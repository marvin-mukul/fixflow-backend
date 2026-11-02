import { z } from "zod";
import "../lib/openapi.js";
import { RatingBreakdown } from "./worker.schema.js";
import { RequestDto } from "./request.schema.js";

const Paise = z.number().int().min(0).max(100_000_000);

export const CreateQuoteBody = z
  .object({
    labourPaise: Paise.openapi({
      example: 40000,
      description: "Integer paise (₹400.00)",
    }),
    materialsPaise: Paise.openapi({ example: 10000 }),
    notes: z.string().trim().max(1000).optional().nullable(),
    etaHours: z.number().int().min(1).max(720).openapi({ example: 4 }),
    proposedSlot: z.iso.datetime().optional().nullable(),
    validUntil: z.iso
      .datetime()
      .optional()
      .openapi({ description: "Defaults to 72 h from now" }),
  })
  .refine((q) => q.labourPaise + q.materialsPaise > 0, {
    message: "Quote total must be above zero",
    path: ["labourPaise"],
  })
  .openapi("CreateQuoteBody");

export const ReviseQuoteBody = z
  .object({
    labourPaise: Paise,
    materialsPaise: Paise,
    notes: z.string().trim().max(1000).nullable(),
    etaHours: z.number().int().min(1).max(720),
    proposedSlot: z.iso.datetime().nullable(),
    validUntil: z.iso.datetime(),
  })
  .partial()
  .openapi("ReviseQuoteBody");

export const AcceptQuoteBody = z
  .object({
    version: z
      .number()
      .int()
      .min(1)
      .openapi({ description: "The quote version you saw" }),
  })
  .openapi("AcceptQuoteBody");

export const QuoteDto = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    status: z.enum([
      "SUBMITTED",
      "WITHDRAWN",
      "ACCEPTED",
      "REJECTED",
      "EXPIRED",
    ]),
    version: z.number().int(),
    labourPaise: z.number().int(),
    materialsPaise: z.number().int(),
    totalPaise: z.number().int(),
    notes: z.string().nullable(),
    etaHours: z.number().int(),
    proposedSlot: z.string().nullable(),
    validUntil: z.string(),
    createdAt: z.string(),
    worker: z.object({
      id: z.string().uuid(),
      name: z.string(),
      jobsCompleted: z.number().int(),
      rating: RatingBreakdown,
    }),
    distanceKm: z.number().nullable(),
    rankScore: z.number().nullable(),
  })
  .openapi("Quote");

export const QuoteList = z
  .object({ items: z.array(QuoteDto) })
  .openapi("QuoteList");

export const AcceptResult = z
  .object({
    request: RequestDto,
    job: z.object({
      id: z.string().uuid(),
      subStatus: z.string(),
      workerProfileId: z.string().uuid(),
      scheduledStart: z.string().nullable(),
    }),
  })
  .openapi("AcceptQuoteResult");

export type CreateQuoteInput = z.infer<typeof CreateQuoteBody>;
export type ReviseQuoteInput = z.infer<typeof ReviseQuoteBody>;
