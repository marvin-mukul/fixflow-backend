import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { PaymentStatus } from "../generated/prisma/enums.js";
import { uuid } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { prisma, type TxClient } from "../lib/prisma.js";
import { getPaymentProvider } from "../payments/index.js";
import type { Checkout, WebhookEvent } from "../payments/PaymentProvider.js";
import { buildMockWebhook } from "../payments/providers/mock.js";
import {
  invoiceRepository,
  type InvoiceWithContext,
} from "../repositories/invoice.repository.js";
import { paymentRepository } from "../repositories/payment.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import {
  notificationService,
  type AfterCommit,
} from "./notification.service.js";
import { requestPolicy, type Viewer } from "./request.policy.js";
import { runAfterCommit } from "./requestWorkflow.service.js";

/** Forward-only payment state (requirements.md §5.2.6). FAILED → PAID allowed: a retry on the same order can succeed. */
const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ["PAID", "FAILED"],
  FAILED: ["PAID"],
  PAID: ["REFUNDED", "PARTIALLY_REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED", "PARTIALLY_REFUNDED"],
  REFUNDED: [],
};

async function loadInvoiceForPayer(invoiceId: string, user: Viewer) {
  const inv = await invoiceRepository.findById(invoiceId);
  const rel = requestPolicy.assertVisible(inv?.job.request ?? null, user);
  if (!rel.includes("PAYER"))
    throw AppError.forbidden("Only the payer can pay this invoice");
  return inv!;
}

function invoiceLink(inv: InvoiceWithContext) {
  return `/requests/${inv.job.requestId}`;
}

/**
 * Single convergence point for return URL + webhook (system-design.md §6): lock payment,
 * move forward only, mirror onto the invoice. Idempotent.
 */
async function applyProviderStatus(
  tx: TxClient,
  providerOrderId: string,
  status: "PAID" | "FAILED" | "PENDING" | "REFUNDED",
  extra: { providerPaymentId?: string; amountPaise?: number },
  afterCommit: AfterCommit,
) {
  const p = await paymentRepository.lockByOrderId(providerOrderId, tx);
  if (!p) throw AppError.notFound("Payment not found");
  if (status === "PENDING") return p;

  if (
    status === "PAID" &&
    extra.amountPaise !== undefined &&
    extra.amountPaise !== p.amountPaise
  ) {
    logger.error(
      { providerOrderId, expected: p.amountPaise, got: extra.amountPaise },
      "payment amount mismatch",
    );
    if (p.status === "CREATED")
      return paymentRepository.update(
        p.id,
        { status: "FAILED", failureReason: "AMOUNT_MISMATCH" },
        tx,
      );
    return p;
  }
  const target: PaymentStatus =
    status === "REFUNDED"
      ? (extra.amountPaise ?? p.amountPaise) >= p.amountPaise
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED"
      : status;
  if (target === p.status || !ALLOWED[p.status].includes(target)) return p; // no-op (duplicate / out of order)

  const updated = await paymentRepository.update(
    p.id,
    {
      status: target,
      providerPaymentId: extra.providerPaymentId ?? p.providerPaymentId,
      ...(target === "FAILED" ? { failureReason: "Declined at gateway" } : {}),
      ...(target === "REFUNDED" || target === "PARTIALLY_REFUNDED"
        ? {
            refundedPaise: Math.max(
              p.refundedPaise,
              extra.amountPaise ?? p.amountPaise,
            ),
          }
        : {}),
    },
    tx,
  );
  const inv = (await invoiceRepository.lockById(p.invoiceId, tx))!;
  if (target === "PAID" && inv.status === "ISSUED") {
    await invoiceRepository.update(
      inv.id,
      { status: "PAID", paidAt: new Date() },
      tx,
    );
    await notificationService.notify(
      tx,
      [
        {
          userId: inv.job.request.payerUserId,
          type: "PAYMENT_RECEIVED",
          title: "Payment successful",
          body: `${inv.number} paid`,
          link: invoiceLink(inv),
        },
        {
          userId: inv.job.workerProfile.userId,
          type: "PAYMENT_RECEIVED",
          title: "Customer paid",
          body: `${inv.number} for ${inv.job.request.title}`,
          link: `/worker/earnings`,
        },
      ],
      afterCommit,
      true,
    );
  }
  if (target === "REFUNDED" || target === "PARTIALLY_REFUNDED") {
    await invoiceRepository.update(inv.id, { status: target }, tx);
  }
  if (target === "FAILED") {
    await notificationService.notify(tx, [
      {
        userId: inv.job.request.payerUserId,
        type: "PAYMENT_FAILED",
        title: "Payment failed",
        body: `${inv.number}: please try again`,
        link: invoiceLink(inv),
      },
    ]);
  }
  return updated;
}

