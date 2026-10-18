import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";
import { pool } from "./db";
import { loadChains } from "./chains";
import { loadReturnList } from "./returnList";
import { loadStoreReport } from "./storeReport";
import { requireAuth, requireSuperAdmin, type AuthUser } from "./auth";
import { isConfined } from "./scope";
import { optionalPositiveInt } from "./validate";
import {
  buildExportLayout,
  cellFor,
  chainsByPackage,
  chainColumns,
  NEW_COLUMNS,
  type PackageLike,
  type UploadLike,
} from "./exportLayout";

// Mounted at /campaigns/:campaignId/export, and reused by /admin/campaigns/:id/export.
// The sheet reproduces the uploaded columns exactly (same names, same order), appends the three
// reporting columns, and shades every returned row light red and every resent row light green — red
// wins, because a package that came back is a return even when it was also used as a resend.
//
// ExcelJS is used instead of SheetJS here because the community SheetJS build cannot write cell
// styles (fills are silently dropped). This is server-side only, so it never reaches the SPA bundle.

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const currentUser = (res: Response) => res.locals.user as AuthUser;

const RETURNED_FILL = "FFFFC7CE"; // the familiar Excel "light red fill"
const RESENT_FILL = "FFC6EFCE"; // and its "light green fill"
const HEADER_FILL = "FFEFEFEF";
const MAX_WIDTH = 45;
const ROOT_CHUNK = 500;

interface PackageRow extends RowDataPacket {
  id: number;
  upload_id: number | null;
  sender_id: string;
  extra_columns: unknown;
  chain_id: number | null;
  attempt_no: number;
  resent_at: string | null;
  return_id: number | null;
  reason_label: string | null;
}

