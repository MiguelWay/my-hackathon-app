// Pure layout logic for the .xlsx export. Kept dependency-free so it can be unit-tested.
//
// Rebuilding the original sheet needs one non-obvious thing: which header in
// `campaign_uploads.columns` held the sender ID. The upload excluded exactly that column from
// `extra_columns`, so it is the single header not present in any of the upload's rows.

export const NEW_COLUMNS = ["Return Status", "Return Reason"] as const;

/**
 * The headings for the chain columns: the original sending ID, then one per resend. Empty when nothing
 * in scope was sent again, so a campaign with no chains keeps the plain five columns.
 *
 * Worded to match the Resend chains report on screen (`src/pages/RecentReturnsPage.tsx`); keep the two
 * in step. A different shape here is what the export used to have, with a single "Resend Of".
 */
export function chainColumns(maxResends: number): string[] {
  if (maxResends === 0) return [];
  const words = ["as", "again as", "a 3rd time as", "a 4th time as", "a 5th time as"];
  return [
    "Original ID",
    ...Array.from({ length: maxResends }, (_, i) => `Resent ${words[i] ?? `${i + 1}th time as`}`),
  ];
}

/** Header used for rows typed in by hand (a resend) when no uploaded header can be borrowed. */
export const MANUAL_SENDER_HEADER = "Package ID";

export interface UploadLike {
  id: number;
  columns: string[];
}

export interface PackageLike {
  id: number;
  upload_id: number | null;
  sender_id: string;
  extra_columns: unknown; // object (mysql2) or a JSON string
  chain_id: number | null;
  /** 1 for a package as uploaded, 2 for the package used as its resend, and so on. */
  attempt_no?: number;
}

export function parseExtraColumns(value: unknown): Record<string, string> {
  if (value && typeof value === "object") return value as Record<string, string>;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

export interface ExportLayout {
  columns: string[];
  senderHeaderByUpload: Record<number, string | null>;
  manualSenderHeader: string;
}

export function buildExportLayout(uploads: UploadLike[], packages: PackageLike[]): ExportLayout {
  const columns: string[] = [];
  for (const u of uploads) {
    for (const c of u.columns) {
      if (!columns.includes(c)) columns.push(c);
    }
  }

  const senderHeaderByUpload: Record<number, string | null> = {};
  for (const u of uploads) {
    const present = new Set<string>();
    for (const p of packages) {
      if (p.upload_id !== u.id) continue;
      for (const key of Object.keys(parseExtraColumns(p.extra_columns))) present.add(key);
    }
    const missing = u.columns.filter((c) => !present.has(c));
    senderHeaderByUpload[u.id] = missing.length === 1 ? missing[0] : (u.columns[0] ?? null);
  }

  const known = Object.values(senderHeaderByUpload).filter((h): h is string => Boolean(h));
  return { columns, senderHeaderByUpload, manualSenderHeader: known[0] ?? MANUAL_SENDER_HEADER };
}

/** The header that holds this package's sender ID. */
export function senderHeaderFor(pkg: PackageLike, layout: ExportLayout): string {
  if (pkg.upload_id === null) return layout.manualSenderHeader;
  return layout.senderHeaderByUpload[pkg.upload_id] ?? layout.manualSenderHeader;
}

export function cellFor(pkg: PackageLike, column: string, layout: ExportLayout): string {
  if (column === senderHeaderFor(pkg, layout)) return pkg.sender_id;
  return parseExtraColumns(pkg.extra_columns)[column] ?? "";
}

/** A chain of attempts: the sending ID it started with, then each one it went out as afterwards. */
export interface Chain {
  original: string;
  resends: string[];
}

/**
 * The chain each package belongs to, keyed by package id, so every member of a chain can print the
 * same row of IDs. Chains of one are left out: a package that never went out again has none to report.
 */
export function chainsByPackage(chainPackages: PackageLike[]): Record<number, Chain> {
  const byRoot = new Map<number, PackageLike[]>();
  for (const p of chainPackages) {
    const root = p.chain_id ?? p.id;
    const list = byRoot.get(root);
    if (list) list.push(p);
    else byRoot.set(root, [p]);
  }
  const map: Record<number, Chain> = {};
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    // A resend target is an ordinary uploaded package, so its id can sit anywhere in the upload. The
    // attempt number says which one came first; id only breaks a tie that should never exist.
    const ordered = [...members].sort(
      (a, b) => (a.attempt_no ?? 1) - (b.attempt_no ?? 1) || a.id - b.id
    );
    const chain: Chain = {
      original: ordered[0].sender_id,
      resends: ordered.slice(1).map((p) => p.sender_id),
    };
    for (const p of ordered) map[p.id] = chain;
  }
  return map;
}
