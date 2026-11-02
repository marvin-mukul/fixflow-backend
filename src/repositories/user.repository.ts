import type { GlobalRole, Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

const withProfileFlag = {
  workerProfile: { select: { id: true } },
} satisfies Prisma.UserInclude;

export type UserRecord = Prisma.UserGetPayload<{
  include: typeof withProfileFlag;
}>;

export const userRepository = {
  findByEmail(email: string, tx: TxClient = prisma) {
    return tx.user.findUnique({ where: { email }, include: withProfileFlag });
  },

  findById(id: string, tx: TxClient = prisma) {
    return tx.user.findUnique({ where: { id }, include: withProfileFlag });
  },

  create(
    data: {
      email: string;
      name: string;
      phone?: string | null;
      passwordHash: string;
      globalRole: GlobalRole;
      mustChangePassword?: boolean;
    },
    tx: TxClient = prisma,
  ) {
    return tx.user.create({ data, include: withProfileFlag });
  },

  update(id: string, data: Prisma.UserUpdateInput, tx: TxClient = prisma) {
    return tx.user.update({ where: { id }, data, include: withProfileFlag });
  },
};
