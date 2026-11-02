import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const settingsRepository = {
  async findAll(tx: TxClient = prisma) {
    const rows = await tx.platformSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value as unknown]));
  },

  async upsertMany(values: Record<string, unknown>, tx: TxClient = prisma) {
    for (const [key, value] of Object.entries(values)) {
      await tx.platformSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      });
    }
  },
};
