import express, { Router } from "express";
import { z } from "zod";
import { paymentController as c } from "../controllers/payment.controller.js";
import { errorResponses, json, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { validate } from "../middlewares/validate.js";
import { BEARER, IdParams } from "../schemas/common.schema.js";
import {
  CheckoutDto,
  MockCompleteBody,
  MockCompleteDto,
  MockOrderDto,
  OfflineDto,
  OrderParams,
  PaymentListDto,
  PaymentListQuery,
  ProviderParams,
  RefundBody,
  RefundDto,
  ReturnQuery,
} from "../schemas/payment.schema.js";

/** Mounted in app.ts BEFORE express.json(): signatures are computed over the raw bytes. */
export const webhookRouter = Router();
webhookRouter.post(
  "/api/v1/webhooks/payments/:provider",
  express.raw({ type: "*/*", limit: "1mb" }),
  validate({ params: ProviderParams }),
  c.webhook,
);

export const paymentRouter = Router();
const auth = requireAuth();
const customer = [auth, requireRole("CUSTOMER")];
const byId = validate({ params: IdParams });

paymentRouter.post("/invoices/:id/checkout", ...customer, byId, c.checkout);
paymentRouter.get(
  "/payments/return",
  validate({ query: ReturnQuery }),
  c.return,
);
paymentRouter.get(
  "/payments/mock/:orderId",
  ...customer,
  validate({ params: OrderParams }),
  c.mockOrder,
);
paymentRouter.post(
  "/payments/mock/:orderId/complete",
  ...customer,
  validate({ params: OrderParams, body: MockCompleteBody }),
  c.mockComplete,
);
paymentRouter.post(
  "/invoices/:id/mark-paid-offline",
  ...customer,
  byId,
  c.markOffline,
);
paymentRouter.post(
  "/invoices/:id/confirm-offline",
  auth,
  requireRole("WORKER"),
  byId,
  c.confirmOffline,
);
paymentRouter.get(
  "/admin/payments",
  auth,
  requireRole("ADMIN"),
  validate({ query: PaymentListQuery }),
  c.list,
);
paymentRouter.post(
  "/admin/payments/:id/refund",
  auth,
  requireRole("ADMIN"),
  validate({ params: IdParams, body: RefundBody }),
  c.refund,
);

const tags = ["Payments"];
const p = { params: IdParams };
registry.registerPath({
  method: "post",
  path: "/api/v1/invoices/{id}/checkout",
  tags,
  security: BEARER,
  summary:
    "Start checkout for an invoice (payer). Amount comes from the invoice.",
  description:
    "Mock provider → `redirect` to the mock pay page; Cashfree → `sdk` with payment_session_id. Reuses an open payment.",
  request: p,
  responses: {
    201: ok("Checkout", CheckoutDto),
    ...errorResponses(401, 403, 404, 409),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/payments/return",
  tags,
  summary:
    "Gateway return URL → verifies, converges, 302 to APP_URL/invoices/:id?status=",
  request: { query: ReturnQuery },
  responses: {
    302: { description: "Redirect to the frontend invoice page" },
    ...errorResponses(404, 422),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/webhooks/payments/{provider}",
  tags,
  summary:
    "Provider webhook (raw body, signature verified, idempotent by event id)",
  request: {
    params: ProviderParams,
    body: {
      content: {
        "application/json": { schema: z.record(z.string(), z.unknown()) },
      },
    },
  },
  responses: {
    200: ok(
      "Received",
      z
        .object({
          received: z.boolean(),
          duplicate: z.boolean().optional(),
          ignored: z.boolean().optional(),
        })
        .openapi("WebhookAck"),
    ),
    ...errorResponses(400, 404),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/payments/mock/{orderId}",
  tags,
  security: BEARER,
  summary: "Mock pay page data (404 unless PAYMENT_PROVIDER=mock)",
  request: { params: OrderParams },
  responses: {
    200: ok("Order", MockOrderDto),
    ...errorResponses(401, 403, 404),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/payments/mock/{orderId}/complete",
  tags,
  security: BEARER,
  summary: "Mock pay page buttons → synthetic signed webhook (404 unless mock)",
  request: { params: OrderParams, body: { content: json(MockCompleteBody) } },
  responses: {
    200: ok("Result", MockCompleteDto),
    ...errorResponses(401, 403, 404, 422),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/invoices/{id}/mark-paid-offline",
  tags,
  security: BEARER,
  summary: "Payer marks the invoice paid in cash/UPI outside the app",
  request: p,
  responses: {
    200: ok("Marked", OfflineDto),
    ...errorResponses(401, 403, 404, 409),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/invoices/{id}/confirm-offline",
  tags,
  security: BEARER,
  summary: "Assigned worker confirms offline receipt → PAID_OFFLINE",
  request: p,
  responses: {
    200: ok("Confirmed", OfflineDto),
    ...errorResponses(401, 403, 404, 409),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/admin/payments",
  tags: ["Admin"],
  security: BEARER,
  summary: "Payments (admin)",
  request: { query: PaymentListQuery },
  responses: {
    200: ok("Payments", PaymentListDto),
    ...errorResponses(401, 403),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/payments/{id}/refund",
  tags: ["Admin"],
  security: BEARER,
  summary: "Refund a payment (full or partial)",
  request: { ...p, body: { content: json(RefundBody) } },
  responses: {
    200: ok("Refund", RefundDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
