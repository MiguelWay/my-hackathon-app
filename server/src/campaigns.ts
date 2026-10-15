import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, requireCompany, requireSuperAdmin, type AuthUser } from "./auth";
import { MAX_NAME_LENGTH, boundedString, parseIsoDate } from "./validate";

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
      `SELECT c.id, c.name, c.start_date, c.finish_date, c.created_at,
              COUNT(u.id) AS upload_count,
              CAST(COALESCE(SUM(u.row_count), 0) AS UNSIGNED) AS total_rows
         FROM campaigns c
         LEFT JOIN campaign_uploads u ON u.campaign_id = c.id
        WHERE c.customer_id = ?
        GROUP BY c.id, c.name, c.start_date, c.finish_date, c.created_at
        ORDER BY c.id DESC`,
      [user.customerId]
    );
    res.json(rows);
  })
);

campaignsRouter.post(
  "/",
  requireSuperAdmin,
  requireCompany,
  ah(async (req, res) => {
    const user = currentUser(res);
    const { name, startDate, finishDate } = req.body ?? {};
    const campaignName = boundedString(name, MAX_NAME_LENGTH);
    if (!campaignName) {
      return res.status(400).json({ error: "name is required (max 255 characters)" });
    }
    // Both dates are mandatory: a campaign with no window cannot be reported on.
    const start = parseIsoDate(startDate);
    if (!start) {
      return res.status(400).json({ error: "startDate is required and must be a valid date (YYYY-MM-DD)" });
    }
    const finish = parseIsoDate(finishDate);
    if (!finish) {
      return res.status(400).json({ error: "finishDate is required and must be a valid date (YYYY-MM-DD)" });
    }
    if (finish < start) {
      return res.status(400).json({ error: "finishDate cannot be before startDate" });
    }
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO campaigns (customer_id, name, start_date, finish_date) VALUES (?, ?, ?, ?)",
      [user.customerId, campaignName, start, finish]
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
  requireSuperAdmin,
  requireCompany,
  ah(async (req, res) => {
    const user = currentUser(res);
    const { name, startDate, finishDate } = req.body ?? {};

    const [existing] = await pool.query<
      (RowDataPacket & { start_date: string | null; finish_date: string | null })[]
    >("SELECT start_date, finish_date FROM campaigns WHERE id = ? AND customer_id = ?", [
      req.params.id,
      user.customerId,
    ]);
    if (!existing[0]) return res.status(404).json({ error: "campaign not found" });

    // Only the dates that were supplied are validated, against the values that will result.
    const start = startDate === undefined ? existing[0].start_date : parseIsoDate(startDate);
    const finish = finishDate === undefined ? existing[0].finish_date : parseIsoDate(finishDate);
    if (!start) {
      return res.status(400).json({ error: "startDate is required and must be a valid date (YYYY-MM-DD)" });
    }
    if (!finish) {
      return res.status(400).json({ error: "finishDate is required and must be a valid date (YYYY-MM-DD)" });
    }
    if (finish < start) {
      return res.status(400).json({ error: "finishDate cannot be before startDate" });
    }

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
