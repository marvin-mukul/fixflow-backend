import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const HEADER = "x-request-id";
const VALID = /^[A-Za-z0-9-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get(HEADER);
  req.id = incoming && VALID.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, req.id);
  next();
}
