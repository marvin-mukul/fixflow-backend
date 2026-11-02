import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const idempotencyRepository = {
  find(key: string, tx: TxClient = prisma) {
    return tx.idempotencyKey.findUnique({ where: { key } });
  },
  save(
    data: {
      key: string;
      userId: string;
      route: string;
      responseStatus: number;
      responseBody: unknown;
    },
    tx: TxClient = prisma,
  ) {
    return tx.idempotencyKey.create({
      data: {
        ...data,
        responseBody: data.responseBody as Prisma.InputJsonValue,
      },
    });
  },
};
