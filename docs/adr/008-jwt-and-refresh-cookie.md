# ADR 008 — Short-lived JWT in memory + rotating refresh cookie

- Status: accepted · Date: 2026-11-02

## Decision

Access JWT (15 min) is returned in the body and kept in memory (Redux) only. The refresh token (48 random bytes, sha256 stored) lives in an httpOnly, SameSite=Lax cookie scoped to `/api/v1/auth`, rotates on every refresh, and reuse of a rotated token revokes the whole family. Passport `local` for login and `jwt` for bearer auth.

## Consequences

XSS can't read the refresh token; CSRF can't use it outside the auth path. A stolen refresh token is detected on its first reuse.
