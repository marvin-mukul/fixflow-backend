import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { healthRouter } from "./health.routes.js";
import { propertyRouter } from "./property.routes.js";
import { requestRouter } from "./request.routes.js";
import { notificationRouter } from "./notification.routes.js";
import { categoryRouter } from "./category.routes.js";

/** Versioned API routes, mounted at /api/v1. Each area adds its router here. */
export const apiRouter = Router();
apiRouter.use(authRouter);
apiRouter.use(propertyRouter);
apiRouter.use(categoryRouter);
apiRouter.use(requestRouter);
apiRouter.use(notificationRouter);

/** Unversioned operational routes. */
export const opsRouter = Router();
opsRouter.use(healthRouter);
