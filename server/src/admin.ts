import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, requireSuperAdmin, type AuthUser } from "./auth";
import { sendCampaignExport } from "./export";
import {
  boundedString,
  isValidEmail,
  MAX_NAME_LENGTH,
  optionalPositiveInt,
  parseIsoDate,
  passwordProblem,
} from "./validate";

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
              (SELECT COUNT(*) FROM users u WHERE u.customer_id = c.id) AS user_count,
              (SELECT COUNT(*) FROM users u WHERE u.customer_id = c.id AND u.is_active = 1)
                AS active_user_count
         FROM customers c ORDER BY c.id DESC`
    );
    res.json(rows);
  })
);

// A customer is never an empty shell: registering one also opens its first campaign, named by the
// caller (or after the customer) and landing on the chosen company. Both rows go in together, so a
// failure leaves neither behind.
adminRouter.post(
  "/customers",
  ah(async (req, res) => {
    const { name, campaignName, startDate, finishDate } = req.body ?? {};
    const customerName = boundedString(name, MAX_NAME_LENGTH);
    if (!customerName) {
      return res.status(400).json({ error: "name is required (max 255 characters)" });
    }

    const named = campaignName === undefined || campaignName === null || campaignName === "";
    const firstCampaignName = named ? customerName : boundedString(campaignName, MAX_NAME_LENGTH);
    if (!firstCampaignName) {
      return res.status(400).json({ error: "campaignName must be 255 characters or fewer" });
    }

    // Dates are optional here and default to a one-day window on today, so the campaign is valid
    // straight away; it can be re-dated from the Campaigns screen.
    const today = new Date().toISOString().slice(0, 10);
    const start = startDate === undefined || startDate === null || startDate === ""
      ? today
      : parseIsoDate(startDate);
    if (!start) {
      return res.status(400).json({ error: "startDate must be a valid date (YYYY-MM-DD)" });
    }
    const finish = finishDate === undefined || finishDate === null || finishDate === ""
      ? start
      : parseIsoDate(finishDate);
    if (!finish) {
      return res.status(400).json({ error: "finishDate must be a valid date (YYYY-MM-DD)" });
    }
    if (finish < start) {
      return res.status(400).json({ error: "finishDate cannot be before startDate" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [customer] = await conn.query<ResultSetHeader>(
        "INSERT INTO customers (name) VALUES (?)",
        [customerName]
      );
      const [campaign] = await conn.query<ResultSetHeader>(
        "INSERT INTO campaigns (customer_id, name, start_date, finish_date) VALUES (?, ?, ?, ?)",
        [customer.insertId, firstCampaignName, start, finish]
      );
      await conn.commit();
      res.status(201).json({
        id: customer.insertId,
        name: customerName,
        campaign: {
          id: campaign.insertId,
          name: firstCampaignName,
          start_date: start,
          finish_date: finish,
        },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

adminRouter.get(
  "/customers/:id/users",
  ah(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, role, is_active, created_at
         FROM users WHERE customer_id = ? ORDER BY is_active DESC, id`,
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
              (SELECT COUNT(*) FROM packages p WHERE p.campaign_id = c.id) AS package_count,
              (SELECT COUNT(*) FROM packages p JOIN returns r ON r.package_id = p.id
                WHERE p.campaign_id = c.id) AS return_count,
              (SELECT CAST(COALESCE(SUM(u.row_count), 0) AS UNSIGNED) FROM campaign_uploads u
                WHERE u.campaign_id = c.id) AS total_rows
         FROM campaigns c
        WHERE c.customer_id = ?
        ORDER BY c.id DESC`,
      [req.params.id]
    );
    res.json(rows);
  })
);

// Every campaign on the platform, named with its company: the Campaigns screen needs one list that
// a platform super-admin (no company of its own) can create into. The tenant route `/campaigns` is
// deliberately untouched — it stays scoped to the caller's own company.
adminRouter.get(
  "/campaigns",
  ah(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.customer_id, cu.name AS customer_name, c.name, c.start_date, c.finish_date,
              c.created_at,
              COUNT(u.id) AS upload_count,
              CAST(COALESCE(SUM(u.row_count), 0) AS UNSIGNED) AS total_rows
         FROM campaigns c
         JOIN customers cu ON cu.id = c.customer_id
         LEFT JOIN campaign_uploads u ON u.campaign_id = c.id
        GROUP BY c.id, c.customer_id, cu.name, c.name, c.start_date, c.finish_date, c.created_at
        ORDER BY c.id DESC`
    );
    res.json(rows);
  })
);

