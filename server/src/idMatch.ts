// Recovering a package ID from OCR text.
//
// Reading a short printed token with a camera is lossy, and the loss is predictable: `0/O/Q`,
// `1/I/L`, `2/Z`, `5/S`, `8/B`, `6/G`, `4/A` and `U/V` swap places, separators disappear, and a
// character is dropped or doubled. Comparing that string to the campaign's own ID list and accepting
// a candidate only when it is both close AND unambiguous turns frequent character errors into a
// correct lookup instead of a "no match" dead end.
//
// Everything here is pure so the rules can be unit-tested without a database (tests/idMatch.test.ts).

// Token extraction lives in `shared/` because the browser also uses it, for a new ID that cannot be
// matched against the campaign yet. Re-exported here so the matching API stays in one module.
export { extractTokens } from "../../shared/ocrTokens";

export interface Candidate {
  senderId: string;
  distance: number;
}

export interface MatchResult {
  /** The accepted ID, or null when nothing was close enough or the closest ones tie. */
  senderId: string | null;
  /** Distance of the best candidate found (0 for an exact hit); -1 when there were none. */
  distance: number;
  /** Other IDs within the threshold, closest first — shown to the user when the choice is ambiguous. */
  alternatives: Candidate[];
  /** True when at least one candidate was close enough but more than one shared that distance. */
  ambiguous: boolean;
}

/** Characters an OCR engine routinely swaps for one another. */
const CONFUSION_GROUPS = ["0OQD", "1IL", "2Z", "4A", "5S", "6G", "8B", "UV"];

const CONFUSION_CLASS = (() => {
  const map = new Map<string, number>();
  CONFUSION_GROUPS.forEach((group, index) => {
    for (const char of group) map.set(char, index);
  });
  return map;
})();

/** Upper-cases and drops whitespace/separators: `pq-987 654.es` and `PQ987654ES` compare equal. */
export function normalizeId(value: string): string {
  return value.toUpperCase().replace(/[\s._\-/]+/g, "");
}

/** Two characters cost nothing to swap when the OCR engine cannot tell them apart. */
function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  const left = CONFUSION_CLASS.get(a);
  const right = CONFUSION_CLASS.get(b);
  return left !== undefined && left === right ? 0 : 1;
}

/**
 * Levenshtein distance with confusion-aware substitutions, capped at `max`.
 *
 * Returns `max + 1` as soon as the distance cannot come in under the cap, so comparing one OCR token
 * against thousands of IDs stays cheap. Inputs are assumed already normalised.
 */
function distanceNormalized(left: string, right: string, max: number): number {
  if (Math.abs(left.length - right.length) > max) return max + 1;
  if (left === right) return 0;

  const cap = max + 1;
  let previous = new Array<number>(right.length + 1);
  let current = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = substitutionCost(left[i - 1], right[j - 1]);
      current[j] = Math.min(
        previous[j] + 1, // delete
        current[j - 1] + 1, // insert
        previous[j - 1] + cost // substitute
      );
      if (current[j] < rowMin) rowMin = current[j];
    }
    // Every remaining row can only add to the cost, so an over-budget row means no match.
    if (rowMin > max) return cap;
    [previous, current] = [current, previous];
  }
  return Math.min(previous[right.length], cap);
}

/** The same distance, taking raw strings. */
export function idDistance(a: string, b: string, max: number): number {
  return distanceNormalized(normalizeId(a), normalizeId(b), max);
}

/**
 * How many edits to tolerate, by ID length. Short IDs are compared strictly: at 4 characters, two
 * edits would match most of the campaign.
 */
export function distanceForLength(length: number): number {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

export interface MatchOptions {
  /** Overrides the automatic threshold. Mainly for tests. */
  maxDistance?: number;
  /** How many runner-up IDs to return. */
  alternatives?: number;
}

/**
 * Picks the campaign ID an OCR token most likely stands for.
 *
 * The token set is everything the OCR engine saw (a label also carries addresses, weights and
 * dates), so each token is scored against every candidate and the best pair wins. A result is only
 * accepted when one ID is strictly closer than the rest; ties are returned as alternatives for a
 * human to settle, because silently picking one would record a return against the wrong package.
 */
export function bestMatch(
  tokens: string[],
  candidates: string[],
  options: MatchOptions = {}
): MatchResult {
  const limit = options.alternatives ?? 3;
  const cleaned = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))];

  // Normalise once: a campaign can hold 20,000 IDs and every token is compared with each of them.
  const normalizedCandidates = candidates.map((candidate) => ({
    senderId: candidate,
    normalized: normalizeId(candidate),
  }));

  let best: Candidate | null = null;
  const close = new Map<string, number>();

  for (const token of cleaned) {
    const normalizedToken = normalizeId(token);
    const max = options.maxDistance ?? distanceForLength(normalizedToken.length);
    if (max === 0) {
      // Exact hits only: no distance work at all.
      for (const candidate of normalizedCandidates) {
        if (candidate.normalized === normalizedToken && !close.has(candidate.senderId)) {
          close.set(candidate.senderId, 0);
        }
      }
      continue;
    }
    for (const candidate of normalizedCandidates) {
      const distance = distanceNormalized(normalizedToken, candidate.normalized, max);
      if (distance > max) continue;
      const known = close.get(candidate.senderId);
      if (known === undefined || distance < known) close.set(candidate.senderId, distance);
    }
  }

  for (const [senderId, distance] of close) {
    if (!best || distance < best.distance || (distance === best.distance && senderId < best.senderId)) {
      best = { senderId, distance };
    }
  }

  if (!best) return { senderId: null, distance: -1, alternatives: [], ambiguous: false };

  const alternatives = [...close.entries()]
    .filter(([senderId]) => senderId !== best!.senderId)
    .map(([senderId, distance]) => ({ senderId, distance }))
    .sort((a, b) => a.distance - b.distance || a.senderId.localeCompare(b.senderId))
    .slice(0, limit);

  const ambiguous = alternatives.some((entry) => entry.distance === best!.distance);

  return {
    // A tie means we do not know which box is in the operator's hand: let them choose.
    senderId: ambiguous ? null : best.senderId,
    distance: best.distance,
    alternatives: ambiguous ? [{ senderId: best.senderId, distance: best.distance }, ...alternatives]
      .sort((a, b) => a.distance - b.distance || a.senderId.localeCompare(b.senderId))
      .slice(0, limit) : alternatives,
    ambiguous,
  };
}
