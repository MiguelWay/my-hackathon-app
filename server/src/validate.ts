// Boundary validation helpers. Pure so they can be unit-tested, and shared by every route that
// accepts user input so the limits stay consistent with the schema widths.

/** Matches `packages.sender_id` (VARCHAR(128)). */
export const MAX_SENDER_ID_LENGTH = 128;
/** Matches the VARCHAR(255) name columns. */
export const MAX_NAME_LENGTH = 255;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NOTE_LENGTH = 500;
export const MIN_PASSWORD_LENGTH = 8;
/**
 * bcrypt only reads the first 72 bytes and hashing is deliberately CPU-bound, so an unbounded
 * password would let one request burn an arbitrary amount of CPU (a cheap DoS).
 */
export const MAX_PASSWORD_LENGTH = 100;

// Deliberately permissive: the goal is to reject junk, not to argue with RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const email = value.trim();
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

/** Trimmed value when it is a non-empty string of at most `max` characters, else null. */
export function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** Returns a user-facing problem description, or null when the password is acceptable. */
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

/**
 * An optional positive integer from a query string or query parameter: `undefined` when it is absent
 * or empty, `null` when it is present but not a positive whole number.
 */
export function optionalPositiveInt(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts a `YYYY-MM-DD` string and returns it, or null when it is missing or not a real calendar
 * date (`2026-02-31` and `2026-13-01` are rejected, not silently rolled over).
 */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return roundTrips ? value : null;
}
