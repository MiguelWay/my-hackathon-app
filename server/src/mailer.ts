import nodemailer from "nodemailer";
import { promises as dns } from "node:dns";
import { config } from "./config";

/** Messages captured in the test process, so reset tests can read the link without real email. */
export interface OutboxMessage {
  to: string;
  subject: string;
  text: string;
}
export const mailOutbox: OutboxMessage[] = [];

/** The subset of a message this module builds; keeps the transport call structurally typed. */
interface OutgoingMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/**
 * Delivers straight to the recipient's mail server.
 *
 * Used when the local MTA will not relay (`SMTP_DIRECT=true`). The MX host is the certificate name —
 * TLS is verified against it, not against the EHLO name — so STARTTLS still works. Hosts are tried in
 * MX priority order, which is what a sending MTA would do.
 */
async function sendDirect(to: string, message: OutgoingMessage) {
  const domain = to.split("@")[1];
  if (!domain) throw new Error("recipient has no domain");

  const records = await dns.resolveMx(domain).catch(() => []);
  const hosts = records.length
    ? records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange)
    : [domain];

  const senderDomain = String(message.from ?? config.smtp.from).split("@")[1] ?? "localhost";
  let lastError: unknown = null;

  for (const host of hosts) {
    const transport = nodemailer.createTransport({
      host,
      port: 25,
      secure: false,
      name: senderDomain,
      tls: { servername: host },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      return await transport.sendMail(message);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`no mail server found for ${domain}`);
}

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

  const message = {
    from: config.smtp.from,
    to,
    subject,
    text,
  };

  if (config.smtp.direct) {
    await sendDirect(to, message);
    return;
  }

  if (!config.smtp.host) {
    if (config.isProduction) throw new Error("SMTP is not configured (set SMTP_HOST or SMTP_DIRECT)");
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

  await transport.sendMail(message);
}
