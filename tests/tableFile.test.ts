import { describe, expect, it } from "vitest";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPT_ATTRIBUTE,
  decodeSpreadsheetText,
  guessDelimiter,
  isDelimitedFile,
} from "../src/lib/tableFile";

const encodeUtf8 = (text: string) => new TextEncoder().encode(text);

/** Windows-1252 bytes for a short Spanish header — what an old Excel export actually contains. */
function windows1252(text: string): Uint8Array {
  const high: Record<string, number> = { "ó": 0xf3, "í": 0xed, "ñ": 0xf1, "Á": 0xc1 };
  return Uint8Array.from(
    [...text].map((char) => (char.charCodeAt(0) < 128 ? char.charCodeAt(0) : high[char]))
  );
}

describe("accepted formats", () => {
  it("offers the spreadsheet and delimited formats people actually export", () => {
    expect(ACCEPTED_EXTENSIONS).toContain(".xlsx");
    expect(ACCEPTED_EXTENSIONS).toContain(".csv");
    expect(ACCEPT_ATTRIBUTE).toBe(ACCEPTED_EXTENSIONS.join(","));
  });

  it("recognises the delimiter-separated ones", () => {
    expect(isDelimitedFile("lista.csv")).toBe(true);
    expect(isDelimitedFile("LISTA.CSV")).toBe(true);
    expect(isDelimitedFile("lista.tsv")).toBe(true);
    expect(isDelimitedFile("lista.xlsx")).toBe(false);
    expect(isDelimitedFile("lista.xls")).toBe(false);
  });
});

describe("decodeSpreadsheetText", () => {
  it("keeps UTF-8 accents intact", () => {
    expect(decodeSpreadsheetText(encodeUtf8("ID de envío;Dirección"))).toBe(
      "ID de envío;Dirección"
    );
  });

  it("falls back to Windows-1252 when the bytes are not UTF-8", () => {
    // The header an old Spanish Excel writes, which a UTF-8 decode would turn into mojibake.
    const decoded = decodeSpreadsheetText(windows1252("ID de envío;Dirección"));
    expect(decoded).toBe("ID de envío;Dirección");
  });

  it("drops a UTF-8 BOM so the first column keeps its name", () => {
    expect(decodeSpreadsheetText(encodeUtf8("\uFEFFID de envío"))).toBe("ID de envío");
  });
});

describe("guessDelimiter", () => {
  it("picks semicolons for a Spanish Excel CSV", () => {
    expect(guessDelimiter("ID de envío;Dirección;Ref. 2", "lista.csv")).toBe(";");
  });

  it("picks commas for a comma-separated file", () => {
    expect(guessDelimiter("sender,address,store", "lista.csv")).toBe(",");
  });

  it("picks tabs for a TSV regardless of its content", () => {
    expect(guessDelimiter("a\tb\tc", "lista.tsv")).toBe("\t");
    expect(guessDelimiter("a,b,c", "lista.tsv")).toBe("\t");
  });

  it("defaults to a comma for a single-column file", () => {
    expect(guessDelimiter("ID de envío", "lista.csv")).toBe(",");
  });
});
