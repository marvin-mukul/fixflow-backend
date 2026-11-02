import { z } from "zod";
import "../lib/openapi.js";
import { PriorityEnum, RequestStatusEnum } from "./request.schema.js";

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const WorkerProfileBody = z
  .object({
    bio: z.string().trim().max(1000).default(""),
    baseLat: z.number().min(6).max(38).openapi({ example: 30.3345 }),
    baseLng: z.number().min(68).max(98).openapi({ example: 78.0322 }),
    serviceRadiusKm: z.number().int().min(1).max(20).default(20),
    state: z.string().trim().min(2).max(80).openapi({ example: "Uttarakhand" }),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(GSTIN, "Invalid GSTIN")
      .nullable()
      .optional(),
  })
  .openapi("WorkerProfileBody");

export const WorkerCategoriesBody = z
  .object({
    categories: z
      .array(
        z.object({
          categoryId: z.string().uuid(),
          yearsExperience: z.number().int().min(0).max(60),
        }),
      )
      .min(1)
      .max(7),
  })
  .openapi("WorkerCategoriesBody");

export const AvailabilityBody = z
  .object({ isAvailable: z.boolean() })
  .openapi("AvailabilityBody");

const CategoryRef = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  icon: z.string(),
});

export const WorkerProfileDto = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    name: z.string(),
    bio: z.string(),
    baseLat: z.number(),
    baseLng: z.number(),
    serviceRadiusKm: z.number(),
    isAvailable: z.boolean(),
    verificationStatus: z.enum([
      "PENDING",
      "VERIFIED",
      "REJECTED",
      "SUSPENDED",
    ]),
    hasIdDocument: z.boolean(),
    gstin: z.string().nullable(),
    state: z.string(),
    categories: z.array(CategoryRef.extend({ yearsExperience: z.number() })),
    verifiedAt: z.string().nullable(),
  })
  .openapi("WorkerProfile");

export const RatingBreakdown = z
  .object({
    count: z.number().int(),
    bayesian: z.number(),
    overall: z.number().nullable(),
    quality: z.number().nullable(),
    punctuality: z.number().nullable(),
    behaviour: z.number().nullable(),
    value: z.number().nullable(),
  })
  .openapi("RatingBreakdown");

export const PublicWorkerDto = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    bio: z.string(),
    state: z.string(),
    verified: z.boolean(),
    categories: z.array(CategoryRef.extend({ yearsExperience: z.number() })),
    jobsCompleted: z.number().int(),
    rating: RatingBreakdown,
    memberSince: z.string(),
  })
  .openapi("PublicWorker");

export const MyQuoteDto = z.object({
  id: z.string().uuid(),
  status: z.enum(["SUBMITTED", "WITHDRAWN", "ACCEPTED", "REJECTED", "EXPIRED"]),
  version: z.number().int(),
  labourPaise: z.number().int(),
  materialsPaise: z.number().int(),
  totalPaise: z.number().int(),
  etaHours: z.number().int(),
  proposedSlot: z.string().nullable(),
  validUntil: z.string(),
  notes: z.string().nullable(),
});

export const LeadDto = z
  .object({
    requestId: z.string().uuid(),
    title: z.string(),
    description: z.string(),
    priority: PriorityEnum,
    status: RequestStatusEnum,
    category: CategoryRef,
    locality: z.object({ city: z.string(), pincode: z.string() }),
    approxDistanceKm: z.number(),
    location: z.object({ lat: z.number(), lng: z.number() }).openapi({
      description: "Rounded to ~1 km until your quote is accepted",
    }),
    preferredSlots: z.array(z.object({ start: z.string(), end: z.string() })),
    quoteDeadline: z.string().nullable(),
    media: z.array(
      z.object({
        id: z.string().uuid(),
        url: z.string(),
        mimeType: z.string(),
      }),
    ),
    myQuote: MyQuoteDto.nullable(),
    canQuote: z.boolean(),
    unmasked: z.boolean(),
    address: z
      .object({
        addressLine1: z.string(),
        addressLine2: z.string().nullable(),
        city: z.string(),
        state: z.string(),
        pincode: z.string(),
      })
      .nullable(),
    contact: z
      .object({ name: z.string(), phone: z.string().nullable() })
      .nullable(),
    jobId: z.string().uuid().nullable(),
    matchedAt: z.string(),
  })
  .openapi("Lead");

export const LeadPage = z
  .object({ items: z.array(LeadDto), nextCursor: z.string().uuid().nullable() })
  .openapi("LeadPage");

export const LeadsQuery = z.object({
  open: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const LeadParams = z.object({ requestId: z.string().uuid() });

export type WorkerProfileInput = z.infer<typeof WorkerProfileBody>;
