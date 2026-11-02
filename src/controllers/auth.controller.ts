import type { CookieOptions, Request, Response } from "express";
import { isProd } from "../config/env.js";
import { currentUser, validated } from "../lib/http.js";
import type { UserRecord } from "../repositories/user.repository.js";
import type {
  ChangePasswordInput,
  RegisterInput,
} from "../schemas/auth.schema.js";
import { authService, type Session } from "../services/auth.service.js";

export const REFRESH_COOKIE = "ff_refresh";

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  path: "/api/v1/auth",
  maxAge: authService.refreshTtlMs,
});

function sendSession(res: Response, session: Session, status = 200) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions());
  res
    .status(status)
    .json({ accessToken: session.accessToken, user: session.user });
}

const readCookie = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

export const authController = {
  async register(_req: Request, res: Response) {
    const { body } = validated<{ body: RegisterInput }>(res);
    sendSession(res, await authService.register(body), 201);
  },

  async login(_req: Request, res: Response) {
    const user = res.locals.loginUser as UserRecord;
    sendSession(res, await authService.createSession(user.id));
  },

  async refresh(req: Request, res: Response) {
    try {
      sendSession(res, await authService.refresh(readCookie(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
      throw err;
    }
  },

  async logout(req: Request, res: Response) {
    await authService.logout(readCookie(req));
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    res.json(await authService.me(currentUser(req).id));
  },

  async deleteAccount(req: Request, res: Response) {
    const { body } = validated<{ body: { password: string } }>(res);
    await authService.deleteAccount(currentUser(req).id, body.password);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    res.status(204).end();
  },

  async changePassword(req: Request, res: Response) {
    const { body } = validated<{ body: ChangePasswordInput }>(res);
    sendSession(
      res,
      await authService.changePassword(currentUser(req).id, body),
    );
  },
};
