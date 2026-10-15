import { describe, expect, it } from "vitest";
import { guessSenderColumn, normalize } from "../src/lib/senderColumn";

describe("normalize", () => {
  it("lowercases, trims and strips Spanish accents", () => {
    expect(normalize("  ID de ENVÍO  ")).toBe("id de envio");
    expect(normalize("Dirección")).toBe("direccion");
  });
});

describe("guessSenderColumn", () => {
  it("finds an exact English header", () => {
    expect(guessSenderColumn(["Date", "Sender ID", "City"])).toBe(1);
  });

  it("finds an accented Spanish header", () => {
    expect(guessSenderColumn(["Fecha", "ID de envío", "Tienda"])).toBe(1);
  });

  it("is case- and accent-insensitive", () => {
    expect(guessSenderColumn(["Ciudad", "ID DE ENVIO", "Notas"])).toBe(1);
  });

  it("prefers a specific hint over a generic one", () => {
    // "package" is a specific hint; "id" is generic, so the specific column wins.
    expect(guessSenderColumn(["Nombre", "id", "Package"])).toBe(2);
  });

  it("prefers an exact match over a substring match", () => {
    // "Sending notes" only matches via substring; "package" matches exactly.
    expect(guessSenderColumn(["Sending notes", "package"])).toBe(1);
  });

  it("falls back to a generic id column", () => {
    expect(guessSenderColumn(["Nombre", "id"])).toBe(1);
  });

  it("matches parcialmente a header like 'Envío ID'", () => {
    expect(guessSenderColumn(["Fecha", "Envío ID"])).toBe(1);
  });

  // Regression: a real Correos label sheet ("EtqVueltaC.xlsx") whose sender IDs live in "Ref. 1".
  // The old hint list only knew "sender"/"envío"/"id" and returned -1 for it.
  describe("a real Spanish label sheet", () => {
    const realHeaders = [
      "Ref. 1",
      "Ref. 2",
      "Ref. 3",
      "Nombre establecimiento",
      "Dirección",
      "Ciudad",
      "Código postal",
      "Provincia",
      "ATT.",
      "Telefono",
      "Email",
      "Observaciones",
      "Largo",
      "Ancho",
      "Alto",
      "Peso",
    ];

    it("picks 'Ref. 1' and not the other Ref. columns", () => {
      expect(guessSenderColumn(realHeaders)).toBe(0);
    });

    it("is not confused by the other columns in that sheet", () => {
      // None of these should ever be chosen over a Ref. column.
      for (const noise of ["Dirección", "Provincia", "Observaciones", "Peso"]) {
        expect(guessSenderColumn([noise, ...realHeaders])).toBe(1);
      }
    });
  });

  it("understands the shorthands Spanish carriers use", () => {
    expect(guessSenderColumn(["Fecha", "Nº de envío"])).toBe(1);
    expect(guessSenderColumn(["Fecha", "No de envio"])).toBe(1);
    expect(guessSenderColumn(["Albaran", "Cliente"])).toBe(0);
    expect(guessSenderColumn(["Nombre", "Nº seguimiento"])).toBe(1);
    expect(guessSenderColumn(["Referencia", "Ciudad"])).toBe(0);
  });

  it("returns -1 when nothing looks like a sender ID", () => {
    expect(guessSenderColumn(["Fecha", "Ciudad", "Notas"])).toBe(-1);
  });

  it("ignores blank headers", () => {
    expect(guessSenderColumn(["", "   ", ""])).toBe(-1);
  });

  it("returns -1 for an empty header row", () => {
    expect(guessSenderColumn([])).toBe(-1);
  });
});
