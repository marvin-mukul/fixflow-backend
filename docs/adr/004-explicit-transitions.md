# ADR 004 — Explicit state transitions through one helper

- Status: accepted · Date: 2026-11-02

## Context

Repair requests move through 11 statuses with different actors and guards. Ad-hoc `UPDATE status = …` calls drift and race.

## Decision

A pure transition table (`src/domain/requestStateMachine.ts`) plus one service helper, `applyTransition()` (`services/requestWorkflow.service.ts`): lock the row (`SELECT … FOR UPDATE`) → resolve relations → validate the transition → side effects → status update → append `RequestEvent` → enter-status hooks (deadline, matching, invoice) → notifications, all in one transaction; emails after commit. Every transition is its own endpoint.

## Consequences

Concurrency is serialised per request (e.g. two quote accepts: one wins, one 409). The timeline is the event log. New side effects attach as enter-status hooks without touching callers.
