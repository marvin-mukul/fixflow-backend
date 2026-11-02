import type { Relation } from "./requestStateMachine.js";

/** Which review dimensions a reviewer may rate (requirements.md §4.7). Pure. */
export type Dimension = "quality" | "punctuality" | "behaviour" | "value";
export const ON_SITE: Dimension[] = ["quality", "punctuality", "behaviour"];

export function allowedDimensions(relations: readonly Relation[]): Dimension[] {
  const out = new Set<Dimension>();
  if (relations.includes("RAISER") || relations.includes("TENANT"))
    ON_SITE.forEach((d) => out.add(d));
  if (relations.includes("PAYER") || relations.includes("OWNER"))
    out.add("value");
  return [...out];
}

export type ReviewScores = Partial<Record<Dimension, number | null>> & {
  overall: number;
};

/** Sum/count deltas for WorkerStats when a review is added (+1), removed (−1) or edited (new − old). */
export function statsDelta(
  next: ReviewScores | null,
  prev: ReviewScores | null,
) {
  const v = (r: ReviewScores | null, k: Dimension | "overall") =>
    r && r[k] != null ? (r[k] as number) : 0;
  const c = (r: ReviewScores | null, k: Dimension) =>
    r && r[k] != null ? 1 : 0;
  return {
    ratingCount: (next ? 1 : 0) - (prev ? 1 : 0),
    sumOverall: v(next, "overall") - v(prev, "overall"),
    sumQuality: v(next, "quality") - v(prev, "quality"),
    sumPunctuality: v(next, "punctuality") - v(prev, "punctuality"),
    sumBehaviour: v(next, "behaviour") - v(prev, "behaviour"),
    sumValue: v(next, "value") - v(prev, "value"),
    countQuality: c(next, "quality") - c(prev, "quality"),
    countPunctuality: c(next, "punctuality") - c(prev, "punctuality"),
    countBehaviour: c(next, "behaviour") - c(prev, "behaviour"),
    countValue: c(next, "value") - c(prev, "value"),
  };
}
