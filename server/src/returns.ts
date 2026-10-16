import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, requireSuperAdmin, type AuthUser } from "./auth";
import { loadChains } from "./chains";
import { sendChainsExport } from "./export";
import { normalizeSenderId } from "./senderId";
import { chainRootId, parseResendBody } from "./resends";
import { optionalPositiveInt } from "./validate";

// Mounted at /returns. A store operator types a sender ID, sees the package, and picks a reason.
// Every query is scoped by customer_id.

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const currentUser = (res: Response) => res.locals.user as AuthUser;

/**
 * Whose data a request is about.
 *
 * The app is run by one team processing returns for every client company, so the boundary is the
 * REQUEST, not the account: the caller names the customer it is working in, and every query is then
 * scoped to that one customer. Naming none means the caller's own company, which is what an account
 * that never picks one keeps doing.
 */
async function scopeOf(
  res: Response,
  named: unknown
): Promise<{ customerId: number | null } | { status: number; error: string }> {
  const namedId = optionalPositiveInt(named);
  if (namedId === null) return { status: 400, error: "customerId must be a positive number" };
  if (namedId === undefined) return { customerId: currentUser(res).customerId };
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM customers WHERE id = ?", [
    namedId,
  ]);
  if (!rows[0]) return { status: 404, error: "customer not found" };
  return { customerId: namedId };
}

const RECENT_LIMIT = 100;

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

// ---- the directory an operator works from: pick a customer, then a campaign ----
// Read-only, and the same list for everyone: one team handles every client company.
returnsRouter.get(
  "/customers",
  ah(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name FROM customers ORDER BY name, id"
    );
    res.json(rows);
  })
);

returnsRouter.get(
  "/customers/:id/campaigns",
  ah(async (req, res) => {
    const customerId = optionalPositiveInt(req.params.id);
    if (customerId === null || customerId === undefined) {
      return res.status(400).json({ error: "customerId must be a positive number" });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.start_date, c.finish_date,
              (SELECT COUNT(*) FROM packages p WHERE p.campaign_id = c.id) AS package_count,
              (SELECT COUNT(*) FROM returns r
                 JOIN packages p ON p.id = r.package_id
                WHERE p.campaign_id = c.id) AS return_count,
              (SELECT COUNT(*) FROM packages p
                WHERE p.campaign_id = c.id AND p.created_via = 'resend') AS resend_count
         FROM campaigns c
        WHERE c.customer_id = ?
        ORDER BY c.start_date DESC, c.id DESC`,
      [customerId]
    );
    res.json(
      rows.map((row) => ({
        ...row,
        package_count: Number(row.package_count),
        return_count: Number(row.return_count),
        resend_count: Number(row.resend_count),
      }))
    );
  })
);

// ---- one campaign's identity and its own counters, for its returns screen ----
// The campaign names its own customer, so a request needs nothing else — the per-request model in
// SECURITY.md finding 21. Every count is the campaign's own, never its customer's.
returnsRouter.get(
  "/campaigns/:id",
  ah(async (req, res) => {
    const campaignId = optionalPositiveInt(req.params.id);
    if (campaignId === null || campaignId === undefined) {
      return res.status(400).json({ error: "campaignId must be a positive number" });
    }
    const [rows] = await pool.query<
      (RowDataPacket & {
        sent: number;
        returns: number;
        resends: number;
      })[]
    >(
      `SELECT c.id, c.name, c.start_date, c.finish_date,
              cu.id AS customer_id, cu.name AS customer_name,
              (SELECT COUNT(*) FROM packages p WHERE p.campaign_id = c.id) AS sent,
              (SELECT COUNT(*) FROM returns r
                 JOIN packages p ON p.id = r.package_id
                WHERE p.campaign_id = c.id) AS returns,
              (SELECT COUNT(*) FROM packages p
                WHERE p.campaign_id = c.id AND p.created_via = 'resend') AS resends
         FROM campaigns c
         JOIN customers cu ON cu.id = c.customer_id
        WHERE c.id = ?`,
      [campaignId]
    );
    const campaign = rows[0];
    if (!campaign) return res.status(404).json({ error: "campaign not found" });
    res.json({
      ...campaign,
      sent: Number(campaign.sent),
      returns: Number(campaign.returns),
      resends: Number(campaign.resends),
    });
  })
);

// ---- how many packages went out, came back, or were sent again ----
// The recent list is capped, so its length is not the total; these counters are.
// A company-wide report, so it is a super-admin's: a campaign screen has its own counters.
returnsRouter.get(
  "/summary",
  requireSuperAdmin,
  ah(async (req, res) => {
    const scope = await scopeOf(res, req.query.customerId);
    if ("error" in scope) return res.status(scope.status).json({ error: scope.error });
    const customerId = scope.customerId;
    const [rows] = await pool.query<
      (
        RowDataPacket & { sent_count: number; returns_count: number; resend_count: number }
      )[]
    >(
      `SELECT
         (SELECT COUNT(*) FROM packages WHERE customer_id = ?) AS sent_count,
         (SELECT COUNT(*) FROM returns WHERE customer_id = ?) AS returns_count,
         (SELECT COUNT(*) FROM packages WHERE customer_id = ? AND created_via = 'resend')
           AS resend_count`,
      [customerId, customerId, customerId]
    );
    const counts = rows[0];
    res.json({
      sent: Number(counts?.sent_count ?? 0),
      returns: Number(counts?.returns_count ?? 0),
      resends: Number(counts?.resend_count ?? 0),
      recent: RECENT_LIMIT,
    });
  })
);

// ---- the five seeded reasons ----
// Shared configuration, identical for every customer, so there is nothing to scope.
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
  requireSuperAdmin,
  ah(async (req, res) => {
    const scope = await scopeOf(res, req.query.customerId);
    if ("error" in scope) return res.status(scope.status).json({ error: scope.error });
    const customerId = scope.customerId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id, r.returned_at, r.note,
              p.id AS package_id, p.sender_id, p.chain_id, p.extra_columns,
              c.id AS campaign_id, c.name AS campaign_name,
              rr.code AS reason_code, rr.label AS reason_label, rr.closed_store
         FROM returns r
         JOIN packages p ON p.id = r.package_id
         JOIN campaigns c ON c.id = p.campaign_id
         JOIN return_reasons rr ON rr.id = r.reason_id
        WHERE r.customer_id = ?
        ORDER BY r.id DESC
        LIMIT ${RECENT_LIMIT}`,
      [customerId]
    );

    // Did the package get sent again? The next package in its chain is the resend.
    const roots = [
      ...new Set(
        rows.map((row) => chainRootId({ id: Number(row.package_id), chain_id: row.chain_id }))
      ),
    ];
    const chains = await chainsFor(customerId, roots);
    const resentAs = new Map<number, string>();
    for (const row of rows) {
      const root = chainRootId({ id: Number(row.package_id), chain_id: row.chain_id });
      // chainsFor returns members in id order, so the first one after this package is its resend.
      const next = (chains.get(root) ?? []).find(
        (member) => Number(member.id) > Number(row.package_id)
      );
      if (next) resentAs.set(Number(row.package_id), String(next.sender_id));
    }

    res.json(
      rows.map((row) => ({
        ...row,
        resent_as: resentAs.get(Number(row.package_id)) ?? null,
      }))
    );
  })
);

