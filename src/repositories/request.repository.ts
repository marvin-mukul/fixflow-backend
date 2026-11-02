import type { RequestStatus } from "../generated/prisma/enums.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const TERMINAL_STATUSES: RequestStatus[] = [
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];

export const requestRepository = {
  countOpenForProperty(propertyId: string, tx: TxClient = prisma) {
    return tx.repairRequest.count({
      where: { propertyId, status: { notIn: TERMINAL_STATUSES } },
    });
  },
};
