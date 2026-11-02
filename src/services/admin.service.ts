import bcrypt from "bcryptjs";
import { AppError } from "../errors/AppError.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { VerificationStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { openStored } from "../lib/storage.js";
import { adminRepository } from "../repositories/admin.repository.js";
import { refreshTokenRepository } from "../repositories/refreshToken.repository.js";
import { settingsRepository } from "../repositories/settings.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import {
  workerRepository,
  type WorkerWithContext,
} from "../repositories/worker.repository.js";
import type { Settings } from "../domain/settings.js";
import { BCRYPT_COST } from "./auth.service.js";
import { notificationService } from "./notification.service.js";
import { settingsService } from "./settings.service.js";
import { toProfileDto } from "./worker.service.js";
import type { Viewer } from "./request.policy.js";

const ratio = (a: number, b: number) =>
  b > 0 ? Math.round((a / b) * 10_000) / 10_000 : 0;

function toAdminWorker(w: WorkerWithContext) {
  return {
    ...toProfileDto(w),
    email: w.user.email,
    phone: w.user.phone,
    createdAt: w.createdAt.toISOString(),
    idDocumentUrl: w.idDocumentPath
      ? `/api/v1/admin/workers/${w.id}/id-document`
      : null,
  };
}

const ALLOWED: Record<"verify" | "reject" | "suspend", VerificationStatus[]> = {
  verify: ["PENDING", "REJECTED", "SUSPENDED"],
  reject: ["PENDING"],
  suspend: ["VERIFIED"],
};
const TARGET = {
  verify: "VERIFIED",
  reject: "REJECTED",
  suspend: "SUSPENDED",
} as const;

export const adminService = {
  async listWorkers(status?: VerificationStatus) {
    return {
      items: (await workerRepository.listByStatus(status)).map(toAdminWorker),
    };
  },

  async setWorkerStatus(
    workerProfileId: string,
    admin: Viewer,
    action: "verify" | "reject" | "suspend",
    reason?: string,
  ) {
    const w = await workerRepository.findById(workerProfileId);
    if (!w) throw AppError.notFound("Worker not found");
    if (!ALLOWED[action].includes(w.verificationStatus))
      throw AppError.invalidTransition(
        `Cannot ${action} a ${w.verificationStatus} worker`,
      );
    if (action === "verify" && (w.categories.length === 0 || !w.idDocumentPath))
      throw AppError.conflict(
        "WORKER_INCOMPLETE",
        "Worker needs at least one category and an ID document",
      );
    const updated = await prisma.$transaction(async (tx) => {
      const u = await workerRepository.update(
        w.id,
        {
          verificationStatus: TARGET[action],
          ...(action === "verify"
            ? { verifiedAt: new Date(), verifiedById: admin.id }
            : {}),
        },
        tx,
      );
      await notificationService.notify(tx, [
        {
          userId: w.userId,
          type: `WORKER_${TARGET[action]}`,
          title:
            action === "verify"
              ? "You're verified"
              : action === "reject"
                ? "Verification rejected"
                : "Account suspended",
          body:
            action === "verify"
              ? "You'll now receive leads near you."
              : (reason ?? ""),
          link: "/worker/profile",
        },
      ]);
      return u;
    });
    return toAdminWorker(updated);
  },

  async idDocument(workerProfileId: string) {
    const w = await workerRepository.findById(workerProfileId);
    if (!w?.idDocumentPath) throw AppError.notFound("No ID document");
    const file = await openStored(w.idDocumentPath).catch(() => {
      throw AppError.notFound("File missing");
    });
    const ext = w.idDocumentPath.split(".").pop() ?? "bin";
    const mime =
      ext === "pdf"
        ? "application/pdf"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";
    return { ...file, mimeType: mime, filename: `id-${w.id}.${ext}` };
  },

  async stats() {
    const s = await adminRepository.stats();
    const count = <T extends { _count: { _all: number } }>(
      rows: T[],
      key: keyof T,
    ) => Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all]));
    return {
      users: count(s.usersByRole, "globalRole"),
      workers: count(s.workers, "verificationStatus"),
      requests: count(s.requestsByStatus, "status"),
      jobs: { total: s.jobs, completed: s.completedJobs },
      money: {
        gmvPaise: s.paid._sum.totalPaise ?? 0,
        commissionPaise: s.paid._sum.commissionPaise ?? 0,
        commissionGstPaise: s.paid._sum.commissionGstPaise ?? 0,
        paidInvoices: s.paid._count._all,
      },
      rates: {
        acceptance: ratio(s.accepted, s.everOpened),
        completion: ratio(s.completedJobs, s.jobs),
        dispute: ratio(s.disputes, s.jobs),
      },
    };
  },

  async getSettings() {
    return settingsService.getSettings();
  },

  /** Only affects new invoices: issued invoices keep their ratesSnapshot. */
  async updateSettings(patch: Partial<Settings>) {
    await prisma.$transaction((tx) =>
      settingsRepository.upsertMany(
        patch as Record<string, Prisma.InputJsonValue>,
        tx,
      ),
    );
    settingsService.invalidate();
    return settingsService.getSettings();
  },

  async listAdmins() {
    const rows = await adminRepository.listAdmins();
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        globalRole: u.globalRole as "ADMIN" | "SUPERADMIN",
        mustChangePassword: u.mustChangePassword,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  },

  async createAdmin(input: { name: string; email: string; password: string }) {
    if (await userRepository.findByEmail(input.email))
      throw AppError.conflict(
        "EMAIL_TAKEN",
        "An account with this email already exists",
      );
    await userRepository.create({
      email: input.email,
      name: input.name,
      globalRole: "ADMIN",
      passwordHash: await bcrypt.hash(input.password, BCRYPT_COST),
      mustChangePassword: true,
    });
    return (await this.listAdmins()).items.find(
      (a) => a.email === input.email,
    )!;
  },

  /** Soft-delete + revoke sessions. Superadmins can't be removed here. */
  async removeAdmin(id: string, actor: Viewer) {
    if (id === actor.id)
      throw AppError.conflict(
        "CANNOT_REMOVE_SELF",
        "You can't remove yourself",
      );
    const u = await userRepository.findById(id);
    if (!u || u.deletedAt || u.globalRole !== "ADMIN")
      throw AppError.notFound("Admin not found");
    await prisma.$transaction(async (tx) => {
      await userRepository.update(
        id,
        {
          status: "DELETED",
          deletedAt: new Date(),
          email: `deleted+${id}@fixflow.invalid`,
        },
        tx,
      );
      await refreshTokenRepository.revokeAllForUser(id, tx);
    });
  },
};
