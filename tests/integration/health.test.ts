import { describe, expect, it } from "vitest";
import { api } from "../helpers/app.js";

describe("ops routes", () => {
  it("GET /health reports db up", async () => {
    const res = await api().get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "up" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("unknown route returns the 404 envelope with requestId", async () => {
    const res = await api().get("/unknown");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND", details: [] });
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("malformed JSON returns 400 envelope", async () => {
    const res = await api()
      .post("/api/v1/anything")
      .set("content-type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("serves the OpenAPI spec with /health and Swagger UI", async () => {
    const spec = await api().get("/api/docs.json");
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toBe("3.1.0");
    expect(spec.body.paths["/health"]).toBeDefined();
    const ui = await api().get("/api/docs/");
    expect(ui.status).toBe(200);
    expect(ui.text).toContain("swagger-ui");
  });
});
