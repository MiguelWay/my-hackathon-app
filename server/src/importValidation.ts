// Validation + normalisation for a campaign-list import payload.
// Pure (no DB, no Express) so the many failure branches can be unit-tested.

export const MAX_ROWS = 20_000;

export interface ParsedRow {
  sourceRow: number; // 1-based row in the source file (row 1 is the header)
  sender: string;
  cells: string[];
}

export interface ParsedImport {
  filename: string | null;
  columns: string[];
  senderIndex: number;
  records: ParsedRow[];
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
    cells: r.map((c) => String(c ?? "")),
  }));

  const blank = records.filter((rec) => !rec.sender);
  if (blank.length) {
    const sample = blank.slice(0, 5).map((x) => x.sourceRow).join(", ");
    return fail(400, `sender ID is empty on row(s): ${sample}${blank.length > 5 ? ", …" : ""}`);
  }

  // ---- no duplicate sender IDs inside this file (case-insensitive, like the DB) ----
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const rec of records) {
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
      `duplicate sender IDs in this file: ${dupes.slice(0, 5).join(", ")}${
        dupes.length > 5 ? ", …" : ""
      }`
    );
  }

  const filename = b.filename ? String(b.filename).slice(0, 255) : null;
  return { ok: true, value: { filename, columns: cols, senderIndex: idx, records } };
}
