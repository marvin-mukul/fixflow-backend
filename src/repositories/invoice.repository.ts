import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";
import { requestInclude } from "./request.repository.js";

export const invoiceInclude = {
  job: {
    include: {
      request: { include: requestInclude },
      quote: { select: { id: true, labourPaise: true, materialsPaise: true } },
      workerProfile: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  },
  payments: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithContext = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

export const invoiceRepository = {
  /** Atomic per-FY sequence (row lock via upsert increment). */
  async nextSeq(fy: string, tx: TxClient) {
    const row = await tx.invoiceCounter.upsert({
      where: { fy },
      create: { fy, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    });
    return row.lastSeq;
  },

  create(data: Prisma.InvoiceUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.invoice.create({ data });
  },

  findByJobId(jobId: string, tx: TxClient = prisma) {
    return tx.invoice.findUnique({ where: { jobId }, include: invoiceInclude });
  },

  findById(id: string, tx: TxClient = prisma) {
    return tx.invoice.findUnique({ where: { id }, include: invoiceInclude });
  },

  async lockById(id: string, tx: TxClient) {
    await tx.$queryRaw`SELECT id FROM invoice WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.invoice.findUnique({ where: { id }, include: invoiceInclude });
  },

  update(
    id: string,
    data: Prisma.InvoiceUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.invoice.update({ where: { id }, data });
  },

  listForWorker(workerProfileId: string, tx: TxClient = prisma) {
    return tx.invoice.findMany({
      where: { job: { workerProfileId } },
      include: {
        job: {
          select: { id: true, request: { select: { id: true, title: true } } },
        },
      },
      orderBy: { issuedAt: "desc" },
      take: 200,
    });
  },
};
