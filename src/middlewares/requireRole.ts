import type { NextFunction, Request, Response } from "express";
import type { GlobalRole } from "../generated/prisma/enums.js";
import { AppError } from "../errors/AppError.js";

/** Use after requireAuth(). SUPERADMIN passes any ADMIN gate. */
export function requireRole(...roles: GlobalRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.globalRole;
    if (!role) return next(AppError.unauthenticated());
    const allowed =
      roles.includes(role) ||
      (role === "SUPERADMIN" && roles.includes("ADMIN"));
    if (!allowed) return next(AppError.forbidden());
    next();
  };
}
