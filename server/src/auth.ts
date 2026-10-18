import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { config } from "./config";
import { sendPasswordReset } from "./mailer";
import {
  boundedString,
  isValidEmail,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  passwordProblem,
} from "./validate";

const COOKIE = "session";

// Compared against when the email is unknown, so a failed login costs the same time whether or not
// the account exists (no user enumeration through response timing).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

// Two roles: `superadmin` has full access (and may be attached to a customer); `user` processes
// returns — for any customer it names — and records their resends.
export type Role = "superadmin" | "user";

export interface AuthUser {
  id: number;
  customerId: number | null;
  email: string;
  role: Role;
}

// Wrap async handlers so rejected promises reach the error middleware (Express 4).
const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.isProduction,
  path: "/",
};

async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function getUserFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [rows] = await pool.query<
    (RowDataPacket & { id: number; customer_id: number | null; email: string; role: Role })[]
  >(
    `SELECT u.id, u.customer_id, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = 1
        AND s.last_seen_at > NOW() - INTERVAL ? MINUTE`,
    [tokenHash, config.sessionIdleMinutes]
  );
  const r = rows[0];
  if (!r) {
    // Drop a cookie that points at a session which is expired or has been idle too long, so the row
    // does not linger. An unknown token is untouched.
    await pool
      .query(
        `DELETE FROM sessions
          WHERE token_hash = ?
            AND (expires_at <= NOW() OR last_seen_at <= NOW() - INTERVAL ? MINUTE)`,
        [tokenHash, config.sessionIdleMinutes]
      )
      .catch(() => undefined);
    return null;
  }
  // Using the app keeps the session alive; the stamp is the idle clock the next request reads.
  await pool.query("UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = ?", [tokenHash]);
  return { id: r.id, customerId: r.customer_id, email: r.email, role: r.role };
}

export const authRouter = Router();

// Self-signup: creates a new customer and its first (admin) user.
// Disabled in production by default, because otherwise anyone on the internet can create a tenant.
// Set ALLOW_SELF_SIGNUP=true to open it up deliberately.
authRouter.post(
  "/register",
  ah(async (req, res) => {
    if (!config.allowSelfSignup) {
      return res.status(403).json({ error: "self-signup is disabled" });
    }
    const { customerName, email, password } = req.body ?? {};

    const name = boundedString(customerName, MAX_NAME_LENGTH);
    if (!name) {
      return res.status(400).json({ error: "customerName is required (max 255 characters)" });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: "a valid email is required" });
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [existing] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM users WHERE email = ?",
        [String(email).trim()]
      );
      if (existing.length) {
        await conn.rollback();
        return res.status(409).json({ error: "email already registered" });
      }
      const [cust] = await conn.query<ResultSetHeader>(
        "INSERT INTO customers (name) VALUES (?)",
        [name]
      );
      const passwordHash = await bcrypt.hash(String(password), 12);
      const [user] = await conn.query<ResultSetHeader>(
        "INSERT INTO users (customer_id, email, password_hash, role) VALUES (?, ?, ?, 'superadmin')",
        [cust.insertId, String(email).trim(), passwordHash]
      );
      await conn.commit();
      const { token, expiresAt } = await createSession(user.insertId);
      res.cookie(COOKIE, token, { ...cookieOptions, expires: expiresAt });
      res.status(201).json({
        id: user.insertId,
        email: String(email).trim(),
        role: "superadmin",
        customerId: cust.insertId,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

authRouter.post(
  "/login",
  ah(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!isValidEmail(email)) {
      return res.status(401).json({ error: "invalid email or password" });
    }
    // Reject over-long passwords before hashing (see MAX_PASSWORD_LENGTH).
    if (typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const [rows] = await pool.query<
      (RowDataPacket & {
        id: number;
        customer_id: number;
        password_hash: string;
        role: Role;
        is_active: number;
      })[]
    >("SELECT id, customer_id, password_hash, role, is_active FROM users WHERE email = ?", [
      String(email).trim(),
    ]);

    const u = rows[0];
    // Always run a comparison, so timing does not reveal whether the account exists.
    const passwordOk = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !u.is_active || !passwordOk) {
      console.warn(`[security] failed login from ${req.ip ?? "unknown"}`);
      return res.status(401).json({ error: "invalid email or password" });
    }
    const { token, expiresAt } = await createSession(u.id);
    res.cookie(COOKIE, token, { ...cookieOptions, expires: expiresAt });
    res.json({ id: u.id, email: String(email).trim(), role: u.role, customerId: u.customer_id });
  })
);

authRouter.post(
  "/logout",
  ah(async (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ ok: true });
  })
);

