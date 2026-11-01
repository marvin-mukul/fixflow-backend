import { Router } from "express";
import { getHealth } from "../controllers/health.controller.js";
import { errorResponses, registry } from "../lib/openapi.js";
import { HealthResponseSchema } from "../schemas/health.schema.js";

export const healthRouter = Router();

healthRouter.get("/health", getHealth);

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Ops"],
  summary: "Liveness + database check",
  description: "Public. Returns 503 when the database is unreachable.",
  responses: {
    200: {
      description: "API and database are up",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
    503: {
      description: "Database is down",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
    ...errorResponses(500),
  },
});
