import { Router } from "express";
import { z } from "zod";
import { propertyController as c } from "../controllers/property.controller.js";
import { errorResponses, json, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { validate } from "../middlewares/validate.js";
import { BEARER, IdParams } from "../schemas/common.schema.js";
import {
  InvitationCreatedDto,
  InvitationPreviewDto,
  InviteBody,
  PropertyBody,
  PropertyDetailDto,
  PropertyDto,
  PropertyList,
  PropertyPatchBody,
  TenancyParams,
  TokenParams,
} from "../schemas/property.schema.js";

export const propertyRouter = Router();
const auth = requireAuth();
const customer = [auth, requireRole("CUSTOMER")];

propertyRouter.get("/properties", ...customer, c.list);
propertyRouter.post(
  "/properties",
  ...customer,
  validate({ body: PropertyBody }),
  c.create,
);
propertyRouter.get(
  "/properties/:id",
  ...customer,
  validate({ params: IdParams }),
  c.get,
);
propertyRouter.patch(
  "/properties/:id",
  ...customer,
  validate({ params: IdParams, body: PropertyPatchBody }),
  c.update,
);
propertyRouter.delete(
  "/properties/:id",
  ...customer,
  validate({ params: IdParams }),
  c.remove,
);
propertyRouter.post(
  "/properties/:id/invitations",
  ...customer,
  validate({ params: IdParams, body: InviteBody }),
  c.invite,
);
propertyRouter.post(
  "/properties/:id/tenancies/:tid/end",
  ...customer,
  validate({ params: TenancyParams }),
  c.endTenancy,
);
propertyRouter.get(
  "/invitations/:token",
  validate({ params: TokenParams }),
  c.previewInvitation,
);
propertyRouter.post(
  "/invitations/:token/accept",
  auth,
  validate({ params: TokenParams }),
  c.acceptInvitation,
);

const tags = ["Properties"];
const idParam = { params: IdParams };

registry.registerPath({
  method: "get",
  path: "/api/v1/properties",
  tags,
  security: BEARER,
  summary: "Properties I own or rent (active tenancy)",
  responses: {
    200: ok("Visible properties with my relation", PropertyList),
    ...errorResponses(401, 403),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/properties",
  tags,
  security: BEARER,
  summary: "Register a property (caller becomes owner)",
  request: { body: { content: json(PropertyBody) } },
  responses: {
    201: ok("Created", PropertyDto),
    ...errorResponses(401, 403, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/properties/{id}",
  tags,
  security: BEARER,
  summary: "Property detail (owner sees tenants + pending invitations)",
  request: idParam,
  responses: {
    200: ok("Property", PropertyDetailDto),
    ...errorResponses(401, 404),
  },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/properties/{id}",
  tags,
  security: BEARER,
  summary: "Update a property (owner)",
  request: { ...idParam, body: { content: json(PropertyPatchBody) } },
  responses: {
    200: ok("Updated", PropertyDto),
    ...errorResponses(401, 403, 404, 422),
  },
});
registry.registerPath({
  method: "delete",
  path: "/api/v1/properties/{id}",
  tags,
  security: BEARER,
  summary: "Soft-delete a property (owner, no open requests)",
  request: idParam,
  responses: {
    204: { description: "Deleted" },
    ...errorResponses(401, 403, 404, 409),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/properties/{id}/invitations",
  tags,
  security: BEARER,
  summary: "Invite a tenant by email (single-use link, 7-day expiry)",
  request: { ...idParam, body: { content: json(InviteBody) } },
  responses: {
    201: ok("Invitation sent", InvitationCreatedDto),
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/properties/{id}/tenancies/{tid}/end",
  tags,
  security: BEARER,
  summary:
    "End a tenancy (owner) or leave (tenant); open requests transfer to the owner",
  request: { params: TenancyParams },
  responses: {
    204: { description: "Ended" },
    ...errorResponses(401, 404, 409),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/invitations/{token}",
  tags: ["Invitations"],
  summary: "Preview an invitation (public)",
  request: { params: TokenParams },
  responses: {
    200: ok("Invitation", InvitationPreviewDto),
    ...errorResponses(404, 409, 410),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/invitations/{token}/accept",
  tags: ["Invitations"],
  security: BEARER,
  summary: "Accept an invitation (must be logged in with the invited email)",
  request: { params: TokenParams },
  responses: {
    200: ok(
      "Tenancy active",
      z
        .object({ propertyId: z.string().uuid(), tenancyId: z.string().uuid() })
        .openapi("InvitationAccepted"),
    ),
    ...errorResponses(401, 403, 404, 409, 410),
  },
});
