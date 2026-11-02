import type { Router } from "express";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../src/lib/openapi.js";
import { apiRouter, opsRouter } from "../../src/routes/index.js";
import { webhookRouter } from "../../src/routes/payment.routes.js";

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
};

/** Walks the Express routers and yields "METHOD /openapi/{path}" for every route. */
function collect(router: Router, prefix: string, out: Set<string>) {
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    if (layer.route) {
      const path = (prefix + layer.route.path).replace(/:(\w+)/g, "{$1}");
      for (const [m, on] of Object.entries(layer.route.methods))
        if (on && m !== "_all") out.add(`${m.toUpperCase()} ${path}`);
    } else if (layer.handle?.stack) {
      collect(layer.handle as unknown as Router, prefix, out);
    }
  }
}

describe("OpenAPI coverage", () => {
  it("every Express route is documented in the spec", () => {
    const routes = new Set<string>();
    collect(apiRouter, "/api/v1", routes);
    collect(opsRouter, "", routes);
    collect(webhookRouter, "", routes);

    const spec = buildOpenApiDocument();
    const documented = new Set<string>();
    for (const [path, ops] of Object.entries(spec.paths ?? {})) {
      for (const m of Object.keys(ops as object))
        documented.add(`${m.toUpperCase()} ${path}`);
    }
    const missing = [...routes].filter((r) => !documented.has(r));
    expect(missing).toEqual([]);
    expect(routes.size).toBeGreaterThan(70);
  });

  it("every operation has a summary, a 2xx/3xx response and error responses", () => {
    const spec = buildOpenApiDocument();
    for (const [path, ops] of Object.entries(spec.paths ?? {})) {
      for (const [m, op] of Object.entries(
        ops as Record<
          string,
          { summary?: string; responses?: Record<string, unknown> }
        >,
      )) {
        expect(op.summary, `${m} ${path} summary`).toBeTruthy();
        const codes = Object.keys(op.responses ?? {});
        expect(
          codes.some((c) => /^[23]/.test(c)),
          `${m} ${path} success`,
        ).toBe(true);
        expect(
          codes.some((c) => /^[45]/.test(c)),
          `${m} ${path} errors`,
        ).toBe(true);
      }
    }
  });
});
