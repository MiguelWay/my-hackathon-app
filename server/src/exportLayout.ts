// Pure layout logic for the .xlsx export. Kept dependency-free so it can be unit-tested.
//
// Rebuilding the original sheet needs one non-obvious thing: which header in
// `campaign_uploads.columns` held the sender ID. The upload excluded exactly that column from
// `extra_columns`, so it is the single header not present in any of the upload's rows.

export const NEW_COLUMNS = ["Return Status", "Return Reason", "Resend Of"] as const;

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

/** sender_id of the attempt each resend replaced, keyed by package id (chains ordered by id). */
export function resendOfMap(chainPackages: PackageLike[]): Record<number, string> {
  const byRoot = new Map<number, PackageLike[]>();
  for (const p of chainPackages) {
    const root = p.chain_id ?? p.id;
    const list = byRoot.get(root);
    if (list) list.push(p);
    else byRoot.set(root, [p]);
  }
  const map: Record<number, string> = {};
  for (const members of byRoot.values()) {
    const ordered = [...members].sort((a, b) => a.id - b.id);
    for (let i = 1; i < ordered.length; i++) map[ordered[i].id] = ordered[i - 1].sender_id;
  }
  return map;
}
