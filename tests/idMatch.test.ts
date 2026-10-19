import { describe, expect, it } from "vitest";
import {
  bestMatch,
  distanceForLength,
  extractTokens,
  idDistance,
  normalizeId,
} from "../server/src/idMatch";

const CAMPAIGN = ["PQ987654321ES", "PQ987654322ES", "PQ111111111ES", "PQ222222222ES"];

describe("normalizeId", () => {
  it("folds case and drops whitespace and separators", () => {
    expect(normalizeId("pq-987.654 321/es")).toBe("PQ987654321ES");
    expect(normalizeId("  PQ987654321ES ")).toBe("PQ987654321ES");
  });
});

describe("idDistance", () => {
  it("is zero for the same ID written differently", () => {
    expect(idDistance("pq987654321es", "PQ987654321ES", 2)).toBe(0);
    expect(idDistance("PQ987-654-321-ES", "PQ987654321ES", 2)).toBe(0);
  });

  it("treats routinely confused characters as free", () => {
    // O/Q/D read as 0, I/L as 1, S as 5, B as 8, Z as 2.
    expect(idDistance("PQ98765432IES", "PQ987654321ES", 2)).toBe(0);
    expect(idDistance("PQ98765432lES", "PQ987654321ES", 2)).toBe(0);
    expect(idDistance("PQS87654321ES", "PQ587654321ES", 2)).toBe(0);
    expect(idDistance("PQ98765432BES", "PQ987654328ES", 2)).toBe(0);
    expect(idDistance("PQ98765432ZES", "PQ987654322ES", 2)).toBe(0);
  });

  it("counts a dropped or doubled character as one edit", () => {
    expect(idDistance("PQ98765432ES", "PQ987654321ES", 2)).toBe(1);
    expect(idDistance("PQ9876543211ES", "PQ987654321ES", 2)).toBe(1);
  });

  it("counts a genuinely different character as one edit", () => {
    expect(idDistance("PQ987654321EX", "PQ987654321ES", 2)).toBe(1);
  });

  it("gives up above the cap", () => {
    expect(idDistance("PQ111111111ES", "PQ987654321ES", 2)).toBe(3);
    expect(idDistance("PQ987654321ES", "XX", 2)).toBe(3);
  });
});

describe("distanceForLength", () => {
  it("is strict with short IDs and lenient with long ones", () => {
    expect(distanceForLength(4)).toBe(0);
    expect(distanceForLength(6)).toBe(1);
    expect(distanceForLength(13)).toBe(2);
  });
});

describe("bestMatch", () => {
  it("finds the exact ID, ignoring case", () => {
    const result = bestMatch(["pq987654321es"], CAMPAIGN);
    expect(result.senderId).toBe("PQ987654321ES");
    expect(result.distance).toBe(0);
    expect(result.ambiguous).toBe(false);
  });

  it("recovers an ID with two confused characters", () => {
    const result = bestMatch(["PQ98765432IES"], CAMPAIGN);
    expect(result.senderId).toBe("PQ987654321ES");
    expect(result.distance).toBe(0);
  });

  it("corrects a dropped character", () => {
    const result = bestMatch(["PQ98765432ES"], ["PQ987654321ES", "PQ111111111ES"]);
    expect(result.senderId).toBe("PQ987654321ES");
    expect(result.distance).toBe(1);
  });

  it("asks instead of guessing when a dropped character fits two consecutive IDs", () => {
    // One missing digit sits one edit from both ...321ES and ...322ES: the operator has to say which.
    const result = bestMatch(["PQ98765432ES"], CAMPAIGN);
    expect(result.senderId).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.alternatives.map((a) => a.senderId)).toEqual([
      "PQ987654321ES",
      "PQ987654322ES",
    ]);
  });

  it("picks the ID the OCR text is closest to when the label shows several words", () => {
    const result = bestMatch(["Calle", "Sol", "1", "PQ98765432IES", "28001"], CAMPAIGN);
    expect(result.senderId).toBe("PQ987654321ES");
  });

  it("refuses to guess when two IDs are equally close", () => {
    const result = bestMatch(["PQ98765432XES"], ["PQ987654321ES", "PQ987654322ES"]);
    expect(result.senderId).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.alternatives.map((a) => a.senderId)).toEqual([
      "PQ987654321ES",
      "PQ987654322ES",
    ]);
  });

  it("returns nothing when every candidate is too far away", () => {
    const result = bestMatch(["ZZ000000000ZZ"], CAMPAIGN);
    expect(result.senderId).toBeNull();
    expect(result.distance).toBe(-1);
    expect(result.ambiguous).toBe(false);
    expect(result.alternatives).toEqual([]);
  });

  it("ignores empty tokens but still matches the useful one", () => {
    const result = bestMatch(["", "   ", "PQ111111111ES"], CAMPAIGN);
    expect(result.senderId).toBe("PQ111111111ES");
  });

  it("is exact-only for very short IDs", () => {
    expect(bestMatch(["AB12"], ["AB12", "AB13"]).senderId).toBe("AB12");
    expect(bestMatch(["AB13"], ["AB12"]).senderId).toBeNull();
  });
});

describe("extractTokens", () => {
  it("keeps ID-shaped runs and drops ordinary words", () => {
    const tokens = extractTokens("Calle Sol 1, Cádiz 28001 PQ987654321ES urgente");
    expect(tokens).toContain("PQ987654321ES");
    expect(tokens).toContain("28001");
    expect(tokens).not.toContain("Calle");
  });

  it("rejoins an ID split across a line break", () => {
    expect(extractTokens("PQ987654321\nES")).toContain("PQ987654321ES");
  });

  it("ranks the ID-like token first", () => {
    expect(extractTokens("28001 PQ987654321ES Calle")[0]).toBe("PQ987654321ES");
  });

  it("caps the list", () => {
    const text = Array.from({ length: 40 }, (_, i) => `AB${100000 + i}ES`).join(" ");
    expect(extractTokens(text, 5)).toHaveLength(5);
  });
});
