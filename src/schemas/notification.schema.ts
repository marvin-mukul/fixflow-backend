import { z } from "zod";
import "../lib/openapi.js";

export const NotificationDto = z
  .object({
    id: z.string().uuid(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Notification");

export const NotificationPage = z
  .object({
    items: z.array(NotificationDto),
    nextCursor: z.string().uuid().nullable(),
  })
  .openapi("NotificationPage");

export const NotificationQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const UnreadCount = z
  .object({ count: z.number().int() })
  .openapi("UnreadCount");
