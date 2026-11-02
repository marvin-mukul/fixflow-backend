import { Router } from "express";
import { adminController as c } from "../controllers/admin.controller.js";
import { errorResponses, json, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { validate } from "../middlewares/validate.js";
import {
  AdminUserDto,
  AdminUserList,
  AdminWorkerDto,
  AdminWorkerList,
  CreateAdminBody,
  ReasonBody,
  SettingsDto,
  SettingsPatch,
  StatsDto,
  WorkerQueueQuery,
} from "../schemas/admin.schema.js";
import {
  CategoryDto,
  CategoryList,
  CreateCategoryBody,
  UpdateCategoryBody,
} from "../schemas/category.schema.js";
import { BEARER, IdParams } from "../schemas/common.schema.js";

export const adminRouter = Router();
const admin = [requireAuth(), requireRole("ADMIN")];
const superadmin = [requireAuth(), requireRole("SUPERADMIN")];
const byId = validate({ params: IdParams });

adminRouter.get(
  "/admin/workers",
  ...admin,
  validate({ query: WorkerQueueQuery }),
  c.workers,
);
adminRouter.post("/admin/workers/:id/verify", ...admin, byId, c.verify);
adminRouter.post(
  "/admin/workers/:id/reject",
  ...admin,
  validate({ params: IdParams, body: ReasonBody }),
  c.reject,
);
adminRouter.post(
  "/admin/workers/:id/suspend",
  ...admin,
  validate({ params: IdParams, body: ReasonBody }),
  c.suspend,
);
adminRouter.get("/admin/workers/:id/id-document", ...admin, byId, c.idDocument);
adminRouter.get("/admin/stats", ...admin, c.stats);
adminRouter.get("/admin/categories", ...admin, c.categories);
adminRouter.post(
  "/admin/categories",
  ...admin,
  validate({ body: CreateCategoryBody }),
  c.createCategory,
);
adminRouter.patch(
  "/admin/categories/:id",
  ...admin,
  validate({ params: IdParams, body: UpdateCategoryBody }),
  c.updateCategory,
);
adminRouter.get("/admin/settings", ...admin, c.getSettings);
adminRouter.put(
  "/admin/settings",
  ...superadmin,
  validate({ body: SettingsPatch }),
  c.putSettings,
);
adminRouter.get("/admin/admins", ...superadmin, c.admins);
adminRouter.post(
  "/admin/admins",
  ...superadmin,
  validate({ body: CreateAdminBody }),
  c.createAdmin,
);
adminRouter.delete("/admin/admins/:id", ...superadmin, byId, c.removeAdmin);

const A = { tags: ["Admin"], security: BEARER };
const S = { tags: ["Superadmin"], security: BEARER };
const p = { params: IdParams };
const e = errorResponses(401, 403, 404, 409, 422);

registry.registerPath({
  method: "get",
  path: "/api/v1/admin/workers",
  ...A,
  summary: "Worker verification queue (filter by status)",
  request: { query: WorkerQueueQuery },
  responses: {
    200: ok("Workers", AdminWorkerList),
    ...errorResponses(401, 403, 422),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/workers/{id}/verify",
  ...A,
  summary: "Verify a worker (needs category + ID document)",
  request: p,
  responses: { 200: ok("Worker", AdminWorkerDto), ...e },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/workers/{id}/reject",
  ...A,
  summary: "Reject a pending worker",
  request: { ...p, body: { content: json(ReasonBody) } },
  responses: { 200: ok("Worker", AdminWorkerDto), ...e },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/workers/{id}/suspend",
  ...A,
  summary: "Suspend a verified worker (stops leads)",
  request: { ...p, body: { content: json(ReasonBody) } },
  responses: { 200: ok("Worker", AdminWorkerDto), ...e },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/admin/workers/{id}/id-document",
  ...A,
  summary: "Stream the worker's ID document (admin only)",
  request: p,
  responses: {
    200: { description: "File bytes" },
    ...errorResponses(401, 403, 404),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/admin/stats",
  ...A,
  summary:
    "Platform stats: counts, GMV, commission, acceptance/completion/dispute rates",
  responses: { 200: ok("Stats", StatsDto), ...errorResponses(401, 403) },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/admin/categories",
  ...A,
  summary: "All categories incl. inactive",
  responses: {
    200: ok("Categories", CategoryList),
    ...errorResponses(401, 403),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/categories",
  ...A,
  summary: "Create a category",
  request: { body: { content: json(CreateCategoryBody) } },
  responses: {
    201: ok("Category", CategoryDto),
    ...errorResponses(401, 403, 409, 422),
  },
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/admin/categories/{id}",
  ...A,
  summary: "Rename / (de)activate a category",
  request: { ...p, body: { content: json(UpdateCategoryBody) } },
  responses: { 200: ok("Category", CategoryDto), ...e },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/admin/settings",
  ...A,
  summary: "Platform settings (admins read, superadmin writes)",
  responses: { 200: ok("Settings", SettingsDto), ...errorResponses(401, 403) },
});
registry.registerPath({
  method: "put",
  path: "/api/v1/admin/settings",
  ...S,
  summary: "Update settings (partial; affects new invoices only)",
  request: { body: { content: json(SettingsPatch) } },
  responses: {
    200: ok("Settings", SettingsDto),
    ...errorResponses(401, 403, 422),
  },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/admin/admins",
  ...S,
  summary: "List admins",
  responses: { 200: ok("Admins", AdminUserList), ...errorResponses(401, 403) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/admins",
  ...S,
  summary: "Create an admin (must change password on first login)",
  request: { body: { content: json(CreateAdminBody) } },
  responses: {
    201: ok("Admin", AdminUserDto),
    ...errorResponses(401, 403, 409, 422),
  },
});
registry.registerPath({
  method: "delete",
  path: "/api/v1/admin/admins/{id}",
  ...S,
  summary: "Remove an admin (soft delete, sessions revoked)",
  request: p,
  responses: {
    204: { description: "Removed" },
    ...errorResponses(401, 403, 404, 409),
  },
});
