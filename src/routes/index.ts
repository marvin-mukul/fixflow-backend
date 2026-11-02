import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";

/** Versioned API routes, mounted at /api/v1. Each area adds its router here. */
export const apiRouter = Router();
apiRouter.use(authRouter);

/** Unversioned operational routes. */
export const opsRouter = Router();
opsRouter.use(healthRouter);
