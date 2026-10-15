import { describe, expect, it } from "vitest";
import { MAX_ROWS, parseImportBody } from "../server/src/importValidation";

const valid = {
  filename: "envios.xlsx",
  columns: ["Fecha", "ID de envío"],
  senderColumn: 1,
  rows: [
    ["2026-04-01", "PQ1"],
    ["2026-04-02", "PQ2"],
  ],
};

describe("parseImportBody", () => {
  it("accepts a valid payload and numbers rows from the sheet (header is row 1)", () => {
    const res = parseImportBody(valid);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.filename).toBe("envios.xlsx");
    expect(res.value.columns).toEqual(["Fecha", "ID de envío"]);
    expect(res.value.senderIndex).toBe(1);
    expect(res.value.records).toEqual([
      { sourceRow: 2, sender: "PQ1", cells: ["2026-04-01", "PQ1"] },
      { sourceRow: 3, sender: "PQ2", cells: ["2026-04-02", "PQ2"] },
    ]);
  });

  it("keeps column names verbatim, including accents and order", () => {
    const res = parseImportBody({
      columns: ["Dirección", "Observación", "ID de envío"],
      senderColumn: 2,
      rows: [["Cádiz", "", "PQ9"]],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.columns).toEqual(["Dirección", "Observación", "ID de envío"]);
  });

  it("coerces null/undefined cells to empty strings", () => {
    const res = parseImportBody({
      columns: ["id", "b"],
      senderColumn: 0,
      rows: [["PQ1", null], ["PQ2", undefined]],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.records[0].cells).toEqual(["PQ1", ""]);
      expect(res.value.records[1].cells).toEqual(["PQ2", ""]);
    }
  });

  it("trims the sender ID", () => {
    const res = parseImportBody({ columns: ["id"], senderColumn: 0, rows: [["  PQ7  "]] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.records[0].sender).toBe("PQ7");
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
      parseImportBody({ columns: ["id", "id"], senderColumn: 0, rows: [["x", "y"]] })
    ).toMatchObject({ ok: false, status: 400, error: "duplicate column names are not supported" });
  });

  it("rejects an out-of-range senderColumn", () => {
    expect(parseImportBody({ ...valid, senderColumn: 5 })).toMatchObject({ ok: false, status: 400 });
    expect(parseImportBody({ ...valid, senderColumn: -1 })).toMatchObject({ ok: false, status: 400 });
    expect(parseImportBody({ ...valid, senderColumn: "1.5" })).toMatchObject({ ok: false });
  });

  it("rejects empty rows", () => {
    expect(parseImportBody({ ...valid, rows: [] })).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a row whose length does not match the header", () => {
    const res = parseImportBody({ ...valid, rows: [["2026-04-01", "PQ1"], ["2026-04-02"]] });
    expect(res).toMatchObject({
      ok: false,
      status: 400,
      error: "row 3 does not match the header (2 columns)",
    });
  });

  it("rejects blank package IDs and reports the sheet rows", () => {
    const res = parseImportBody({ ...valid, rows: [["a", "PQ1"], ["b", "   "], ["c", ""]] });
    expect(res).toMatchObject({
      ok: false,
      status: 400,
      error: "package ID is empty on row(s): 3, 4",
    });
  });

  it("rejects duplicate package IDs within the file, case-insensitively", () => {
    const res = parseImportBody({ ...valid, rows: [["a", "PQ1"], ["b", "pq1"]] });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toContain("duplicate package IDs in this file");
  });

  it("rejects more rows than the limit", () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => [String(i), `PQ${i}`]);
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
