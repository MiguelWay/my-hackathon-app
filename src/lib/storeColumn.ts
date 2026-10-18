// Heuristic for picking the store-ID column out of an uploaded spreadsheet.
// Kept dependency-free so it can be unit-tested in isolation.

import { normalize } from "./senderColumn";

// Most-specific first. Real Correos lists label the store as "Ref. 2"; other customers call it
// "Store ID", "Tienda" or "Código de tienda". The package-ID guesser would happily match "ref", so
// this guesser runs separately and never returns the package-ID column.
export const STORE_HINTS = [
  "ref. 2",
  "ref 2",
  "ref2",
  "ref.2",
  "reference 2",
  "store id",
  "storeid",
  "store reference",
  "store code",
  "id tienda",
  "codigo tienda",
  "cod tienda",
  "ref tienda",
  "tienda",
  "store",
];

/**
 * Returns the index of the best store-ID column, or -1 if nothing matches.
 * `senderIndex` is never returned: the same column can never be both references.
 */
export function guessStoreColumn(headers: string[], senderIndex: number): number {
  let best = -1;
  let bestScore = 0;
  headers.forEach((h, i) => {
    if (i === senderIndex) return;
    const n = normalize(h);
    if (!n) return;
    let score = 0;
    const exact = STORE_HINTS.indexOf(n);
    if (exact >= 0) score = 100 - exact;
    else if (STORE_HINTS.some((hint) => n.includes(hint))) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
