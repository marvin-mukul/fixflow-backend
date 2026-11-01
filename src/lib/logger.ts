import { pino } from "pino";
import { env, isProd, isTest } from "../config/env.js";

export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.refreshToken",
      "*.secret",
      "*.CASHFREE_SECRET_KEY",
      "*.CASHFREE_WEBHOOK_SECRET",
    ],
    censor: "[redacted]",
  },
  ...(isProd || isTest
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
