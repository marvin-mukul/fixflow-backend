import { execSync } from "node:child_process";
import "dotenv/config";

/** Applies migrations to the test database once per integration run. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url)
    throw new Error("DATABASE_URL_TEST is required for integration tests");
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
