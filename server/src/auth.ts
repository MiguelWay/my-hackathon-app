import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { config } from "./config";
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
  const [rows] = await pool.query<
    (RowDataPacket & { id: number; customer_id: number | null; email: string; role: Role })[]
  >(
    `SELECT u.id, u.customer_id, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = 1`,
    [hashToken(token)]
  );
  const r = rows[0];
  return r ? { id: r.id, customerId: r.customer_id, email: r.email, role: r.role } : null;
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

// Changing your own password. It needs the current one, so a borrowed session cannot lock the owner
// out, and it ends every *other* session on the account — a new password should evict whoever else had
// the old one — while leaving the caller's own session open.
//
authRouter.post(
  "/password",
  ah(async (req, res) => {
    const token = req.cookies?.[COOKIE];
    const me = await getUserFromToken(token);
    if (!me || !token) return res.status(401).json({ error: "not authenticated" });

    const { currentPassword, newPassword } = req.body ?? {};
    // Reject an over-long password before hashing (see MAX_PASSWORD_LENGTH).
    if (typeof currentPassword !== "string" || currentPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(401).json({ error: "current password is incorrect" });
    }
    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    const [rows] = await pool.query<(RowDataPacket & { password_hash: string })[]>(
      "SELECT password_hash FROM users WHERE id = ?",
      [me.id]
    );
    // Always run a comparison, so the response does not reveal whether the account still exists.
    const currentOk = await bcrypt.compare(currentPassword, rows[0]?.password_hash ?? DUMMY_HASH);
    if (!rows[0] || !currentOk) {
      console.warn(`[security] failed password change for user ${me.id}`);
      return res.status(401).json({ error: "current password is incorrect" });
    }

    const hash = await bcrypt.hash(newPassword as string, 12);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, me.id]);
    await pool.query("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", [
      me.id,
      hashToken(token),
    ]);
    res.json({ ok: true });
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

/**
 * For routes that operate on a customer's own data. A super-admin with no customer attached
 * (a pure platform owner) has nowhere to put a campaign, so those routes are refused.
 */
export const requireCompany: RequestHandler = (_req, res, next) => {
  const user = res.locals.user as AuthUser | undefined;
  if (!user || user.customerId === null) {
    res.status(403).json({ error: "this account is not attached to a company" });
    return;
  }
  next();
};
