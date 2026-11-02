import { Router } from "express";
import { notificationController as c } from "../controllers/notification.controller.js";
import { errorResponses, ok, registry } from "../lib/openapi.js";
import { requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { BEARER, IdParams } from "../schemas/common.schema.js";
import {
  NotificationPage,
  NotificationQuery,
  UnreadCount,
} from "../schemas/notification.schema.js";

export const notificationRouter = Router();
const auth = requireAuth();

notificationRouter.get(
  "/notifications",
  auth,
  validate({ query: NotificationQuery }),
  c.list,
);
notificationRouter.get("/notifications/unread-count", auth, c.unreadCount);
notificationRouter.post("/notifications/read-all", auth, c.readAll);
notificationRouter.post(
  "/notifications/:id/read",
  auth,
  validate({ params: IdParams }),
  c.read,
);

const tags = ["Notifications"];
registry.registerPath({
  method: "get",
  path: "/api/v1/notifications",
  tags,
  security: BEARER,
  summary: "My notifications (newest first)",
  request: { query: NotificationQuery },
  responses: { 200: ok("Page", NotificationPage), ...errorResponses(401, 422) },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/notifications/unread-count",
  tags,
  security: BEARER,
  summary: "Unread count (poll every 30 s)",
  responses: { 200: ok("Count", UnreadCount), ...errorResponses(401) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/notifications/{id}/read",
  tags,
  security: BEARER,
  summary: "Mark one as read",
  request: { params: IdParams },
  responses: { 204: { description: "Read" }, ...errorResponses(401, 404) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/notifications/read-all",
  tags,
  security: BEARER,
  summary: "Mark all as read",
  responses: { 204: { description: "Done" }, ...errorResponses(401) },
});
