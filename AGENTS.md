# FixFlow Backend – Agent Guide

Follow these rules for every change. Product spec: `../requirements.md`; build order: `../implementation.md`; patterns: `../system-design.md` (read only the sections a step lists).

## Stack

- Node 26 (`.nvmrc`; run `nvm use` first), TypeScript `~6.0.x` strict, **ESM** (`"type": "module"`, NodeNext, `.js` suffix on every relative import).
- Express 5, zod v4 (+ `@asteasolutions/zod-to-openapi`), Prisma **7** with `@prisma/adapter-pg`, PostgreSQL 17 (no PostGIS — ADR 002), pino, Vitest + Supertest.
- Prisma 7 only: URL lives in `prisma.config.ts`, never `url = env()` in the schema. Client is generated to `src/generated/prisma` (gitignored) and imported from `../generated/prisma/client.js`. Geo is lat/lng floats + SQL haversine in `matching.repository` (ADR 002); raw SQL only via `$queryRaw`/`$executeRaw` tagged templates. After any schema change run `npm run db:generate` (Prisma 7 migrate does not regenerate).

## Commands

- No Docker. Local PostgreSQL 17 on **localhost:5432** (dbs `fixflow`, `fixflow_test`; one-time setup in `../requirements.md §13`). Emails are logged to the console unless `SMTP_HOST` is set.
- `npm run dev` – API on :4000, Swagger at `/api/docs`, spec at `/api/docs.json`
- `npm run typecheck && npm run lint && npm test` – must be green before every commit
- `npm run db:migrate` / `db:reset` / `db:seed` / `db:generate` / `db:studio`
- `npm run test:int`, `npm run openapi:check`

## Layers (dependency points down only)

```
routes        → URL + verb → middleware chain → controller; registers the OpenAPI path   (no logic)
middlewares   → requestId, auth, requireRole, validate(zod), rateLimit, idempotency, notFound, errorHandler
controllers   → read res.locals.validated → call ONE service → send response           (no Prisma, no rules)
services      → business rules, policies (<area>.policy.ts), transactions, side effects (no req/res)
repositories  → all Prisma/SQL, one per aggregate, accept optional `tx`, return plain types (no rules)
domain        → pure functions: state machine, pricing, ranking, geo, money             (no I/O)
```

`services → domain` is allowed; nothing imports upward. Only services and `src/domain` contain business rules.

## Layout

```
src/app.ts (createApp, no listen)  src/server.ts (listen + graceful shutdown)
src/config/env.ts      zod-parsed env, exits on invalid; NODE_ENV=test swaps in DATABASE_URL_TEST
src/lib/               prisma.ts logger.ts openapi.ts (mailer.ts storage.ts later)
src/errors/AppError.ts src/middlewares/ src/domain/ src/payments/
src/routes/<area>.routes.ts  src/controllers/<area>.controller.ts
src/services/<area>.service.ts + <area>.policy.ts  src/repositories/<aggregate>.repository.ts
src/schemas/<area>.schema.ts (zod + .openapi())  src/jobs/scheduler.ts
tests/unit/  tests/integration/  tests/helpers/
```

## Rules for every endpoint

1. zod schema in `schemas/` with `.openapi()` examples.
2. Route: `validate({ body, query, params })` → controller. Validated data is on `res.locals.validated` (Express 5 `req.query` is read-only).
3. `registry.registerPath(...)` in the same routes file: tag, summary, `security: [{ bearerAuth: [] }]` when authed, request + success schemas, `...errorResponses(...)` for every error it can return. A route missing from the spec fails CI.
4. Service runs the policy check first; invisible rows → `AppError.notFound()` (never leak existence), visible but disallowed → `AppError.forbidden()`.
5. Lists are scoped by caller **in the repository query**, never fetch-then-filter. Cursor pagination, `limit ≤ 50`.
6. Multi-row writes run in one `prisma.$transaction`; emails/webhooks are dispatched after commit.

## Errors

Throw `AppError` (factories: `validation`, `unauthenticated`, `forbidden`, `notFound`, `conflict`, `invalidTransition`, `rateLimited`, `internal`). `errorHandler` maps zod → 422, P2002 → 409, P2025 → 404 and always returns
`{ error: { code, message, details, requestId } }` (no stack in production).

## Domain non-negotiables

- Money is integer **paise**. Never floats for money.
- Authorisation happens on the server in services. "Owner"/"tenant"/"payer" are relations, not roles.
- Status changes only through the state machine + `applyTransition` (`system-design.md §4`).
- Payments only through the `PaymentProvider` interface; default `PAYMENT_PROVIDER=mock`.
- Secrets never logged (pino redaction in `lib/logger.ts`), never committed.

## Tests

- Unit: everything in `domain/` and `payments/providers/mock.ts`.
- Integration: Supertest via `tests/helpers/app.ts` against real Postgres (`fixflow_test`); files run sequentially; truncate between files. Cover happy path + auth + permission + validation failures for every endpoint.

## Git

- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`), one logical change each; give a one-line reason for any new dependency.
- **Never add `Co-Authored-By` lines or any AI attribution.**
- Remote `git@github-work:marvin-mukul/fixflow-backend.git` (the `github-work` SSH host).
- Never commit `.env`, `uploads/`, `dist/` or `src/generated/`.
- After each step update `docs/PROGRESS.md`.

## Docs lookup

Use Context7 (or the Prisma skills in `.agents/skills/`) before writing version-sensitive code (Prisma 7, Express 5).
