# ADR 002 — Geo matching without PostGIS (plain SQL haversine)

- Status: accepted (revisit when PostGIS is installed)
- Date: 2026-11-02

## Context

The spec called for PostGIS (`geography(Point,4326)`, `ST_DWithin`, GiST). The project runs on the developer's local PostgreSQL 17 with **no Docker** (owner's decision), and the `postgresql-17-postgis-3` package is not installed on the machine; installing it needs sudo. `earthdistance` would also need a superuser. Matching must work from a plain `npm run db:deploy`.

## Decision

- Store coordinates as `lat`/`lng` (`double precision`) on `property` and `base_lat`/`base_lng` on `worker_profile`, with B-tree indexes on both pairs.
- `matching.repository.findCandidates` prefilters with a bounding box (`domain/geo.boundingBox`, index-friendly `BETWEEN`) and filters exactly with the haversine formula in SQL, `<= LEAST(radius, worker.service_radius_km)`.
- `domain/geo.ts` holds the same haversine in TypeScript for unit tests and server-side distance display.

## Consequences

- Zero extensions, works on any Postgres. Accuracy is the same as `ST_DWithin` on a sphere (< 0.5 % error vs. the ellipsoid at 20 km).
- Performance is fine at marketplace scale (thousands of workers per city); the bounding box keeps the haversine to a handful of rows.
- **Switching to PostGIS later** is contained: add `location geography(Point,4326)` columns (generated from lat/lng), a GiST index, and replace the WHERE clause in `findCandidates` with `ST_DWithin`. No service, API or frontend change.
