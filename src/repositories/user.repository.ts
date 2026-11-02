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

export const accountRepository = {
  /** Open obligations that block self-deletion. */
  async openObligations(userId: string, tx: TxClient = prisma) {
    const [requests, jobs, unpaid] = await Promise.all([
      tx.repairRequest.count({
        where: {
          OR: [{ raisedById: userId }, { payerUserId: userId }],
          status: { notIn: ["COMPLETED", "REJECTED", "EXPIRED", "CANCELLED"] },
        },
      }),
      tx.job.count({
        where: {
          workerProfile: { userId },
          request: {
            status: {
              in: ["SCHEDULED", "IN_PROGRESS", "PENDING_SIGN_OFF", "DISPUTED"],
            },
          },
        },
      }),
      tx.invoice.count({
        where: { status: "ISSUED", job: { request: { payerUserId: userId } } },
      }),
    ]);
    return { requests, jobs, unpaid };
  },

  /** Soft-delete + anonymise PII; history rows keep their foreign keys. */
  async anonymise(userId: string, tx: TxClient) {
    await tx.user.update({
      where: { id: userId },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
        email: `deleted+${userId}@fixflow.invalid`,
        name: "Deleted user",
        phone: null,
        passwordHash: "!",
      },
    });
    await tx.workerProfile.updateMany({
      where: { userId },
      data: { isAvailable: false, bio: "", gstin: null, idDocumentPath: null },
    });
    await tx.tenancy.updateMany({
      where: { tenantId: userId, status: "ACTIVE" },
      data: { status: "ENDED", endDate: new Date() },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
