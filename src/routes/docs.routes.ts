import { Router, type RequestHandler } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "../lib/openapi.js";

/**
 * Must be created after every route module has registered its paths.
 * `guard` (admin auth) is applied in production when SWAGGER_PUBLIC=false.
 */
export function createDocsRouter(guard: RequestHandler[] = []): Router {
  const router = Router();
  const spec = buildOpenApiDocument();
  router.get("/api/docs.json", ...guard, (_req, res) => {
    res.json(spec);
  });
  router.use("/api/docs", ...guard, swaggerUi.serve, swaggerUi.setup(spec));
  return router;
}
