import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  cashfreeProvider,
  verifyCashfreeSignature,
} from "../../src/payments/providers/cashfree.js";
import {
  buildMockWebhook,
  MOCK_SIGNATURE_HEADER,
  mockProvider,
} from "../../src/payments/providers/mock.js";

const input = {
  orderId: "5b1d7a2e-0000-4000-8000-000000000001",
  invoiceId: "inv-1",
  amountPaise: 59000,
  currency: "INR" as const,
  customer: {
    id: "u1",
    name: "Olivia",
    email: "o@x.in",
    phone: "+919800000001",
  },
  returnUrl: "http://api/return?order_id={order_id}",
  notifyUrl: "http://api/webhooks/payments/cashfree",
};

describe("mock provider", () => {
  it("redirects to the frontend mock page with a deterministic order id", async () => {
    const r = await mockProvider().createCheckout(input);
    expect(r.providerOrderId).toBe(`mock_${input.orderId}`);
    expect(r.checkout).toEqual({
      kind: "redirect",
      url: `http://localhost:5173/pay/mock/mock_${input.orderId}`,
    });
  });

  it("signed webhooks verify; tampered ones don't", () => {
    const p = mockProvider();
    const { rawBody, headers } = buildMockWebhook("mock_abc", "success", 59000);
    const ok = p.parseWebhook(rawBody, headers);
    expect(ok).toMatchObject({
      ok: true,
      status: "PAID",
      providerOrderId: "mock_abc",
      amountPaise: 59000,
    });
    const tampered = Buffer.from(rawBody.toString().replace("59000", "1"));
    expect(p.parseWebhook(tampered, headers)?.ok).toBe(false);
    expect(p.parseWebhook(Buffer.from("not json"), {})).toBeNull();
    expect(p.parseWebhook(rawBody, { [MOCK_SIGNATURE_HEADER]: "x" })?.ok).toBe(
      false,
    );
  });

  it("verifyReturn reflects the recorded outcome; refunds resolve immediately", async () => {
    const p = mockProvider();
    expect((await p.verifyReturn({ order_id: "mock_new" })).status).toBe(
      "PENDING",
    );
    buildMockWebhook("mock_new", "failure", 100);
    expect((await p.verifyReturn({ order_id: "mock_new" })).status).toBe(
      "FAILED",
    );
    expect(
      (
        await p.refund({
          providerOrderId: "o",
          providerPaymentId: "p",
          amountPaise: 1,
          reason: "r",
          refundId: "rf1",
        })
      ).status,
    ).toBe("DONE");
  });
});

describe("cashfree provider", () => {
  // Fixture: signature = base64(HMAC_SHA256(timestamp + rawBody, secret))
  const secret = "cf_test_secret";
  const rawBody = Buffer.from(
    JSON.stringify({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      event_time: "2026-11-02T10:00:00+05:30",
      data: {
        order: { order_id: "ord_1", order_amount: 590 },
        payment: {
          cf_payment_id: 998877,
          payment_status: "SUCCESS",
          payment_amount: 590,
        },
      },
    }),
  );
  const ts = "1762057800";
  const sig = createHmac("sha256", secret)
    .update(ts + rawBody.toString())
    .digest("base64");

  it("verifies the webhook signature fixture", () => {
    expect(verifyCashfreeSignature(rawBody, ts, sig, secret)).toBe(true);
    expect(verifyCashfreeSignature(rawBody, "1762057801", sig, secret)).toBe(
      false,
    );
    expect(verifyCashfreeSignature(rawBody, ts, sig, "wrong")).toBe(false);
  });

  it("parses payment success into a converged event", () => {
    const p = cashfreeProvider({
      appId: "a",
      secretKey: "s",
      webhookSecret: secret,
      env: "sandbox",
      apiVersion: "2025-01-01",
    });
    const e = p.parseWebhook(rawBody, {
      "x-webhook-timestamp": ts,
      "x-webhook-signature": sig,
    });
    expect(e).toMatchObject({
      ok: true,
      status: "PAID",
      providerOrderId: "ord_1",
      providerPaymentId: "998877",
      amountPaise: 59000,
    });
  });

  it("createCheckout calls Create Order with rupees and returns the SDK session", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            order_id: input.orderId,
            payment_session_id: "session_abc",
          }),
          { status: 200 },
        ),
    );
    const p = cashfreeProvider({
      appId: "app",
      secretKey: "sec",
      env: "sandbox",
      apiVersion: "2025-01-01",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await p.createCheckout(input);
    expect(r).toEqual({
      providerOrderId: input.orderId,
      checkout: { kind: "sdk", sessionId: "session_abc" },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders");
    expect((init.headers as Record<string, string>)["x-client-id"]).toBe("app");
    expect((init.headers as Record<string, string>)["x-api-version"]).toBe(
      "2025-01-01",
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      order_id: input.orderId,
      order_amount: 590,
      order_currency: "INR",
    });
    expect(body.customer_details.customer_phone).toBe("9800000001");
    expect(body.order_meta.return_url).toContain("{order_id}");
  });

  it("verifyReturn maps order_status", async () => {
    const fetchImpl = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/payments")
              ? [{ cf_payment_id: 5, payment_status: "SUCCESS" }]
              : { order_id: "o1", order_status: "PAID" },
          ),
          { status: 200 },
        ),
    );
    const p = cashfreeProvider({
      appId: "a",
      secretKey: "s",
      env: "sandbox",
      apiVersion: "x",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await p.verifyReturn({ order_id: "o1" })).toEqual({
      providerOrderId: "o1",
      status: "PAID",
      providerPaymentId: "5",
    });
  });
});
