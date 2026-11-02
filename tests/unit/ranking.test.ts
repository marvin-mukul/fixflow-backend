import { describe, expect, it } from "vitest";
import {
  bayesianScore,
  completionRate,
  rankScore,
  responseSpeed,
  selectForFanout,
  updateAvgResponse,
} from "../../src/domain/ranking.js";
import { DEFAULT_SETTINGS } from "../../src/domain/settings.js";

const w = DEFAULT_SETTINGS.rankingWeights;

describe("ranking", () => {
  it("bayesian pulls few ratings toward the prior", () => {
    expect(bayesianScore(0, 0, 10, 4)).toBe(4);
    expect(bayesianScore(5, 1, 10, 4)).toBeCloseTo(45 / 11, 6); // one 5★ barely moves it
    expect(bayesianScore(500, 100, 10, 4)).toBeCloseTo(540 / 110, 6); // many 5★ → near 5
  });

  it("completion rate and response speed", () => {
    expect(completionRate(0, 0)).toBe(1);
    expect(completionRate(9, 1)).toBeCloseTo(10 / 11, 6);
    expect(responseSpeed(null)).toBe(0.5);
    expect(responseSpeed(0)).toBe(1);
    expect(responseSpeed(60)).toBe(0.5);
  });

  it("rank score matches the formula", () => {
    const s = rankScore(
      {
        bayesian: 4,
        distanceKm: 5,
        maxDistanceKm: 20,
        jobsCompleted: 0,
        cancellations: 0,
        avgResponseMinutes: null,
      },
      w,
    );
    expect(s).toBeCloseTo(0.55 * 0.8 + 0.2 * 0.75 + 0.15 * 1 + 0.1 * 0.5, 4);
  });

  it("closer and better-rated workers rank higher", () => {
    const base = {
      bayesian: 4,
      distanceKm: 10,
      maxDistanceKm: 20,
      jobsCompleted: 10,
      cancellations: 0,
      avgResponseMinutes: 30,
    };
    expect(rankScore({ ...base, distanceKm: 2 }, w)).toBeGreaterThan(
      rankScore(base, w),
    );
    expect(rankScore({ ...base, bayesian: 4.8 }, w)).toBeGreaterThan(
      rankScore(base, w),
    );
    expect(rankScore({ ...base, distanceKm: 40 }, w)).toBeCloseTo(
      rankScore({ ...base, distanceKm: 20 }, w),
      6,
    );
  });

  it("fan-out takes top N plus newcomer slots", () => {
    const c = (score: number, jobsCompleted: number) => ({
      score,
      jobsCompleted,
    });
    const ranked = [
      c(0.9, 50),
      c(0.8, 20),
      c(0.3, 0),
      c(0.2, 1),
      c(0.1, 2),
      c(0.05, 30),
    ];
    const out = selectForFanout(ranked, 2, 2);
    expect(out.map((x) => x.score)).toEqual([0.9, 0.8, 0.3, 0.2]);
    expect(selectForFanout(ranked, 10, 2)).toHaveLength(6);
    expect(selectForFanout(ranked, 1, 0)).toHaveLength(1);
  });

  it("EMA for response minutes", () => {
    expect(updateAvgResponse(null, 40)).toBe(40);
    expect(updateAvgResponse(40, 100)).toBeCloseTo(58, 6);
  });
});
