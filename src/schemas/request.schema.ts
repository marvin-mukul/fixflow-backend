import { z } from "zod";
import { REQUEST_STATUSES } from "../domain/requestStateMachine.js";
import "../lib/openapi.js";

export const PriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "EMERGENCY"]);
export const RequestStatusEnum = z.enum(REQUEST_STATUSES);

const Slot = z
  .object({ start: z.iso.datetime(), end: z.iso.datetime() })
  .refine((s) => new Date(s.end) > new Date(s.start), {
    message: "end must be after start",
    path: ["end"],
  })
  .openapi({
    example: {
      start: "2026-11-05T04:30:00.000Z",
      end: "2026-11-05T07:30:00.000Z",
    },
  });

export const CreateRequestBody = z
  .object({
    propertyId: z.string().uuid(),
    categoryId: z.string().uuid(),
    title: z
      .string()
      .trim()
      .min(5)
      .max(120)
      .openapi({ example: "Kitchen sink leaking" }),
    description: z.string().trim().min(10).max(2000).openapi({
      example: "Water drips from the pipe under the kitchen sink.",
    }),
    priority: PriorityEnum.openapi({ example: "HIGH" }),
    preferredSlots: z.array(Slot).max(3).default([]),
    payerUserId: z
      .string()
      .uuid()
      .optional()
      .openapi({ description: "Owner only: an active tenant who pays" }),
  })
  .openapi("CreateRequestBody");

export const ListRequestsQuery = z.object({
  status: z
    .union([RequestStatusEnum, z.array(RequestStatusEnum)])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    ),
  propertyId: z.string().uuid().optional(),
  scope: z.enum(["all", "raised", "approvals"]).default("all"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ApproveBody = z
  .object({ tenantPays: z.boolean().default(false) })
  .openapi("ApproveBody");
export const ReasonBody = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .openapi("ReasonBody", { example: { reason: "Not needed any more" } });

export const MediaDto = z.object({
  id: z.string().uuid(),
  kind: z.enum(["BEFORE", "AFTER", "DOCUMENT"]),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  url: z.string(),
  createdAt: z.string(),
});

export const RequestDto = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string(),
    priority: PriorityEnum,
    status: RequestStatusEnum,
    property: z.object({
      id: z.string().uuid(),
      label: z.string(),
      addressLine1: z.string(),
      addressLine2: z.string().nullable(),
      city: z.string(),
      state: z.string(),
      pincode: z.string(),
      lat: z.number(),
      lng: z.number(),
    }),
    category: z.object({
      id: z.string().uuid(),
      slug: z.string(),
      name: z.string(),
      icon: z.string(),
    }),
    raisedBy: z.object({ id: z.string().uuid(), name: z.string() }),
    payer: z.object({ id: z.string().uuid(), name: z.string() }),
    preferredSlots: z.array(z.object({ start: z.string(), end: z.string() })),
    quoteDeadline: z.string().nullable(),
    approvedAt: z.string().nullable(),
    searchRadiusKm: z.number(),
    reopenedCount: z.number(),
    cancelReason: z.string().nullable(),
    media: z.array(MediaDto),
    jobId: z.string().uuid().nullable(),
    myRelations: z.array(z.string()),
    availableActions: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("RepairRequest");

export const RequestPage = z
  .object({
    items: z.array(RequestDto),
    nextCursor: z.string().uuid().nullable(),
  })
  .openapi("RepairRequestPage");

export const TimelineDto = z
  .object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        action: z.string(),
        fromStatus: RequestStatusEnum.nullable(),
        toStatus: RequestStatusEnum,
        actor: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
        payload: z.unknown(),
        createdAt: z.string(),
      }),
    ),
  })
  .openapi("RequestTimeline");

export const MediaParams = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
});

export type CreateRequestInput = z.infer<typeof CreateRequestBody>;
export type ListRequestsInput = z.infer<typeof ListRequestsQuery>;