authRouter.get(
  "/me",
  ah(async (req, res) => {
    const user = await getUserFromToken(req.cookies?.[COOKIE]);
    if (!user) return res.status(401).json({ error: "not authenticated" });
    res.json(user);
  })
);

// ---- Forgot password ----
// The response is deliberately the same whether or not the account exists, so this cannot be used to
// discover who has a login. A link is emailed only when an active account matches.
const RESET_MINUTES = 30;
const resetHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

authRouter.post(
  "/forgot",
  ah(async (req, res) => {
    const { email } = req.body ?? {};
    if (isValidEmail(email)) {
      const address = String(email).trim();
      const [users] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM users WHERE email = ? AND is_active = 1",
        [address]
      );
      const account = users[0];
      if (account) {
        // One live link per account: asking again invalidates the previous one.
        await pool.query("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL", [
          account.id,
        ]);
        const token = crypto.randomBytes(32).toString("hex");
        await pool.query(
          `INSERT INTO password_resets (user_id, token_hash, expires_at)
           VALUES (?, ?, NOW() + INTERVAL ? MINUTE)`,
          [account.id, resetHash(token), RESET_MINUTES]
        );
        const link = `${config.appUrl}/reset-password?token=${token}`;
        // Sent in the background: waiting for SMTP would make an existing account noticeably slower to
        // answer than an unknown one, which is exactly the enumeration this endpoint avoids. A mail
        // failure must not reveal whether the account exists either, so it is only logged.
        void sendPasswordReset(address, link).catch((err: unknown) => {
          console.error("[auth] could not send the password-reset email:", err);
        });
      }
    }
    res.json({ ok: true });
  })
);

authRouter.post(
  "/reset",
  ah(async (req, res) => {
    const { token, newPassword } = req.body ?? {};
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(400).json({ error: "that reset link is invalid or has expired" });
    }
    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<(RowDataPacket & { id: number; user_id: number })[]>(
        `SELECT pr.id, pr.user_id
           FROM password_resets pr
           JOIN users u ON u.id = pr.user_id
          WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > NOW()
            AND u.is_active = 1
          FOR UPDATE`,
        [resetHash(token)]
      );
      const reset = rows[0];
      if (!reset) {
        await conn.rollback();
        return res.status(400).json({ error: "that reset link is invalid or has expired" });
      }

      const hash = await bcrypt.hash(newPassword as string, 12);
      await conn.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, reset.user_id]);
      await conn.query("UPDATE password_resets SET used_at = NOW() WHERE id = ?", [reset.id]);
      // A new password evicts every existing session, including a stolen one.
      await conn.query("DELETE FROM sessions WHERE user_id = ?", [reset.user_id]);
      await conn.commit();
      res.json({ ok: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// ---- Middleware ----

export const requireAuth: RequestHandler = ah(async (req, res, next) => {
  const user = await getUserFromToken(req.cookies?.[COOKIE]);
  if (!user) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  res.locals.user = user;
  next();
});

export const requireSuperAdmin: RequestHandler = (_req, res, next) => {
  const user = res.locals.user as AuthUser | undefined;
  if (!user || user.role !== "superadmin") {
    res.status(403).json({ error: "super-admin only" });
    return;
  }
  next();
};
