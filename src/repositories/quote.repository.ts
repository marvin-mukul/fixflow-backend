import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

const listInclude = {
  workerProfile: {
    include: {
      user: { select: { id: true, name: true } },
      stats: true,
    },
  },
} satisfies Prisma.QuoteInclude;

export type QuoteWithWorker = Prisma.QuoteGetPayload<{
  include: typeof listInclude;
}>;

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

  create(data: Prisma.QuoteUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.quote.create({ data, include: listInclude });
  },

  findById(id: string, tx: TxClient = prisma) {
    return tx.quote.findUnique({ where: { id }, include: listInclude });
  },

  async lockById(id: string, tx: TxClient) {
    await tx.$queryRaw`SELECT id FROM quote WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.quote.findUnique({ where: { id }, include: listInclude });
  },

  /** Revise: only a SUBMITTED quote; bumps version atomically. Returns null if it lost a race. */
  async revise(
    id: string,
    data: Prisma.QuoteUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    const r = await tx.quote.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { ...data, version: { increment: 1 } },
    });
    return r.count === 1
      ? tx.quote.findUnique({ where: { id }, include: listInclude })
      : null;
  },

  async setStatusIf(
    id: string,
    from: "SUBMITTED",
    to: "WITHDRAWN" | "ACCEPTED",
    tx: TxClient = prisma,
  ) {
    const r = await tx.quote.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    return r.count === 1;
  },

  /** Rejects all other SUBMITTED quotes; returns their worker user ids for notifications. */
  async rejectSiblings(requestId: string, acceptedId: string, tx: TxClient) {
    const siblings = await tx.quote.findMany({
      where: { requestId, status: "SUBMITTED", id: { not: acceptedId } },
      select: { id: true, workerProfile: { select: { userId: true } } },
    });
    await tx.quote.updateMany({
      where: { id: { in: siblings.map((s) => s.id) } },
      data: { status: "REJECTED" },
    });
    return siblings.map((s) => s.workerProfile.userId);
  },

  /** Payer view: active quotes ordered by stored rank (from RequestMatch). */
  listForRequest(
    requestId: string,
    opts: { workerProfileId?: string } = {},
    tx: TxClient = prisma,
  ) {
    return tx.quote.findMany({
      where: {
        requestId,
        ...(opts.workerProfileId
          ? { workerProfileId: opts.workerProfileId }
          : { status: { not: "WITHDRAWN" } }),
      },
      include: listInclude,
      orderBy: { createdAt: "asc" },
    });
  },

  listForWorker(workerProfileId: string, tx: TxClient = prisma) {
    return tx.quote.findMany({
      where: { workerProfileId },
      include: {
        request: {
          select: { id: true, title: true, status: true, priority: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },

  expireStale(now: Date, tx: TxClient = prisma) {
    return tx.quote.updateMany({
      where: { status: "SUBMITTED", validUntil: { lt: now } },
      data: { status: "EXPIRED" },
    });
  },
};
