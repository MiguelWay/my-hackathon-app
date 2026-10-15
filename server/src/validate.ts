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
