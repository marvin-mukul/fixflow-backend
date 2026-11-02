import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const reviewRepository = {
  create(data: Prisma.ReviewUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.review.create({ data });
  },
  findById(id: string, tx: TxClient = prisma) {
    return tx.review.findUnique({
      where: { id },
      include: {
        job: { include: { request: { select: { categoryId: true } } } },
      },
    });
  },
  update(
    id: string,
    data: Prisma.ReviewUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.review.update({ where: { id }, data });
  },
  async listForWorker(
    workerProfileId: string,
    f: { cursor?: string; limit: number },
    tx: TxClient = prisma,
  ) {
    const rows = await tx.review.findMany({
      where: { revieweeType: "WORKER", job: { workerProfileId } },
      include: {
        reviewer: { select: { name: true } },
        job: {
          select: {
            request: { select: { category: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > f.limit;
    const items = hasMore ? rows.slice(0, f.limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  },
};

export const disputeRepository = {
  create(data: Prisma.DisputeUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.dispute.create({ data });
  },
  findById(id: string, tx: TxClient = prisma) {
    return tx.dispute.findUnique({
      where: { id },
      include: { job: { select: { id: true, requestId: true } } },
    });
  },
  resolve(
    id: string,
    data: { resolution: string; resolvedById: string },
    tx: TxClient = prisma,
  ) {
    return tx.dispute.update({
      where: { id },
      data: { ...data, status: "RESOLVED", resolvedAt: new Date() },
    });
  },
  list(status: "OPEN" | "RESOLVED" | undefined, tx: TxClient = prisma) {
    return tx.dispute.findMany({
      where: status ? { status } : {},
      include: {
        raisedBy: { select: { id: true, name: true } },
        job: {
          select: {
            id: true,
            requestId: true,
            finalAmountPaise: true,
            request: { select: { title: true, status: true } },
            workerProfile: {
              select: { id: true, user: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },
};
