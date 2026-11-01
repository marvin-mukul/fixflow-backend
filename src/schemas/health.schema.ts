import { z } from "zod";
import "../lib/openapi.js";

export const HealthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    db: z.enum(["up", "down"]),
    timestamp: z.string().datetime(),
  })
  .openapi("HealthResponse", {
    example: { status: "ok", db: "up", timestamp: "2026-11-01T10:00:00.000Z" },
  });
