# ADR 006 — Bayesian rating + weighted rank score

- Status: accepted · Date: 2026-11-02

## Decision

Per (worker, category) `WorkerStats` keeps sums and counts. The rating is Bayesian, `R = (C·m + Σ)/(C + n)` with C = 10 and prior m = 4, so a single 5★ can't top the list. Rank = `0.55·R/5 + 0.20·(1 − d/radius) + 0.15·completionRate + 0.10·responseSpeed` (weights in settings). Fan-out takes the top N plus up to 2 newcomers (< 5 jobs) who missed the cut. Stats are updated with atomic increments inside the review transaction.

## Consequences

Rankings are stable with few reviews, new workers still get leads, and the formula is tunable without a deploy.
