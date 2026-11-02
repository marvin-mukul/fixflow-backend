import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { randomToken, sha256, uuid } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { refreshTokenRepository } from "../repositories/refreshToken.repository.js";
import {
  userRepository,
  type UserRecord,
} from "../repositories/user.repository.js";
import type {
  ChangePasswordInput,
  RegisterInput,
  UserDtoT,
} from "../schemas/auth.schema.js";

export const BCRYPT_COST = 12;
const REFRESH_TTL_MS = env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
// Compared against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

export type AccessPayload = { sub: string; role: string };
export type Session = {
  accessToken: string;
  refreshToken: string;
  user: UserDtoT;
};

export function toUserDto(u: UserRecord): UserDtoT {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    globalRole: u.globalRole,
    mustChangePassword: u.mustChangePassword,
    hasWorkerProfile: Boolean(u.workerProfile),
  };
}

function signAccess(u: UserRecord): string {
  const payload: AccessPayload = { sub: u.id, role: u.globalRole };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"],
  });
}

async function issueRefresh(userId: string, familyId = uuid()) {
  const token = randomToken(48);
  const row = await refreshTokenRepository.create({
    userId,
    tokenHash: sha256(token),
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return { token, row };
}

function assertActive(u: UserRecord) {
  if (u.status === "SUSPENDED")
    throw new AppError(403, "ACCOUNT_SUSPENDED", "This account is suspended");
  if (u.status === "DELETED" || u.deletedAt)
    throw AppError.unauthenticated("Invalid credentials");
}

export const authService = {
  refreshTtlMs: REFRESH_TTL_MS,

  async register(input: RegisterInput): Promise<Session> {
    const existing = await userRepository.findByEmail(input.email);
    if (existing)
      throw AppError.conflict(
        "EMAIL_TAKEN",
        "An account with this email already exists",
      );
    const user = await userRepository.create({
      email: input.email,
      name: input.name,
      phone: input.phone ?? null,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_COST),
      globalRole: input.role,
    });
    const { token } = await issueRefresh(user.id);
    return {
      accessToken: signAccess(user),
      refreshToken: token,
      user: toUserDto(user),
    };
  },

  /** Used by the passport-local strategy. Returns null on bad credentials. */
  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<UserRecord | null> {
    const user = await userRepository.findByEmail(email.trim().toLowerCase());
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) return null;
    assertActive(user);
    return user;
  },

  async createSession(userId: string): Promise<Session> {
    const user = await userRepository.update(userId, {
      lastLoginAt: new Date(),
    });
    const { token } = await issueRefresh(user.id);
    return {
      accessToken: signAccess(user),
      refreshToken: token,
      user: toUserDto(user),
    };
  },

  /** Rotates the refresh token. Reuse of a revoked token revokes the whole family. */
  async refresh(presented: string | undefined): Promise<Session> {
    if (!presented) throw AppError.unauthenticated("No refresh token");
    const row = await refreshTokenRepository.findByHash(sha256(presented));
    if (!row) throw AppError.unauthenticated("Invalid refresh token");
    if (row.revokedAt) {
      await refreshTokenRepository.revokeFamily(row.familyId);
      throw AppError.unauthenticated(
        "Refresh token reuse detected; please log in again",
      );
    }
    if (row.expiresAt.getTime() <= Date.now())
      throw AppError.unauthenticated("Refresh token expired");

    const user = await userRepository.findById(row.userId);
    if (!user) throw AppError.unauthenticated();
    assertActive(user);

    return prisma.$transaction(async (tx) => {
      const token = randomToken(48);
      const next = await refreshTokenRepository.create(
        {
          userId: user.id,
          tokenHash: sha256(token),
          familyId: row.familyId,
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
        tx,
      );
      const revoked = await refreshTokenRepository.revoke(row.id, next.id, tx);
      if (revoked === 0) {
        // A concurrent refresh already used this token: treat as reuse.
        throw AppError.unauthenticated("Refresh token already used");
      }
      return {
        accessToken: signAccess(user),
        refreshToken: token,
        user: toUserDto(user),
      };
    });
  },

  async logout(presented: string | undefined): Promise<void> {
    if (!presented) return;
    const row = await refreshTokenRepository.findByHash(sha256(presented));
    if (row) await refreshTokenRepository.revokeFamily(row.familyId);
  },

  async me(userId: string): Promise<UserDtoT> {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.unauthenticated();
    return toUserDto(user);
  },

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<Session> {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.unauthenticated();
    const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!ok)
      throw AppError.validation([
        { path: "currentPassword", message: "Current password is incorrect" },
      ]);
    const updated = await prisma.$transaction(async (tx) => {
      await refreshTokenRepository.revokeAllForUser(user.id, tx);
      return userRepository.update(
        user.id,
        {
          passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_COST),
          mustChangePassword: false,
        },
        tx,
      );
    });
    const { token } = await issueRefresh(updated.id);
    return {
      accessToken: signAccess(updated),
      refreshToken: token,
      user: toUserDto(updated),
    };
  },

  /** For passport-jwt: loads the current user for a verified token. */
  async userForToken(userId: string): Promise<Express.User | null> {
    const u = await userRepository.findById(userId);
    if (!u || u.status !== "ACTIVE" || u.deletedAt) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      globalRole: u.globalRole,
      mustChangePassword: u.mustChangePassword,
    };
  },
};
