// Heuristics for picking the sender-ID column out of an uploaded spreadsheet.
// Kept dependency-free so it can be unit-tested in isolation.

// Most-specific first; an exact header match scores highest, earlier hints win.
export const SENDER_HINTS = [
  "sender id",
  "sending id",
  "senderid",
  "sendingid",
  "id de envio",
  "id envio",
  "paquete",
  "package",
  "envio",
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
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Returns the index of the best sender-ID column, or -1 if nothing matches.
 * Column names are never altered by the app; this only chooses which one holds
 * the Correos sender ID.
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
