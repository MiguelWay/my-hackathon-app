import { describe, expect, it } from "vitest";
import {
  buildExportLayout,
  cellFor,
  MANUAL_SENDER_HEADER,
  parseExtraColumns,
  resendOfMap,
  senderHeaderFor,
  type PackageLike,
} from "../server/src/exportLayout";

const pkg = (over: Partial<PackageLike> & { id: number }): PackageLike => ({
  upload_id: 1,
  sender_id: `S${over.id}`,
  extra_columns: {},
  chain_id: null,
  ...over,
});

describe("parseExtraColumns", () => {
  it("accepts an object (mysql2 JSON column)", () => {
    expect(parseExtraColumns({ a: "1" })).toEqual({ a: "1" });
  });
  it("accepts a JSON string", () => {
    expect(parseExtraColumns('{"a":"1"}')).toEqual({ a: "1" });
  });
  it("falls back to empty for junk", () => {
    expect(parseExtraColumns("not json")).toEqual({});
    expect(parseExtraColumns(null)).toEqual({});
    expect(parseExtraColumns(["a"])).toEqual(["a"]);
  });
});

describe("buildExportLayout", () => {
  it("keeps the original column order", () => {
    const layout = buildExportLayout(
      [{ id: 1, columns: ["Fecha", "ID de envío", "Dirección"] }],
      [pkg({ id: 1, extra_columns: { Fecha: "2026-04-01", Dirección: "Cádiz" } })]
    );
    expect(layout.columns).toEqual(["Fecha", "ID de envío", "Dirección"]);
  });

  it("detects the sender header as the one kept out of extra_columns, even when it is last", () => {
    const layout = buildExportLayout(
      [{ id: 7, columns: ["Fecha", "Dirección", "ID de envío"] }],
      [pkg({ id: 1, upload_id: 7, extra_columns: { Fecha: "x", Dirección: "y" } })]
    );
    expect(layout.senderHeaderByUpload[7]).toBe("ID de envío");
  });

  it("handles an upload whose only column is the sender ID", () => {
    const layout = buildExportLayout(
      [{ id: 1, columns: ["ID"] }],
      [pkg({ id: 1, extra_columns: {} })]
    );
    expect(layout.senderHeaderByUpload[1]).toBe("ID");
  });

  it("merges several uploads into one ordered, de-duplicated header row", () => {
    const layout = buildExportLayout(
      [
        { id: 1, columns: ["Fecha", "ID"] },
        { id: 2, columns: ["Fecha", "ID", "Tienda"] },
      ],
      []
    );
    expect(layout.columns).toEqual(["Fecha", "ID", "Tienda"]);
  });

  it("borrows an uploaded sender header for hand-typed rows", () => {
    const layout = buildExportLayout(
      [{ id: 1, columns: ["Fecha", "ID de envío"] }],
      [pkg({ id: 1, extra_columns: { Fecha: "x" } }), pkg({ id: 2, upload_id: null })]
    );
    expect(layout.manualSenderHeader).toBe("ID de envío");
    expect(senderHeaderFor(pkg({ id: 2, upload_id: null }), layout)).toBe("ID de envío");
  });

  it("falls back to a Sender ID header when the campaign has no uploads at all", () => {
    const layout = buildExportLayout([], [pkg({ id: 1, upload_id: null })]);
    expect(layout.columns).toEqual([]);
    expect(layout.manualSenderHeader).toBe(MANUAL_SENDER_HEADER);
  });
});

describe("cellFor", () => {
  const layout = buildExportLayout(
    [{ id: 1, columns: ["Fecha", "ID de envío"] }],
    [pkg({ id: 1, extra_columns: { Fecha: "2026-04-01" } })]
  );
  const row = pkg({ id: 1, sender_id: "PQ1", extra_columns: { Fecha: "2026-04-01" } });

  it("puts the sender ID under the sender header", () => {
    expect(cellFor(row, "ID de envío", layout)).toBe("PQ1");
  });
  it("puts other values under their own header", () => {
    expect(cellFor(row, "Fecha", layout)).toBe("2026-04-01");
  });
  it("returns blank for a column this row does not have", () => {
    expect(cellFor(row, "Tienda", layout)).toBe("");
  });
});

describe("resendOfMap", () => {
  it("links each resend to the attempt it replaced", () => {
    const map = resendOfMap([
      { id: 3, chain_id: null, sender_id: "A", upload_id: 1, extra_columns: {} },
      { id: 8, chain_id: 3, sender_id: "B", upload_id: null, extra_columns: {} },
      { id: 9, chain_id: 3, sender_id: "C", upload_id: null, extra_columns: {} },
    ]);
    expect(map).toEqual({ 8: "A", 9: "B" });
  });

  it("leaves a chain of one alone", () => {
    const map = resendOfMap([
      { id: 1, chain_id: null, sender_id: "A", upload_id: 1, extra_columns: {} },
    ]);
    expect(map).toEqual({});
  });

  it("orders members by id regardless of input order", () => {
    const map = resendOfMap([
      { id: 9, chain_id: 3, sender_id: "C", upload_id: null, extra_columns: {} },
      { id: 3, chain_id: null, sender_id: "A", upload_id: 1, extra_columns: {} },
    ]);
    expect(map).toEqual({ 9: "A" });
  });
});
