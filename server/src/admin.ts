import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, requireSuperAdmin } from "./auth";
import { sendCampaignExport } from "./export";
import { boundedString, isValidEmail, MAX_NAME_LENGTH, passwordProblem } from "./validate";

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// ---- Platform super-admin: manage customers and their users ----
// These queries are intentionally NOT scoped by customer_id: this router is the one place that
// operates across every tenant, and it is gated by requireSuperAdmin above.
export const adminRouter = Router();
adminRouter.use(requireAuth, requireSuperAdmin);

adminRouter.get(
  "/customers",
  ah(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.customer_id = c.id) AS user_count
         FROM customers c ORDER BY c.id DESC`
    );
    res.json(rows);
  })
);

adminRouter.post(
  "/customers",
  ah(async (req, res) => {
    const { name } = req.body ?? {};
    const customerName = boundedString(name, MAX_NAME_LENGTH);
    if (!customerName) {
      return res.status(400).json({ error: "name is required (max 255 characters)" });
    }
    const [result] = await pool.query<ResultSetHeader>("INSERT INTO customers (name) VALUES (?)", [
      customerName,
    ]);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, created_at FROM customers WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  })
);

adminRouter.get(
  "/customers/:id/users",
  ah(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, role, created_at FROM users WHERE customer_id = ? ORDER BY role, id",
      [req.params.id]
    );
    res.json(rows);
  })
);

// Every campaign of one customer, with the counts a platform admin needs to choose one.
adminRouter.get(
  "/customers/:id/campaigns",
  ah(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.start_date, c.finish_date,
              COUNT(p.id) AS package_count,
              COUNT(r.id) AS return_count
         FROM campaigns c
         LEFT JOIN packages p ON p.campaign_id = c.id
         LEFT JOIN returns r ON r.package_id = p.id
        WHERE c.customer_id = ?
        GROUP BY c.id, c.name, c.start_date, c.finish_date
        ORDER BY c.id DESC`,
      [req.params.id]
    );
    res.json(rows);
  })
);

// One campaign's flagged .xlsx, for ANY customer: the tenant route (/campaigns/:id/export) stays
// scoped to the caller's own company, and this is the platform-wide equivalent.
adminRouter.get(
  "/campaigns/:id/export",
  ah(async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: "invalid campaign id" });
    }
    await sendCampaignExport(res, campaignId, null);
  })
);

adminRouter.post(
  "/customers/:id/users",
  ah(async (req, res) => {
    const customerId = Number(req.params.id);
    const { email, password, role } = req.body ?? {};
    if (!isValidEmail(email)) return res.status(400).json({ error: "a valid email is required" });
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });
    if (role !== "superadmin" && role !== "user") {
      return res.status(400).json({ error: "role must be superadmin or user" });
    }
    const newEmail = String(email).trim();
    const [cust] = await pool.query<RowDataPacket[]>("SELECT id FROM customers WHERE id = ?", [
      customerId,
    ]);
    if (!cust[0]) return res.status(404).json({ error: "customer not found" });

    const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE email = ?", [
      newEmail,
    ]);
    if (existing[0]) return res.status(409).json({ error: "email already registered" });

    const hash = await bcrypt.hash(String(password), 12);
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO users (customer_id, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [customerId, newEmail, hash, role]
    );
    res
      .status(201)
      .json({ id: result.insertId, email: newEmail, role, customerId });
  })
);
