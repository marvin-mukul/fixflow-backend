import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env, isProd } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { passportInitialize, requireAuth } from "./middlewares/auth.js";
import { requireRole } from "./middlewares/requireRole.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import {
  createAuthLimiter,
  createRefreshLimiter,
  createRequestCreateLimiter,
} from "./middlewares/rateLimit.js";
import { requestId } from "./middlewares/requestId.js";
import { createDocsRouter } from "./routes/docs.routes.js";
import { apiRouter, opsRouter } from "./routes/index.js";
import { webhookRouter } from "./routes/payment.routes.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      customProps: (req) => ({ requestId: (req as express.Request).id }),
    }),
  );
  app.use(
    helmet({
      // Swagger UI needs inline scripts/styles; only relax CSP outside production.
      contentSecurityPolicy: isProd ? undefined : false,
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(cookieParser());
  // Payment webhooks need the raw body for signature checks: mounted before express.json().
  app.use(webhookRouter);
  app.use(express.json({ limit: "1mb" }));

  app.use(passportInitialize);

  app.use(opsRouter);
  const authLimiter = createAuthLimiter();
  for (const p of ["login", "register", "change-password"])
    app.post(`/api/v1/auth/${p}`, authLimiter);
  app.post("/api/v1/auth/refresh", createRefreshLimiter());
  const requestCreateLimiter = createRequestCreateLimiter();
  app.post("/api/v1/requests", requestCreateLimiter);
  app.use("/api/v1", apiRouter);
  // Swagger: public in dev/test (or SWAGGER_PUBLIC=true); admin-only otherwise.
  app.use(
    createDocsRouter(
      !isProd || env.SWAGGER_PUBLIC
        ? []
        : [requireAuth(), requireRole("ADMIN")],
    ),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
