import type { RowDataPacket } from "mysql2";
import { pool } from "./db";

// The two tables behind the campaign's Return package list: one row per returned/resent package, and
// one row per resend link (the package that came back → the package it went out as next).

export interface ReturnListRow {
  sender_id: string;
  status: "Returned" | "Resent";
  reason_label: string | null;
  returned_at: string | null;
  resent_at: string | null;
}

export interface ResendLink {
  returned_id: string;
  reason: string | null;
  resent_id: string;
  /** The resent package's own ID when it came back too, otherwise null. */
  returned_again_id: string | null;
  returned_again_reason: string | null;
}

export interface ReasonCount {
  code: string;
  label: string;
  count: number;
}

interface PackageRow extends RowDataPacket {
  id: number;
  sender_id: string;
  chain_id: number | null;
  attempt_no: number;
  resent_at: string | null;
  return_id: number | null;
  returned_at: string | null;
  reason_code: string | null;
  reason_label: string | null;
}

/** Every attempt belongs to one chain; an original package is its own chain. */
const chainKey = (p: { id: number; chain_id: number | null }): number =>
  Number(p.chain_id ?? p.id);

export async function loadReturnList(
  customerId: number,
  campaignId: number
): Promise<{ rows: ReturnListRow[]; links: ResendLink[]; reasons: ReasonCount[] }> {
  const [packages] = await pool.query<PackageRow[]>(
    `SELECT p.id, p.sender_id, p.chain_id, p.attempt_no, p.resent_at,
            r.id AS return_id, r.returned_at,
            rr.code AS reason_code, rr.label AS reason_label
       FROM packages p
       LEFT JOIN returns r ON r.package_id = p.id
       LEFT JOIN return_reasons rr ON rr.id = r.reason_id
      WHERE p.campaign_id = ? AND p.customer_id = ?
      ORDER BY p.id`,
    [campaignId, customerId]
  );

  // Every seeded reason is listed, including the ones with no returns, so the chart is stable.
  const [reasonRows] = await pool.query<(RowDataPacket & { code: string; label: string })[]>(
    "SELECT code, label FROM return_reasons ORDER BY sort_order, id"
  );
  const counts = new Map<string, number>();
  for (const p of packages) {
    if (p.reason_code) counts.set(p.reason_code, (counts.get(p.reason_code) ?? 0) + 1);
  }
  const reasons: ReasonCount[] = reasonRows.map((r) => ({
    code: r.code,
    label: r.label,
    count: counts.get(r.code) ?? 0,
  }));

  const rows: ReturnListRow[] = packages
    .filter((p) => p.return_id !== null || Number(p.attempt_no) > 1)
    .map((p) => ({
      sender_id: p.sender_id,
      // One status per package: a returned package is a return even when it was also a resend.
      status: p.return_id !== null ? "Returned" : "Resent",
      reason_label: p.reason_label,
      returned_at: p.returned_at,
      resent_at: p.resent_at,
    }));

  // Attempts by chain, so a resend can find the package it replaced.
  const byChain = new Map<number, Map<number, PackageRow>>();
  for (const p of packages) {
    const attempts = byChain.get(chainKey(p)) ?? new Map<number, PackageRow>();
    attempts.set(Number(p.attempt_no), p);
    byChain.set(chainKey(p), attempts);
  }

  const ordered: { chain: number; attempt: number; link: ResendLink }[] = [];
  for (const p of packages) {
    const attempt = Number(p.attempt_no);
    if (attempt <= 1) continue;
    const previous = byChain.get(chainKey(p))?.get(attempt - 1);
    if (!previous) continue;
    ordered.push({
      chain: chainKey(p),
      attempt,
      link: {
        returned_id: previous.sender_id,
        reason: previous.reason_label,
        resent_id: p.sender_id,
        returned_again_id: p.return_id !== null ? p.sender_id : null,
        returned_again_reason: p.reason_label,
      },
    });
  }
  ordered.sort((a, b) => a.chain - b.chain || a.attempt - b.attempt);

  return { rows, links: ordered.map((entry) => entry.link), reasons };
}
