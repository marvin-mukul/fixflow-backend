import { approxDistanceKm } from "../domain/geo.js";
import { updateAvgResponse } from "../domain/ranking.js";
import { AppError } from "../errors/AppError.js";
import { prisma } from "../lib/prisma.js";
import { jobRepository } from "../repositories/job.repository.js";
import {
  quoteRepository,
  type QuoteWithWorker,
} from "../repositories/quote.repository.js";
import { requestRepository } from "../repositories/request.repository.js";
import {
  matchRepository,
  workerRepository,
} from "../repositories/worker.repository.js";
import type {
  CreateQuoteInput,
  ReviseQuoteInput,
} from "../schemas/quote.schema.js";
import { requestPolicy, relationsFor, type Viewer } from "./request.policy.js";
import { toRequestDto } from "./request.service.js";
import { applyTransition } from "./requestWorkflow.service.js";
import { settingsService } from "./settings.service.js";
import { ratingBreakdown, workerService } from "./worker.service.js";
import { notificationService } from "./notification.service.js";

const DEFAULT_VALIDITY_MS = 72 * 3_600_000;

async function toQuoteDto(
  q: QuoteWithWorker,
  categoryId: string,
  match?: { distanceKm: number; rankScore: number },
) {
  const s = await settingsService.getSettings();
  const stats = q.workerProfile.stats.filter(
    (st) => st.categoryId === categoryId,
  );
  return {
    id: q.id,
    requestId: q.requestId,
    status: q.status,
    version: q.version,
    labourPaise: q.labourPaise,
    materialsPaise: q.materialsPaise,
    totalPaise: q.labourPaise + q.materialsPaise,
    notes: q.notes,
    etaHours: q.etaHours,
    proposedSlot: q.proposedSlot?.toISOString() ?? null,
    validUntil: q.validUntil.toISOString(),
    createdAt: q.createdAt.toISOString(),
    worker: {
      id: q.workerProfile.id,
      name: q.workerProfile.user.name,
      jobsCompleted: stats.reduce((a, st) => a + st.jobsCompleted, 0),
      rating: ratingBreakdown(stats, s.bayesianC, s.bayesianPriorMean),
    },
    distanceKm: match ? approxDistanceKm(match.distanceKm) : null,
    rankScore: match?.rankScore ?? null,
  };
}

function assertOpen(status: string, deadline: Date | null) {
  if (status !== "OPEN_FOR_QUOTES")
    throw AppError.invalidTransition("This request is not open for quotes");
  if (deadline && deadline.getTime() <= Date.now())
    throw AppError.conflict(
      "QUOTE_DEADLINE_PASSED",
      "The quote window for this request has closed",
    );
}

