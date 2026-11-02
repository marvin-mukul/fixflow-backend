import type { Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

/** Typed access to data parsed by the `validate` middleware. */
export function validated<
  T extends { body?: unknown; query?: unknown; params?: unknown },
>(res: Response): T {
  return (res.locals.validated ?? {}) as T;
}

/** The authenticated user; `requireAuth` guarantees presence. */
export function currentUser(req: Request): Express.User {
  if (!req.user) throw AppError.unauthenticated();
  return req.user;
}
