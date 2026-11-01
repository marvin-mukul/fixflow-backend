# ADR 001 — Backend module format: ESM

- Status: accepted
- Date: 2026-11-01

## Context

The initial scaffold was CommonJS (`"type": "commonjs"`) with `module: nodenext`. Prisma 7 is ESM-first (the `prisma-client` generator defaults to ESM), several dependencies (`file-type`, newer `pino` transports) are ESM-only, and the frontend is already ESM.

## Decision

Use native ESM: `"type": "module"`, `module`/`moduleResolution: NodeNext`, explicit `.js` suffixes on relative imports, generator `moduleFormat = "esm"` with `importFileExtension = "js"`. Dev runs through `tsx watch`; production runs compiled `dist/` with plain `node`.

## Consequences

- ESM-only packages (`file-type`) import directly, no dynamic `import()` workarounds.
- Every relative import needs `.js`; TypeScript (NodeNext) enforces it at typecheck.
- No `__dirname`; use `import.meta.dirname`.
