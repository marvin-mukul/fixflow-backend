import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const jobRepository = {
  create(data: Prisma.JobUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.job.create({ data });
  },
};
