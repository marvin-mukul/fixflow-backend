import type { Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import { currentUser, validated } from "../lib/http.js";
import { notificationService } from "../services/notification.service.js";

export const notificationController = {
  async list(req: Request, res: Response) {
    const { query } = validated<{
      query: { cursor?: string; limit: number; unreadOnly: boolean };
    }>(res);
    res.json(await notificationService.list(currentUser(req).id, query));
  },
  async unreadCount(req: Request, res: Response) {
    res.json(await notificationService.unreadCount(currentUser(req).id));
  },
  async read(req: Request, res: Response) {
    const { params } = validated<{ params: { id: string } }>(res);
    if (!(await notificationService.markRead(params.id, currentUser(req).id)))
      throw AppError.notFound();
    res.status(204).end();
  },
  async readAll(req: Request, res: Response) {
    await notificationService.markAllRead(currentUser(req).id);
    res.status(204).end();
  },
};
