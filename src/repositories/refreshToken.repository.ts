import { prisma, type TxClient } from "../lib/prisma.js";

export const refreshTokenRepository = {
  create(
    data: {
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
    },
    tx: TxClient = prisma,
  ) {
    return tx.refreshToken.create({ data });
  },

  findByHash(tokenHash: string, tx: TxClient = prisma) {
    return tx.refreshToken.findUnique({ where: { tokenHash } });
  },

  /** Marks one token used; returns 0 if it was already revoked (lost race). */
  async revoke(id: string, replacedById: string | null, tx: TxClient = prisma) {
    const r = await tx.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById },
    });
    return r.count;
  },

  revokeFamily(familyId: string, tx: TxClient = prisma) {
    return tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  revokeAllForUser(userId: string, tx: TxClient = prisma) {
    return tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
