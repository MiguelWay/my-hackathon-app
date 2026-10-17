import type { RowDataPacket } from "mysql2";
import { pool } from "./db";

// Resend chains, loaded the same way for the on-screen report and for its .xlsx, so the two can never
// disagree. Every query is scoped by customer_id.

export interface Chain {
  /** The package id of the first attempt, which is the chain's root. */
  original_id: number;
  /** The sending ID printed on the package the store sent back. */
  original_sender_id: string;
  /** Where the original was sent. */
  campaign_id: number;
  campaign_name: string;
  /** Why the store sent the original back, or null when no reason was recorded. */
  reason_label: string | null;
  /** The sending IDs of each attempt after the original, in the order they were sent. */
  resends: string[];
}

interface ChainRow extends RowDataPacket {
  id: number;
  sender_id: string;
  chain_id: number | null;
  attempt_no: number;
  campaign_id: number;
  campaign_name: string;
  reason_label: string | null;
}

/**
 * Every chain of one company, each laid out as the original followed by each resend, attempts in order.
 *
 * A package that was never sent again is not a chain, so it is not listed — the report is about what
 * went out more than once. The first row of every group is the lowest id, which is the original.
 */
export async function loadChains(customerId: number | null): Promise<Chain[]> {
  const [rows] = await pool.query<ChainRow[]>(
    `SELECT p.id, p.sender_id, p.chain_id, p.attempt_no, p.campaign_id, c.name AS campaign_name,
            rr.label AS reason_label
       FROM packages p
       JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN returns r ON r.package_id = p.id
       LEFT JOIN return_reasons rr ON rr.id = r.reason_id
      WHERE p.customer_id = ?
        AND COALESCE(p.chain_id, p.id) IN (
          SELECT root FROM (
            SELECT COALESCE(chain_id, id) AS root
              FROM packages
             WHERE customer_id = ?
             GROUP BY root
            HAVING COUNT(*) > 1
          ) AS chained
        )
      ORDER BY COALESCE(p.chain_id, p.id), p.attempt_no, p.id`,
    [customerId, customerId]
  );

  const chains: Chain[] = [];
  for (const row of rows) {
    const root = row.chain_id ?? row.id;
    const current = chains[chains.length - 1];
    if (!current || current.original_id !== root) {
      chains.push({
        original_id: root,
        original_sender_id: row.sender_id,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        reason_label: row.reason_label,
        resends: [],
      });
    } else {
      current.resends.push(row.sender_id);
    }
  }
  return chains;
}
