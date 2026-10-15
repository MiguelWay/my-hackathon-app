// Pure helpers for resend chains. Kept dependency-free so they can be unit-tested.

import { MAX_SENDER_ID_LENGTH } from "./validate";

/** A package's chain is identified by its first package (chain root). */
export interface ChainNode {
  id: number;
  chain_id: number | null;
}

export function chainRootId(pkg: ChainNode): number {
  return pkg.chain_id ?? pkg.id;
}

/** 1-based position of a package within its (id-ordered) chain. */
export function attemptNumber(chain: ChainNode[], packageId: number): number {
  return chain.findIndex((p) => p.id === packageId) + 1;
}

export interface ParsedResend {
  packageId: number;
  newSenderId: string;
  /**
   * Optional, and normally omitted: a resend always stays in the ORIGINAL package's campaign, so the
   * server derives it. If a client does send one, it must match (see the /resend handler).
   */
  campaignId?: number;
}

export type ResendParse =
  | { ok: true; value: ParsedResend }
  | { ok: false; status: number; error: string };

const positiveInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function parseResendBody(body: unknown): ResendParse {
  const b = (body ?? {}) as { packageId?: unknown; newSenderId?: unknown; campaignId?: unknown };

  const packageId = positiveInt(b.packageId);
  if (packageId === null) return { ok: false, status: 400, error: "packageId is required" };

  const newSenderId = String(b.newSenderId ?? "").trim();
  if (!newSenderId) return { ok: false, status: 400, error: "new package ID is required" };
  if (newSenderId.length > MAX_SENDER_ID_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `new package ID must be at most ${MAX_SENDER_ID_LENGTH} characters`,
    };
  }

  // The campaign is optional; when present it still has to be a real id.
  if (b.campaignId === undefined || b.campaignId === null || b.campaignId === "") {
    return { ok: true, value: { packageId, newSenderId } };
  }
  const campaignId = positiveInt(b.campaignId);
  if (campaignId === null) {
    return { ok: false, status: 400, error: "campaignId must be a positive number" };
  }
  return { ok: true, value: { packageId, newSenderId, campaignId } };
}