// The uploaded lists of every campaign, so the Campaigns screen can show them in one request.
adminRouter.get(
  "/campaigns/uploads",
  ah(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, campaign_id, customer_id, filename, row_count, created_at
         FROM campaign_uploads ORDER BY campaign_id DESC, id`
    );
    res.json(rows);
  })
);

// One campaign's flagged .xlsx, for ANY customer: the tenant route (/campaigns/:id/export) stays
// scoped to the caller's own company, and this is the platform-wide equivalent. `?uploadId=` limits it
// to the rows of a single uploaded list.
adminRouter.get(
  "/campaigns/:id/export",
  ah(async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: "invalid campaign id" });
    }
    const uploadId = optionalPositiveInt(req.query.uploadId);
    if (uploadId === null) {
      return res.status(400).json({ error: "uploadId must be a positive number" });
    }
    await sendCampaignExport(res, campaignId, null, uploadId);
  })
);

/** An account, as far as the guards below care. */
interface AccountRow extends RowDataPacket {
  id: number;
  customer_id: number | null;
  email: string;
  role: string;
  is_active: number;
}

async function findAccount(id: string): Promise<AccountRow | null> {
  const [rows] = await pool.query<AccountRow[]>(
    "SELECT id, customer_id, email, role, is_active FROM users WHERE id = ?",
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Only a platform super-admin (no customer of its own) can reach these screens, so the last active
 * one has to survive: without it nobody could create customers or fix accounts again.
 */
async function isLastPlatformAdmin(user: AccountRow): Promise<boolean> {
  if (user.customer_id !== null || user.role !== "superadmin" || user.is_active !== 1) return false;
  const [rows] = await pool.query<(RowDataPacket & { others: number })[]>(
    `SELECT COUNT(*) AS others FROM users
      WHERE customer_id IS NULL AND role = 'superadmin' AND is_active = 1 AND id <> ?`,
    [user.id]
  );
  return Number(rows[0]?.others ?? 0) === 0;
}

/** The reasons an account may not be deactivated or deleted; null when it may. */
async function problemWith(
  user: AccountRow,
  callerId: number,
  action: "deactivate" | "delete"
): Promise<string | null> {
  if (user.id === callerId) return `you cannot ${action} your own account`;
  if (await isLastPlatformAdmin(user)) {
    return `${action} would leave nobody able to manage customers: this is the last active platform super-admin`;
  }
  return null;
}

// Activate or deactivate one account. A deactivated account cannot log in, and its open sessions end
// immediately, because every authenticated request checks users.is_active.
adminRouter.patch(
  "/users/:id",
  ah(async (req, res) => {
    const caller = res.locals.user as AuthUser;
    const user = await findAccount(String(req.params.id));
    if (!user) return res.status(404).json({ error: "user not found" });

    const { active } = req.body ?? {};
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "active must be true or false" });
    }
    if (!active) {
      const problem = await problemWith(user, caller.id, "deactivate");
      if (problem) return res.status(400).json({ error: problem });
    }

    await pool.query("UPDATE users SET is_active = ? WHERE id = ?", [active ? 1 : 0, user.id]);
    if (!active) await pool.query("DELETE FROM sessions WHERE user_id = ?", [user.id]);
    res.json({ id: user.id, email: user.email, role: user.role, is_active: active ? 1 : 0 });
  })
);

// Delete an account for good. Returns keep a reference to whoever recorded them, so an account that
// recorded returns can only be deactivated.
adminRouter.delete(
  "/users/:id",
  ah(async (req, res) => {
    const caller = res.locals.user as AuthUser;
    const user = await findAccount(String(req.params.id));
    if (!user) return res.status(404).json({ error: "user not found" });

    const problem = await problemWith(user, caller.id, "delete");
    if (problem) return res.status(400).json({ error: problem });

    try {
      await pool.query("DELETE FROM users WHERE id = ?", [user.id]);
    } catch (err) {
      if ((err as { code?: string }).code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(409).json({
          error: "this account recorded returns; deactivate it instead of deleting it",
        });
      }
      throw err;
    }
    res.json({ ok: true, id: user.id, email: user.email });
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
