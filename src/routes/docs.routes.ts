import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "../lib/openapi.js";

/** Must be created after every route module has registered its paths. */
export function createDocsRouter(): Router {
  const router = Router();
  const spec = buildOpenApiDocument();
  router.get("/api/docs.json", (_req, res) => {
    res.json(spec);
  });
  router.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));
  return router;
}
