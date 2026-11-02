import type { InvitationType } from "../generated/prisma/enums.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const invitationRepository = {
  create(
    data: {
      type: InvitationType;
      propertyId: string;
      inviterId: string;
      email: string;
      phone?: string | null;
      tokenHash: string;
      expiresAt: Date;
    },
    tx: TxClient = prisma,
  ) {
    return tx.invitation.create({ data });
  },

  findByTokenHash(tokenHash: string, tx: TxClient = prisma) {
    return tx.invitation.findUnique({
      where: { tokenHash },
      include: {
        property: {
          select: { id: true, label: true, city: true, deletedAt: true },
        },
        inviter: { select: { name: true } },
      },
    });
  },

  listPendingForProperty(propertyId: string, tx: TxClient = prisma) {
    return tx.invitation.findMany({
      where: { propertyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Single-use: returns false if someone else already accepted it. */
  async markAccepted(id: string, tx: TxClient = prisma) {
    const r = await tx.invitation.updateMany({
      where: { id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    return r.count === 1;
  },
};
