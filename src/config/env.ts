import "dotenv/config";
import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  /** Public base URL of this API (payment return/notify URLs). */
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SEED_SUPERADMIN_EMAIL: z
    .string()
    .email()
    .default("marvin.mukul@rubicotech.in"),
  SEED_SUPERADMIN_PASSWORD: z.string().min(6).optional(),
  // Empty SMTP_HOST → emails are logged to the console (dev/test, no mail server needed).
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("FixFlow <no-reply@fixflow.local>"),
  UPLOAD_DIR: z.string().default("./uploads"),
  SWAGGER_PUBLIC: bool,
  PAYMENT_PROVIDER: z.enum(["mock", "cashfree"]).default("mock"),
  CASHFREE_APP_ID: z.string().optional(),
  CASHFREE_SECRET_KEY: z.string().optional(),
  CASHFREE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  CASHFREE_WEBHOOK_SECRET: z.string().optional(),
  CASHFREE_API_VERSION: z.string().default("2025-01-01"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", z.prettifyError(parsed.error));
    process.exit(1);
  }
  const data = parsed.data;
  // Tests always run against the dedicated test database.
  if (data.NODE_ENV === "test") {
    if (!data.DATABASE_URL_TEST) {
      console.error("DATABASE_URL_TEST is required when NODE_ENV=test");
      process.exit(1);
    }
    data.DATABASE_URL = data.DATABASE_URL_TEST;
  }
  return data;
}

export const env = load();
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
