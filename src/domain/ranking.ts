/** Worker ranking (requirements.md §4.7). Pure — no I/O. */

export type RankingWeights = {
  rating: number;
  distance: number;
  completion: number;
  response: number;
};

/** Bayesian average R = (C·m + Σ) / (C + n). With no ratings R = m (the prior). */
export function bayesianScore(
  sum: number,
  n: number,
  C: number,
  m: number,
): number {
  return (C * m + sum) / (C + n);
}

/** Laplace-smoothed share of accepted jobs that were completed; newcomers start at 1. */
export function completionRate(
  jobsCompleted: number,
  cancellations: number,
): number {
  return (jobsCompleted + 1) / (jobsCompleted + cancellations + 1);
}

/** 1 for instant replies, 0.5 at one hour, → 0 for slow; unknown = 0.5. */
export function responseSpeed(
  avgResponseMinutes: number | null | undefined,
): number {
  if (avgResponseMinutes == null) return 0.5;
  return 1 / (1 + Math.max(0, avgResponseMinutes) / 60);
}

export type RankInput = {
  bayesian: number; // 1..5
  distanceKm: number;
  maxDistanceKm: number;
  jobsCompleted: number;
  cancellations: number;
  avgResponseMinutes: number | null;
};

/** 0.55·R/5 + 0.20·(1 − d/max) + 0.15·completionRate + 0.10·responseSpeed (weights from settings). */
export function rankScore(i: RankInput, w: RankingWeights): number {
  const dist = Math.min(
    Math.max(i.distanceKm / Math.max(i.maxDistanceKm, 1e-6), 0),
    1,
  );
  const score =
    w.rating * (i.bayesian / 5) +
    w.distance * (1 - dist) +
    w.completion * completionRate(i.jobsCompleted, i.cancellations) +
    w.response * responseSpeed(i.avgResponseMinutes);
  return Math.round(score * 10_000) / 10_000;
}

export const NEWCOMER_JOB_THRESHOLD = 5;

/**
 * Top `limit` by score, then up to `newcomerSlots` best newcomers (< 5 jobs) who missed the cut,
 * so new workers get a fair chance (requirements.md §4.5).
 */
export function selectForFanout<
  T extends { score: number; jobsCompleted: number },
>(ranked: T[], limit: number, newcomerSlots: number): T[] {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, limit);
  const extra = sorted
    .slice(limit)
    .filter((c) => c.jobsCompleted < NEWCOMER_JOB_THRESHOLD)
    .slice(0, newcomerSlots);
  return [...top, ...extra];
}

/** Exponential moving average for response minutes (keeps one column, no history table). */
export function updateAvgResponse(
  prev: number | null | undefined,
  sample: number,
  alpha = 0.3,
): number {
  if (prev == null) return sample;
  return prev * (1 - alpha) + sample * alpha;
}
