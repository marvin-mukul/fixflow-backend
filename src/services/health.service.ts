import { logger } from "../lib/logger.js";
import { healthRepository } from "../repositories/health.repository.js";

export type HealthStatus = {
  status: "ok" | "degraded";
  db: "up" | "down";
  timestamp: string;
};

export const healthService = {
  async check(): Promise<HealthStatus> {
    let db: HealthStatus["db"] = "up";
    try {
      await healthRepository.pingDatabase();
    } catch (err) {
      logger.warn({ err }, "Database health check failed");
      db = "down";
    }
    return {
      status: db === "up" ? "ok" : "degraded",
      db,
      timestamp: new Date().toISOString(),
    };
  },
};
