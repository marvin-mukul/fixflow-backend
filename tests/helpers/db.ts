import { prisma } from "../../src/lib/prisma.js";

/** Truncates every app table (keeps migrations). Call in beforeAll/beforeEach of integration files. */
export async function resetDb(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

export { prisma };
