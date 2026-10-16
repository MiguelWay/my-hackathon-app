import type { RowDataPacket } from "mysql2";
import { pool } from "./db";
import type { AuthUser } from "./auth";

/** A campaign, as far as scoping it to a caller needs. */
export interface ScopedCampaign extends RowDataPacket {
  id: number;
  customer_id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
}

/**
 * The campaign the request names, if the caller may touch it — or null.
 *
 * The boundary is the request, not the account (`SECURITY.md` finding 21). An account attached to a
 * company only ever reaches its **own** campaigns. A platform super-admin — one with no company of its
 * own — reaches any campaign a request names, which is what lets one person set a customer up and then
 * open and fill the campaign that came with it.
 *
 * This narrows nothing about *who* may get here: every route that uses it is `requireAuth` plus, where
 * it writes, `requireSuperAdmin`. It only decides which campaign the answer is about.
 */
export async function scopedCampaign(
  rawId: unknown,
  user: AuthUser
): Promise<ScopedCampaign | null> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [rows] = await pool.query<ScopedCampaign[]>(
    `SELECT id, customer_id, name, start_date, finish_date FROM campaigns
      WHERE id = ?${user.customerId === null ? "" : " AND customer_id = ?"}`,
    user.customerId === null ? [id] : [id, user.customerId]
  );
  return rows[0] ?? null;
}
