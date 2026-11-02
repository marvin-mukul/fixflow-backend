# FixFlow API

Home-repair marketplace backend: owners/tenants raise repair requests, nearby verified workers quote, the payer accepts, the job is tracked to completion, invoiced with GST, paid through a pluggable payment provider, and reviewed.

Express 5 · Prisma 7 (pg driver adapter) · PostgreSQL 17 · zod v4 + OpenAPI 3.1 (Swagger UI) · Vitest + Supertest · Node 26, ESM.

## Quick start

```bash
nvm use                      # Node 26 (.nvmrc)
npm ci                       # also runs `prisma generate`
cp .env.example .env         # adjust DATABASE_URL if needed
npm run db:deploy && npm run db:seed
npm run dev                  # http://localhost:4000  · Swagger: http://localhost:4000/api/docs
```

### One-time database setup (local PostgreSQL, no Docker)

```bash
sudo -u postgres psql -c "CREATE ROLE fixflow LOGIN PASSWORD 'fixflow' CREATEDB;"
sudo -u postgres createdb -O fixflow fixflow
sudo -u postgres createdb -O fixflow fixflow_test
```

No extensions are needed — geo matching uses plain SQL haversine (see `docs/adr/002-geo-without-postgis.md`).

`npm run db:reset` (drop + migrate + seed) works too; Prisma asks for explicit confirmation when it is run by an AI agent.

## Demo accounts (seed)

| Role                                                       | Email                                                                | Password                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Superadmin (must change password on first login)           | `marvin.mukul@rubicotech.in`                                         | `SEED_SUPERADMIN_PASSWORD` (`Rubi@123` in `.env.example`) |
| Admin                                                      | `admin@demo.fixflow`                                                 | `Demo@123`                                                |
| Owner of "Rajpur Road Flat", Dehradun                      | `owner@demo.fixflow`                                                 | `Demo@123`                                                |
| Tenant of that flat                                        | `tenant@demo.fixflow`                                                | `Demo@123`                                                |
| Verified plumbers (2, 5.8, 12 km)                          | `plumber1@…`, `plumber2@…` (GST-registered), `plumber3@demo.fixflow` | `Demo@123`                                                |
| Verified electricians                                      | `electrician1@…`, `electrician2@demo.fixflow`                        | `Demo@123`                                                |
| Plumber at 25 km (never matched at 20 km)                  | `plumber-far@demo.fixflow`                                           | `Demo@123`                                                |
| Unverified plumber (admin verifies → starts getting leads) | `plumber-new@demo.fixflow`                                           | `Demo@123`                                                |

## Golden path (Swagger or the frontend)

1. Tenant `POST /requests` (plumbing) → `PENDING_APPROVAL`; owner gets a notification.
2. Owner `POST /requests/:id/approve` → `OPEN_FOR_QUOTES`; the 3 verified plumbers within 20 km are matched.
3. Plumber `GET /worker/leads` (masked) → `POST /requests/:id/quotes`.
4. Owner `GET /requests/:id/quotes` (ranked) → `POST /quotes/:id/accept` with header `Idempotency-Key` and `{ version }` → `SCHEDULED`.
5. Plumber `POST /jobs/:id/en-route` → `/arrive` → `/start` → `/complete` (multipart `files`).
6. Tenant `POST /jobs/:id/confirm` → `COMPLETED`, invoice `FF/2026-27/000001` issued (₹500 quote → customer pays ₹590).
7. Owner `POST /invoices/:id/checkout` → mock pay page → `POST /payments/mock/:orderId/complete {"outcome":"success"}` → invoice `PAID`.
8. Tenant, owner and plumber `POST /jobs/:id/reviews`.

## Payments

All payment code goes through `src/payments/PaymentProvider.ts`. `PAYMENT_PROVIDER` selects the implementation.

### Mock (default — no account needed)

`createCheckout` returns `{ kind: "redirect", url: "<APP_URL>/pay/mock/<orderId>" }`. The frontend page shows the amount with **Pay (success)** / **Fail** buttons that call `POST /api/v1/payments/mock/:orderId/complete`. That endpoint builds a **signed synthetic webhook** and runs it through the same `parseWebhook → PaymentEvent dedupe → apply` pipeline as a real gateway. It returns 404 unless `PAYMENT_PROVIDER=mock`.

### Cashfree sandbox (optional, no KYC)

1. Sign up at <https://merchant.cashfree.com> → switch to **Test mode** → _Developers → API Keys_ → copy App ID and Secret Key.
2. In `.env`:
   ```
   PAYMENT_PROVIDER=cashfree
   CASHFREE_APP_ID=TEST...
   CASHFREE_SECRET_KEY=cfsk_ma_test_...
   CASHFREE_ENV=sandbox
   CASHFREE_WEBHOOK_SECRET=        # empty → the secret key is used (Cashfree signs with it)
   API_PUBLIC_URL=https://<your-tunnel>   # must be reachable by Cashfree for return/notify URLs
   ```
   In the frontend `.env`, set `VITE_PAYMENT_PROVIDER=cashfree` so the Cashfree JS SDK is loaded.
3. Expose the API for webhooks: `npx localtunnel --port 4000` (or `cloudflared tunnel --url http://localhost:4000` / ngrok) and set `API_PUBLIC_URL` to the public URL. Webhook URL: `<API_PUBLIC_URL>/api/v1/webhooks/payments/cashfree` (sent per order as `notify_url`; you can also add it in _Developers → Webhooks_).
4. Pay with sandbox test instruments from the Cashfree docs (_Payment Gateway → Test data_): e.g. UPI `testsuccess@gocash` (success) / `testfailure@gocash` (failure), or the listed test cards.

Order amounts are sent in rupees (`paise / 100`, two decimals); the webhook signature is `base64(HMAC_SHA256(x-webhook-timestamp + rawBody, secret))`. The return URL and the webhook may arrive in any order — both converge on the same forward-only state machine (`CREATED → PAID | FAILED`, `PAID → REFUNDED | PARTIALLY_REFUNDED`).

## Scripts

| Script                                                                       | What                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------- |
| `dev` / `build` / `start`                                                    | tsx watch / tsc / node dist                    |
| `typecheck`, `lint`, `format`                                                | quality gates                                  |
| `test`                                                                       | unit + integration (needs `DATABASE_URL_TEST`) |
| `test:int`, `test:cov`, `openapi:check`                                      | subsets                                        |
| `db:migrate`, `db:deploy`, `db:seed`, `db:reset`, `db:generate`, `db:studio` | Prisma                                         |

## Security notes

- helmet, CORS allow-list (`CORS_ORIGIN`, comma-separated), rate limits on `/api/v1/auth/*` (20/min/IP) and request creation (30/h/IP), bcrypt cost 12, zod on every input, pino log redaction (tokens, cookies, passwords, payment secrets).
- Swagger is public in dev; in production it requires an admin bearer token unless `SWAGGER_PUBLIC=true`.
- `DELETE /api/v1/auth/me` soft-deletes and anonymises an account (blocked while requests, jobs or unpaid invoices are open).
- Decisions: `docs/adr/` (ESM, geo without PostGIS, contextual roles, explicit transitions, commission from payout, Bayesian ranking, mock-first payments, JWT + refresh cookie). AI usage: `docs/AI_USAGE.md`.

## Architecture

`routes → controllers → services → repositories → prisma`; pure business rules in `src/domain` (state machine, pricing, ranking, geo, money). See `AGENTS.md` and `../system-design.md`.
