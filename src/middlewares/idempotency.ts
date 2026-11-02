import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import { idempotencyRepository } from "../repositories/idempotency.repository.js";
import { logger } from "../lib/logger.js";

const KEY = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Requires an `Idempotency-Key` header. A replay with the same key (same user + route) returns the
 * stored status + body. 2xx and 4xx responses are stored; 5xx are not (so the client can retry).
 * Must run after requireAuth().
 */
export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.get("Idempotency-Key");
      if (!key || !KEY.test(key)) {
        throw AppError.validation(
          [
            {
              path: "headers.idempotency-key",
              message: "Idempotency-Key header (8–128 chars) is required",
            },
          ],
          "Idempotency-Key header is required",
        );
      }
      const userId = req.user!.id;
      const route = `${req.method} ${req.baseUrl}${req.path}`;
      const existing = await idempotencyRepository.find(key);
      if (existing) {
        if (existing.userId !== userId || existing.route !== route) {
          throw AppError.conflict(
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was used for a different request",
          );
        }
        res.setHeader("Idempotent-Replay", "true");
        res.status(existing.responseStatus).json(existing.responseBody);
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        const status = res.statusCode;
        if (status >= 500) return originalJson(body);
        idempotencyRepository
          .save({
            key,
            userId,
            route,
            responseStatus: status,
            responseBody: body ?? null,
          })
          .catch((err: unknown) =>
            logger.warn(
              { err },
              "idempotency save failed (likely concurrent duplicate)",
            ),
          )
          .finally(() => originalJson(body));
        return res;
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
