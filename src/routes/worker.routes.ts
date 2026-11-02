import { Router } from "express";
import { z } from "zod";
import { workerController as c } from "../controllers/worker.controller.js";
import { errorResponses, json, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { uploadFiles } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import { BEARER, IdParams } from "../schemas/common.schema.js";
import {
  AvailabilityBody,
  LeadDto,
  LeadPage,
  LeadParams,
  LeadsQuery,
  PublicWorkerDto,
  WorkerCategoriesBody,
  WorkerProfileBody,
  WorkerProfileDto,
} from "../schemas/worker.schema.js";

export const workerRouter = Router();
const worker = [requireAuth(), requireRole("WORKER")];

workerRouter.get("/worker/profile", ...worker, c.getProfile);
workerRouter.put(
  "/worker/profile",
  ...worker,
  validate({ body: WorkerProfileBody }),
  c.putProfile,
);
workerRouter.put(
  "/worker/categories",
  ...worker,
  validate({ body: WorkerCategoriesBody }),
  c.putCategories,
);
workerRouter.patch(
  "/worker/availability",
  ...worker,
  validate({ body: AvailabilityBody }),
  c.availability,
);
workerRouter.post(
  "/worker/id-document",
  ...worker,
  uploadFiles("file", 1),
  c.idDocument,
);
workerRouter.get(
  "/worker/leads",
  ...worker,
  validate({ query: LeadsQuery }),
  c.leads,
);
workerRouter.get(
  "/worker/leads/:requestId",
  ...worker,
  validate({ params: LeadParams }),
  c.lead,
);
workerRouter.get("/worker/quotes", ...worker, c.myQuotes);
workerRouter.get(
  "/workers/:id",
  validate({ params: IdParams }),
  c.publicProfile,
);

const tags = ["Worker"];
const W = { tags, security: BEARER };
const profileErrors = errorResponses(401, 403, 404);

registry.registerPath({
  method: "get",
  path: "/api/v1/worker/profile",
  ...W,
  summary: "My worker profile (404 WORKER_PROFILE_MISSING before onboarding)",
  responses: { 200: ok("Profile", WorkerProfileDto), ...profileErrors },
});
registry.registerPath({
  method: "put",
  path: "/api/v1/worker/profile",
  ...W,
  summary: "Create or update my profile (base location, radius 1–20 km, GSTIN)",
  request: { body: { content: json(WorkerProfileBody) } },
  responses: {
    200: ok("Profile", WorkerProfileDto),
    ...errorResponses(401, 403, 422),
  },
});
registry.registerPath({
  method: "put",
  path: "/api/v1/worker/categories",
  ...W,
  summary: "Replace my service categories",
  request: { body: { content: json(WorkerCategoriesBody) } },
  responses: {
    200: ok("Profile", WorkerProfileDto),
    ...errorResponses(401, 403, 404, 422),
  },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/worker/availability",
  ...W,
  summary: "Toggle availability for new leads",
  request: { body: { content: json(AvailabilityBody) } },
  responses: {
    200: ok("Profile", WorkerProfileDto),
    ...errorResponses(401, 403, 404, 422),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/worker/id-document",
  ...W,
  summary:
    "Upload ID document (jpg/png/webp/pdf ≤5 MB) for manual verification",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({ file: z.string().openapi({ format: "binary" }) }),
        },
      },
    },
  },
  responses: {
    201: ok("Profile", WorkerProfileDto),
    ...errorResponses(401, 403, 404, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/worker/leads",
  ...W,
  summary: "Leads matched to me (masked until my quote is accepted)",
  request: { query: LeadsQuery },
  responses: { 200: ok("Leads", LeadPage), ...profileErrors },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/worker/leads/{requestId}",
  ...W,
  summary: "Lead detail (marks viewed)",
  request: { params: LeadParams },
  responses: { 200: ok("Lead", LeadDto), ...profileErrors },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/worker/quotes",
  ...W,
  summary: "My quotes",
  responses: {
    200: ok(
      "Quotes",
      z
        .object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              status: z.string(),
              version: z.number(),
              totalPaise: z.number(),
              labourPaise: z.number(),
              materialsPaise: z.number(),
              etaHours: z.number(),
              validUntil: z.string(),
              createdAt: z.string(),
              request: z.object({
                id: z.string().uuid(),
                title: z.string(),
                status: z.string(),
                priority: z.string(),
              }),
            }),
          ),
        })
        .openapi("MyQuotes"),
    ),
    ...profileErrors,
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/workers/{id}",
  tags: ["Workers (public)"],
  summary: "Public worker profile with rating breakdown",
  request: { params: IdParams },
  responses: { 200: ok("Worker", PublicWorkerDto), ...errorResponses(404) },
});
