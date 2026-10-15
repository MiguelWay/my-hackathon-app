// Heuristics for picking the sender-ID column out of an uploaded spreadsheet.
// Kept dependency-free so it can be unit-tested in isolation.

// Most-specific first; an exact header match scores highest, earlier hints win.
// Real-world Correos lists label the sender ID in many ways: "Ref. 1", "Nº de envío",
// "Albarán", "Seguimiento", ... so the list covers the common Spanish shorthands too.
export const SENDER_HINTS = [
  "sender id",
  "sending id",
  "senderid",
  "sendingid",
  "num seguimiento",
  "n seguimiento",
  "seguimiento",
  "tracking number",
  "tracking",
  "id de envio",
  "id envio",
  "n de envio",
  "num envio",
  "numero de envio",
  "envio",
  "referencia",
  "ref",
  "albaran",
  "expedicion",
  "etiqueta",
  "bulto",
  "paquete",
  "package",
  "sender",
  "sending",
  "id",
];

export function normalize(s: string): string {
  return s
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Ordinal markers, so "Nº de envío" and "No de envio" collapse to the same thing.
    .replace(/[\u00ba\u00aa]/g, "");
}

/**
 * Returns the index of the best sender-ID column, or -1 if nothing matches.
 * Column names are never altered by the app; this only chooses which one holds the Correos sender ID.
 * The user always confirms, so the goal is to save a click in the common cases, not to be clever.
 */
export function guessSenderColumn(headers: string[]): number {
  let best = -1;
  let bestScore = 0;
  headers.forEach((h, i) => {
    const n = normalize(h);
    if (!n) return;
    let score = 0;
    const idx = SENDER_HINTS.indexOf(n);
    if (idx >= 0) score = 100 - idx;
    else if (SENDER_HINTS.some((hint) => n.includes(hint))) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
