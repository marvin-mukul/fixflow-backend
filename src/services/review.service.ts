import { bayesianScore } from "../domain/ranking.js";
import {
  allowedDimensions,
  statsDelta,
  type Dimension,
  type ReviewScores,
} from "../domain/reviews.js";
import { AppError, type ErrorDetail } from "../errors/AppError.js";
import { prisma, type TxClient } from "../lib/prisma.js";
import { jobRepository } from "../repositories/job.repository.js";
import { reviewRepository } from "../repositories/review.repository.js";
import { workerRepository } from "../repositories/worker.repository.js";
import type { ReviewInput, ReviewPatch } from "../schemas/review.schema.js";
import { relationsFor, requestPolicy, type Viewer } from "./request.policy.js";
import { settingsService } from "./settings.service.js";

const EDIT_WINDOW_MS = 24 * 3_600_000;
const DIMENSIONS: Dimension[] = [
  "quality",
  "punctuality",
  "behaviour",
  "value",
];

type ReviewRow = Awaited<ReturnType<typeof reviewRepository.create>>;

function toDto(r: ReviewRow) {
  return {
    id: r.id,
    jobId: r.jobId,
    revieweeType: r.revieweeType,
    overall: r.overall,
    quality: r.quality,
    punctuality: r.punctuality,
    behaviour: r.behaviour,
    value: r.value,
    wouldRehire: r.wouldRehire,
    finalCostMatchedQuote: r.finalCostMatchedQuote,
    comment: r.comment ?? null,
    editable:
      !r.editedAt && Date.now() - r.createdAt.getTime() < EDIT_WINDOW_MS,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
  };
}

function assertDimensions(input: Partial<ReviewInput>, allowed: Dimension[]) {
  const bad: ErrorDetail[] = DIMENSIONS.filter(
    (d) => input[d] !== undefined && !allowed.includes(d),
  ).map((d) => ({
    path: d,
    message: `You can't rate ${d} for this job`,
    code: "DIMENSION_NOT_ALLOWED",
  }));
  if (bad.length)
    throw AppError.validation(
      bad,
      "Some ratings are not allowed for your role",
    );
}

/** Applies a review delta to WorkerStats atomically and recomputes the Bayesian score. */
async function applyStats(
  tx: TxClient,
  workerProfileId: string,
  categoryId: string,
  next: ReviewScores | null,
  prev: ReviewScores | null,
) {
  const s = await settingsService.getSettings();
  const d = statsDelta(next, prev);
  const inc = Object.fromEntries(
    Object.entries(d).map(([k, v]) => [k, { increment: v }]),
  );
  const row = await workerRepository.upsertStats(
    workerProfileId,
    categoryId,
    inc,
    d,
    tx,
  );
  await workerRepository.upsertStats(
    workerProfileId,
    categoryId,
    {
      bayesianScore: bayesianScore(
        row.sumOverall,
        row.ratingCount,
        s.bayesianC,
        s.bayesianPriorMean,
      ),
    },
    {},
    tx,
  );
}

export const reviewService = {
  async create(jobId: string, user: Viewer, input: ReviewInput) {
    const job = await jobRepository.findWithContext(jobId);
    const rel = requestPolicy.assertVisible(job?.request ?? null, user);
    if (job!.request.status !== "COMPLETED")
      throw AppError.invalidTransition(
        "Reviews open once the job is completed",
      );
    const s = await settingsService.getSettings();
    const since = (job!.confirmedAt ?? job!.updatedAt).getTime();
    if (Date.now() - since > s.reviewWindowDays * 86_400_000)
      throw AppError.conflict(
        "REVIEW_WINDOW_CLOSED",
        `Reviews close ${s.reviewWindowDays} days after completion`,
      );

    const isWorker = rel.includes("WORKER");
    if (!isWorker && !requestPolicy.isCustomerSide(rel))
      throw AppError.forbidden("Only participants can review");
    assertDimensions(input, isWorker ? [] : allowedDimensions(rel));
    if (
      isWorker &&
      (input.wouldRehire !== undefined ||
        input.finalCostMatchedQuote !== undefined)
    )
      throw AppError.validation([
        {
          path: "wouldRehire",
          message: "Workers rate the customer with overall + comment only",
        },
      ]);

    const review = await prisma
      .$transaction(async (tx) => {
        const r = await reviewRepository.create(
          {
            jobId,
            reviewerId: user.id,
            revieweeType: isWorker ? "CUSTOMER" : "WORKER",
            overall: input.overall,
            quality: input.quality ?? null,
            punctuality: input.punctuality ?? null,
            behaviour: input.behaviour ?? null,
            value: input.value ?? null,
            wouldRehire: input.wouldRehire ?? null,
            finalCostMatchedQuote: input.finalCostMatchedQuote ?? null,
            comment: input.comment ?? null,
          },
          tx,
        );
        if (!isWorker)
          await applyStats(
            tx,
            job!.workerProfileId,
            job!.request.categoryId,
            r,
            null,
          );
        return r;
      })
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === "P2002")
          throw AppError.conflict(
            "ALREADY_REVIEWED",
            "You already reviewed this job",
          );
        throw e;
      });
    return toDto(review);
  },

  async update(reviewId: string, user: Viewer, input: ReviewPatch) {
    const existing = await reviewRepository.findById(reviewId);
    if (!existing || existing.reviewerId !== user.id)
      throw AppError.notFound("Review not found");
    if (existing.editedAt)
      throw AppError.conflict(
        "REVIEW_ALREADY_EDITED",
        "A review can be edited only once",
      );
    if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS)
      throw AppError.conflict(
        "REVIEW_EDIT_WINDOW_CLOSED",
        "Reviews can be edited within 24 hours",
      );
    const job = (await jobRepository.findWithContext(existing.jobId))!;
    const rel = relationsFor(job.request, user);
    const isWorker = existing.revieweeType === "CUSTOMER";
    assertDimensions(input, isWorker ? [] : allowedDimensions(rel));
    const updated = await prisma.$transaction(async (tx) => {
      const r = await reviewRepository.update(
        reviewId,
        { ...input, editedAt: new Date() },
        tx,
      );
      if (!isWorker)
        await applyStats(
          tx,
          job.workerProfileId,
          existing.job.request.categoryId,
          r,
          existing,
        );
      return r;
    });
    return toDto(updated);
  },

  async listForWorker(
    workerProfileId: string,
    q: { cursor?: string; limit: number },
  ) {
    const w = await workerRepository.findById(workerProfileId);
    if (!w || w.verificationStatus !== "VERIFIED")
      throw AppError.notFound("Worker not found");
    const page = await reviewRepository.listForWorker(workerProfileId, q);
    return {
      items: page.items.map((r) => ({
        id: r.id,
        // First name only: reviews are public.
        reviewerName: r.reviewer.name.split(" ")[0] ?? "Customer",
        category: r.job.request.category.name,
        overall: r.overall,
        quality: r.quality,
        punctuality: r.punctuality,
        behaviour: r.behaviour,
        value: r.value,
        wouldRehire: r.wouldRehire,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },
};
