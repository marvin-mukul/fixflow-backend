import { Router } from "express";
import { z } from "zod";
import { jobController as c } from "../controllers/job.controller.js";
import { errorResponses, json, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { uploadFiles } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import { BEARER, CursorQuery, IdParams } from "../schemas/common.schema.js";
import {
  CompleteJobBody,
  ConfirmResult,
  DisputeBody,
  DisputeListDto,
  DisputeQuery,
  EarningsDto,
  InvoiceDto,
  JobDto,
  JobPage,
  JobsQuery,
  ResolveDisputeBody,
} from "../schemas/job.schema.js";
import {
  PublicReviewPage,
  ReviewBody,
  ReviewDto,
  ReviewPatchBody,
} from "../schemas/review.schema.js";

export const jobRouter = Router();
const auth = requireAuth();
const worker = [auth, requireRole("WORKER")];
const customer = [auth, requireRole("CUSTOMER")];
const admin = [auth, requireRole("ADMIN")];
const byId = validate({ params: IdParams });

jobRouter.get("/jobs", auth, validate({ query: JobsQuery }), c.list);
jobRouter.get(
  "/worker/jobs",
  ...worker,
  validate({ query: JobsQuery }),
  c.list,
);
jobRouter.get("/worker/earnings", ...worker, c.earnings);
jobRouter.get("/jobs/:id", auth, byId, c.get);
jobRouter.post("/jobs/:id/en-route", ...worker, byId, c.enRoute);
jobRouter.post("/jobs/:id/arrive", ...worker, byId, c.arrive);
jobRouter.post("/jobs/:id/start", ...worker, byId, c.start);
jobRouter.post(
  "/jobs/:id/complete",
  ...worker,
  byId,
  uploadFiles("files", 5),
  validate({ params: IdParams, body: CompleteJobBody }),
  c.complete,
);
jobRouter.post("/jobs/:id/confirm", ...customer, byId, c.confirm);
jobRouter.post(
  "/jobs/:id/dispute",
  ...customer,
  validate({ params: IdParams, body: DisputeBody }),
  c.dispute,
);
jobRouter.get("/jobs/:id/invoice", auth, byId, c.invoiceForJob);
jobRouter.get("/invoices/:id", auth, byId, c.invoice);
jobRouter.post(
  "/jobs/:id/reviews",
  auth,
  validate({ params: IdParams, body: ReviewBody }),
  c.createReview,
);
jobRouter.patch(
  "/reviews/:id",
  auth,
  validate({ params: IdParams, body: ReviewPatchBody }),
  c.updateReview,
);
jobRouter.get(
  "/workers/:id/reviews",
  validate({ params: IdParams, query: CursorQuery }),
  c.workerReviews,
);
jobRouter.get(
  "/admin/disputes",
  ...admin,
  validate({ query: DisputeQuery }),
  c.listDisputes,
);
jobRouter.post(
  "/admin/disputes/:id/resolve",
  ...admin,
  validate({ params: IdParams, body: ResolveDisputeBody }),
  c.resolveDispute,
);

const J = { tags: ["Jobs"], security: BEARER };
const p = { params: IdParams };
const step = (path: string, summary: string) =>
  registry.registerPath({
    method: "post",
    path,
    ...J,
    summary,
    request: p,
    responses: {
      200: ok("Job", JobDto),
      ...errorResponses(401, 403, 404, 409),
    },
  });

registry.registerPath({
  method: "get",
  path: "/api/v1/jobs",
  ...J,
  summary: "Jobs I'm part of (worker: assigned; customer: my requests)",
  request: { query: JobsQuery },
  responses: { 200: ok("Jobs", JobPage), ...errorResponses(401, 422) },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/worker/jobs",
  ...J,
  summary: "My assigned jobs (worker)",
  request: { query: JobsQuery },
  responses: { 200: ok("Jobs", JobPage), ...errorResponses(401, 403, 404) },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/worker/earnings",
  ...J,
  summary: "My earnings: payout per invoice, paid vs pending",
  responses: {
    200: ok("Earnings", EarningsDto),
    ...errorResponses(401, 403, 404),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/jobs/{id}",
  ...J,
  summary: "Job detail with allowed worker/customer actions",
  request: p,
  responses: { 200: ok("Job", JobDto), ...errorResponses(401, 404) },
});
step("/api/v1/jobs/{id}/en-route", "Worker: CONFIRMED → EN_ROUTE");
step("/api/v1/jobs/{id}/arrive", "Worker: EN_ROUTE → ARRIVED");
step(
  "/api/v1/jobs/{id}/start",
  "Worker: ARRIVED → WORKING; request → IN_PROGRESS",
);
registry.registerPath({
  method: "post",
  path: "/api/v1/jobs/{id}/complete",
  ...J,
  summary: "Worker completes with ≥1 after photo; request → PENDING_SIGN_OFF",
  description:
    "multipart/form-data: `files` (1–5 images) and optional `finalAmountPaise` (≤ accepted quote total).",
  request: {
    ...p,
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            files: z.array(z.string().openapi({ format: "binary" })),
            finalAmountPaise: z.number().int().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: ok("Job", JobDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/jobs/{id}/confirm",
  ...J,
  summary: "Customer confirms completion → COMPLETED, invoice issued",
  request: p,
  responses: {
    200: ok("Confirmed", ConfirmResult),
    ...errorResponses(401, 403, 404, 409),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/jobs/{id}/dispute",
  ...J,
  summary: "Customer disputes completion → DISPUTED",
  request: { ...p, body: { content: json(DisputeBody) } },
  responses: {
    200: ok("Job", JobDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/jobs/{id}/invoice",
  tags: ["Invoices"],
  security: BEARER,
  summary: "Invoice for a job (404 INVOICE_NOT_ISSUED before completion)",
  request: p,
  responses: { 200: ok("Invoice", InvoiceDto), ...errorResponses(401, 404) },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/invoices/{id}",
  tags: ["Invoices"],
  security: BEARER,
  summary: "Invoice detail (commission/payout only for worker/admin)",
  request: p,
  responses: { 200: ok("Invoice", InvoiceDto), ...errorResponses(401, 404) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/jobs/{id}/reviews",
  tags: ["Reviews"],
  security: BEARER,
  summary:
    "Review a completed job (dimensions depend on your relation; workers review the customer)",
  request: { ...p, body: { content: json(ReviewBody) } },
  responses: {
    201: ok("Review", ReviewDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/reviews/{id}",
  tags: ["Reviews"],
  security: BEARER,
  summary: "Edit my review once within 24 h",
  request: { ...p, body: { content: json(ReviewPatchBody) } },
  responses: {
    200: ok("Review", ReviewDto),
    ...errorResponses(401, 404, 409, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/workers/{id}/reviews",
  tags: ["Workers (public)"],
  summary: "Public reviews of a worker",
  request: { ...p, query: CursorQuery },
  responses: {
    200: ok("Reviews", PublicReviewPage),
    ...errorResponses(404, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/admin/disputes",
  tags: ["Admin"],
  security: BEARER,
  summary: "Disputes queue",
  request: { query: DisputeQuery },
  responses: {
    200: ok("Disputes", DisputeListDto),
    ...errorResponses(401, 403),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/disputes/{id}/resolve",
  tags: ["Admin"],
  security: BEARER,
  summary: "Resolve a dispute → COMPLETED (invoice issued) or CANCELLED",
  request: { ...p, body: { content: json(ResolveDisputeBody) } },
  responses: {
    200: ok("Dispute", DisputeListDto.shape.items.element),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
