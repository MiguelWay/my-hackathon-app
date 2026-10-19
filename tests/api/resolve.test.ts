import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closePool,
  newClient,
  resetDatabase,
  seedUser,
  startServer,
  type Client,
  type TestServer,
} from "./helpers";

// POST /returns/resolve turns the text an OCR read of a label produced into one of the campaign's
// package IDs. The matching rules themselves are unit-tested in tests/idMatch.test.ts; this file
// covers the endpoint: auth, scoping, validation and the shape the SPA consumes.

const COLUMNS = ["Fecha de envío", "Dirección", "ID de envío", "Ref. 2"];
const IDS = [
  "PQ987654321ES",
  "PQ987654322ES",
  "PQ111111111ES",
  "PQ222222222ES",
  "PQ333333333ES",
];

const row = (sender: string) => ["2026-03-01", "Calle Sol 1", sender, `ST-${sender}`];

interface CampaignRow {
  id: number;
}

interface ResolveBody {
  senderId: string | null;
  distance: number;
  ambiguous: boolean;
  alternatives: { senderId: string; distance: number }[];
}

let server: TestServer;
let anon: Client;
let alpha: Client;
let alphaOperator: Client;
let beta: Client;
let alphaCampaign = 0;
let betaCampaign = 0;

beforeAll(async () => {
  await resetDatabase();
  server = await startServer();
  anon = newClient(server.baseUrl);
  alpha = newClient(server.baseUrl);
  alphaOperator = newClient(server.baseUrl);
  beta = newClient(server.baseUrl);

  const a = await alpha.register("Alpha Co", "alpha-admin@test.local", "password123");
  const b = await beta.register("Beta Co", "beta-admin@test.local", "password123");
  await seedUser(a.customerId, "alpha-operator@test.local", "password123", "user");
  await alphaOperator.login("alpha-operator@test.local", "password123");

  const created = await alpha.post<CampaignRow>("/campaigns", {
    name: "Alpha March",
    startDate: "2026-03-01",
    finishDate: "2026-03-31",
  });
  alphaCampaign = created.body.id;
  await alpha.post(`/campaigns/${alphaCampaign}/packages`, {
    filename: "alpha.xlsx",
    columns: COLUMNS,
    senderColumn: 2,
    storeColumn: 3,
    rows: IDS.map(row),
  });

  const other = await beta.post<CampaignRow>("/campaigns", {
    name: "Beta March",
    startDate: "2026-03-01",
    finishDate: "2026-03-31",
  });
  betaCampaign = other.body.id;
  await beta.post(`/campaigns/${betaCampaign}/packages`, {
    filename: "beta.xlsx",
    columns: COLUMNS,
    senderColumn: 2,
    storeColumn: 3,
    rows: [row("PQBETA00001ES")],
  });
});

afterAll(async () => {
  await server.close();
  await closePool();
});

describe("POST /returns/resolve", () => {
  it("requires a session", async () => {
    const res = await anon.post("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: [IDS[0]],
    });
    expect(res.status).toBe(401);
  });

  it("returns the exact ID when the OCR read it perfectly", async () => {
    const res = await alpha.post<ResolveBody>("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: [IDS[0]],
    });
    expect(res.status).toBe(200);
    expect(res.body.senderId).toBe(IDS[0]);
    expect(res.body.distance).toBe(0);
    expect(res.body.ambiguous).toBe(false);
  });

  it("recovers an ID the OCR read with confused characters", async () => {
    // I instead of 1, O instead of 0 at the end: both are routine OCR confusions.
    const res = await alpha.post<ResolveBody>("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: ["PQ98765432IES"],
    });
    expect(res.body.senderId).toBe(IDS[0]);
  });

  it("asks instead of guessing when two IDs are equally close", async () => {
    const res = await alpha.post<ResolveBody>("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: ["PQ98765432OES"],
    });
    expect(res.body.senderId).toBeNull();
    expect(res.body.ambiguous).toBe(true);
    expect(res.body.alternatives.map((entry) => entry.senderId)).toEqual([
      "PQ987654321ES",
      "PQ987654322ES",
    ]);
  });

  it("says so when the label is not from this campaign", async () => {
    const res = await alpha.post<ResolveBody>("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: ["PQBETA00001ES"],
    });
    expect(res.status).toBe(200);
    expect(res.body.senderId).toBeNull();
    expect(res.body.distance).toBe(-1);
    expect(res.body.alternatives).toEqual([]);
  });

  it("accepts raw OCR text and ignores the words around the ID", async () => {
    const res = await alpha.post<ResolveBody>("/returns/resolve", {
      campaignId: alphaCampaign,
      text: "Destinatario: Calle Sol 1, Cádiz 28001\nID de envío: PQ111111111ES\nPeso: 2 kg",
    });
    expect(res.body.senderId).toBe("PQ111111111ES");
  });

  it("works for an operator, who reaches every client", async () => {
    const res = await alphaOperator.post<ResolveBody>("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: [IDS[2]],
    });
    expect(res.body.senderId).toBe(IDS[2]);
  });

  it("hides another company's campaign from a tenant administrator", async () => {
    const res = await beta.post<ResolveBody>("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: [IDS[2]],
    });
    expect(res.status).toBe(404);
  });

  it("rejects a campaign that does not exist", async () => {
    const res = await alpha.post("/returns/resolve", { campaignId: 999_999, tokens: [IDS[0]] });
    expect(res.status).toBe(404);
  });

  it("validates the request body", async () => {
    const missingCampaign = await alpha.post("/returns/resolve", { tokens: [IDS[0]] });
    expect(missingCampaign.status).toBe(400);

    const badCampaign = await alpha.post("/returns/resolve", {
      campaignId: "not-a-number",
      tokens: [IDS[0]],
    });
    expect(badCampaign.status).toBe(400);

    const noPayload = await alpha.post("/returns/resolve", { campaignId: alphaCampaign });
    expect(noPayload.status).toBe(400);

    const emptyTokens = await alpha.post("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: ["", "   "],
    });
    expect(emptyTokens.status).toBe(400);

    const tooLong = await alpha.post("/returns/resolve", {
      campaignId: alphaCampaign,
      tokens: ["A".repeat(200)],
    });
    expect(tooLong.status).toBe(400);
  });
});
