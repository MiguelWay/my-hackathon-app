import { describe, expect, it } from "vitest";
import { guessStoreColumn } from "../src/lib/storeColumn";

describe("guessStoreColumn", () => {
  it("finds the \"Ref. 2\" column used by Correos lists", () => {
    expect(guessStoreColumn(["Ref. 1", "Ref. 2", "Ref. 3"], 0)).toBe(1);
  });

  it("finds common English and Spanish store headers", () => {
    expect(guessStoreColumn(["Ref. 1", "Store ID", "City"], 0)).toBe(1);
    expect(guessStoreColumn(["Ref. 1", "ID tienda", "Ciudad"], 0)).toBe(1);
    expect(guessStoreColumn(["Ref. 1", "Código de tienda"], 0)).toBe(1);
  });

  it("never returns the package-ID column", () => {
    // Only one candidate, and it is already the sender column.
    expect(guessStoreColumn(["Ref. 1", "Fecha"], 0)).toBe(-1);
  });

  it("returns -1 when nothing looks like a store column", () => {
    expect(guessStoreColumn(["Fecha", "Ciudad", "Notas"], 0)).toBe(-1);
    expect(guessStoreColumn([], -1)).toBe(-1);
  });
});
