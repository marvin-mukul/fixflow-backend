import { Router } from "express";
import { z } from "zod";
import { requestController as c } from "../controllers/request.controller.js";
import { errorResponses, json, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { uploadFiles } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import { BEARER, IdParams } from "../schemas/common.schema.js";
import {
  ApproveBody,
  CreateRequestBody,
  ListRequestsQuery,
  MediaParams,
  ReasonBody,
  RequestDto,
  RequestPage,
  TimelineDto,
} from "../schemas/request.schema.js";

export const requestRouter = Router();
const auth = requireAuth();
const customer = [auth, requireRole("CUSTOMER")];
const viewers = [auth, requireRole("CUSTOMER", "ADMIN")];
const byId = validate({ params: IdParams });

requestRouter.post(
  "/requests",
  ...customer,
  validate({ body: CreateRequestBody }),
  c.create,
);
requestRouter.get(
  "/requests",
  ...viewers,
  validate({ query: ListRequestsQuery }),
  c.list,
);
requestRouter.get("/requests/:id", ...viewers, byId, c.get);
requestRouter.post(
  "/requests/:id/media",
  ...customer,
  byId,
  uploadFiles("files", 5),
  c.uploadMedia,
);
requestRouter.get(
  "/requests/:id/media/:mediaId",
  auth,
  validate({ params: MediaParams }),
  c.media,
);
requestRouter.post(
  "/requests/:id/approve",
  ...customer,
  validate({ params: IdParams, body: ApproveBody }),
  c.approve,
);
requestRouter.post(
  "/requests/:id/reject",
  ...customer,
  validate({ params: IdParams, body: ReasonBody }),
  c.reject,
);
requestRouter.post(
  "/requests/:id/cancel",
  ...customer,
  validate({ params: IdParams, body: ReasonBody }),
  c.cancel,
);
requestRouter.post("/requests/:id/reopen", ...customer, byId, c.reopen);
requestRouter.get("/requests/:id/timeline", ...viewers, byId, c.timeline);

const tags = ["Requests"];
const p = { params: IdParams };
const transitionErrors = errorResponses(401, 403, 404, 409, 422);

registry.registerPath({
  method: "post",
  path: "/api/v1/requests",
  tags,
  security: BEARER,
  summary: "Raise a repair request",
  description:
    "Tenant → PENDING_APPROVAL (EMERGENCY auto-approves if the property allows). Owner → OPEN_FOR_QUOTES. Rate limited.",
  request: { body: { content: json(CreateRequestBody) } },
  responses: {
    201: ok("Created", RequestDto),
    ...errorResponses(401, 403, 404, 409, 422, 429),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/requests",
  tags,
  security: BEARER,
  summary:
    "Requests I can see (raised, owned property, active tenancy, paying). Admins see all.",
  request: { query: ListRequestsQuery },
  responses: { 200: ok("Page", RequestPage), ...errorResponses(401, 403, 422) },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/requests/{id}",
  tags,
  security: BEARER,
  summary: "Request detail with my relations and available actions",
  request: p,
  responses: { 200: ok("Request", RequestDto), ...errorResponses(401, 404) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/requests/{id}/media",
  tags,
  security: BEARER,
  summary:
    "Upload up to 5 photos (jpg/png/webp, ≤5 MB each, verified by magic bytes)",
  request: {
    ...p,
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            files: z.array(z.string().openapi({ format: "binary" })),
          }),
        },
      },
    },
  },
  responses: {
    201: ok("Request with media", RequestDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/requests/{id}/media/{mediaId}",
  tags,
  security: BEARER,
  summary: "Download a request photo (participants and matched workers only)",
  request: { params: MediaParams },
  responses: {
    200: { description: "The image bytes" },
    ...errorResponses(401, 404),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/requests/{id}/approve",
  tags,
  security: BEARER,
  summary:
    "Owner approves a tenant request (optionally tenant pays) → OPEN_FOR_QUOTES",
  request: { ...p, body: { content: json(ApproveBody) } },
  responses: { 200: ok("Approved", RequestDto), ...transitionErrors },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/requests/{id}/reject",
  tags,
  security: BEARER,
  summary: "Owner rejects a tenant request",
  request: { ...p, body: { content: json(ReasonBody) } },
  responses: { 200: ok("Rejected", RequestDto), ...transitionErrors },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/requests/{id}/cancel",
  tags,
  security: BEARER,
  summary: "Raiser or payer cancels (before work starts)",
  request: { ...p, body: { content: json(ReasonBody) } },
  responses: { 200: ok("Cancelled", RequestDto), ...transitionErrors },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/requests/{id}/reopen",
  tags,
  security: BEARER,
  summary: "Reopen an EXPIRED request once with a wider radius",
  request: p,
  responses: { 200: ok("Reopened", RequestDto), ...transitionErrors },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/requests/{id}/timeline",
  tags,
  security: BEARER,
  summary: "Audit timeline (RequestEvent, oldest first)",
  request: p,
  responses: { 200: ok("Timeline", TimelineDto), ...errorResponses(401, 404) },
});
