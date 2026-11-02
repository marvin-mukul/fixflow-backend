# ADR 005 — Commission is deducted from the worker payout; GST by worker registration

- Status: accepted · Date: 2026-11-02

## Decision

The customer pays service + 18 % GST (CGST/SGST intra-state, IGST inter-state). The platform commission (default 10 %, plus optional 18 % GST on commission) is deducted from the worker's payout. Unregistered worker → platform is the deemed supplier under CGST s.9(5) and keeps the GST to remit. Registered worker (GSTIN) → the GST is part of the payout and the platform collects TCS (s.52, default 0.5 %). All amounts are integer paise, rounded half-up per line (`src/domain/pricing.ts`). Rates are snapshotted on the invoice.

## Consequences

The ₹500 reference quote gives customer ₹590.00, commission ₹50, GST on commission ₹9, payout ₹441.00. Settings changes only affect new invoices. Whether GST on commission applies under s.9(5) is a CA question, so it stays a flag.
