import { Router } from "express";
import { categoryController as c } from "../controllers/category.controller.js";
import { errorResponses, ok, registry } from "../lib/openapi.js";
import { CategoryList } from "../schemas/category.schema.js";

export const categoryRouter = Router();
categoryRouter.get("/categories", c.list);

registry.registerPath({
  method: "get",
  path: "/api/v1/categories",
  tags: ["Categories"],
  summary: "Active service categories (public)",
  responses: { 200: ok("Categories", CategoryList), ...errorResponses(500) },
});
