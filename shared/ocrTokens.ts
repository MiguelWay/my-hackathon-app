// Pulls ID-shaped tokens out of OCR text.
//
// Shared by the server (which matches the tokens against the campaign's own IDs) and the browser
// (which uses them for a *new* ID that is not in the campaign yet). Keeping one implementation means
// both paths agree on what a readable ID looks like.
//
// Runs twice, once on the text as read and once with the whitespace removed, because OCR happily
// splits a single ID across a line break (`PQ987654321` / `ES`).

export function extractTokens(text: string, limit = 20): string[] {
  const pattern = /[A-Za-z0-9][A-Za-z0-9._\-/]{3,127}/g;
  const found = new Set<string>();
  for (const source of [text, text.replace(/\s+/g, "")]) {
    for (const match of source.match(pattern) ?? []) {
      const token = match.replace(/[._\-/]+$/, "");
      // A run of letters is a word; an ID almost always carries a digit or is long and mixed.
      if (token.length < 4) continue;
      if (!/\d/.test(token) && token.length < 8) continue;
      found.add(token);
    }
  }
  // Prefer tokens that look most like an ID: digits present, then longer.
  return [...found]
    .sort((a, b) => score(b) - score(a) || b.length - a.length)
    .slice(0, limit);
}

function score(token: string): number {
  let value = /\d/.test(token) ? 100 : 0;
  value += /^[A-Za-z]{2}\d{6,}[A-Za-z]{2}$/.test(token) ? 50 : 0;
  value += token.length >= 8 && token.length <= 20 ? 10 : 0;
  return value;
}
