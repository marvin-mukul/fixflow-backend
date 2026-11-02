import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const categoryRepository = {
  listActive(tx: TxClient = prisma) {
    return tx.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  },
  listAll(tx: TxClient = prisma) {
    return tx.serviceCategory.findMany({ orderBy: { name: "asc" } });
  },
  findById(id: string, tx: TxClient = prisma) {
    return tx.serviceCategory.findUnique({ where: { id } });
  },
  create(data: Prisma.ServiceCategoryCreateInput, tx: TxClient = prisma) {
    return tx.serviceCategory.create({ data });
  },
  update(
    id: string,
    data: Prisma.ServiceCategoryUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.serviceCategory.update({ where: { id }, data });
  },
};
