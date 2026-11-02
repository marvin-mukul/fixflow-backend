import { prisma, type TxClient } from "../lib/prisma.js";

export type NewNotification = {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
};

export const notificationRepository = {
  createMany(rows: NewNotification[], tx: TxClient = prisma) {
    if (rows.length === 0) return Promise.resolve({ count: 0 });
    return tx.notification.createMany({
      data: rows.map((r) => ({ ...r, link: r.link ?? null })),
    });
  },

  async list(
    userId: string,
    opts: { cursor?: string; limit: number; unreadOnly?: boolean },
    tx: TxClient = prisma,
  ) {
    const rows = await tx.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  },

  unreadCount(userId: string, tx: TxClient = prisma) {
    return tx.notification.count({ where: { userId, readAt: null } });
  },

  async markRead(id: string, userId: string, tx: TxClient = prisma) {
    const r = await tx.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (r.count === 0)
      return (await tx.notification.count({ where: { id, userId } })) > 0;
    return true;
  },

  markAllRead(userId: string, tx: TxClient = prisma) {
    return tx.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  },
};
