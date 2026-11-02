import { env } from "../config/env.js";
import { sendMail } from "../lib/mailer.js";
import type { TxClient } from "../lib/prisma.js";
import {
  notificationRepository,
  type NewNotification,
} from "../repositories/notification.repository.js";
import { userRepository } from "../repositories/user.repository.js";

export type AfterCommit = Array<() => Promise<void>>;

const toDto = (n: {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

export const notificationService = {
  /**
   * Inserts in-app notifications inside the caller's transaction; when `email` is set, queues
   * an email for after commit (emails never roll back state).
   */
  async notify(
    tx: TxClient,
    rows: NewNotification[],
    afterCommit?: AfterCommit,
    email = false,
  ) {
    const unique = rows.filter(
      (r, i) =>
        r.userId &&
        rows.findIndex((x) => x.userId === r.userId && x.type === r.type) === i,
    );
    await notificationRepository.createMany(unique, tx);
    if (email && afterCommit) {
      for (const n of unique) {
        afterCommit.push(async () => {
          const u = await userRepository.findById(n.userId);
          if (!u) return;
          await sendMail({
            to: u.email,
            subject: `FixFlow: ${n.title}`,
            text: `${n.body}${n.link ? `\n\nOpen: ${env.APP_URL}${n.link}` : ""}`,
          });
        });
      }
    }
  },

  async list(
    userId: string,
    q: { cursor?: string; limit: number; unreadOnly?: boolean },
  ) {
    const page = await notificationRepository.list(userId, q);
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  },

  async unreadCount(userId: string) {
    return { count: await notificationRepository.unreadCount(userId) };
  },

  async markRead(id: string, userId: string) {
    return notificationRepository.markRead(id, userId);
  },

  async markAllRead(userId: string) {
    await notificationRepository.markAllRead(userId);
  },
};