const toPackageLike = (row: Record<string, unknown>): PackageLike => ({
  id: Number(row.id),
  upload_id: row.upload_id === null || row.upload_id === undefined ? null : Number(row.upload_id),
  sender_id: String(row.sender_id),
  extra_columns: row.extra_columns,
  chain_id: row.chain_id === null || row.chain_id === undefined ? null : Number(row.chain_id),
  attempt_no:
    row.attempt_no === null || row.attempt_no === undefined ? 1 : Number(row.attempt_no),
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

/** The same slug for an uploaded list, without the .xlsx on the end (it is added back later). */
const listSlug = (filename: string) => fileSlug(filename.replace(/\.xlsx?$/i, ""));

/** The bold, tinted header row every sheet starts with. */
function writeHeader(sheet: Worksheet, header: string[]): void {
  sheet.addRow(header);
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
}

/** Column widths, sized from the data so the sheet is readable without manual resizing. */
function sizeColumns(sheet: Worksheet, header: string[]): void {
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
}

/**
 * Builds one campaign's .xlsx and sends it.
 *
 * `scopeToCustomer` is the company the caller may look in: the tenant route passes the caller's own
 * company, while the platform route passes null because a super-admin may export any campaign. Every
 * query after that uses the campaign's real owner, so one sheet can never mix two companies.
 *
 * `uploadId`, when given, limits the sheet to the rows of one uploaded list — the way to get a single
 * list back, without the resends that no file line produced.
 */
export async function sendCampaignExport(
  res: Response,
  campaignId: number,
  scopeToCustomer: number | null,
  uploadId?: number
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

  // A list can only be exported through the campaign it was uploaded to.
  let listFilename: string | null = null;
  if (uploadId !== undefined) {
    const [lists] = await pool.query<(RowDataPacket & { filename: string | null })[]>(
      "SELECT filename FROM campaign_uploads WHERE id = ? AND campaign_id = ? AND customer_id = ?",
      [uploadId, campaignId, customerId]
    );
    if (!lists[0]) {
      res.status(404).json({ error: "list not found" });
      return;
    }
    listFilename = lists[0].filename;
  }

  const [rows] = await pool.query<PackageRow[]>(
    `SELECT p.id, p.upload_id, p.sender_id, p.extra_columns, p.chain_id, p.attempt_no, p.resent_at,
            r.id AS return_id, rr.label AS reason_label
       FROM packages p
       LEFT JOIN returns r ON r.package_id = p.id
       LEFT JOIN return_reasons rr ON rr.id = r.reason_id
      WHERE p.campaign_id = ? AND p.customer_id = ?${uploadId === undefined ? "" : " AND p.upload_id = ?"}
      ORDER BY p.id`,
    uploadId === undefined
      ? [campaignId, customerId]
      : [campaignId, customerId, uploadId]
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

  // The chain columns need the siblings of every chain touched by this campaign.
  const roots = [...new Set(packages.map((p) => p.chain_id ?? p.id))];
  const chainPackages: PackageLike[] = [];
  for (let i = 0; i < roots.length; i += ROOT_CHUNK) {
    const chunk = roots.slice(i, i + ROOT_CHUNK);
    const [chainRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, upload_id, sender_id, extra_columns, chain_id, attempt_no
         FROM packages
        WHERE customer_id = ? AND (id IN (?) OR chain_id IN (?))`,
      [customerId, chunk, chunk]
    );
    chainPackages.push(...chainRows.map(toPackageLike));
  }
  const chains = chainsByPackage(chainPackages);
  // As wide as the deepest chain this campaign touches, so every row's row of IDs lines up.
  const maxResends = Object.values(chains).reduce(
    (deepest, c) => Math.max(deepest, c.resends.length),
    0
  );
  const chainHeaders = chainColumns(maxResends);
  const chainCellsFor = (pkg: PackageLike): string[] => {
    const chain = chains[pkg.id];
    if (!chain) return chainHeaders.map(() => "");
    return [chain.original, ...Array.from({ length: maxResends }, (_, i) => chain.resends[i] ?? "")];
  };

  // ---- build the workbook ----
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Package Returns";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName(campaign.name));

  const header = [...layout.columns, ...NEW_COLUMNS, ...chainHeaders];
  writeHeader(sheet, header);

  for (const row of rows) {
    const pkg = toPackageLike(row);
    const returned = row.return_id !== null;
    const resent = row.resent_at !== null;
    const added = sheet.addRow([
      ...layout.columns.map((c) => cellFor(pkg, c, layout)),
      returned ? "Returned" : resent ? "Resent" : "Sent",
      row.reason_label ? String(row.reason_label) : "",
      ...chainCellsFor(pkg),
    ]);
    const fill = returned ? RETURNED_FILL : resent ? RESENT_FILL : null;
    if (fill !== null) {
      added.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
    }
  }

  // Column widths, sized from the data so the sheet is readable without manual resizing.
  sizeColumns(sheet, header);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename =
    listFilename === null
      ? `campaign-${campaignId}-${fileSlug(campaign.name)}.xlsx`
      : `campaign-${campaignId}-${listSlug(listFilename)}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(buffer.byteLength));
  res.end(Buffer.from(buffer));
}

/**
 * Builds the company's chain report as a .xlsx.
 *
 * One row per chain: the original sending ID, then each package it went out as, then where the original
 * was sent and why it came back. The same rows the Resend chains card shows, read off the same query, so
 * what is downloaded can never disagree with what was on screen.
 */
export async function sendChainsExport(res: Response, customerId: number | null): Promise<void> {
  const chains = await loadChains(customerId);
  if (!chains.length) {
    res.status(400).json({ error: "this company has no resends to report" });
    return;
  }

  const maxResends = chains.reduce((deepest, c) => Math.max(deepest, c.resends.length), 0);
  const header = [...chainColumns(maxResends), "Campaign", "Return Reason"];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Package Returns";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Resend chains");
  writeHeader(sheet, header);

  for (const chain of chains) {
    sheet.addRow([
      chain.original_sender_id,
      ...Array.from({ length: maxResends }, (_, i) => chain.resends[i] ?? ""),
      chain.campaign_name,
      chain.reason_label ?? "",
    ]);
  }
  sizeColumns(sheet, header);

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", 'attachment; filename="resend-chains.xlsx"');
  res.setHeader("Content-Length", String(buffer.byteLength));
  res.end(Buffer.from(buffer));
}

/**
 * One campaign's return package list: every package that came back or was used as a resend, one row
 * each. A package that is both is red — the same rule as the campaign export — so it appears once.
 */
export async function sendReturnListExport(
  res: Response,
  campaignId: number,
  user: AuthUser
): Promise<void> {
  const [campaigns] = await pool.query<
    (RowDataPacket & { id: number; name: string; customer_id: number })[]
  >("SELECT id, name, customer_id FROM campaigns WHERE id = ?", [campaignId]);
  const campaign = campaigns[0];
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }
  const customerId = Number(campaign.customer_id);
  if (isConfined(user) && customerId !== user.customerId) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }

  const { rows, links } = await loadReturnList(customerId, campaignId);

  const header = ["Package ID", "Status", "Reason"];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Package Returns";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Return package list");
  writeHeader(sheet, header);

  for (const row of rows) {
    const returned = row.status === "Returned";
    const added = sheet.addRow([
      row.sender_id,
      row.status,
      row.reason_label ? String(row.reason_label) : "",
    ]);
    added.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: returned ? RETURNED_FILL : RESENT_FILL },
      };
    });
  }
  sizeColumns(sheet, header);

  // The pairings, on their own sheet and deliberately uncoloured: the two IDs and what happened are
  // the whole content. `Returned ID` / `Reason` repeat because the resent package may have come back
  // too, and its own result sits beside the ID it went out as.
  const linkHeader = ["Returned ID", "Reason", "Resent ID", "Returned ID", "Reason"];
  const linksSheet = workbook.addWorksheet("Resend links");
  writeHeader(linksSheet, linkHeader);
  for (const link of links) {
    linksSheet.addRow([
      link.returned_id,
      link.reason ?? "",
      link.resent_id,
      link.returned_again_id ?? "",
      link.returned_again_reason ?? "",
    ]);
  }
  sizeColumns(linksSheet, linkHeader);

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="return-package-list-${campaignId}-${fileSlug(campaign.name)}.xlsx"`
  );
  res.setHeader("Content-Length", String(buffer.byteLength));
  res.end(Buffer.from(buffer));
}

/**
 * The new "Returns + Store ID" report, as a one-sheet .xlsx.
 *
 * One row per return → resend link. The left pair (Store ID, Return package ID) belongs to the package
 * that came back; the right pair (Store ID, Resend package ID) belongs to the package it went out as
 * next. Both store IDs are read from the package rows themselves, never copied between them.
 */
export async function sendStoreReportExport(
  res: Response,
  campaignId: number,
  user: AuthUser
): Promise<void> {
  const [campaigns] = await pool.query<
    (RowDataPacket & { id: number; name: string; customer_id: number })[]
  >("SELECT id, name, customer_id FROM campaigns WHERE id = ?", [campaignId]);
  const campaign = campaigns[0];
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }
  const customerId = Number(campaign.customer_id);
  if (isConfined(user) && customerId !== user.customerId) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }

  const rows = await loadStoreReport(customerId, campaignId);

  const header = ["Store ID", "Return package ID", "Reason", "Store ID", "Resend package ID"];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Package Returns";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Returns + Store ID");
  writeHeader(sheet, header);

  for (const row of rows) {
    sheet.addRow([
      row.returned_store_id,
      row.returned_id,
      row.reason ?? "",
      row.resend_store_id,
      row.resend_id,
    ]);
  }
  sizeColumns(sheet, header);

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="returns-store-id-${campaignId}-${fileSlug(campaign.name)}.xlsx"`
  );
  res.setHeader("Content-Length", String(buffer.byteLength));
  res.end(Buffer.from(buffer));
}

export const exportRouter = Router({ mergeParams: true });
exportRouter.use(requireAuth);

// Exporting the flagged sheet is a planning action, so it is a super-admin's to take: the buttons are
// already hidden from a `user`, and this keeps the API saying the same thing as the screen.
exportRouter.get(
  "/",
  requireSuperAdmin,
  ah(async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: "invalid campaign id" });
    }
    // A platform super-admin has no company of its own, so this route stays empty for them: the
    // platform route (/admin/campaigns/:id/export) is the one that reaches every customer.
    const user = currentUser(res);
    if (user.customerId === null) return res.status(404).json({ error: "campaign not found" });

    const uploadId = optionalPositiveInt(req.query.uploadId);
    if (uploadId === null) {
      return res.status(400).json({ error: "uploadId must be a positive number" });
    }
    await sendCampaignExport(res, campaignId, user.customerId, uploadId);
  })
);
