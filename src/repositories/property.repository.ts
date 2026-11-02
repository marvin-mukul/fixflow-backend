import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

const listInclude = {
  owner: { select: { name: true } },
  tenancies: { where: { status: "ACTIVE" }, select: { tenantId: true } },
} satisfies Prisma.PropertyInclude;

export type PropertyRow = Prisma.PropertyGetPayload<{
  include: typeof listInclude;
}>;

/** A property is visible to its owner and to active tenants. */
export const visibleTo = (userId: string): Prisma.PropertyWhereInput => ({
  deletedAt: null,
  OR: [
    { ownerId: userId },
    { tenancies: { some: { tenantId: userId, status: "ACTIVE" } } },
  ],
});

export const propertyRepository = {
  listVisible(userId: string, tx: TxClient = prisma) {
    return tx.property.findMany({
      where: visibleTo(userId),
      include: listInclude,
      orderBy: { createdAt: "desc" },
    });
  },

  findVisible(id: string, userId: string, tx: TxClient = prisma) {
    return tx.property.findFirst({
      where: { id, ...visibleTo(userId) },
      include: listInclude,
    });
  },

  findById(id: string, tx: TxClient = prisma) {
    return tx.property.findFirst({
      where: { id, deletedAt: null },
      include: listInclude,
    });
  },

  create(data: Prisma.PropertyUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.property.create({ data, include: listInclude });
  },

  update(
    id: string,
    data: Prisma.PropertyUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.property.update({ where: { id }, data, include: listInclude });
  },

  softDelete(id: string, tx: TxClient = prisma) {
    return tx.property.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },
};
