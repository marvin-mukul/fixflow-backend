// Idempotent seed — filled in Step 1 (requirements.md §3.3).
import { prisma } from "../src/lib/prisma.js";

async function main(): Promise<void> {}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
