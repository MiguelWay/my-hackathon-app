// Validation + normalisation for a campaign-list import payload.
// Pure (no DB, no Express) so the many failure branches can be unit-tested.

import { MAX_SENDER_ID_LENGTH, MAX_STORE_ID_LENGTH } from "./validate";

export const MAX_ROWS = 20_000;

export interface ParsedRow {
  sourceRow: number; // 1-based row in the source file (row 1 is the header)
  sender: string;
  store: string;
  cells: string[];
}

export interface ParsedImport {
  filename: string | null;
  columns: string[];
  senderIndex: number;
  storeIndex: number;
  records: ParsedRow[];
  /** Rows left out because they carried no package ID. */
  skipped: number;
}

export type ParseResult =
  | { ok: true; value: ParsedImport }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ParseResult => ({ ok: false, status, error });

export function parseImportBody(body: unknown): ParseResult {
  const b = (body ?? {}) as {
    filename?: unknown;
    columns?: unknown;
    senderColumn?: unknown;
    storeColumn?: unknown;
    rows?: unknown;
  };

  // ---- columns (kept verbatim; order matters for the export) ----
  if (!Array.isArray(b.columns) || b.columns.length === 0) {
    return fail(400, "columns must be a non-empty array");
  }
  const cols = b.columns.map((c) => String(c ?? ""));
  if (new Set(cols).size !== cols.length) {
    return fail(400, "duplicate column names are not supported");
  }

  // ---- which column holds the sender ID ----
  const idx = Number(b.senderColumn);
  if (!Number.isInteger(idx) || idx < 0 || idx >= cols.length) {
    return fail(400, "senderColumn must be a valid column index");
  }

  // ---- which column holds the store ID ("Ref. 2") ----
  // Required, and never the same column as the package ID: the store ID is a second, independent
  // reference that every package must carry.
  const storeIdx = Number(b.storeColumn);
  if (!Number.isInteger(storeIdx) || storeIdx < 0 || storeIdx >= cols.length) {
    return fail(400, "storeColumn must be a valid column index");
  }
  if (storeIdx === idx) {
    return fail(400, "storeColumn must be a different column from senderColumn");
  }

  // ---- rows ----
  if (!Array.isArray(b.rows) || b.rows.length === 0) {
    return fail(400, "rows must be a non-empty array");
  }
  if (b.rows.length > MAX_ROWS) {
    return fail(413, `too many rows in one upload (max ${MAX_ROWS})`);
  }
  const rawRows = b.rows as unknown[][];
  const ragged = rawRows.findIndex((r) => !Array.isArray(r) || r.length !== cols.length);
  if (ragged >= 0) {
    // +2: one for the header row, one for 0-based indexing.
    return fail(400, `row ${ragged + 2} does not match the header (${cols.length} columns)`);
  }

  const records: ParsedRow[] = rawRows.map((r, i) => ({
    sourceRow: i + 2,
    sender: String(r[idx] ?? "").trim(),
    store: String(r[storeIdx] ?? "").trim(),
    cells: r.map((c) => String(c ?? "")),
  }));

  // A row without a package ID is not an error. Real sheets carry blank separator rows, sub-totals, notes
  // and footers, and refusing the whole file over them helps nobody. They are left out instead, and their
  // count is reported back so nothing is dropped in silence. The rows that ARE imported keep their
  // original sheet numbers, so `sourceRow` still points at the right line of the upload.
  const imported = records.filter((rec) => rec.sender !== "");
  if (imported.length === 0) {
    // Every row empty in the chosen column: that column is almost certainly the wrong one.
    return fail(
      400,
      `no package IDs in that column — all ${records.length} rows came out empty. Is it the right column?`
    );
  }

  // Longer than the column: reject here rather than let MySQL raise a 500.
  const tooLong = imported.filter((rec) => rec.sender.length > MAX_SENDER_ID_LENGTH);
  if (tooLong.length) {
    const sample = tooLong.slice(0, 5).map((x) => x.sourceRow).join(", ");
    return fail(
      400,
      `package ID is longer than ${MAX_SENDER_ID_LENGTH} characters on row(s): ${sample}${
        tooLong.length > 5 ? ", …" : ""
      }`
    );
  }

  // A store ID is required on every imported row. Unlike a blank package ID (a separator row), a
  // missing store ID means the operator picked the wrong column or the list is incomplete, so the row
  // is refused and names its own sheet line.
  const missingStore = imported.filter((rec) => rec.store === "");
  if (missingStore.length) {
    const sample = missingStore.slice(0, 5).map((x) => x.sourceRow).join(", ");
    return fail(
      400,
      `store ID is missing on row(s): ${sample}${missingStore.length > 5 ? ", …" : ""}`
    );
  }

  const storeTooLong = imported.filter((rec) => rec.store.length > MAX_STORE_ID_LENGTH);
  if (storeTooLong.length) {
    const sample = storeTooLong.slice(0, 5).map((x) => x.sourceRow).join(", ");
    return fail(
      400,
      `store ID is longer than ${MAX_STORE_ID_LENGTH} characters on row(s): ${sample}${
        storeTooLong.length > 5 ? ", …" : ""
      }`
    );
  }

  // ---- no duplicate package IDs inside this file (case-insensitive, like the DB) ----
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const rec of imported) {
    const key = rec.sender.toLowerCase();
    if (seen.has(key)) {
      if (!dupes.includes(rec.sender)) dupes.push(rec.sender);
    } else {
      seen.add(key);
    }
  }
  if (dupes.length) {
    return fail(
      400,
      `duplicate package IDs in this file: ${dupes.slice(0, 5).join(", ")}${
        dupes.length > 5 ? ", …" : ""
      }`
    );
  }

  const filename = b.filename ? String(b.filename).slice(0, 255) : null;
  return {
    ok: true,
    value: {
      filename,
      columns: cols,
      senderIndex: idx,
      storeIndex: storeIdx,
      records: imported,
      skipped: records.length - imported.length,
    },
  };
}
