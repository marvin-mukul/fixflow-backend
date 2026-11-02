import { prisma, type TxClient } from "../lib/prisma.js";

export const quoteRepository = {
  countSubmitted(requestId: string, tx: TxClient = prisma) {
    return tx.quote.count({ where: { requestId, status: "SUBMITTED" } });
  },

  rejectOpenForRequest(requestId: string, tx: TxClient = prisma) {
    return tx.quote.updateMany({
      where: { requestId, status: "SUBMITTED" },
      data: { status: "REJECTED" },
    });
  },
};
