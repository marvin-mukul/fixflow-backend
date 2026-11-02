import { z } from "zod";
import "../lib/openapi.js";
import { RequestDto } from "./request.schema.js";

export const JobsQuery = z.object({
  active: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const CompleteJobBody = z.object({
  finalAmountPaise: z.coerce.number().int().positive().optional(),
});

export const DisputeBody = z
  .object({ reason: z.string().trim().min(10).max(1000) })
  .openapi("DisputeBody", {
    example: { reason: "Leak returned within an hour of the visit." },
  });

export const JobDto = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    subStatus: z.enum(["CONFIRMED", "EN_ROUTE", "ARRIVED", "WORKING", "DONE"]),
    requestStatus: z.string(),
    title: z.string(),
    category: z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      icon: z.string(),
    }),
    priority: z.string(),
    quote: z.object({
      id: z.string().uuid(),
      labourPaise: z.number(),
      materialsPaise: z.number(),
      totalPaise: z.number(),
      etaHours: z.number(),
      notes: z.string().nullable(),
    }),
    finalAmountPaise: z.number().int(),
    scheduledStart: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    confirmedAt: z.string().nullable(),
    worker: z.object({
      id: z.string().uuid(),
      name: z.string(),
      phone: z.string().nullable(),
    }),
    property: z.object({
      label: z.string(),
      addressLine1: z.string(),
      addressLine2: z.string().nullable(),
      city: z.string(),
      state: z.string(),
      pincode: z.string(),
      lat: z.number(),
      lng: z.number(),
    }),
    contact: z.object({ name: z.string(), phone: z.string().nullable() }),
    afterPhotos: z.array(
      z.object({
        id: z.string().uuid(),
        url: z.string(),
        mimeType: z.string(),
      }),
    ),
    invoice: z
      .object({
        id: z.string().uuid(),
        number: z.string(),
        status: z.string(),
        totalPaise: z.number(),
      })
      .nullable(),
    dispute: z
      .object({
        id: z.string().uuid(),
        status: z.string(),
        reason: z.string(),
        resolution: z.string().nullable(),
      })
      .nullable(),
    myReview: z
      .object({ id: z.string().uuid(), overall: z.number() })
      .passthrough()
      .nullable(),
    myRelations: z.array(z.string()),
    workerActions: z.array(z.enum(["en_route", "arrive", "start", "complete"])),
    customerActions: z.array(z.string()),
  })
  .openapi("Job");

export const JobPage = z
  .object({ items: z.array(JobDto), nextCursor: z.string().uuid().nullable() })
  .openapi("JobPage");
export const ConfirmResult = z
  .object({ request: RequestDto, job: JobDto })
  .openapi("ConfirmResult");

export const InvoiceDto = z
  .object({
    id: z.string().uuid(),
    number: z.string().openapi({ example: "FF/2026-27/000001" }),
    jobId: z.string().uuid(),
    requestId: z.string().uuid(),
    requestTitle: z.string(),
    workerName: z.string(),
    payerUserId: z.string().uuid(),
    status: z.enum([
      "ISSUED",
      "PAID",
      "PAID_OFFLINE",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
    ]),
    servicePaise: z.number().int().openapi({ example: 50000 }),
    cgstPaise: z.number().int().openapi({ example: 4500 }),
    sgstPaise: z.number().int().openapi({ example: 4500 }),
    igstPaise: z.number().int().openapi({ example: 0 }),
    totalPaise: z.number().int().openapi({ example: 59000 }),
    gstMode: z.enum(["PLATFORM_9_5", "WORKER_REGISTERED"]),
    issuedAt: z.string(),
    paidAt: z.string().nullable(),
    offlineMarkedAt: z.string().nullable(),
    payments: z.array(
      z.object({
        id: z.string().uuid(),
        provider: z.string(),
        status: z.string(),
        amountPaise: z.number(),
        refundedPaise: z.number(),
        createdAt: z.string(),
      }),
    ),
    breakdown: z
      .object({
        commissionPaise: z.number().int(),
        commissionGstPaise: z.number().int(),
        tcsPaise: z.number().int(),
        workerPayoutPaise: z.number().int(),
        ratesSnapshot: z.record(z.string(), z.unknown()),
      })
      .nullable()
      .openapi({
        description:
          "Commission/payout split — worker and admin only (null for customers)",
      }),
  })
  .openapi("Invoice");

export const EarningsDto = z
  .object({
    totals: z.object({
      paidPaise: z.number().int(),
      pendingPaise: z.number().int(),
      jobs: z.number().int(),
    }),
    items: z.array(
      z.object({
        invoiceId: z.string().uuid(),
        number: z.string(),
        jobId: z.string().uuid(),
        requestTitle: z.string(),
        status: z.string(),
        totalPaise: z.number().int(),
        commissionPaise: z.number().int(),
        tcsPaise: z.number().int(),
        workerPayoutPaise: z.number().int(),
        issuedAt: z.string(),
        paidAt: z.string().nullable(),
      }),
    ),
  })
  .openapi("Earnings");

export const DisputeListDto = z
  .object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["OPEN", "RESOLVED"]),
        reason: z.string(),
        resolution: z.string().nullable(),
        raisedBy: z.object({ id: z.string().uuid(), name: z.string() }),
        jobId: z.string().uuid(),
        requestId: z.string().uuid(),
        requestTitle: z.string(),
        requestStatus: z.string(),
        workerName: z.string(),
        amountPaise: z.number().nullable(),
        createdAt: z.string(),
        resolvedAt: z.string().nullable(),
      }),
    ),
  })
  .openapi("DisputeList");

export const DisputeQuery = z.object({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
});
export const ResolveDisputeBody = z
  .object({
    outcome: z.enum(["COMPLETE", "CANCEL"]),
    resolution: z.string().trim().min(5).max(1000),
  })
  .openapi("ResolveDisputeBody", {
    example: {
      outcome: "COMPLETE",
      resolution: "Worker revisited and fixed the leak.",
    },
  });
