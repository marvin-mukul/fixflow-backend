# ADR 007 — Pluggable payments, mock provider first

- Status: accepted · Date: 2026-11-02

## Decision

Services use only the `PaymentProvider` interface. `mock` (default) needs no account: its pay page triggers a **signed synthetic webhook** that runs through the real `parseWebhook → PaymentEvent dedupe → apply` path. `cashfree` uses sandbox keys (no KYC) over plain `fetch`. The webhook is the source of truth; the return URL and the webhook converge on a forward-only state machine.

## Consequences

The whole flow is demoable and testable from a fresh clone. Razorpay or Stripe can be added as another adapter without touching services.