export const quoteService = {
  async create(requestId: string, userId: string, input: CreateQuoteInput) {
    const worker = await workerService.requireProfile(userId);
    if (worker.verificationStatus !== "VERIFIED")
      throw AppError.forbidden("Only verified workers can quote");
    const match = await matchRepository.find(requestId, worker.id);
    const req = match
      ? await requestRepository.findWithContext(requestId)
      : null;
    if (!match || !req) throw AppError.notFound("Lead not found");
    assertOpen(req.status, req.quoteDeadline);
    const validUntil = input.validUntil
      ? new Date(input.validUntil)
      : new Date(Date.now() + DEFAULT_VALIDITY_MS);
    if (validUntil.getTime() <= Date.now())
      throw AppError.validation([
        { path: "validUntil", message: "Must be in the future" },
      ]);

    const quote = await prisma
      .$transaction(async (tx) => {
        const q = await quoteRepository.create(
          {
            requestId,
            workerProfileId: worker.id,
            labourPaise: input.labourPaise,
            materialsPaise: input.materialsPaise,
            notes: input.notes ?? null,
            etaHours: input.etaHours,
            proposedSlot: input.proposedSlot
              ? new Date(input.proposedSlot)
              : null,
            validUntil,
          },
          tx,
        );
        const minutes = (Date.now() - match.notifiedAt.getTime()) / 60_000;
        const prev = await workerRepository.findStats(
          worker.id,
          req.categoryId,
          tx,
        );
        const avg = updateAvgResponse(
          prev?.avgResponseMinutes ?? null,
          minutes,
        );
        await workerRepository.upsertStats(
          worker.id,
          req.categoryId,
          { avgResponseMinutes: avg },
          { avgResponseMinutes: avg },
          tx,
        );
        await notificationService.notify(tx, [
          {
            userId: req.payerUserId,
            type: "NEW_QUOTE",
            title: "New quote received",
            body: `${worker.user.name} quoted ₹${((input.labourPaise + input.materialsPaise) / 100).toFixed(2)} for ${req.title}`,
            link: `/requests/${req.id}`,
          },
        ]);
        return q;
      })
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === "P2002")
          throw AppError.conflict(
            "QUOTE_EXISTS",
            "You already have an active quote on this request; revise it instead",
          );
        throw e;
      });
    return toQuoteDto(quote, req.categoryId, match);
  },

  async listForRequest(requestId: string, user: Viewer) {
    const req = await requestRepository.findWithContext(requestId);
    let workerProfileId: string | undefined;
    if (user.globalRole === "WORKER") {
      const w = await workerService.requireProfile(user.id);
      if (!(await matchRepository.find(requestId, w.id)))
        throw AppError.notFound("Request not found");
      workerProfileId = w.id;
    } else {
      requestPolicy.assertVisible(req, user);
    }
    const [quotes, matches] = await Promise.all([
      quoteRepository.listForRequest(requestId, { workerProfileId }),
      matchRepository.listForRequest(requestId),
    ]);
    const byWorker = new Map(matches.map((m) => [m.workerProfileId, m]));
    const items = await Promise.all(
      quotes.map((q) =>
        toQuoteDto(q, req!.categoryId, byWorker.get(q.workerProfileId)),
      ),
    );
    items.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
    return { items };
  },

  async mine(userId: string) {
    const w = await workerService.requireProfile(userId);
    const rows = await quoteRepository.listForWorker(w.id);
    return {
      items: rows.map((q) => ({
        id: q.id,
        status: q.status,
        version: q.version,
        totalPaise: q.labourPaise + q.materialsPaise,
        labourPaise: q.labourPaise,
        materialsPaise: q.materialsPaise,
        etaHours: q.etaHours,
        validUntil: q.validUntil.toISOString(),
        createdAt: q.createdAt.toISOString(),
        request: q.request,
      })),
    };
  },

  async ownQuote(quoteId: string, userId: string) {
    const w = await workerService.requireProfile(userId);
    const q = await quoteRepository.findById(quoteId);
    if (!q || q.workerProfileId !== w.id)
      throw AppError.notFound("Quote not found");
    return q;
  },

  async revise(quoteId: string, userId: string, input: ReviseQuoteInput) {
    const q = await this.ownQuote(quoteId, userId);
    if (q.status !== "SUBMITTED")
      throw AppError.invalidTransition("Only submitted quotes can be revised");
    const req = (await requestRepository.findWithContext(q.requestId))!;
    assertOpen(req.status, req.quoteDeadline);
    const updated = await quoteRepository.revise(quoteId, {
      ...input,
      proposedSlot:
        input.proposedSlot === undefined
          ? undefined
          : input.proposedSlot
            ? new Date(input.proposedSlot)
            : null,
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    });
    if (!updated)
      throw AppError.invalidTransition("Only submitted quotes can be revised");
    const match = await matchRepository.find(q.requestId, q.workerProfileId);
    return toQuoteDto(updated, req.categoryId, match ?? undefined);
  },

  async withdraw(quoteId: string, userId: string) {
    const q = await this.ownQuote(quoteId, userId);
    if (!(await quoteRepository.setStatusIf(quoteId, "SUBMITTED", "WITHDRAWN")))
      throw AppError.invalidTransition(
        "Only submitted quotes can be withdrawn",
      );
    const req = (await requestRepository.findWithContext(q.requestId))!;
    return toQuoteDto(
      (await quoteRepository.findById(quoteId))!,
      req.categoryId,
    );
  },

  /**
   * Payer accepts (system-design.md §5): request row locked by applyTransition, quote row locked here;
   * version must match; creates the Job; siblings rejected; request → SCHEDULED.
   */
  async accept(quoteId: string, user: Viewer, version: number) {
    const quote = await quoteRepository.findById(quoteId);
    if (!quote) throw AppError.notFound("Quote not found");
    let job: {
      id: string;
      subStatus: string;
      workerProfileId: string;
      scheduledStart: Date | null;
    } | null = null;
    let rejectedUserIds: string[] = [];
    try {
      const req = await applyTransition(quote.requestId, "accept_quote", user, {
        payload: { quoteId, version },
        sideEffects: async (tx) => {
          const q = await quoteRepository.lockById(quoteId, tx);
          if (!q || q.status !== "SUBMITTED")
            throw AppError.conflict(
              "QUOTE_NOT_ACCEPTABLE",
              "This quote can no longer be accepted",
            );
          if (q.validUntil.getTime() <= Date.now())
            throw AppError.conflict("QUOTE_EXPIRED", "This quote has expired");
          if (q.version !== version)
            throw AppError.conflict(
              "QUOTE_VERSION_MISMATCH",
              "The worker revised this quote; review the latest version",
            );
          job = await jobRepository.create(
            {
              requestId: q.requestId,
              quoteId: q.id,
              workerProfileId: q.workerProfileId,
              subStatus: "CONFIRMED",
              scheduledStart: q.proposedSlot,
            },
            tx,
          );
          await quoteRepository.setStatusIf(q.id, "SUBMITTED", "ACCEPTED", tx);
          rejectedUserIds = await quoteRepository.rejectSiblings(
            q.requestId,
            q.id,
            tx,
          );
        },
        notify: (r) => ({
          rows: [
            {
              userId: quote.workerProfile.userId,
              type: "QUOTE_ACCEPTED",
              title: "Your quote was accepted",
              body: `${r.title} — full address is now visible`,
              link: `/worker/leads/${r.id}`,
            },
            ...rejectedUserIds.map((uid) => ({
              userId: uid,
              type: "QUOTE_REJECTED",
              title: "Quote not selected",
              body: r.title,
              link: `/worker/leads/${r.id}`,
            })),
            {
              userId: r.raisedById,
              type: "JOB_SCHEDULED",
              title: "Job scheduled",
              body: `${quote.workerProfile.user.name} will handle ${r.title}`,
              link: `/requests/${r.id}`,
            },
          ],
          email: true,
        }),
      });
      const j = job!;
      return {
        request: toRequestDto(req, relationsFor(req, user)),
        job: {
          id: j.id,
          subStatus: j.subStatus,
          workerProfileId: j.workerProfileId,
          scheduledStart: j.scheduledStart?.toISOString() ?? null,
        },
      };
    } catch (e) {
      if (e instanceof AppError && e.code === "INVALID_TRANSITION") {
        const current = await requestRepository.findWithContext(
          quote.requestId,
        );
        if (current?.job)
          throw AppError.conflict(
            "QUOTE_ALREADY_ACCEPTED",
            "A quote was already accepted for this request",
          );
      }
      throw e;
    }
  },

  /** Scheduler: stale quotes expire; open requests past deadline with no quotes expire. */
  async expireDue(now = new Date()) {
    const stale = await quoteRepository.expireStale(now);
    const due = await requestRepository.findOpenPastDeadline(now);
    let expired = 0;
    for (const r of due) {
      try {
        await applyTransition(r.id, "expire", "SYSTEM", {
          guardCtx: async (tx, req) => ({
            submittedQuotes: await quoteRepository.countSubmitted(req.id, tx),
          }),
          notify: (req) => ({
            rows: [
              {
                userId: req.raisedById,
                type: "REQUEST_EXPIRED",
                title: "No quotes received",
                body: `${req.title} expired. You can reopen it once with a wider radius.`,
                link: `/requests/${req.id}`,
              },
              {
                userId: req.payerUserId,
                type: "REQUEST_EXPIRED",
                title: "No quotes received",
                body: `${req.title} expired.`,
                link: `/requests/${req.id}`,
              },
            ],
            email: true,
          }),
        });
        expired++;
      } catch {
        // HAS_QUOTES guard: stays open so the payer can still pick a quote.
      }
    }
    return stale.count + expired || 0;
  },
};
