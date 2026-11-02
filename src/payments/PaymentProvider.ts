/** requirements.md §5.1. Services depend only on this interface. */

export type ProviderName = "mock" | "cashfree";

export type Checkout =
  { kind: "redirect"; url: string } | { kind: "sdk"; sessionId: string };

export type CreateCheckoutInput = {
  /** Our Payment id — used as the gateway order id where the gateway lets us choose it. */
  orderId: string;
  invoiceId: string;
  amountPaise: number;
  currency: "INR";
  customer: { id: string; name: string; email: string; phone?: string | null };
  returnUrl: string;
  notifyUrl: string;
};

export type ProviderStatus = "PAID" | "FAILED" | "PENDING";

export type WebhookEvent = {
  ok: boolean;
  eventId: string;
  type: string;
  providerOrderId: string;
  status: "PAID" | "FAILED" | "REFUNDED";
  providerPaymentId?: string;
  amountPaise?: number;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(
    input: CreateCheckoutInput,
  ): Promise<{ providerOrderId: string; checkout: Checkout }>;
  verifyReturn(params: Record<string, string>): Promise<{
    providerOrderId: string;
    status: ProviderStatus;
    providerPaymentId?: string;
  }>;
  /** Returns null when the payload is unrecognised; `ok: false` when the signature is invalid. */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): WebhookEvent | null;
  refund(input: {
    providerOrderId: string;
    providerPaymentId: string;
    amountPaise: number;
    reason: string;
    refundId: string;
  }): Promise<{ providerRefundId: string; status: "PENDING" | "DONE" }>;
}
