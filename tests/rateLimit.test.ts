import { describe, expect, it } from "vitest";
import { hit, peek, prune, type Window } from "../server/src/rateLimit";

const fresh = () => new Map<string, Window>();

describe("peek", () => {
  it("does not consume budget", () => {
    const state = fresh();
    expect(peek(state, "a", 2, 1000, 0).remaining).toBe(2);
    expect(peek(state, "a", 2, 1000, 0).remaining).toBe(2);
    expect(state.size).toBe(0);
  });

  it("reports a fresh window after expiry", () => {
    const state = fresh();
    hit(state, "a", 1, 1000, 0);
    expect(peek(state, "a", 1, 1000, 500).allowed).toBe(false);
    expect(peek(state, "a", 1, 1000, 1000).allowed).toBe(true);
  });
});

describe("hit", () => {
  it("allows up to the max then blocks", () => {
    const state = fresh();
    for (let i = 1; i <= 3; i++) {
      expect(hit(state, "1.2.3.4", 3, 1000, 0).allowed).toBe(true);
    }
    const blocked = hit(state, "1.2.3.4", 3, 1000, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("counts down the remaining budget", () => {
    const state = fresh();
    expect(hit(state, "a", 5, 1000, 0).remaining).toBe(4);
    expect(hit(state, "a", 5, 1000, 0).remaining).toBe(3);
  });

  it("keeps separate counters per key", () => {
    const state = fresh();
    hit(state, "a", 2, 1000, 0);
    hit(state, "a", 2, 1000, 0);
    expect(peek(state, "a", 2, 1000, 0).allowed).toBe(false);
    expect(peek(state, "b", 2, 1000, 0).allowed).toBe(true);
  });

  it("resets once the window elapses", () => {
    const state = fresh();
    hit(state, "a", 1, 1000, 0);
    expect(peek(state, "a", 1, 1000, 500).allowed).toBe(false);
    expect(hit(state, "a", 1, 1000, 1000).allowed).toBe(true);
  });

  it("starts the window from the first hit and expires at the boundary", () => {
    const state = fresh();
    expect(hit(state, "a", 1, 1000, 0).resetAt).toBe(1000);
    expect(peek(state, "a", 1, 1000, 1001).allowed).toBe(true);
  });
});

describe("prune", () => {
  it("drops expired windows only", () => {
    const state = fresh();
    hit(state, "old", 1, 1000, 0);
    hit(state, "new", 1, 1000, 900);
    prune(state, 1000);
    expect([...state.keys()]).toEqual(["new"]);
  });

  it("empties the map once everything has expired", () => {
    const state = fresh();
    hit(state, "a", 1, 1000, 0);
    prune(state, 10_000);
    expect(state.size).toBe(0);
  });
});
