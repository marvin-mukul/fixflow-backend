import { pino, type LoggerOptions } from "pino";
import { env, isProd, isTest } from "../config/env.js";

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-webhook-signature"]',
  'res.headers["set-cookie"]',
  "password",
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.secret",
  "*.secretKey",
  "*.CASHFREE_SECRET_KEY",
  "*.CASHFREE_WEBHOOK_SECRET",
  "*.card",
  "*.upi_id",
  "*.payment_method",
];

export const loggerOptions: LoggerOptions = {
  level: isTest ? "silent" : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
};

export const logger = pino({
  ...loggerOptions,
  ...(isProd || isTest
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
