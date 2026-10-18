import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "./db";
import { requireAuth, requireSuperAdmin, type AuthUser } from "./auth";
import { scopedCampaign } from "./scope";
import { parseImportBody } from "./importValidation";

// Mounted at /campaigns/:campaignId — packages and uploads belong to one campaign, which belongs to
// one customer. The campaign is resolved per request (see scope.ts); every query then runs under the
// customer that campaign belongs to, not the caller's own, which a platform super-admin has none of.

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const currentUser = (res: Response) => res.locals.user as AuthUser;

const INSERT_CHUNK = 500;
const LOOKUP_CHUNK = 1_000;

export const packagesRouter = Router({ mergeParams: true });
packagesRouter.use(requireAuth);

packagesRouter.get(
  "/uploads",
  ah(async (req, res) => {
    const campaign = await scopedCampaign(req.params.campaignId, currentUser(res));
    if (!campaign) return res.status(404).json({ error: "campaign not found" });
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, filename, columns, row_count, created_at
         FROM campaign_uploads
        WHERE campaign_id = ? AND customer_id = ?
        ORDER BY id DESC`,
      [campaign.id, campaign.customer_id]
    );
    res.json(rows);
  })
);

packagesRouter.get(
  "/packages",
  ah(async (req, res) => {
    const campaign = await scopedCampaign(req.params.campaignId, currentUser(res));
    if (!campaign) return res.status(404).json({ error: "campaign not found" });
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, upload_id, source_row, sender_id, extra_columns, created_at
         FROM packages
        WHERE campaign_id = ? AND customer_id = ?
        ORDER BY id`,
      [campaign.id, campaign.customer_id]
    );
    res.json(rows);
  })
);

packagesRouter.post(
  "/packages",
  requireSuperAdmin,
  ah(async (req, res) => {
    const campaign = await scopedCampaign(req.params.campaignId, currentUser(res));
    if (!campaign) return res.status(404).json({ error: "campaign not found" });

    const parsed = parseImportBody(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
    const { filename, columns: cols, senderIndex: idx, storeIndex, records, skipped } = parsed.value;

    // The packages belong to the campaign's customer, which is not necessarily the caller's: a platform
    // super-admin has no company of its own and is filling in somebody else's campaign.
    const customerId = campaign.customer_id;
    const campaignId = campaign.id;

    // ---- no sender ID already stored in this campaign ----
    const existing: string[] = [];
    const ids = records.map((r) => r.sender);
    for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
      const [found] = await pool.query<(RowDataPacket & { sender_id: string })[]>(
        "SELECT sender_id FROM packages WHERE customer_id = ? AND campaign_id = ? AND sender_id IN (?)",
        [customerId, campaignId, ids.slice(i, i + LOOKUP_CHUNK)]
      );
      existing.push(...found.map((f) => f.sender_id));
    }
    if (existing.length) {
      return res.status(409).json({
        error: `already in this campaign: ${existing.slice(0, 5).join(", ")}${
          existing.length > 5 ? ` (+${existing.length - 5} more)` : ""
        }`,
      });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [upload] = await conn.query<ResultSetHeader>(
        `INSERT INTO campaign_uploads (customer_id, campaign_id, filename, columns, store_column, row_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [customerId, campaignId, filename, JSON.stringify(cols), cols[storeIndex], records.length]
      );

      for (let i = 0; i < records.length; i += INSERT_CHUNK) {
        const values = records.slice(i, i + INSERT_CHUNK).map((rec) => {
          const extra: Record<string, string> = {};
          cols.forEach((header, ci) => {
            if (ci !== idx) extra[header] = rec.cells[ci];
          });
          return [
            customerId,
            campaignId,
            upload.insertId,
            rec.sourceRow,
            rec.sender,
            rec.store,
            JSON.stringify(extra),
          ];
        });
        await conn.query(
          `INSERT INTO packages (customer_id, campaign_id, upload_id, source_row, sender_id, store_id, extra_columns)
           VALUES ?`,
          [values]
        );
      }

      await conn.commit();
      res.status(201).json({
        uploadId: upload.insertId,
        campaignId,
        filename,
        senderColumn: { index: idx, name: cols[idx] },
        storeColumn: { index: storeIndex, name: cols[storeIndex] },
        columns: cols,
        imported: records.length,
        skipped,
      });
    } catch (err) {
      await conn.rollback();
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
        return res
          .status(409)
          .json({ error: "a package ID in this file already exists in this campaign" });
      }
      throw err;
    } finally {
      conn.release();
    }
  })
);
