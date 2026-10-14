// The sender ID a user types is matched against `packages.sender_id`, which is indexed with a
// case-insensitive collation — so only trimming is needed here. Kept dependency-free for tests.
export function normalizeSenderId(input: unknown): string {
  return String(input ?? "").trim();
}
