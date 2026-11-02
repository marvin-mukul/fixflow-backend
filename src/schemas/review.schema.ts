import { z } from "zod";
import "../lib/openapi.js";

const Star = z.number().int().min(1).max(5);

export const ReviewBody = z
  .object({
    overall: Star.openapi({ example: 5 }),
    quality: Star.optional(),
    punctuality: Star.optional(),
    behaviour: Star.optional(),
    value: Star.optional(),
    wouldRehire: z.boolean().optional(),
    finalCostMatchedQuote: z.boolean().optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .openapi("ReviewBody", {
    example: {
      overall: 5,
      quality: 5,
      punctuality: 4,
      behaviour: 5,
      wouldRehire: true,
      comment: "Quick and tidy.",
    },
  });

export const ReviewPatchBody = ReviewBody.partial().openapi("ReviewPatchBody");

export const ReviewDto = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    revieweeType: z.enum(["WORKER", "CUSTOMER"]),
    overall: z.number(),
    quality: z.number().nullable(),
    punctuality: z.number().nullable(),
    behaviour: z.number().nullable(),
    value: z.number().nullable(),
    wouldRehire: z.boolean().nullable(),
    finalCostMatchedQuote: z.boolean().nullable(),
    comment: z.string().nullable(),
    editable: z.boolean(),
    createdAt: z.string(),
    editedAt: z.string().nullable(),
  })
  .openapi("Review");

export const PublicReviewPage = z
  .object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        reviewerName: z.string(),
        category: z.string(),
        overall: z.number(),
        quality: z.number().nullable(),
        punctuality: z.number().nullable(),
        behaviour: z.number().nullable(),
        value: z.number().nullable(),
        wouldRehire: z.boolean().nullable(),
        comment: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
    nextCursor: z.string().uuid().nullable(),
  })
  .openapi("PublicReviewPage");

export type ReviewInput = z.infer<typeof ReviewBody>;
export type ReviewPatch = z.infer<typeof ReviewPatchBody>;
