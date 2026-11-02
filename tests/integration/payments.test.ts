import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPaymentProvider } from "../../src/payments/index.js";
import { cashfreeProvider } from "../../src/payments/providers/cashfree.js";
import { buildMockWebhook } from "../../src/payments/providers/mock.js";
import { settingsService } from "../../src/services/settings.service.js";
import { api } from "../helpers/app.js";
import { userWithToken } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";
import { completedJob } from "../helpers/flow.js";

async function invoiceCtx() {
  const ctx = await completedJob();
  const inv = await api()
    .get(`/api/v1/jobs/${ctx.jobId}/invoice`)
    .set(ctx.owner.auth);
  return { ...ctx, invoiceId: inv.body.id as string };
}

const orderOf = (url: string) => url.split("/pay/mock/")[1]!;

describe("payments (mock provider)", () => {
  beforeEach(async () => {
    await resetDb();
    settingsService.invalidate();
    setPaymentProvider(null);
  });
  afterEach(() => setPaymentProvider(null));

  it("amount comes from the invoice; non-payer 403; open checkout is reused", async () => {
    const ctx = await invoiceCtx();
    expect(
      (
        await api()
          .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
          .set(ctx.tenant.auth)
      ).status,
    ).toBe(403);
    const c1 = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth)
      .send({ amountPaise: 1 });
    expect(c1.status).toBe(201);
    expect(c1.body.checkout.kind).toBe("redirect");
    const pay = await prisma.payment.findUniqueOrThrow({
      where: { id: c1.body.paymentId },
    });
    expect(pay.amountPaise).toBe(59000);
    const c2 = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    expect(c2.body.paymentId).toBe(c1.body.paymentId);
    const page = await api()
      .get(`/api/v1/payments/mock/${orderOf(c1.body.checkout.url)}`)
      .set(ctx.owner.auth);
    expect(page.body).toMatchObject({ amountPaise: 59000, status: "CREATED" });
  });

  it("mock success → PAID (payment + invoice), return redirects to the invoice page", async () => {
    const ctx = await invoiceCtx();
    const c = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    const order = orderOf(c.body.checkout.url);
    const done = await api()
      .post(`/api/v1/payments/mock/${order}/complete`)
      .set(ctx.owner.auth)
      .send({ outcome: "success" });
    expect(done.body.status).toBe("PAID");
    const inv = await prisma.invoice.findUniqueOrThrow({
      where: { id: ctx.invoiceId },
    });
    expect(inv.status).toBe("PAID");
    expect(inv.paidAt).not.toBeNull();
    const ret = await api().get(`/api/v1/payments/return?order_id=${order}`);
    expect(ret.status).toBe(302);
    expect(ret.headers.location).toBe(
      `http://localhost:5173/invoices/${ctx.invoiceId}?status=PAID`,
    );
    expect(
      (await api().get("/api/v1/worker/earnings").set(ctx.worker.auth)).body
        .totals.paidPaise,
    ).toBe(44100);
    expect(
      (
        await api()
          .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
          .set(ctx.owner.auth)
      ).status,
    ).toBe(409);
  });

  it("mock failure → FAILED, then a new attempt can succeed", async () => {
    const ctx = await invoiceCtx();
    const c = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    const f = await api()
      .post(`/api/v1/payments/mock/${orderOf(c.body.checkout.url)}/complete`)
      .set(ctx.owner.auth)
      .send({ outcome: "failure" });
    expect(f.body.status).toBe("FAILED");
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: ctx.invoiceId } }))
        .status,
    ).toBe("ISSUED");
    const c2 = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    expect(c2.body.paymentId).not.toBe(c.body.paymentId);
    const s = await api()
      .post(`/api/v1/payments/mock/${orderOf(c2.body.checkout.url)}/complete`)
      .set(ctx.owner.auth)
      .send({ outcome: "success" });
    expect(s.body.status).toBe("PAID");
  });

  it("duplicate webhook events are ignored; bad signature 400; unknown provider 404", async () => {
    const ctx = await invoiceCtx();
    const c = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    const { rawBody, headers } = buildMockWebhook(
      orderOf(c.body.checkout.url),
      "success",
      59000,
    );
    const send = () =>
      api()
        .post("/api/v1/webhooks/payments/mock")
        .set(headers)
        .send(rawBody.toString("utf8"));
    expect((await send()).body).toEqual({ received: true });
    expect((await send()).body).toEqual({ received: true, duplicate: true });
    expect(await prisma.paymentEvent.count()).toBe(1);
    const bad = await api()
      .post("/api/v1/webhooks/payments/mock")
      .set({ ...headers, "x-mock-signature": "nope" })
      .send(rawBody.toString("utf8"));
    expect(bad.status).toBe(400);
    expect(
      (
        await api()
          .post("/api/v1/webhooks/payments/cashfree")
          .set(headers)
          .send(rawBody.toString("utf8"))
      ).status,
    ).toBe(404);
  });

  it("return and webhook converge in either order", async () => {
    const a = await invoiceCtx();
    const ca = await api()
      .post(`/api/v1/invoices/${a.invoiceId}/checkout`)
      .set(a.owner.auth);
    const orderA = orderOf(ca.body.checkout.url);
    // Return first (outcome known to the mock gateway), then the webhook arrives.
    const hookA = buildMockWebhook(orderA, "success", 59000);
    await api().get(`/api/v1/payments/return?order_id=${orderA}`);
    expect(
      (
        await prisma.payment.findFirstOrThrow({
          where: { providerOrderId: orderA },
        })
      ).status,
    ).toBe("PAID");
    await api()
      .post("/api/v1/webhooks/payments/mock")
      .set(hookA.headers)
      .send(hookA.rawBody.toString("utf8"));
    const pa = await prisma.payment.findFirstOrThrow({
      where: { providerOrderId: orderA },
    });
    expect(pa.status).toBe("PAID");

    await resetDb();
    const b = await invoiceCtx();
    const cb = await api()
      .post(`/api/v1/invoices/${b.invoiceId}/checkout`)
      .set(b.owner.auth);
    const orderB = orderOf(cb.body.checkout.url);
    const hookB = buildMockWebhook(orderB, "success", 59000);
    await api()
      .post("/api/v1/webhooks/payments/mock")
      .set(hookB.headers)
      .send(hookB.rawBody.toString("utf8"));
    const ret = await api().get(`/api/v1/payments/return?order_id=${orderB}`);
    expect(ret.headers.location).toContain("status=PAID");
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: b.invoiceId } }))
        .status,
    ).toBe("PAID");

    // A late FAILED webhook never moves PAID backwards.
    const late = buildMockWebhook(orderB, "failure", 59000);
    await api()
      .post("/api/v1/webhooks/payments/mock")
      .set(late.headers)
      .send(late.rawBody.toString("utf8"));
    expect(
      (
        await prisma.payment.findFirstOrThrow({
          where: { providerOrderId: orderB },
        })
      ).status,
    ).toBe("PAID");
  });

  it("webhook with a different amount never marks PAID", async () => {
    const ctx = await invoiceCtx();
    const c = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    const hook = buildMockWebhook(orderOf(c.body.checkout.url), "success", 100);
    await api()
      .post("/api/v1/webhooks/payments/mock")
      .set(hook.headers)
      .send(hook.rawBody.toString("utf8"));
    const p = await prisma.payment.findUniqueOrThrow({
      where: { id: c.body.paymentId },
    });
    expect(p).toMatchObject({
      status: "FAILED",
      failureReason: "AMOUNT_MISMATCH",
    });
  });

  it("mock endpoints 404 when the provider is not mock", async () => {
    const ctx = await invoiceCtx();
    const c = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    setPaymentProvider(
      cashfreeProvider({
        appId: "a",
        secretKey: "s",
        env: "sandbox",
        apiVersion: "x",
        fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
      }),
    );
    const order = orderOf(c.body.checkout.url);
    expect(
      (
        await api()
          .post(`/api/v1/payments/mock/${order}/complete`)
          .set(ctx.owner.auth)
          .send({ outcome: "success" })
      ).status,
    ).toBe(404);
    expect(
      (await api().get(`/api/v1/payments/mock/${order}`).set(ctx.owner.auth))
        .status,
    ).toBe(404);
  });

  it("admin refund: partial then full; invoice mirrors", async () => {
    const ctx = await invoiceCtx();
    const admin = await userWithToken("ADMIN");
    const c = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
      .set(ctx.owner.auth);
    await api()
      .post(`/api/v1/payments/mock/${orderOf(c.body.checkout.url)}/complete`)
      .set(ctx.owner.auth)
      .send({ outcome: "success" });
    expect(
      (
        await api()
          .post(`/api/v1/admin/payments/${c.body.paymentId}/refund`)
          .set(ctx.owner.auth)
          .send({ reason: "x y z" })
      ).status,
    ).toBe(403);
    const part = await api()
      .post(`/api/v1/admin/payments/${c.body.paymentId}/refund`)
      .set(admin.auth)
      .send({ amountPaise: 9000, reason: "Partial goodwill" });
    expect(part.body).toMatchObject({
      status: "PARTIALLY_REFUNDED",
      refundedPaise: 9000,
      providerStatus: "DONE",
    });
    expect(
      (
        await api()
          .post(`/api/v1/admin/payments/${c.body.paymentId}/refund`)
          .set(admin.auth)
          .send({ amountPaise: 60000, reason: "Too much" })
      ).status,
    ).toBe(422);
    const full = await api()
      .post(`/api/v1/admin/payments/${c.body.paymentId}/refund`)
      .set(admin.auth)
      .send({ reason: "Dispute settled" });
    expect(full.body).toMatchObject({
      status: "REFUNDED",
      refundedPaise: 59000,
    });
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: ctx.invoiceId } }))
        .status,
    ).toBe("REFUNDED");
    expect(
      (
        await api()
          .post(`/api/v1/admin/payments/${c.body.paymentId}/refund`)
          .set(admin.auth)
          .send({ reason: "Again please" })
      ).status,
    ).toBe(409);
    const list = await api()
      .get("/api/v1/admin/payments?status=REFUNDED")
      .set(admin.auth);
    expect(list.body.items).toHaveLength(1);
  });

  it("offline: payer marks, worker confirms → PAID_OFFLINE", async () => {
    const ctx = await invoiceCtx();
    expect(
      (
        await api()
          .post(`/api/v1/invoices/${ctx.invoiceId}/confirm-offline`)
          .set(ctx.worker.auth)
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post(`/api/v1/invoices/${ctx.invoiceId}/mark-paid-offline`)
          .set(ctx.tenant.auth)
      ).status,
    ).toBe(403);
    const m = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/mark-paid-offline`)
      .set(ctx.owner.auth);
    expect(m.body.offlineMarkedAt).toBeTruthy();
    const other = await userWithToken("WORKER");
    expect(
      (
        await api()
          .post(`/api/v1/invoices/${ctx.invoiceId}/confirm-offline`)
          .set(other.auth)
      ).status,
    ).toBe(404);
    const ok = await api()
      .post(`/api/v1/invoices/${ctx.invoiceId}/confirm-offline`)
      .set(ctx.worker.auth);
    expect(ok.body.status).toBe("PAID_OFFLINE");
    expect(
      (
        await api()
          .post(`/api/v1/invoices/${ctx.invoiceId}/checkout`)
          .set(ctx.owner.auth)
      ).status,
    ).toBe(409);
  });
});
