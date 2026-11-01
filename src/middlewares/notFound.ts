import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
}
