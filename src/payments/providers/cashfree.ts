import { createHmac, timingSafeEqual } from "node:crypto";
import { paiseToRupeeString } from "../../domain/money.js";
import type { PaymentProvider, WebhookEvent } from "../PaymentProvider.js";

/** Cashfree PG (requirements.md §5.4) over plain fetch — sandbox keys need no KYC. */
export type CashfreeConfig = {
  appId: string;
  secretKey: string;
  webhookSecret?: string;
  env: "sandbox" | "production";
  apiVersion: string;
  fetchImpl?: typeof fetch;
};

const rupeesToPaise = (v: unknown) => Math.round(Number(v) * 100);

/** HMAC-SHA256(timestamp + rawBody) base64, compared in constant time. */
export function verifyCashfreeSignature(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(timestamp + rawBody.toString("utf8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cashfreeProvider(cfg: CashfreeConfig): PaymentProvider {
  const base =
    cfg.env === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";
  const doFetch = cfg.fetchImpl ?? fetch;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-client-id": cfg.appId,
        "x-client-secret": cfg.secretKey,
        "x-api-version": cfg.apiVersion,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & {
      message?: string;
    };
    if (!res.ok)
      throw new Error(
        `Cashfree ${method} ${path} failed (${res.status}): ${json.message ?? "unknown error"}`,
      );
    return json;
  }

  return {
    name: "cashfree",

    async createCheckout(input) {
      const order = await call<{
        order_id: string;
        payment_session_id: string;
      }>("POST", "/orders", {
        order_id: input.orderId,
        order_amount: Number(paiseToRupeeString(input.amountPaise)),
        order_currency: input.currency,
        customer_details: {
          customer_id: input.customer.id,
          customer_name: input.customer.name,
          customer_email: input.customer.email,
          // Cashfree requires a phone; sandbox accepts any 10-digit number.
          customer_phone: (input.customer.phone ?? "9999999999")
            .replace(/^\+91/, "")
            .slice(-10),
        },
        order_meta: {
          return_url: input.returnUrl,
          notify_url: input.notifyUrl,
        },
        order_note: `Invoice ${input.invoiceId}`,
      });
      return {
        providerOrderId: order.order_id,
        checkout: { kind: "sdk", sessionId: order.payment_session_id },
      };
    },

    async verifyReturn(params) {
      const orderId = params.order_id ?? "";
      const order = await call<{
        order_id: string;
        order_status: string;
        cf_order_id?: string | number;
      }>("GET", `/orders/${encodeURIComponent(orderId)}`);
      const status =
        order.order_status === "PAID"
          ? "PAID"
          : order.order_status === "ACTIVE"
            ? "PENDING"
            : "FAILED";
      let providerPaymentId: string | undefined;
      if (status === "PAID") {
        const pays = await call<
          Array<{ cf_payment_id: string | number; payment_status: string }>
        >("GET", `/orders/${encodeURIComponent(orderId)}/payments`).catch(
          () => [],
        );
        const ok = pays.find((p) => p.payment_status === "SUCCESS");
        providerPaymentId = ok ? String(ok.cf_payment_id) : undefined;
      }
      return { providerOrderId: order.order_id, status, providerPaymentId };
    },

    parseWebhook(rawBody, headers): WebhookEvent | null {
      let body: {
        type?: string;
        event_time?: string;
        data?: {
          order?: { order_id?: string; order_amount?: number };
          payment?: {
            cf_payment_id?: string | number;
            payment_status?: string;
            payment_amount?: number;
          };
          refund?: {
            order_id?: string;
            refund_status?: string;
            refund_amount?: number;
            cf_refund_id?: string | number;
            cf_payment_id?: string | number;
          };
        };
      };
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return null;
      }
      const ok = verifyCashfreeSignature(
        rawBody,
        headers["x-webhook-timestamp"] ?? "",
        headers["x-webhook-signature"] ?? "",
        cfg.webhookSecret || cfg.secretKey,
      );
      const type = body.type ?? "";
      if (
        type === "PAYMENT_SUCCESS_WEBHOOK" ||
        type === "PAYMENT_FAILED_WEBHOOK" ||
        type === "PAYMENT_USER_DROPPED_WEBHOOK"
      ) {
        const orderId = body.data?.order?.order_id;
        const pay = body.data?.payment;
        if (!orderId || !pay) return null;
        return {
          ok,
          eventId:
            headers["x-idempotency-key"] ||
            `${type}:${pay.cf_payment_id ?? orderId}`,
          type,
          providerOrderId: orderId,
          status: type === "PAYMENT_SUCCESS_WEBHOOK" ? "PAID" : "FAILED",
          providerPaymentId:
            pay.cf_payment_id !== undefined
              ? String(pay.cf_payment_id)
              : undefined,
          amountPaise:
            pay.payment_amount !== undefined
              ? rupeesToPaise(pay.payment_amount)
              : undefined,
        };
      }
      if (type.startsWith("REFUND_")) {
        const r = body.data?.refund;
        if (!r?.order_id || r.refund_status !== "SUCCESS") return null;
        return {
          ok,
          eventId:
            headers["x-idempotency-key"] ||
            `${type}:${r.cf_refund_id ?? r.order_id}`,
          type,
          providerOrderId: r.order_id,
          status: "REFUNDED",
          providerPaymentId:
            r.cf_payment_id !== undefined ? String(r.cf_payment_id) : undefined,
          amountPaise:
            r.refund_amount !== undefined
              ? rupeesToPaise(r.refund_amount)
              : undefined,
        };
      }
      return null;
    },

    async refund(input) {
      const r = await call<{
        cf_refund_id: string | number;
        refund_status: string;
      }>(
        "POST",
        `/orders/${encodeURIComponent(input.providerOrderId)}/refunds`,
        {
          refund_amount: Number(paiseToRupeeString(input.amountPaise)),
          refund_id: input.refundId,
          refund_note: input.reason.slice(0, 100),
        },
      );
      return {
        providerRefundId: String(r.cf_refund_id),
        status: r.refund_status === "SUCCESS" ? "DONE" : "PENDING",
      };
    },
  };
}
