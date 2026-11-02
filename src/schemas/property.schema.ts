import { z } from "zod";
import "../lib/openapi.js";

export const PropertyTypeEnum = z.enum(["HOUSE", "FLAT", "OTHER"]);

export const PropertyBody = z
  .object({
    label: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .openapi({ example: "Rajpur Road Flat" }),
    type: PropertyTypeEnum,
    addressLine1: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .openapi({ example: "Flat 12B, Green Residency, Rajpur Road" }),
    addressLine2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().min(2).max(80).openapi({ example: "Dehradun" }),
    state: z.string().trim().min(2).max(80).openapi({ example: "Uttarakhand" }),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/, "6-digit Indian pincode")
      .openapi({ example: "248001" }),
    // India bounding box.
    lat: z.number().min(6).max(38).openapi({ example: 30.3165 }),
    lng: z.number().min(68).max(98).openapi({ example: 78.0322 }),
    isOwnerOccupied: z.boolean().default(false),
    autoApproveEmergency: z.boolean().default(false),
  })
  .openapi("PropertyBody");

export const PropertyPatchBody =
  PropertyBody.partial().openapi("PropertyPatchBody");

export const TenantDto = z.object({
  tenancyId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(["INVITED", "ACTIVE", "ENDED"]),
  startDate: z.string(),
  endDate: z.string().nullable(),
});

export const PendingInvitationDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  expiresAt: z.string(),
});

export const PropertyDto = z
  .object({
    id: z.string().uuid(),
    ownerId: z.string().uuid().nullable(),
    label: z.string(),
    type: PropertyTypeEnum,
    addressLine1: z.string(),
    addressLine2: z.string().nullable(),
    city: z.string(),
    state: z.string(),
    pincode: z.string(),
    lat: z.number(),
    lng: z.number(),
    isOwnerOccupied: z.boolean(),
    autoApproveEmergency: z.boolean(),
    relation: z.enum(["OWNER", "TENANT"]),
    ownerName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Property");

export const PropertyDetailDto = PropertyDto.extend({
  tenants: z.array(TenantDto),
  pendingInvitations: z.array(PendingInvitationDto),
}).openapi("PropertyDetail");

export const PropertyList = z
  .object({ items: z.array(PropertyDto) })
  .openapi("PropertyList");

export const InviteBody = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email())
      .openapi({ example: "tenant@demo.fixflow" }),
    phone: z
      .string()
      .regex(/^\+?[0-9]{10,15}$/)
      .optional(),
  })
  .openapi("InviteBody");

export const InvitationCreatedDto = z
  .object({ id: z.string().uuid(), email: z.string(), expiresAt: z.string() })
  .openapi("InvitationCreated");

export const InvitationPreviewDto = z
  .object({
    type: z.enum(["TENANT", "OWNER"]),
    email: z.string(),
    propertyLabel: z.string(),
    city: z.string(),
    inviterName: z.string(),
    expiresAt: z.string(),
    needsRegistration: z.boolean(),
  })
  .openapi("InvitationPreview");

export const TokenParams = z.object({ token: z.string().min(20).max(200) });
export const TenancyParams = z.object({
  id: z.string().uuid(),
  tid: z.string().uuid(),
});

export type PropertyInput = z.infer<typeof PropertyBody>;
export type PropertyPatch = z.infer<typeof PropertyPatchBody>;
export type InviteInput = z.infer<typeof InviteBody>;
