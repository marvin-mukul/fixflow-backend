import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env, isProd } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { passportInitialize } from "./middlewares/auth.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import {
  createAuthLimiter,
  createRequestCreateLimiter,
} from "./middlewares/rateLimit.js";
import { requestId } from "./middlewares/requestId.js";
import { createDocsRouter } from "./routes/docs.routes.js";
import { apiRouter, opsRouter } from "./routes/index.js";

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
  // Payment webhooks (Step 9) mount express.raw() before this line.
  app.use(express.json({ limit: "1mb" }));

  app.use(passportInitialize);

  app.use(opsRouter);
  app.use("/api/v1/auth", createAuthLimiter());
  const requestCreateLimiter = createRequestCreateLimiter();
  app.post("/api/v1/requests", requestCreateLimiter);
  app.use("/api/v1", apiRouter);
  if (!isProd || env.SWAGGER_PUBLIC) app.use(createDocsRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
