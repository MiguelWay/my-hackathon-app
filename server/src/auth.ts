import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { config } from "./config";

const COOKIE = "session";

export type Role = "admin" | "user";

export interface AuthUser {
  id: number;
  customerId: number;
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
    (RowDataPacket & { id: number; customer_id: number; email: string; role: Role })[]
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
authRouter.post(
  "/register",
  ah(async (req, res) => {
    const { customerName, email, password } = req.body ?? {};
    if (!customerName || !email || !password) {
      return res.status(400).json({ error: "customerName, email and password are required" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [existing] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM users WHERE email = ?",
        [email]
      );
      if (existing.length) {
        await conn.rollback();
        return res.status(409).json({ error: "email already registered" });
      }
      const [cust] = await conn.query<ResultSetHeader>(
        "INSERT INTO customers (name) VALUES (?)",
        [customerName]
      );
      const passwordHash = await bcrypt.hash(String(password), 12);
      const [user] = await conn.query<ResultSetHeader>(
        "INSERT INTO users (customer_id, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
        [cust.insertId, email, passwordHash]
      );
      await conn.commit();
      const { token, expiresAt } = await createSession(user.insertId);
      res.cookie(COOKIE, token, { ...cookieOptions, expires: expiresAt });
      res.status(201).json({ id: user.insertId, email, role: "admin", customerId: cust.insertId });
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
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    const [rows] = await pool.query<
      (RowDataPacket & {
        id: number;
        customer_id: number;
        password_hash: string;
        role: Role;
        is_active: number;
      })[]
    >("SELECT id, customer_id, password_hash, role, is_active FROM users WHERE email = ?", [email]);

    const u = rows[0];
    if (!u || !u.is_active || !(await bcrypt.compare(String(password), u.password_hash))) {
      return res.status(401).json({ error: "invalid email or password" });
    }
    const { token, expiresAt } = await createSession(u.id);
    res.cookie(COOKIE, token, { ...cookieOptions, expires: expiresAt });
    res.json({ id: u.id, email, role: u.role, customerId: u.customer_id });
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

export const requireAdmin: RequestHandler = (_req, res, next) => {
  const user = res.locals.user as AuthUser | undefined;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "admin only" });
    return;
  }
  next();
};
