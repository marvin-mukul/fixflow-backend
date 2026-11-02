import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const paymentRepository = {
  create(data: Prisma.PaymentUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.payment.create({ data });
  },

  findOpenForInvoice(
    invoiceId: string,
    provider: string,
    tx: TxClient = prisma,
  ) {
    return tx.payment.findFirst({
      where: { invoiceId, provider, status: "CREATED" },
      orderBy: { createdAt: "desc" },
    });
  },

  findById(id: string, tx: TxClient = prisma) {
    return tx.payment.findUnique({ where: { id } });
  },

  findByOrderId(providerOrderId: string, tx: TxClient = prisma) {
    return tx.payment.findUnique({ where: { providerOrderId } });
  },

  async lockByOrderId(providerOrderId: string, tx: TxClient) {
    await tx.$queryRaw`SELECT id FROM payment WHERE provider_order_id = ${providerOrderId} FOR UPDATE`;
    return tx.payment.findUnique({ where: { providerOrderId } });
  },

  async lockById(id: string, tx: TxClient) {
    await tx.$queryRaw`SELECT id FROM payment WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.payment.findUnique({ where: { id } });
  },

  update(
    id: string,
    data: Prisma.PaymentUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.payment.update({ where: { id }, data });
  },

  /** Returns false if this (provider, eventId) was already recorded. */
  async recordEvent(
    data: {
      provider: string;
      eventId: string;
      type: string;
      payload: Prisma.InputJsonValue;
    },
    tx: TxClient = prisma,
  ) {
    const r = await tx.paymentEvent.createMany({
      data: [data],
      skipDuplicates: true,
    });
    return r.count === 1;
  },

  list(f: { status?: string }, tx: TxClient = prisma) {
    return tx.payment.findMany({
      where: f.status ? { status: f.status as never } : {},
      include: {
        invoice: {
          select: { id: true, number: true, totalPaise: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },
};
