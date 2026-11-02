# ADR 003 — Owner / tenant / payer are relations, not roles

- Status: accepted · Date: 2026-11-02

## Context

The same customer can own flat A and rent flat B. A global "TENANT" role cannot express that.

## Decision

`User.globalRole` is only `SUPERADMIN | ADMIN | CUSTOMER | WORKER`. Owner, tenant, payer, raiser and assigned worker are computed per request from rows (`Property.ownerId`, active `Tenancy`, `RepairRequest.payerUserId/raisedById`, `Job.workerProfileId`) in `request.policy.relationsFor()`.

## Consequences

Every authorisation decision is made in services against the specific row. Invisible rows return 404 (no existence leak); visible-but-forbidden returns 403. The UI gets `myRelations` + `availableActions` instead of guessing.
