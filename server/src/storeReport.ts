import type { RowDataPacket } from "mysql2";
import { pool } from "./db";

// The new "Returns + Store ID" report: one row per return → resend link, carrying the store ID of
// each package in the pair. It is deliberately separate from the Return package list, which keeps
// its own two reports unchanged.

export interface StoreReportRow {
  /** Store of the package that came back. */
  returned_store_id: string;
  returned_id: string;
  reason: string | null;
  /** Store of the package it went out as next. */
  resend_store_id: string;
  resend_id: string;
}

interface PackageRow extends RowDataPacket {
  id: number;
  sender_id: string;
  store_id: string;
  chain_id: number | null;
  attempt_no: number;
  reason_label: string | null;
}

/** Every attempt belongs to one chain; an original package is its own chain. */
const chainKey = (p: { id: number; chain_id: number | null }): number =>
  Number(p.chain_id ?? p.id);

export async function loadStoreReport(
  customerId: number,
  campaignId: number
): Promise<StoreReportRow[]> {
  const [packages] = await pool.query<PackageRow[]>(
    `SELECT p.id, p.sender_id, p.store_id, p.chain_id, p.attempt_no,
            rr.label AS reason_label
       FROM packages p
       LEFT JOIN returns r ON r.package_id = p.id
       LEFT JOIN return_reasons rr ON rr.id = r.reason_id
      WHERE p.campaign_id = ? AND p.customer_id = ?
      ORDER BY p.id`,
    [campaignId, customerId]
  );

  // Attempts by chain, so each resend can find the package it replaced.
  const byChain = new Map<number, Map<number, PackageRow>>();
  for (const p of packages) {
    const attempts = byChain.get(chainKey(p)) ?? new Map<number, PackageRow>();
    attempts.set(Number(p.attempt_no), p);
    byChain.set(chainKey(p), attempts);
  }

  const ordered: { chain: number; attempt: number; row: StoreReportRow }[] = [];
  for (const p of packages) {
    const attempt = Number(p.attempt_no);
    if (attempt <= 1) continue;
    const previous = byChain.get(chainKey(p))?.get(attempt - 1);
    if (!previous) continue;
    ordered.push({
      chain: chainKey(p),
      attempt,
      row: {
        returned_store_id: previous.store_id,
        returned_id: previous.sender_id,
        reason: previous.reason_label,
        resend_store_id: p.store_id,
        resend_id: p.sender_id,
      },
    });
  }
  ordered.sort((a, b) => a.chain - b.chain || a.attempt - b.attempt);

  return ordered.map((entry) => entry.row);
}
