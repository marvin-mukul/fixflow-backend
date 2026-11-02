import { rateLimit } from "express-rate-limit";
import { AppError } from "../errors/AppError.js";

function limiter(limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.rateLimited()),
  });
}

/** Created per app instance so tests get isolated counters. Credential endpoints only. */
export const createAuthLimiter = () => limiter(20, 60_000);
/** Refresh runs on every page load: generous, but still bounded. */
export const createRefreshLimiter = () => limiter(120, 60_000);
export const createRequestCreateLimiter = () => limiter(30, 60 * 60_000);
