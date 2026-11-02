import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";
import { propertyRouter } from "./property.routes.js";

/** Versioned API routes, mounted at /api/v1. Each area adds its router here. */
export const apiRouter = Router();
apiRouter.use(authRouter);
apiRouter.use(propertyRouter);

/** Unversioned operational routes. */
export const opsRouter = Router();
opsRouter.use(healthRouter);
