import nodemailer from "nodemailer";
import { config } from "./config";

/** Messages captured in the test process, so reset tests can read the link without real email. */
export interface OutboxMessage {
  to: string;
  subject: string;
  text: string;
}
export const mailOutbox: OutboxMessage[] = [];

/**
 * Sends the "Forgot password" link.
 *
 * In production this needs SMTP (Plesk's local mail server works: SMTP_HOST=localhost, port 25).
 * Without SMTP the link is written to the server log in development only; in production it is an
 * error, because a reset link in a log is a password waiting to be found.
 */
export async function sendPasswordReset(to: string, link: string): Promise<void> {
  const subject = "Reset your Package Returns password";
  const text = [
    "Someone asked to reset the password for this account.",
    "",
    `Open this link within 30 minutes: ${link}`,
    "",
    "If it was not you, ignore this email; the password has not changed.",
  ].join("\n");

  const testing = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (testing) {
    mailOutbox.push({ to, subject, text });
    return;
  }

  if (!config.smtp.host) {
    if (config.isProduction) throw new Error("SMTP is not configured (set SMTP_HOST)");
    console.warn(`[auth] SMTP is not configured. Reset link for ${to}: ${link}`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.password }
      : undefined,
  });

  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text,
  });
}
