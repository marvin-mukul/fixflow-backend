import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../errors/AppError.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** In-memory multipart parsing (bytes are verified by magic number in the service). */
export function uploadFiles(field: string, maxCount: number) {
  const m = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: maxCount },
  }).array(field, maxCount);
  return (req: Request, res: Response, next: NextFunction) => {
    m(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? "Each file must be 5 MB or smaller"
            : err.code === "LIMIT_FILE_COUNT" ||
                err.code === "LIMIT_UNEXPECTED_FILE"
              ? `Upload at most ${maxCount} files in field "${field}"`
              : err.message;
        return next(
          AppError.validation(
            [{ path: field, message, code: err.code }],
            message,
          ),
        );
      }
      next(err);
    });
  };
}

export function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}
