import { z } from "zod";
import "../lib/openapi.js";

export const CheckoutDto = z
  .object({
    paymentId: z.string().uuid(),
    provider: z.enum(["mock", "cashfree"]),
    checkout: z.union([
      z.object({ kind: z.literal("redirect"), url: z.string() }),
      z.object({ kind: z.literal("sdk"), sessionId: z.string() }),
    ]),
  })
  .openapi("Checkout", {
    example: {
      paymentId: "3f0a9a51-5c1e-4b5d-8c55-1b0d7a1c9e11",
      provider: "mock",
      checkout: {
        kind: "redirect",
        url: "http://localhost:5173/pay/mock/mock_3f0a9a51-5c1e-4b5d-8c55-1b0d7a1c9e11",
      },
    },
  });

export const ReturnQuery = z
  .object({ order_id: z.string().min(1).max(100) })
  .catchall(z.string());
export const OrderParams = z.object({ orderId: z.string().min(1).max(100) });
export const ProviderParams = z.object({ provider: z.string().min(1).max(20) });

export const MockCompleteBody = z
  .object({ outcome: z.enum(["success", "failure"]) })
  .openapi("MockCompleteBody", { example: { outcome: "success" } });

export const MockCompleteDto = z
  .object({
    status: z.string(),
    invoiceId: z.string().uuid(),
    returnUrl: z.string(),
  })
  .openapi("MockCompleteResult");

export const MockOrderDto = z
  .object({
    providerOrderId: z.string(),
    status: z.string(),
    amountPaise: z.number().int(),
    invoiceId: z.string().uuid(),
    invoiceNumber: z.string(),
    title: z.string(),
  })
  .openapi("MockOrder");

export const OfflineDto = z
  .object({
    id: z.string().uuid(),
    status: z.string(),
    offlineMarkedAt: z.string().nullable().optional(),
  })
  .openapi("OfflinePaymentResult");

export const RefundBody = z
  .object({
    amountPaise: z
      .number()
      .int()
      .positive()
      .optional()
      .openapi({ description: "Defaults to the full remaining amount" }),
    reason: z.string().trim().min(3).max(200),
  })
  .openapi("RefundBody", {
    example: { reason: "Dispute resolved in customer's favour" },
  });

export const RefundDto = z
  .object({
    paymentId: z.string().uuid(),
    status: z.string(),
    refundedPaise: z.number().int(),
    providerRefundId: z.string(),
    providerStatus: z.enum(["PENDING", "DONE"]),
  })
  .openapi("RefundResult");

export const PaymentListDto = z
  .object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        provider: z.string(),
        providerOrderId: z.string(),
        status: z.string(),
        amountPaise: z.number().int(),
        refundedPaise: z.number().int(),
        invoice: z.object({
          id: z.string().uuid(),
          number: z.string(),
          totalPaise: z.number(),
          status: z.string(),
        }),
        createdAt: z.string(),
      }),
    ),
  })
  .openapi("PaymentList");

export const PaymentListQuery = z.object({
  status: z
    .enum(["CREATED", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"])
    .optional(),
});
