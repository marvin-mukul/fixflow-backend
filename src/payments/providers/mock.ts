import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { uuid } from "../../lib/crypto.js";
import type {
  PaymentProvider,
  ProviderStatus,
  WebhookEvent,
} from "../PaymentProvider.js";

/** Mock gateway (requirements.md §5.3): no account, deterministic ids, signed synthetic webhooks. */
const secret = () => `mock-webhook:${env.JWT_ACCESS_SECRET}`;
export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

const sign = (body: string) =>
  createHmac("sha256", secret()).update(body).digest("hex");

/** Outcomes recorded by the mock pay page so the return URL can be verified. */
const outcomes = new Map<
  string,
  { status: ProviderStatus; providerPaymentId?: string }
>();

export const mockOrderId = (paymentId: string) => `mock_${paymentId}`;

export function buildMockWebhook(
  providerOrderId: string,
  outcome: "success" | "failure",
  amountPaise: number,
) {
  const providerPaymentId =
    outcome === "success"
      ? `mock_pay_${providerOrderId.slice(5, 13)}`
      : undefined;
  const payload = {
    eventId: `evt_${uuid()}`,
    type: outcome === "success" ? "payment.succeeded" : "payment.failed",
    providerOrderId,
    status: outcome === "success" ? "PAID" : "FAILED",
    providerPaymentId,
    amountPaise,
  };
  outcomes.set(providerOrderId, {
    status: payload.status as ProviderStatus,
    providerPaymentId,
  });
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    rawBody,
    headers: {
      [MOCK_SIGNATURE_HEADER]: sign(rawBody.toString("utf8")),
      "content-type": "application/json",
    },
  };
}

export function mockProvider(): PaymentProvider {
  return {
    name: "mock",

    async createCheckout(input) {
      const providerOrderId = mockOrderId(input.orderId);
      return {
        providerOrderId,
        checkout: {
          kind: "redirect",
          url: `${env.APP_URL}/pay/mock/${providerOrderId}`,
        },
      };
    },

    async verifyReturn(params) {
      const providerOrderId = params.order_id ?? "";
      const o = outcomes.get(providerOrderId);
      return {
        providerOrderId,
        status: o?.status ?? "PENDING",
        providerPaymentId: o?.providerPaymentId,
      };
    },

    parseWebhook(rawBody, headers): WebhookEvent | null {
      let body: Partial<WebhookEvent>;
      try {
        body = JSON.parse(rawBody.toString("utf8")) as Partial<WebhookEvent>;
      } catch {
        return null;
      }
      if (!body.eventId || !body.providerOrderId || !body.status) return null;
      const given = Buffer.from(headers[MOCK_SIGNATURE_HEADER] ?? "", "utf8");
      const expected = Buffer.from(sign(rawBody.toString("utf8")), "utf8");
      const ok =
        given.length === expected.length && timingSafeEqual(given, expected);
      return {
        ok,
        eventId: body.eventId,
        type: body.type ?? "unknown",
        providerOrderId: body.providerOrderId,
        status: body.status,
        providerPaymentId: body.providerPaymentId,
        amountPaise: body.amountPaise,
      };
    },

    async refund(input) {
      return { providerRefundId: `mock_rf_${input.refundId}`, status: "DONE" };
    },
  };
}