export const paymentService = {
  /** Amount always comes from the invoice, never from the client. Reuses an open CREATED payment. */
  async createCheckout(
    invoiceId: string,
    user: Viewer,
  ): Promise<{ paymentId: string; provider: string; checkout: Checkout }> {
    const inv = await loadInvoiceForPayer(invoiceId, user);
    if (inv.status !== "ISSUED")
      throw AppError.conflict(
        "INVOICE_NOT_PAYABLE",
        `Invoice is ${inv.status}`,
      );
    const provider = getPaymentProvider();
    const open = await paymentRepository.findOpenForInvoice(
      inv.id,
      provider.name,
    );
    if (open?.checkoutData && open.amountPaise === inv.totalPaise) {
      return {
        paymentId: open.id,
        provider: provider.name,
        checkout: open.checkoutData as Checkout,
      };
    }
    const payer = (await userRepository.findById(user.id))!;
    const paymentId = uuid();
    const result = await provider.createCheckout({
      orderId: paymentId,
      invoiceId: inv.id,
      amountPaise: inv.totalPaise,
      currency: "INR",
      customer: {
        id: payer.id,
        name: payer.name,
        email: payer.email,
        phone: payer.phone,
      },
      returnUrl: `${env.API_PUBLIC_URL}/api/v1/payments/return?order_id={order_id}`,
      notifyUrl: `${env.API_PUBLIC_URL}/api/v1/webhooks/payments/${provider.name}`,
    });
    await paymentRepository.create({
      id: paymentId,
      invoiceId: inv.id,
      provider: provider.name,
      providerOrderId: result.providerOrderId,
      amountPaise: inv.totalPaise,
      status: "CREATED",
      checkoutData: result.checkout as Prisma.InputJsonValue,
    });
    return { paymentId, provider: provider.name, checkout: result.checkout };
  },

  /** Browser return: verify with the provider, converge, and tell the controller where to redirect. */
  async handleReturn(query: Record<string, string>) {
    const provider = getPaymentProvider();
    const v = await provider.verifyReturn(query);
    const payment = await paymentRepository.findByOrderId(v.providerOrderId);
    if (!payment) throw AppError.notFound("Payment not found");
    const afterCommit: AfterCommit = [];
    const updated = await prisma.$transaction((tx) =>
      applyProviderStatus(
        tx,
        v.providerOrderId,
        v.status,
        { providerPaymentId: v.providerPaymentId },
        afterCommit,
      ),
    );
    await runAfterCommit(afterCommit);
    const status = updated.status === "CREATED" ? "PENDING" : updated.status;
    return `${env.APP_URL}/invoices/${payment.invoiceId}?status=${status}`;
  },

  /** Webhook is the source of truth; duplicates are ignored via PaymentEvent(provider, eventId). */
  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ) {
    const provider = getPaymentProvider();
    if (providerName !== provider.name) throw AppError.notFound();
    const evt: WebhookEvent | null = provider.parseWebhook(rawBody, headers);
    if (!evt) return { received: true, ignored: true };
    if (!evt.ok)
      throw new AppError(
        400,
        "INVALID_SIGNATURE",
        "Webhook signature verification failed",
      );
    const afterCommit: AfterCommit = [];
    const result = await prisma.$transaction(async (tx) => {
      const isNew = await paymentRepository.recordEvent(
        {
          provider: provider.name,
          eventId: evt.eventId,
          type: evt.type,
          payload: JSON.parse(
            rawBody.toString("utf8"),
          ) as Prisma.InputJsonValue,
        },
        tx,
      );
      if (!isNew) return { received: true, duplicate: true };
      await applyProviderStatus(
        tx,
        evt.providerOrderId,
        evt.status,
        {
          providerPaymentId: evt.providerPaymentId,
          amountPaise: evt.amountPaise,
        },
        afterCommit,
      );
      return { received: true };
    });
    await runAfterCommit(afterCommit);
    return result;
  },

  /** Mock pay page buttons → synthetic signed webhook through the real pipeline. 404 unless mock. */
  async completeMock(
    providerOrderId: string,
    outcome: "success" | "failure",
    user: Viewer,
  ) {
    if (getPaymentProvider().name !== "mock") throw AppError.notFound();
    const payment = await paymentRepository.findByOrderId(providerOrderId);
    if (!payment) throw AppError.notFound("Payment not found");
    await loadInvoiceForPayer(payment.invoiceId, user);
    const { rawBody, headers } = buildMockWebhook(
      providerOrderId,
      outcome,
      payment.amountPaise,
    );
    await this.handleWebhook("mock", rawBody, headers);
    const after = (await paymentRepository.findById(payment.id))!;
    return {
      status: after.status,
      invoiceId: payment.invoiceId,
      returnUrl: `${env.API_PUBLIC_URL}/api/v1/payments/return?order_id=${encodeURIComponent(providerOrderId)}`,
    };
  },

  async mockOrder(providerOrderId: string, user: Viewer) {
    if (getPaymentProvider().name !== "mock") throw AppError.notFound();
    const payment = await paymentRepository.findByOrderId(providerOrderId);
    if (!payment) throw AppError.notFound("Payment not found");
    const inv = await loadInvoiceForPayer(payment.invoiceId, user);
    return {
      providerOrderId,
      status: payment.status,
      amountPaise: payment.amountPaise,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      title: inv.job.request.title,
    };
  },

  async markPaidOffline(invoiceId: string, user: Viewer) {
    const inv = await loadInvoiceForPayer(invoiceId, user);
    if (inv.status !== "ISSUED")
      throw AppError.conflict(
        "INVOICE_NOT_PAYABLE",
        `Invoice is ${inv.status}`,
      );
    if (inv.offlineMarkedAt)
      return {
        id: inv.id,
        status: inv.status,
        offlineMarkedAt: inv.offlineMarkedAt.toISOString(),
      };
    await prisma.$transaction(async (tx) => {
      await invoiceRepository.update(
        inv.id,
        { offlineMarkedAt: new Date() },
        tx,
      );
      await notificationService.notify(tx, [
        {
          userId: inv.job.workerProfile.userId,
          type: "OFFLINE_PAYMENT",
          title: "Customer says they paid offline",
          body: `${inv.number}: please confirm receipt`,
          link: `/worker/jobs/${inv.jobId}`,
        },
      ]);
    });
    const after = (await invoiceRepository.findById(inv.id))!;
    return {
      id: after.id,
      status: after.status,
      offlineMarkedAt: after.offlineMarkedAt?.toISOString() ?? null,
    };
  },

  async confirmOffline(invoiceId: string, user: Viewer) {
    const inv = await invoiceRepository.findById(invoiceId);
    const rel = requestPolicy.assertVisible(inv?.job.request ?? null, user);
    if (!rel.includes("WORKER"))
      throw AppError.forbidden(
        "Only the assigned worker can confirm offline payment",
      );
    if (inv!.status !== "ISSUED")
      throw AppError.conflict(
        "INVOICE_NOT_PAYABLE",
        `Invoice is ${inv!.status}`,
      );
    if (!inv!.offlineMarkedAt)
      throw AppError.conflict(
        "NOT_MARKED_OFFLINE",
        "The payer hasn't marked this invoice as paid offline",
      );
    await prisma.$transaction(async (tx) => {
      await invoiceRepository.update(
        inv!.id,
        { status: "PAID_OFFLINE", paidAt: new Date() },
        tx,
      );
      await notificationService.notify(tx, [
        {
          userId: inv!.job.request.payerUserId,
          type: "PAYMENT_RECEIVED",
          title: "Offline payment confirmed",
          body: inv!.number,
          link: invoiceLink(inv!),
        },
      ]);
    });
    return { id: inv!.id, status: "PAID_OFFLINE" as const };
  },

  /** Admin refund (full or partial) through the provider. */
  async refund(
    paymentId: string,
    admin: Viewer,
    input: { amountPaise?: number; reason: string },
  ) {
    const p = await paymentRepository.findById(paymentId);
    if (!p) throw AppError.notFound("Payment not found");
    if (p.status !== "PAID" && p.status !== "PARTIALLY_REFUNDED")
      throw AppError.conflict(
        "PAYMENT_NOT_REFUNDABLE",
        `Payment is ${p.status}`,
      );
    const remaining = p.amountPaise - p.refundedPaise;
    const amount = input.amountPaise ?? remaining;
    if (amount <= 0 || amount > remaining)
      throw AppError.validation([
        {
          path: "amountPaise",
          message: `Refund must be between 1 and ${remaining} paise`,
        },
      ]);
    const provider = getPaymentProvider();
    if (provider.name !== p.provider)
      throw AppError.conflict(
        "PROVIDER_MISMATCH",
        `Payment was made with ${p.provider}`,
      );
    const r = await provider.refund({
      providerOrderId: p.providerOrderId,
      providerPaymentId: p.providerPaymentId ?? p.providerOrderId,
      amountPaise: amount,
      reason: input.reason,
      refundId: `rf_${uuid().slice(0, 18)}`,
    });
    const total = p.refundedPaise + amount;
    const status: PaymentStatus =
      total >= p.amountPaise ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await prisma.$transaction(async (tx) => {
      const locked = (await paymentRepository.lockById(p.id, tx))!;
      await paymentRepository.update(
        p.id,
        { refundedPaise: locked.refundedPaise + amount, status },
        tx,
      );
      await invoiceRepository.update(p.invoiceId, { status }, tx);
      const inv = (await invoiceRepository.findById(p.invoiceId, tx))!;
      await notificationService.notify(tx, [
        {
          userId: inv.job.request.payerUserId,
          type: "REFUND_ISSUED",
          title: "Refund issued",
          body: `₹${(amount / 100).toFixed(2)} for ${inv.number} (${input.reason})`,
          link: invoiceLink(inv),
        },
      ]);
    });
    logger.info(
      {
        paymentId,
        amount,
        adminId: admin.id,
        providerRefundId: r.providerRefundId,
      },
      "refund issued",
    );
    return {
      paymentId: p.id,
      status,
      refundedPaise: total,
      providerRefundId: r.providerRefundId,
      providerStatus: r.status,
    };
  },

  async listPayments(status?: string) {
    const rows = await paymentRepository.list({ status });
    return {
      items: rows.map((p) => ({
        id: p.id,
        provider: p.provider,
        providerOrderId: p.providerOrderId,
        status: p.status,
        amountPaise: p.amountPaise,
        refundedPaise: p.refundedPaise,
        invoice: p.invoice,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  },
};
