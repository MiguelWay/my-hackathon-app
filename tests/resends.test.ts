import { describe, expect, it } from "vitest";
import { attemptNumber, chainRootId, parseResendBody } from "../server/src/resends";

describe("chainRootId", () => {
  it("returns the chain root for a resend", () => {
    expect(chainRootId({ id: 7, chain_id: 3 })).toBe(3);
  });

  it("treats a package with no chain_id as its own root", () => {
    expect(chainRootId({ id: 7, chain_id: null })).toBe(7);
  });
});

describe("attemptNumber", () => {
  const chain = [
    { id: 3, chain_id: null },
    { id: 7, chain_id: 3 },
    { id: 9, chain_id: 3 },
  ];

  it("numbers attempts from 1", () => {
    expect(attemptNumber(chain, 3)).toBe(1);
    expect(attemptNumber(chain, 7)).toBe(2);
    expect(attemptNumber(chain, 9)).toBe(3);
  });

  it("returns 0 when the package is not in the chain", () => {
    expect(attemptNumber(chain, 42)).toBe(0);
  });
});

describe("parseResendBody", () => {
  const valid = { packageId: 5, newSenderId: "PQ777000123ES", campaignId: 2 };

  it("accepts a valid body and trims the new sender ID", () => {
    const res = parseResendBody({ ...valid, newSenderId: "  PQ777000123ES  " });
    expect(res).toEqual({ ok: true, value: valid });
  });

  it("requires a packageId", () => {
    expect(parseResendBody({ ...valid, packageId: undefined })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(parseResendBody({ ...valid, packageId: 0 })).toMatchObject({ ok: false });
  });

  it("requires a new package ID", () => {
    expect(parseResendBody({ ...valid, newSenderId: "   " })).toMatchObject({
      ok: false,
      status: 400,
      error: "new package ID is required",
    });
  });

  it("requires a campaignId", () => {
    expect(parseResendBody({ ...valid, campaignId: null })).toMatchObject({ ok: false, status: 400 });
  });
});
