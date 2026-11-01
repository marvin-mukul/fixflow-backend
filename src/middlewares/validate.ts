import type { NextFunction, Request, Response } from "express";
import type { ZodError, ZodType } from "zod";
import { AppError, type ErrorDetail } from "../errors/AppError.js";

export type RequestSchemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

export function zodIssuesToDetails(err: ZodError): ErrorDetail[] {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));
}

/**
 * Validates and coerces req.body / req.query / req.params.
 * Parsed values are stored on `res.locals.validated` (Express 5 makes req.query read-only).
 */
export function validate(schemas: RequestSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    const out: Record<string, unknown> = {};
    const details: ErrorDetail[] = [];
    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) out[part] = result.data;
      else
        details.push(
          ...zodIssuesToDetails(result.error).map((d) => ({
            ...d,
            path: d.path ? `${part}.${d.path}` : part,
          })),
        );
    }
    if (details.length) return next(AppError.validation(details));
    res.locals.validated = out;
    next();
  };
}
