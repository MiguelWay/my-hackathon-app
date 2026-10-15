import { describe, expect, it } from "vitest";
import {
  boundedString,
  isValidEmail,
  MAX_PASSWORD_LENGTH,
  parseIsoDate,
  passwordProblem,
} from "../server/src/validate";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("admin@acme.test")).toBe(true);
    expect(isValidEmail("  a.b+tag@sub.example.co.uk  ")).toBe(true);
  });

  it("rejects junk and non-strings", () => {
    for (const bad of ["", "  ", "no-at-sign", "a@b", "a b@c.com", "@x.com", "x@.com", "x@y."]) {
      expect(isValidEmail(bad)).toBe(false);
    }
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });

  it("rejects addresses longer than the column allows", () => {
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("boundedString", () => {
  it("trims and returns a valid value", () => {
    expect(boundedString("  Acme Retail  ", 255)).toBe("Acme Retail");
  });

  it("rejects empty, over-long and non-string values", () => {
    expect(boundedString("   ", 255)).toBeNull();
    expect(boundedString("", 255)).toBeNull();
    expect(boundedString("x".repeat(256), 255)).toBeNull();
    expect(boundedString(123, 255)).toBeNull();
  });

  it("enforces the boundary exactly", () => {
    expect(boundedString("x".repeat(255), 255)).toHaveLength(255);
    expect(boundedString("x".repeat(128), 128)).toHaveLength(128);
  });
});

describe("passwordProblem", () => {
  it("accepts a reasonable password", () => {
    expect(passwordProblem("correct horse battery staple")).toBeNull();
  });

  it("rejects short passwords", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("")).toMatch(/at least 8/);
    expect(passwordProblem(null)).toMatch(/at least 8/);
  });

  it("rejects over-long passwords (bcrypt CPU DoS)", () => {
    expect(passwordProblem("x".repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(/at most 100/);
  });

  it("accepts exactly the maximum length", () => {
    expect(passwordProblem("x".repeat(MAX_PASSWORD_LENGTH))).toBeNull();
  });
});

describe("parseIsoDate", () => {
  it("accepts real dates", () => {
    expect(parseIsoDate("2026-03-01")).toBe("2026-03-01");
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-00-10")).toBeNull();
    expect(parseIsoDate("2023-02-29")).toBeNull();
  });

  it("rejects wrong shapes and non-strings", () => {
    for (const bad of ["", "  ", "01-03-2026", "2026-3-1", "2026/03/01", "yesterday"]) {
      expect(parseIsoDate(bad)).toBeNull();
    }
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });
});
