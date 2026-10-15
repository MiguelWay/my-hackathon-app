import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, requireAdmin, type AuthUser } from "./auth";

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const currentUser = (res: Response) => res.locals.user as AuthUser;

// ---- Customers (the caller's own tenant) ----
export const customersRouter = Router();

customersRouter.get(
  "/current",
  requireAuth,
  ah(async (_req, res) => {
    const user = currentUser(res);
    const [rows] = await pool.query<(RowDataPacket & { id: number; name: string })[]>(
      "SELECT id, name FROM customers WHERE id = ?",
      [user.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: "customer not found" });
    res.json(rows[0]);
  })
);

// ---- Campaigns (scoped to the caller's customer) ----
export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

campaignsRouter.get(
  "/",
  ah(async (_req, res) => {
    const user = currentUser(res);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, start_date, finish_date, created_at
         FROM campaigns WHERE customer_id = ? ORDER BY id DESC`,
      [user.customerId]
    );
    res.json(rows);
  })
);

campaignsRouter.post(
  "/",
  requireAdmin,
  ah(async (req, res) => {
    const user = currentUser(res);
    const { name, startDate, finishDate } = req.body ?? {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO campaigns (customer_id, name, start_date, finish_date) VALUES (?, ?, ?, ?)",
      [user.customerId, String(name).trim(), startDate ?? null, finishDate ?? null]
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, start_date, finish_date FROM campaigns WHERE id = ? AND customer_id = ?",
      [result.insertId, user.customerId]
    );
    res.status(201).json(rows[0]);
  })
);

campaignsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const user = currentUser(res);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, start_date, finish_date FROM campaigns WHERE id = ? AND customer_id = ?",
      [req.params.id, user.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: "campaign not found" });
    res.json(rows[0]);
  })
);

campaignsRouter.patch(
  "/:id",
  requireAdmin,
  ah(async (req, res) => {
    const user = currentUser(res);
    const { name, startDate, finishDate } = req.body ?? {};
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE campaigns SET
         name = COALESCE(?, name),
         start_date = COALESCE(?, start_date),
         finish_date = COALESCE(?, finish_date)
       WHERE id = ? AND customer_id = ?`,
      [name ?? null, startDate ?? null, finishDate ?? null, req.params.id, user.customerId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "campaign not found" });
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, start_date, finish_date FROM campaigns WHERE id = ? AND customer_id = ?",
      [req.params.id, user.customerId]
    );
    res.json(rows[0]);
  })
);
