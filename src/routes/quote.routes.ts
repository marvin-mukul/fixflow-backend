import { Router } from "express";
import { z } from "zod";
import { quoteController as c } from "../controllers/quote.controller.js";
import { errorResponses, json, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { idempotency } from "../middlewares/idempotency.js";
import { requireRole } from "../middlewares/requireRole.js";
import { validate } from "../middlewares/validate.js";
import { BEARER, IdParams } from "../schemas/common.schema.js";
import {
  AcceptQuoteBody,
  AcceptResult,
  CreateQuoteBody,
  QuoteDto,
  QuoteList,
  ReviseQuoteBody,
} from "../schemas/quote.schema.js";

export const quoteRouter = Router();
const auth = requireAuth();
const worker = [auth, requireRole("WORKER")];

quoteRouter.post(
  "/requests/:id/quotes",
  ...worker,
  validate({ params: IdParams, body: CreateQuoteBody }),
  c.create,
);
quoteRouter.get(
  "/requests/:id/quotes",
  auth,
  validate({ params: IdParams }),
  c.list,
);
quoteRouter.patch(
  "/quotes/:id",
  ...worker,
  validate({ params: IdParams, body: ReviseQuoteBody }),
  c.revise,
);
quoteRouter.post(
  "/quotes/:id/withdraw",
  ...worker,
  validate({ params: IdParams }),
  c.withdraw,
);
quoteRouter.post(
  "/quotes/:id/accept",
  auth,
  requireRole("CUSTOMER"),
  idempotency(),
  validate({ params: IdParams, body: AcceptQuoteBody }),
  c.accept,
);

const tags = ["Quotes"];
const p = { params: IdParams };
registry.registerPath({
  method: "post",
  path: "/api/v1/requests/{id}/quotes",
  tags,
  security: BEARER,
  summary:
    "Submit a quote (matched, verified worker; before the deadline; one active per worker)",
  request: { ...p, body: { content: json(CreateQuoteBody) } },
  responses: {
    201: ok("Quote", QuoteDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/requests/{id}/quotes",
  tags,
  security: BEARER,
  summary:
    "Quotes on a request, ranked (payer side) — workers see only their own",
  request: p,
  responses: { 200: ok("Quotes", QuoteList), ...errorResponses(401, 404) },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/quotes/{id}",
  tags,
  security: BEARER,
  summary: "Revise my quote (bumps version)",
  request: { ...p, body: { content: json(ReviseQuoteBody) } },
  responses: {
    200: ok("Quote", QuoteDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/quotes/{id}/withdraw",
  tags,
  security: BEARER,
  summary: "Withdraw my quote",
  request: p,
  responses: {
    200: ok("Quote", QuoteDto),
    ...errorResponses(401, 403, 404, 409),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/quotes/{id}/accept",
  tags,
  security: BEARER,
  summary: "Payer accepts a quote → Job + SCHEDULED",
  description:
    "Requires header `Idempotency-Key` (8–128 chars). A replay returns the stored response. `version` must equal the quote version shown. Concurrent accepts: exactly one wins, others get 409.",
  request: {
    ...p,
    headers: z.object({
      "Idempotency-Key": z
        .string()
        .min(8)
        .max(128)
        .openapi({ example: "accept-7f9c2b1e-0d" }),
    }),
    body: { content: json(AcceptQuoteBody) },
  },
  responses: {
    201: ok("Accepted", AcceptResult),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
