import type { Request, Response } from "express";
import { healthService } from "../services/health.service.js";

export async function getHealth(_req: Request, res: Response) {
  const health = await healthService.check();
  res.status(health.db === "up" ? 200 : 503).json(health);
}
