// Truncates every app table in DATABASE_URL and re-seeds. For local E2E runs only.
import { seed } from "../prisma/seed.js";
import { prisma } from "../src/lib/prisma.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset in production");
  process.exit(1);
}
const rows = await prisma.$queryRaw<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
if (rows.length) {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}
await seed(prisma);
await prisma.$disconnect();
console.log("E2E database reset + seeded");
