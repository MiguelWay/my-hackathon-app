import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, type AuthUser } from "./auth";
import { normalizeSenderId } from "./senderId";

// Mounted at /returns. A store operator types a sender ID, sees the package, and picks a reason.
// Every query is scoped by customer_id.

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const currentUser = (res: Response) => res.locals.user as AuthUser;

const RECENT_LIMIT = 25;

export const returnsRouter = Router();
returnsRouter.use(requireAuth);

// ---- the five seeded reasons --------------------------------
returnsRouter.get(
  "/reasons",
  ah(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, code, label, closed_store FROM return_reasons ORDER BY sort_order, id"
    );
    res.json(rows);
  })
);

// ---- most recently recorded returns -------------------------
returnsRouter.get(
  "/",
  ah(async (_req, res) => {
    const user = currentUser(res);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id, r.returned_at, r.note,
              p.sender_id, p.extra_columns,
              c.id AS campaign_id, c.name AS campaign_name,
              rr.code AS reason_code, rr.label AS reason_label, rr.closed_store
         FROM returns r
         JOIN packages p ON p.id = r.package_id
         JOIN campaigns c ON c.id = p.campaign_id
         JOIN return_reasons rr ON rr.id = r.reason_id
        WHERE r.customer_id = ?
        ORDER BY r.id DESC
        LIMIT ${RECENT_LIMIT}`,
      [user.customerId]
    );
    res.json(rows);
  })
);

// ---- find a package by the sender ID a user typed -----------
returnsRouter.get(
  "/lookup",
  ah(async (req, res) => {
    const user = currentUser(res);
    const senderId = normalizeSenderId(req.query.senderId);
    if (!senderId) return res.status(400).json({ error: "senderId is required" });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.sender_id, p.extra_columns, p.source_row,
              c.id AS campaign_id, c.name AS campaign_name,
              r.id AS return_id, r.returned_at, r.note AS return_note,
              rr.code AS reason_code, rr.label AS reason_label, rr.closed_store
         FROM packages p
         JOIN campaigns c ON c.id = p.campaign_id
         LEFT JOIN returns r ON r.package_id = p.id
         LEFT JOIN return_reasons rr ON rr.id = r.reason_id
        WHERE p.customer_id = ? AND p.sender_id = ?
        ORDER BY p.id`,
      [user.customerId, senderId]
    );
    res.json(rows);
  })
);

// ---- record a return ----------------------------------------
returnsRouter.post(
  "/",
  ah(async (req, res) => {
    const user = currentUser(res);
    const { senderId, reasonCode, note, packageId } = req.body ?? {};

    const sid = normalizeSenderId(senderId);
    if (!sid) return res.status(400).json({ error: "senderId is required" });
    if (!reasonCode) return res.status(400).json({ error: "reasonCode is required" });

    const [reasons] = await pool.query<(RowDataPacket & { id: number; label: string })[]>(
      "SELECT id, label FROM return_reasons WHERE code = ?",
      [String(reasonCode)]
    );
    if (!reasons[0]) return res.status(400).json({ error: "unknown reason" });

    // The client sends packageId back when the sender ID matched more than one campaign.
    let pkgId: number | null = null;
    if (packageId !== undefined && packageId !== null && packageId !== "") {
      const [byId] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM packages WHERE id = ? AND customer_id = ?",
        [Number(packageId), user.customerId]
      );
      if (!byId[0]) return res.status(404).json({ error: "package not found" });
      pkgId = byId[0].id;
    } else {
      const [found] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM packages WHERE customer_id = ? AND sender_id = ?",
        [user.customerId, sid]
      );
      if (!found[0]) return res.status(404).json({ error: "no package with that sender ID" });
      if (found.length > 1) {
        return res.status(409).json({
          error: "that sender ID exists in more than one campaign; pick the package from the list",
        });
      }
      pkgId = found[0].id;
    }

    try {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO returns (customer_id, package_id, reason_id, note, recorded_by)
         VALUES (?, ?, ?, ?, ?)`,
        [
          user.customerId,
          pkgId,
          reasons[0].id,
          note ? String(note).slice(0, 500) : null,
          user.id,
        ]
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, package_id, returned_at, note FROM returns WHERE id = ?",
        [result.insertId]
      );
      res.status(201).json({
        ...rows[0],
        reasonCode: String(reasonCode),
        reasonLabel: reasons[0].label,
      });
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "that package is already marked as returned" });
      }
      throw err;
    }
  })
);
