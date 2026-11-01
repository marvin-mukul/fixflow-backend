import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { isProd } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { zodIssuesToDetails } from "./validate.js";

type PrismaKnownError = { code: string; name: string; meta?: unknown };

function isPrismaKnownError(err: unknown): err is PrismaKnownError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "PrismaClientKnownRequestError" &&
    typeof (err as { code?: unknown }).code === "string"
  );
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError)
    return AppError.validation(zodIssuesToDetails(err));
  if (isPrismaKnownError(err)) {
    if (err.code === "P2002")
      return AppError.conflict("CONFLICT", "Resource already exists");
    if (err.code === "P2025") return AppError.notFound();
  }
  // express.json() body parse errors
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { type?: string }).type === "entity.parse.failed"
  ) {
    return new AppError(400, "BAD_REQUEST", "Malformed JSON body");
  }
  return AppError.internal();
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const appErr = toAppError(err);
  if (appErr.status >= 500) {
    logger.error({ err, requestId: req.id }, "Unhandled error");
  }
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message:
        appErr.status >= 500 && isProd
          ? "Something went wrong"
          : appErr.message,
      details: appErr.details,
      requestId: req.id,
      ...(!isProd && appErr.status >= 500 && err instanceof Error
        ? { stack: err.stack }
        : {}),
    },
  });
}
