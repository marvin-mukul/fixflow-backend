# AI usage

This backend was built with Claude (Claude Code, Opus) as a pair programmer, working from `requirements.md`, `implementation.md` and `system-design.md` in the workspace root.

How it was used:

- Step by step per `implementation.md`: each step was implemented, then gated by `npm run typecheck && npm run lint && npm test` before the commit.
- Every endpoint has integration tests against a real PostgreSQL database (no mocked database), including the concurrency, idempotency and payment-convergence cases.
- Version-sensitive APIs (Prisma 7 driver adapter / `prisma.config.ts`, ESM generator output) were checked against the Prisma agent skills vendored in `.agents/skills/`.

Decisions the AI made and recorded (review these):

- No PostGIS (not installed on the dev machine) → SQL haversine (ADR 002).
- Interface extensions for Cashfree (`orderId`, `notifyUrl`, `providerOrderId` for refunds) and `Payment.checkoutData`.
- Deviations per step are listed in `docs/PROGRESS.md`.

Human review is still needed for: GST/TCS treatment (CA question), Cashfree live verification with real sandbox keys, and production deployment settings.
