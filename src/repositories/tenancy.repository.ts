import { prisma, type TxClient } from "../lib/prisma.js";

export const tenancyRepository = {
  listForProperty(propertyId: string, tx: TxClient = prisma) {
    return tx.tenancy.findMany({
      where: { propertyId },
      include: { tenant: { select: { id: true, name: true, email: true } } },
      orderBy: { startDate: "desc" },
    });
  },

  findActive(propertyId: string, tenantId: string, tx: TxClient = prisma) {
    return tx.tenancy.findFirst({
      where: { propertyId, tenantId, status: "ACTIVE" },
    });
  },

  findById(id: string, tx: TxClient = prisma) {
    return tx.tenancy.findUnique({ where: { id } });
  },

  createActive(propertyId: string, tenantId: string, tx: TxClient = prisma) {
    return tx.tenancy.create({
      data: { propertyId, tenantId, status: "ACTIVE", startDate: new Date() },
    });
  },

  end(id: string, tx: TxClient = prisma) {
    return tx.tenancy.update({
      where: { id },
      data: { status: "ENDED", endDate: new Date() },
    });
  },

  countActiveForProperty(propertyId: string, tx: TxClient = prisma) {
    return tx.tenancy.count({ where: { propertyId, status: "ACTIVE" } });
  },
};
