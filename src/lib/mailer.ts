import { env, isTest } from "../config/env.js";
import { logger } from "./logger.js";

export type Mail = { to: string; subject: string; text: string; html?: string };

/** In tests every sent mail lands here (assert on links/tokens). */
export const outbox: Mail[] = [];

/** Splits `Name <email>` (or a bare address) into Brevo's sender shape. */
export function parseAddress(from: string): { name?: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return { email: from.trim() };
  const name = m[1]!.trim();
  return name ? { name, email: m[2]!.trim() } : { email: m[2]!.trim() };
}

/** Sends through Brevo's transactional email API over HTTPS (port 443). */
async function sendViaBrevo(mail: Mail): Promise<void> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: parseAddress(env.MAIL_FROM),
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      ...(mail.html ? { htmlContent: mail.html } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Brevo API ${res.status}: ${await res.text()}`);
  }
}

/** Never throws: email failures are logged, they must not break business flows. */
export async function sendMail(mail: Mail): Promise<void> {
  if (isTest) {
    outbox.push(mail);
    return;
  }
  if (!env.BREVO_API_KEY) {
    logger.info(
      { to: mail.to, subject: mail.subject },
      `[mail:console]\n${mail.text}`,
    );
    return;
  }
  try {
    await sendViaBrevo(mail);
  } catch (err) {
    logger.error(
      { err, to: mail.to, subject: mail.subject },
      "Failed to send email",
    );
  }
}
