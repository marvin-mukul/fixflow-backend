import nodemailer, { type Transporter } from "nodemailer";
import { env, isTest } from "../config/env.js";
import { logger } from "./logger.js";

export type Mail = { to: string; subject: string; text: string; html?: string };

/** In tests every sent mail lands here (assert on links/tokens). */
export const outbox: Mail[] = [];

let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });
  return transport;
}

/** Never throws: email failures are logged, they must not break business flows. */
export async function sendMail(mail: Mail): Promise<void> {
  if (isTest) {
    outbox.push(mail);
    return;
  }
  const t = getTransport();
  if (!t) {
    logger.info(
      { to: mail.to, subject: mail.subject },
      `[mail:console]\n${mail.text}`,
    );
    return;
  }
  try {
    await t.sendMail({ from: env.MAIL_FROM, ...mail });
  } catch (err) {
    logger.error(
      { err, to: mail.to, subject: mail.subject },
      "Failed to send email",
    );
  }
}