// ---- find a package by the sender ID a user typed -----------
returnsRouter.get(
  "/lookup",
  ah(async (req, res) => {
    const scope = await scopeOf(res, req.query.customerId);
    if ("error" in scope) return res.status(scope.status).json({ error: scope.error });
    let customerId = scope.customerId;

    const senderId = normalizeSenderId(req.query.senderId);
    if (!senderId) return res.status(400).json({ error: "senderId is required" });

    // A lookup can be narrowed to one campaign: with the same package ID used in more than one
    // campaign, the caller has to say which one they are holding.
    const campaignId = optionalPositiveInt(req.query.campaignId);
    if (campaignId === null) {
      return res.status(400).json({ error: "campaignId must be a positive number" });
    }
    if (campaignId !== undefined) {
      // A campaign names its own owner, so it can stand in for the customer; naming both means they
      // have to agree.
      const [own] = await pool.query<(RowDataPacket & { customer_id: number })[]>(
        "SELECT id, customer_id FROM campaigns WHERE id = ?",
        [campaignId]
      );
      if (!own[0] || (customerId !== null && Number(own[0].customer_id) !== customerId)) {
        return res.status(404).json({ error: "campaign not found" });
      }
      customerId = Number(own[0].customer_id);
    }
    const campaignFilter = campaignId === undefined ? "" : " AND p.campaign_id = ?";
    const params: (number | string | null)[] =
      campaignId === undefined ? [customerId, senderId] : [customerId, senderId, campaignId];

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.sender_id, p.chain_id, p.created_via, p.extra_columns, p.source_row,
              c.id AS campaign_id, c.name AS campaign_name,
              r.id AS return_id, r.returned_at, r.note AS return_note,
              rr.code AS reason_code, rr.label AS reason_label, rr.closed_store
         FROM packages p
         JOIN campaigns c ON c.id = p.campaign_id
         LEFT JOIN returns r ON r.package_id = p.id
         LEFT JOIN return_reasons rr ON rr.id = r.reason_id
        WHERE p.customer_id = ? AND p.sender_id = ?${campaignFilter}
        ORDER BY p.id`,
      params
    );

    const chains = await chainsFor(
      customerId,
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

// ---- every chain, laid out end to end: the original ID, then each resend ----
// Only chains that were actually resent appear (a chain of one is just a package). The same loader
// backs the .xlsx below, so the download and the screen can never disagree.
returnsRouter.get(
  "/chains",
  requireSuperAdmin,
  ah(async (req, res) => {
    const scope = await scopeOf(res, req.query.customerId);
    if ("error" in scope) return res.status(scope.status).json({ error: scope.error });
    res.json(await loadChains(scope.customerId));
  })
);

// The chain report as a file, for pruning the source database outside the app.
returnsRouter.get(
  "/chains/export",
  requireSuperAdmin,
  ah(async (req, res) => {
    const scope = await scopeOf(res, req.query.customerId);
    if ("error" in scope) return res.status(scope.status).json({ error: scope.error });
    await sendChainsExport(res, scope.customerId);
  })
);

// ---- send the same goods again under a new sender ID ----
// Whoever processes the returns records this too: it is the same operator's job. The package names
// its own customer, so nothing else has to be scoped here.
returnsRouter.post(
  "/resend",
  ah(async (req, res) => {
    const user = currentUser(res);

    const parsed = parseResendBody(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
    const { packageId, newSenderId, campaignId: requestedCampaign } = parsed.value;

    // The package names its own customer, and every query below is scoped to that one.
    const [orig] = await pool.query<
      (RowDataPacket & {
        id: number;
        chain_id: number | null;
        campaign_id: number;
        customer_id: number;
        campaign_name: string;
        return_id: number | null;
      })[]
    >(
      `SELECT p.id, p.chain_id, p.campaign_id, p.customer_id, c.name AS campaign_name,
              r.id AS return_id
         FROM packages p
         JOIN campaigns c ON c.id = p.campaign_id
         LEFT JOIN returns r ON r.package_id = p.id
        WHERE p.id = ?`,
      [packageId]
    );
    if (!orig[0]) return res.status(404).json({ error: "package not found" });
    const customerId = Number(orig[0].customer_id);
    if (!orig[0].return_id) {
      return res.status(400).json({ error: "only a returned package can be resent" });
    }

    // A resend always goes in the SAME campaign as the package it replaces.
    const campaignId = orig[0].campaign_id;
    if (requestedCampaign !== undefined && requestedCampaign !== campaignId) {
      // Keep ownership errors as 404s: a campaign outside this package's company must not be
      // distinguishable from one that does not exist.
      const [foreign] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM campaigns WHERE id = ? AND customer_id = ?",
        [requestedCampaign, customerId]
      );
      if (!foreign[0]) return res.status(404).json({ error: "campaign not found" });
      return res.status(400).json({
        error: "a resend stays in the same campaign as the original package",
      });
    }

    const [dupe] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM packages WHERE customer_id = ? AND campaign_id = ? AND sender_id = ?",
      [customerId, campaignId, newSenderId]
    );
    if (dupe[0]) {
      return res.status(409).json({ error: "that package ID is already used in that campaign" });
    }

    const root = chainRootId(orig[0]);
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO packages
         (customer_id, campaign_id, upload_id, source_row, sender_id, chain_id, created_via, extra_columns)
       VALUES (?, ?, NULL, NULL, ?, ?, 'resend', ?)`,
      [customerId, campaignId, newSenderId, root, JSON.stringify({})]
    );
    res.status(201).json({
      id: result.insertId,
      senderId: newSenderId,
      chainId: root,
      campaignId,
      campaignName: orig[0].campaign_name,
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

    // The client sends packageId back when the sender ID matched more than one campaign. The package
    // then names its own customer, so a name in the body cannot disagree with it.
    let pkgId: number | null = null;
    let customerId: number | null = null;
    if (packageId !== undefined && packageId !== null && packageId !== "") {
      const [byId] = await pool.query<(RowDataPacket & { id: number; customer_id: number })[]>(
        "SELECT id, customer_id FROM packages WHERE id = ?",
        [Number(packageId)]
      );
      if (!byId[0]) return res.status(404).json({ error: "package not found" });
      pkgId = byId[0].id;
      customerId = Number(byId[0].customer_id);
    } else {
      const scope = await scopeOf(res, req.body?.customerId);
      if ("error" in scope) return res.status(scope.status).json({ error: scope.error });
      customerId = scope.customerId;
      const [found] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM packages WHERE customer_id = ? AND sender_id = ?",
        [customerId, sid]
      );
      if (!found[0]) return res.status(404).json({ error: "no package with that ID" });
      if (found.length > 1) {
        return res.status(409).json({
          error: "that ID exists in more than one campaign; pick the package from the list",
        });
      }
      pkgId = found[0].id;
    }

    try {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO returns (customer_id, package_id, reason_id, note, recorded_by)
         VALUES (?, ?, ?, ?, ?)`,
        [
          customerId,
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
