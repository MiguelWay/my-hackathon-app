// Reading an uploaded list that is not an .xlsx.
//
// The browser picker and the decoder are separate concerns, and both used to be wrong for the files
// people actually export: Google Sheets and most ERPs hand out CSV, and older Spanish Excel exports
// are CSV in Windows-1252 with semicolons. SheetJS parses CSV happily, but only if it gets text
// (not bytes) and the right field separator.
//
// Kept dependency-free so it can be unit-tested (tests/tableFile.test.ts).

/** Extensions the file picker accepts. `accept` hides anything else in the OS dialog entirely. */
export const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".csv", ".tsv"];

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",");

/** True for the delimiter-separated formats that must be decoded as text. */
export function isDelimitedFile(name: string): boolean {
  return /\.(csv|tsv)$/i.test(name);
}

/**
 * Decodes a spreadsheet file to text.
 *
 * UTF-8 first (what every current exporter writes). If that produces replacement characters the
 * file was not UTF-8 — typically an old Windows-1252 CSV from Spanish Excel — so decode it that way
 * instead. A leading BOM is dropped so the first column keeps its name.
 */
export function decodeSpreadsheetText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const text = utf8.includes("\uFFFD")
    ? new TextDecoder("windows-1252").decode(bytes)
    : utf8;
  return text.replace(/^\uFEFF/, "");
}

/**
 * Picks the field separator by counting candidates in the header line.
 *
 * Semicolon wins in Spanish Excel (`a;b;c`), tab in TSV, comma elsewhere. Quoted delimiters are not
 * special-cased: a header line with more quoted commas than real separators is not a thing.
 */
export function guessDelimiter(text: string, name: string): string {
  if (/\.tsv$/i.test(name)) return "\t";
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: [string, number][] = [
    [";", (firstLine.match(/;/g) ?? []).length],
    ["\t", (firstLine.match(/\t/g) ?? []).length],
    [",", (firstLine.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  // No separator at all: a single-column list. Any value works; comma is SheetJS's default.
  return counts[0][1] === 0 ? "," : counts[0][0];
}
