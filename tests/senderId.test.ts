import { describe, expect, it } from "vitest";
import { normalizeSenderId } from "../server/src/senderId";

describe("normalizeSenderId", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSenderId("  PQ987654321ES  ")).toBe("PQ987654321ES");
    expect(normalizeSenderId("\tPQ1\n")).toBe("PQ1");
  });

  it("keeps the value otherwise untouched (case and inner characters)", () => {
    expect(normalizeSenderId("pq987-654_321")).toBe("pq987-654_321");
  });

  it("treats whitespace-only and missing values as empty", () => {
    expect(normalizeSenderId("   ")).toBe("");
    expect(normalizeSenderId("")).toBe("");
    expect(normalizeSenderId(null)).toBe("");
    expect(normalizeSenderId(undefined)).toBe("");
  });

  it("coerces non-string input", () => {
    expect(normalizeSenderId(123456)).toBe("123456");
  });
});
