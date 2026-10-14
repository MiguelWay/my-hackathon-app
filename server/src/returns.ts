import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, requireAdmin, type AuthUser } from "./auth";
import { normalizeSenderId } from "./senderId";
import { chainRootId, parseResendBody } from "./resends";

// Mounted at /returns. A store operator types a sender ID, sees the package, and picks a reason.
// Every query is scoped by customer_id.

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const currentUser = (res: Response) => res.locals.user as AuthUser;

const RECENT_LIMIT = 25;

/** Every package in the same chain as one of `roots`, grouped by chain root. */
async function chainsFor(customerId: number | null, roots: number[]) {
  const grouped = new Map<number, RowDataPacket[]>();
  if (!roots.length) return grouped;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.sender_id, p.chain_id, p.created_via, p.created_at,
            c.name AS campaign_name,
            r.returned_at, r.note AS return_note,
            rr.label AS reason_label, rr.closed_store
       FROM packages p
       JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN returns r ON r.package_id = p.id
       LEFT JOIN return_reasons rr ON rr.id = r.reason_id
      WHERE p.customer_id = ? AND (p.id IN (?) OR p.chain_id IN (?))
      ORDER BY p.id`,
    [customerId, roots, roots]
  );
  for (const row of rows) {
    const root = chainRootId(row as unknown as { id: number; chain_id: number | null });
    const list = grouped.get(root);
    if (list) list.push(row);
    else grouped.set(root, [row]);
  }
  return grouped;
}

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
      `SELECT p.id, p.sender_id, p.chain_id, p.created_via, p.extra_columns, p.source_row,
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

    const chains = await chainsFor(
      user.customerId,
      [...new Set(rows.map((r) => chainRootId(r as unknown as { id: number; chain_id: number | null })))]
    );
    res.json(
      rows.map((r) => ({
        ...r,
        chain: chains.get(chainRootId(r as unknown as { id: number; chain_id: number | null })) ?? [],
      }))
    );
  })
);

// ---- send the same goods again under a new sender ID ----
returnsRouter.post(
  "/resend",
  requireAdmin,
  ah(async (req, res) => {
    const user = currentUser(res);
    if (user.customerId === null) return res.status(403).json({ error: "admin only" });

    const parsed = parseResendBody(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
    const { packageId, newSenderId, campaignId } = parsed.value;

    const [orig] = await pool.query<(RowDataPacket & { id: number; chain_id: number | null; return_id: number | null })[]>(
      `SELECT p.id, p.chain_id, r.id AS return_id
         FROM packages p
         LEFT JOIN returns r ON r.package_id = p.id
        WHERE p.id = ? AND p.customer_id = ?`,
      [packageId, user.customerId]
    );
    if (!orig[0]) return res.status(404).json({ error: "package not found" });
    if (!orig[0].return_id) {
      return res.status(400).json({ error: "only a returned package can be resent" });
    }

    const [camp] = await pool.query<(RowDataPacket & { id: number; name: string })[]>(
      "SELECT id, name FROM campaigns WHERE id = ? AND customer_id = ?",
      [campaignId, user.customerId]
    );
    if (!camp[0]) return res.status(404).json({ error: "campaign not found" });

    const [dupe] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM packages WHERE campaign_id = ? AND sender_id = ?",
      [campaignId, newSenderId]
    );
    if (dupe[0]) {
      return res.status(409).json({ error: "that sender ID is already used in that campaign" });
    }

    const root = chainRootId(orig[0]);
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO packages
         (customer_id, campaign_id, upload_id, source_row, sender_id, chain_id, created_via, extra_columns)
       VALUES (?, ?, NULL, NULL, ?, ?, 'resend', ?)`,
      [user.customerId, campaignId, newSenderId, root, JSON.stringify({})]
    );
    res.status(201).json({
      id: result.insertId,
      senderId: newSenderId,
      chainId: root,
      campaignId,
      campaignName: camp[0].name,
    });
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
