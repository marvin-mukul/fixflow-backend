import {
  bayesianScore,
  rankScore,
  selectForFanout,
} from "../domain/ranking.js";
import type { Settings } from "../domain/settings.js";
import type { TxClient } from "../lib/prisma.js";
import {
  matchingRepository,
  type Candidate,
} from "../repositories/matching.repository.js";
import type { RequestWithContext } from "../repositories/request.repository.js";
import { matchRepository } from "../repositories/worker.repository.js";
import {
  notificationService,
  type AfterCommit,
} from "./notification.service.js";
import { onEnterStatus } from "./requestWorkflow.service.js";
import { settingsService } from "./settings.service.js";

export function scoreCandidate(c: Candidate, maxKm: number, s: Settings) {
  const R =
    c.bayesianScore ?? bayesianScore(0, 0, s.bayesianC, s.bayesianPriorMean);
  return rankScore(
    {
      bayesian: R,
      distanceKm: c.distanceKm,
      maxDistanceKm: maxKm,
      jobsCompleted: c.jobsCompleted,
      cancellations: c.cancellations,
      avgResponseMinutes: c.avgResponseMinutes,
    },
    s.rankingWeights,
  );
}

export const matchingService = {
  /** Finds, ranks and notifies workers for a request entering OPEN_FOR_QUOTES (requirements.md §4.5). */
  async matchRequest(
    tx: TxClient,
    req: RequestWithContext,
    afterCommit?: AfterCommit,
  ) {
    const s = await settingsService.getSettings();
    const radius = req.searchRadiusKm;
    const candidates = await matchingRepository.findCandidates(
      {
        lat: req.property.lat,
        lng: req.property.lng,
        radiusKm: radius,
        categoryId: req.categoryId,
        excludeRequestId: req.id,
      },
      tx,
    );
    // Never match the requester's own worker account.
    const eligible = candidates.filter(
      (c) =>
        c.userId !== req.raisedById &&
        c.userId !== req.payerUserId &&
        c.userId !== req.property.ownerId,
    );
    const scored = eligible.map((c) => ({
      ...c,
      score: scoreCandidate(c, radius, s),
    }));
    const chosen = selectForFanout(scored, s.fanoutLimit, s.newcomerSlots);
    await matchRepository.insertMany(
      chosen.map((c) => ({
        requestId: req.id,
        workerProfileId: c.workerProfileId,
        distanceKm: Math.round(c.distanceKm * 100) / 100,
        rankScore: c.score,
      })),
      tx,
    );
    await notificationService.notify(
      tx,
      chosen.map((c) => ({
        userId: c.userId,
        type: "NEW_LEAD",
        title:
          req.priority === "EMERGENCY"
            ? "Emergency lead nearby"
            : "New lead nearby",
        body: `${req.category.name}: ${req.title} (~${Math.round(c.distanceKm)} km)`,
        link: `/worker/leads/${req.id}`,
      })),
      afterCommit,
      req.priority === "EMERGENCY",
    );
    return chosen.length;
  },
};

onEnterStatus("OPEN_FOR_QUOTES", async (tx, req, afterCommit) => {
  await matchingService.matchRequest(tx, req, afterCommit);
});
