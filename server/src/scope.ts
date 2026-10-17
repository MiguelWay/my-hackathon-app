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
 * Whether this account is a tenant's own administrator, and so must stay inside its company.
 *
 * A `user` is the operator team: it works every client, and the request names which one. A platform
 * super-admin has no company at all, so it can never be confined. Only a super-admin attached to a
 * company is — and that is the tenant-isolation guarantee.
 */
export function isConfined(user: AuthUser): boolean {
  return user.role === "superadmin" && user.customerId !== null;
}

/**
 * The campaign the request names, if the caller may touch it — or null.
 *
 * The boundary is the request, not the account (`SECURITY.md` finding 21). An **operator** and a
 * **platform super-admin** reach any campaign a request names, which is what lets one team process
 * every client's returns. A **tenant's own administrator** reaches only its own company's campaigns.
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
  const confined = isConfined(user);
  const [rows] = await pool.query<ScopedCampaign[]>(
    `SELECT id, customer_id, name, start_date, finish_date FROM campaigns
      WHERE id = ?${confined ? " AND customer_id = ?" : ""}`,
    confined ? [id, user.customerId] : [id]
  );
  return rows[0] ?? null;
}
