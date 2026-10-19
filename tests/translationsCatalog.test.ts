import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCREEN_LABELS, translationCatalog } from "../shared/translations";

/** Every key the source asks for must exist in the catalog, or the screen would show the raw key. */
function sourceKeys(): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx)$/.test(file)) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(/\b(?:t|translate)\(\s*["']([^"']+)["']/g)) {
          keys.add(match[1]);
        }
      }
    }
  };
  walk(path.resolve(process.cwd(), "src"));
  return keys;
}

describe("the translation catalog", () => {
  it("has unique, complete entries for every screen", () => {
    const seen = new Set<string>();
    for (const entry of translationCatalog) {
      expect(entry.key).toMatch(/^[a-zA-Z]+\.[a-zA-Z0-9.]+$/);
      expect(seen.has(entry.key)).toBe(false);
      seen.add(entry.key);
      expect(entry.screen in SCREEN_LABELS).toBe(true);
      expect(["all", "administrator", "operator"]).toContain(entry.role);
      expect(entry.context.trim()).not.toBe("");
      expect(entry.english.trim()).not.toBe("");
      expect(entry.spanish.trim()).not.toBe("");
    }
  });

  it("contains every key the source asks for", () => {
    const catalog = new Set(translationCatalog.map((entry) => entry.key));
    const missing = [...sourceKeys()].filter((key) => !catalog.has(key));
    expect(missing).toEqual([]);

    // Built at runtime from the resend column number, so the regex cannot see them.
    for (const key of [
      "recent.resend1",
      "recent.resend2",
      "recent.resend3",
      "recent.resend4",
      "recent.resend5",
      "recent.resendN",
    ]) {
      expect(catalog.has(key)).toBe(true);
    }
  });
});
