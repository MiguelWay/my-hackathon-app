import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import ExcelJS from "exceljs";
import { pool } from "./db";
import { requireAuth, type AuthUser } from "./auth";
import {
  buildExportLayout,
  cellFor,
  NEW_COLUMNS,
  resendOfMap,
  type PackageLike,
  type UploadLike,
} from "./exportLayout";

// Mounted at /campaigns/:campaignId/export, and reused by /admin/campaigns/:id/export.
// The sheet reproduces the uploaded columns exactly (same names, same order), appends the three
// reporting columns, and shades every returned row light red.
//
// ExcelJS is used instead of SheetJS here because the community SheetJS build cannot write cell
// styles (fills are silently dropped). This is server-side only, so it never reaches the SPA bundle.

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const currentUser = (res: Response) => res.locals.user as AuthUser;

const RETURNED_FILL = "FFFFC7CE"; // the familiar Excel "light red fill"
const HEADER_FILL = "FFEFEFEF";
const MAX_WIDTH = 45;
const ROOT_CHUNK = 500;

interface PackageRow extends RowDataPacket {
  id: number;
  upload_id: number | null;
  sender_id: string;
  extra_columns: unknown;
  chain_id: number | null;
  return_id: number | null;
  reason_label: string | null;
}

const toPackageLike = (row: Record<string, unknown>): PackageLike => ({
  id: Number(row.id),
  upload_id: row.upload_id === null || row.upload_id === undefined ? null : Number(row.upload_id),
  sender_id: String(row.sender_id),
  extra_columns: row.extra_columns,
  chain_id: row.chain_id === null || row.chain_id === undefined ? null : Number(row.chain_id),
});

function sheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*\[\]]/g, "-").trim();
  return (cleaned || "Packages").slice(0, 31);
}

function fileSlug(name: string): string {
  const ascii = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return ascii || "campaign";
}

/**
 * Builds one campaign's .xlsx and sends it.
 *
 * `scopeToCustomer` is the company the caller may look in: the tenant route passes the caller's own
 * company, while the platform route passes null because a super-admin may export any campaign. Every
 * query after that uses the campaign's real owner, so one sheet can never mix two companies.
 */
export async function sendCampaignExport(
  res: Response,
  campaignId: number,
  scopeToCustomer: number | null
): Promise<void> {
  const [campaigns] = await pool.query<
    (RowDataPacket & { id: number; name: string; customer_id: number })[]
  >(
    `SELECT id, name, customer_id FROM campaigns WHERE id = ?${
      scopeToCustomer === null ? "" : " AND customer_id = ?"
    }`,
    scopeToCustomer === null ? [campaignId] : [campaignId, scopeToCustomer]
  );
  const campaign = campaigns[0];
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }
  const customerId = campaign.customer_id;

  const [rows] = await pool.query<PackageRow[]>(
    `SELECT p.id, p.upload_id, p.sender_id, p.extra_columns, p.chain_id,
            r.id AS return_id, rr.label AS reason_label
       FROM packages p
       LEFT JOIN returns r ON r.package_id = p.id
       LEFT JOIN return_reasons rr ON rr.id = r.reason_id
      WHERE p.campaign_id = ? AND p.customer_id = ?
      ORDER BY p.id`,
    [campaignId, customerId]
  );
  if (!rows.length) {
    res.status(400).json({ error: "this campaign has no packages to export" });
    return;
  }

  const [uploadRows] = await pool.query<(RowDataPacket & { id: number; columns: unknown })[]>(
    "SELECT id, columns FROM campaign_uploads WHERE campaign_id = ? AND customer_id = ? ORDER BY id",
    [campaignId, customerId]
  );
  const uploads: UploadLike[] = uploadRows.map((u) => ({
    id: Number(u.id),
    columns: (typeof u.columns === "string" ? JSON.parse(u.columns) : u.columns) as string[],
  }));

  const packages = rows.map(toPackageLike);
  const layout = buildExportLayout(uploads, packages);

  // "Resend Of" needs the siblings of every chain touched by this campaign.
  const roots = [...new Set(packages.map((p) => p.chain_id ?? p.id))];
  const chainPackages: PackageLike[] = [];
  for (let i = 0; i < roots.length; i += ROOT_CHUNK) {
    const chunk = roots.slice(i, i + ROOT_CHUNK);
    const [chainRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, upload_id, sender_id, extra_columns, chain_id
         FROM packages
        WHERE customer_id = ? AND (id IN (?) OR chain_id IN (?))`,
      [customerId, chunk, chunk]
    );
    chainPackages.push(...chainRows.map(toPackageLike));
  }
  const resendOf = resendOfMap(chainPackages);

  // ---- build the workbook ----
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Package Returns";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName(campaign.name));

  const header = [...layout.columns, ...NEW_COLUMNS];
  sheet.addRow(header);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });

  for (const row of rows) {
    const pkg = toPackageLike(row);
    const returned = row.return_id !== null;
    const added = sheet.addRow([
      ...layout.columns.map((c) => cellFor(pkg, c, layout)),
      returned ? "Returned" : "Sent",
      row.reason_label ? String(row.reason_label) : "",
      resendOf[pkg.id] ?? "",
    ]);
    if (returned) {
      added.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RETURNED_FILL } };
      });
    }
  }

  // Column widths, sized from the data so the sheet is readable without manual resizing.
  const widths = header.map((h) => h.length);
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cell.value === null || cell.value === undefined ? "" : String(cell.value);
      widths[colNumber - 1] = Math.max(widths[colNumber - 1] ?? 0, text.length);
    });
  });
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = Math.min(MAX_WIDTH, Math.max(10, w + 2));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `campaign-${campaignId}-${fileSlug(campaign.name)}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(buffer.byteLength));
  res.end(Buffer.from(buffer));
}

export const exportRouter = Router({ mergeParams: true });
exportRouter.use(requireAuth);

exportRouter.get(
  "/",
  ah(async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: "invalid campaign id" });
    }
    // A platform super-admin has no company of its own, so this route stays empty for them: the
    // platform route (/admin/campaigns/:id/export) is the one that reaches every customer.
    const user = currentUser(res);
    if (user.customerId === null) return res.status(404).json({ error: "campaign not found" });

    await sendCampaignExport(res, campaignId, user.customerId);
  })
);
