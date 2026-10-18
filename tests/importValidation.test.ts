import { describe, expect, it } from "vitest";
import { MAX_ROWS, parseImportBody } from "../server/src/importValidation";

const valid = {
  filename: "envios.xlsx",
  columns: ["Fecha", "ID de envío", "Ref. 2"],
  senderColumn: 1,
  storeColumn: 2,
  rows: [
    ["2026-04-01", "PQ1", "STORE1"],
    ["2026-04-02", "PQ2", "STORE2"],
  ],
};

describe("parseImportBody", () => {
  it("accepts a valid payload and numbers rows from the sheet (header is row 1)", () => {
    const res = parseImportBody(valid);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.filename).toBe("envios.xlsx");
    expect(res.value.columns).toEqual(["Fecha", "ID de envío", "Ref. 2"]);
    expect(res.value.senderIndex).toBe(1);
    expect(res.value.storeIndex).toBe(2);
    expect(res.value.records).toEqual([
      { sourceRow: 2, sender: "PQ1", store: "STORE1", cells: ["2026-04-01", "PQ1", "STORE1"] },
      { sourceRow: 3, sender: "PQ2", store: "STORE2", cells: ["2026-04-02", "PQ2", "STORE2"] },
    ]);
  });

  it("keeps column names verbatim, including accents and order", () => {
    const res = parseImportBody({
      columns: ["Dirección", "Observación", "ID de envío", "Ref. 2"],
      senderColumn: 2,
      storeColumn: 3,
      rows: [["Cádiz", "", "PQ9", "STORE9"]],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.columns).toEqual(["Dirección", "Observación", "ID de envío", "Ref. 2"]);
    }
  });

  it("coerces null/undefined cells to empty strings", () => {
    const res = parseImportBody({
      columns: ["id", "Ref. 2", "b"],
      senderColumn: 0,
      storeColumn: 1,
      rows: [
        ["PQ1", "STORE1", null],
        ["PQ2", "STORE2", undefined],
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.records[0].cells).toEqual(["PQ1", "STORE1", ""]);
      expect(res.value.records[1].cells).toEqual(["PQ2", "STORE2", ""]);
    }
  });

  it("trims the sender and store IDs", () => {
    const res = parseImportBody({
      columns: ["id", "Ref. 2"],
      senderColumn: 0,
      storeColumn: 1,
      rows: [["  PQ7  ", "  STORE7  "]],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.records[0].sender).toBe("PQ7");
      expect(res.value.records[0].store).toBe("STORE7");
    }
  });

  it("rejects a missing/empty columns array", () => {
    expect(parseImportBody({ columns: [], senderColumn: 0, rows: [["x"]] })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(parseImportBody({ senderColumn: 0, rows: [["x"]] })).toMatchObject({ ok: false });
  });

  it("rejects duplicate column names", () => {
    expect(
      parseImportBody({
        columns: ["id", "id"],
        senderColumn: 0,
        storeColumn: 1,
        rows: [["x", "y"]],
      })
    ).toMatchObject({ ok: false, status: 400, error: "duplicate column names are not supported" });
  });

  it("rejects an out-of-range senderColumn", () => {
    expect(parseImportBody({ ...valid, senderColumn: 5 })).toMatchObject({ ok: false, status: 400 });
    expect(parseImportBody({ ...valid, senderColumn: -1 })).toMatchObject({ ok: false, status: 400 });
    expect(parseImportBody({ ...valid, senderColumn: "1.5" })).toMatchObject({ ok: false });
  });

  it("requires a valid storeColumn", () => {
    expect(parseImportBody({ ...valid, storeColumn: undefined })).toMatchObject({
      ok: false,
      status: 400,
      error: "storeColumn must be a valid column index",
    });
    expect(parseImportBody({ ...valid, storeColumn: 5 })).toMatchObject({ ok: false, status: 400 });
    expect(parseImportBody({ ...valid, storeColumn: -1 })).toMatchObject({ ok: false, status: 400 });
    expect(parseImportBody({ ...valid, storeColumn: "2.5" })).toMatchObject({ ok: false });
  });

  it("refuses the same column as both package ID and store ID", () => {
    expect(parseImportBody({ ...valid, storeColumn: 1 })).toMatchObject({
      ok: false,
      status: 400,
      error: "storeColumn must be a different column from senderColumn",
    });
  });

  it("rejects empty rows", () => {
    expect(parseImportBody({ ...valid, rows: [] })).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a row whose length does not match the header", () => {
    const res = parseImportBody({
      ...valid,
      rows: [
        ["2026-04-01", "PQ1", "STORE1"],
        ["2026-04-02", "PQ2"],
      ],
    });
    expect(res).toMatchObject({
      ok: false,
      status: 400,
      error: "row 3 does not match the header (3 columns)",
    });
  });

  it("leaves rows with no package ID out of the import, and counts them", () => {
    // A sheet's blank separator rows, notes and footers are not packages, and they no longer block the
    // upload. The rows that are imported keep their sheet numbers, so one still points at its own line.
    const res = parseImportBody({
      ...valid,
      rows: [
        ["a", "PQ1", "S1"],
        ["b", "   ", "S2"],
        ["c", "", "S3"],
        ["d", "PQ2", "S4"],
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.skipped).toBe(2);
    expect(res.value.records.map((r) => [r.sourceRow, r.sender])).toEqual([
      [2, "PQ1"],
      [5, "PQ2"],
    ]);
  });

  it("refuses a row with a package ID but no store ID, naming its sheet line", () => {
    const res = parseImportBody({
      ...valid,
      rows: [
        ["a", "PQ1", "S1"],
        ["b", "PQ2", "   "],
        ["c", "PQ3", "S3"],
      ],
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toBe("store ID is missing on row(s): 3");
  });

  it("refuses a chosen column that is empty on every row — that is the wrong column", () => {
    const res = parseImportBody({
      ...valid,
      rows: [
        ["a", "", "S1"],
        ["b", "  ", "S2"],
      ],
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toContain("no package IDs in that column");
  });

  it("rejects an over-long store ID with the row number", () => {
    const res = parseImportBody({
      ...valid,
      rows: [["a", "PQ1", "S".repeat(200)]],
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toContain("store ID is longer than 128 characters on row(s): 2");
  });

  it("rejects duplicate package IDs within the file, case-insensitively", () => {
    const res = parseImportBody({
      ...valid,
      rows: [
        ["a", "PQ1", "S1"],
        ["b", "pq1", "S2"],
      ],
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toContain("duplicate package IDs in this file");
  });

  it("rejects more rows than the limit", () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => [String(i), `PQ${i}`, `S${i}`]);
    expect(parseImportBody({ ...valid, rows })).toMatchObject({ ok: false, status: 413 });
  });

  it("caps the filename at 255 characters and defaults it to null", () => {
    const long = parseImportBody({ ...valid, filename: "x".repeat(400) });
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.value.filename).toHaveLength(255);

    const none = parseImportBody({ ...valid, filename: undefined });
    if (none.ok) expect(none.value.filename).toBeNull();
  });
});
