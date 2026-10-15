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

// Proves per-customer isolation across every data endpoint, plus auth/role gating.
// Runs against a throwaway database; see ./helpers.ts.

const SENDER_A = "PQA000001ES";
const SENDER_A_RETURNED = "PQA000002ES";
const SENDER_A_THIRD = "PQA000003ES";
const SENDER_A_RESEND = "PQA000004ES";
const SENDER_B = "PQB000001ES";

const COLUMNS = ["Fecha de envío", "Dirección", "ID de envío"];
const row = (sender: string, city: string) => ["2026-03-01", city, sender];

interface CampaignRow {
  id: number;
  name: string;
}
interface PackageRow {
  id: number;
  sender_id: string;
}
interface LookupRow {
  id: number;
  sender_id: string;
  return_id: number | null;
  chain: unknown[];
}

let server: TestServer;
let anon: Client;
let alpha: Client;
let beta: Client;
let alphaUser: Client;
let superadmin: Client;

let alphaCampaign = 0;
let alphaReturnedPackageId = 0;
let betaCampaign = 0;
let betaPackageId = 0;

beforeAll(async () => {
  await resetDatabase();
  server = await startServer();

  anon = newClient(server.baseUrl);
  alpha = newClient(server.baseUrl);
  beta = newClient(server.baseUrl);
  alphaUser = newClient(server.baseUrl);
  superadmin = newClient(server.baseUrl);

  const a = await alpha.register("Alpha Co", "alpha-admin@test.local", "password123");
  const b = await beta.register("Beta Co", "beta-admin@test.local", "password123");
  await seedUser(a.customerId, "alpha-user@test.local", "password123", "user");
  await seedUser(null, "root@test.local", "password123", "superadmin");
  await alphaUser.login("alpha-user@test.local", "password123");
  await superadmin.login("root@test.local", "password123");

  // ---- customer A: a campaign with three packages, one returned and resent ----
  const campaign = await alpha.post<CampaignRow>("/campaigns", { name: "Alpha March" });
  alphaCampaign = campaign.body.id;
  await alpha.post(`/campaigns/${alphaCampaign}/packages`, {
    filename: "alpha.xlsx",
    columns: COLUMNS,
    senderColumn: 2,
    rows: [
      row(SENDER_A, "Cádiz"),
      row(SENDER_A_RETURNED, "Málaga"),
      row(SENDER_A_THIRD, "Sevilla"),
    ],
  });

  const alphaPackages = await alpha.get<PackageRow[]>(`/campaigns/${alphaCampaign}/packages`);
  alphaReturnedPackageId = alphaPackages.body.find(
    (p) => p.sender_id === SENDER_A_RETURNED
  )!.id;

  await alpha.post("/returns", { senderId: SENDER_A_RETURNED, reasonCode: "estacionada" });
  await alpha.post("/returns/resend", {
    packageId: alphaReturnedPackageId,
    newSenderId: SENDER_A_RESEND,
    campaignId: alphaCampaign,
  });

  // ---- customer B: its own campaign and one package ----
  const betaCampaignRes = await beta.post<CampaignRow>("/campaigns", { name: "Beta March" });
  betaCampaign = betaCampaignRes.body.id;
  await beta.post(`/campaigns/${betaCampaign}/packages`, {
    filename: "beta.xlsx",
    columns: COLUMNS,
    senderColumn: 2,
    rows: [row(SENDER_B, "Bilbao")],
  });
  const betaPackages = await beta.get<PackageRow[]>(`/campaigns/${betaCampaign}/packages`);
  betaPackageId = betaPackages.body[0].id;
});

afterAll(async () => {
  await closePool();
  await server.close();
});

describe("the app works for the owner (control group)", () => {
  it("serves health without a session", async () => {
    const res = await anon.get<{ ok: boolean; db: string }>("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "up" });
  });

  it("lists only the owner's campaigns", async () => {
    const res = await alpha.get<CampaignRow[]>("/campaigns");
    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.name)).toEqual(["Alpha March"]);
  });

  it("reads its own campaign and packages", async () => {
    expect((await alpha.get(`/campaigns/${alphaCampaign}`)).status).toBe(200);
    const packages = await alpha.get<PackageRow[]>(`/campaigns/${alphaCampaign}/packages`);
    expect(packages.body).toHaveLength(4); // three uploaded + one resend
  });

  it("finds its own package and shows the whole resend chain", async () => {
    const direct = await alpha.get<LookupRow[]>(
      `/returns/lookup?senderId=${SENDER_A_RETURNED}`
    );
    expect(direct.body).toHaveLength(1);
    expect(direct.body[0].return_id).not.toBeNull();
    expect(direct.body[0].chain).toHaveLength(2);

    const fromResend = await alpha.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_A_RESEND}`);
    expect(fromResend.body[0].chain).toHaveLength(2);
  });

  it("exports its own campaign as a real .xlsx", async () => {
    const res = await alpha.get(`/campaigns/${alphaCampaign}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
  });

  it("records a return and shows it in the recent list", async () => {
    const recorded = await alphaUser.post("/returns", {
      senderId: SENDER_A_THIRD,
      reasonCode: "ausente",
    });
    expect(recorded.status).toBe(201);
    const recent = await alpha.get<{ sender_id: string }[]>("/returns");
    expect(recent.body.map((r) => r.sender_id)).toContain(SENDER_A_THIRD);
  });
});

describe("customer A can never read customer B's data", () => {
  it("cannot see B's campaigns in its own list", async () => {
    const list = await alpha.get<CampaignRow[]>("/campaigns");
    expect(list.body.map((c) => c.id)).not.toContain(betaCampaign);
  });

  it("cannot read B's campaign", async () => {
    expect((await alpha.get(`/campaigns/${betaCampaign}`)).status).toBe(404);
  });

  it("cannot read B's packages or uploads", async () => {
    expect((await alpha.get(`/campaigns/${betaCampaign}/packages`)).status).toBe(404);
    expect((await alpha.get(`/campaigns/${betaCampaign}/uploads`)).status).toBe(404);
  });

  it("cannot export B's campaign", async () => {
    const res = await alpha.get(`/campaigns/${betaCampaign}/export`);
    expect(res.status).toBe(404);
  });

  it("cannot find B's package by sender ID", async () => {
    const found = await alpha.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_B}`);
    expect(found.body).toEqual([]);
  });

  it("cannot see B's returns in its recent list", async () => {
    const recent = await alpha.get<{ sender_id: string; campaign_name: string }[]>("/returns");
    expect(recent.body.map((r) => r.sender_id)).not.toContain(SENDER_B);
    expect(recent.body.map((r) => r.campaign_name)).not.toContain("Beta March");
  });

  it("only ever gets its own customer from /customers/current", async () => {
    expect((await alpha.get<{ name: string }>("/customers/current")).body.name).toBe("Alpha Co");
    expect((await beta.get<{ name: string }>("/customers/current")).body.name).toBe("Beta Co");
  });
});

describe("customer A can never write customer B's data", () => {
  it("cannot rename B's campaign, and B's data is untouched", async () => {
    const attempt = await alpha.patch(`/campaigns/${betaCampaign}`, { name: "HACKED" });
    expect(attempt.status).toBe(404);

    const bCampaigns = await beta.get<CampaignRow[]>("/campaigns");
    expect(bCampaigns.body.map((c) => c.name)).toEqual(["Beta March"]);
  });

  it("cannot upload packages into B's campaign, and B's row count is untouched", async () => {
    const attempt = await alpha.post(`/campaigns/${betaCampaign}/packages`, {
      filename: "hack.xlsx",
      columns: COLUMNS,
      senderColumn: 2,
      rows: [row("PQHACK001ES", "Nowhere")],
    });
    expect(attempt.status).toBe(404);

    const bPackages = await beta.get<PackageRow[]>(`/campaigns/${betaCampaign}/packages`);
    expect(bPackages.body).toHaveLength(1);
    expect(bPackages.body.map((p) => p.sender_id)).toEqual([SENDER_B]);
  });

  it("cannot record a return against B's package, even by package id", async () => {
    const bySender = await alpha.post("/returns", { senderId: SENDER_B, reasonCode: "otro" });
    expect(bySender.status).toBe(404);

    const byPackageId = await alpha.post("/returns", {
      senderId: SENDER_B,
      packageId: betaPackageId,
      reasonCode: "otro",
    });
    expect(byPackageId.status).toBe(404);

    const asB = await beta.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_B}`);
    expect(asB.body[0].return_id).toBeNull();
  });

  it("cannot attach a resend to B's package, nor into B's campaign", async () => {
    const foreignPackage = await alpha.post("/returns/resend", {
      packageId: betaPackageId,
      newSenderId: "PQHACK002ES",
      campaignId: alphaCampaign,
    });
    expect(foreignPackage.status).toBe(404);

    const foreignCampaign = await alpha.post("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: "PQHACK003ES",
      campaignId: betaCampaign,
    });
    expect(foreignCampaign.status).toBe(404);

    const bPackages = await beta.get<PackageRow[]>(`/campaigns/${betaCampaign}/packages`);
    expect(bPackages.body).toHaveLength(1);
  });
});

describe("anonymous callers are rejected everywhere", () => {
  const protectedCalls: [string, string][] = [
    ["GET", "/auth/me"],
    ["GET", "/customers/current"],
    ["GET", "/campaigns"],
    ["POST", "/campaigns"],
    ["GET", "/campaigns/1"],
    ["PATCH", "/campaigns/1"],
    ["GET", "/campaigns/1/packages"],
    ["POST", "/campaigns/1/packages"],
    ["GET", "/campaigns/1/uploads"],
    ["GET", "/campaigns/1/export"],
    ["GET", "/returns"],
    ["GET", "/returns/reasons"],
    ["GET", "/returns/lookup?senderId=ANY"],
    ["POST", "/returns"],
    ["POST", "/returns/resend"],
    ["GET", "/admin/customers"],
  ];

  it.each(protectedCalls)("%s %s → 401", async (method, path) => {
    const res = await anon.request(method, path, method === "GET" ? undefined : {});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "not authenticated" });
  });
});

describe("roles", () => {
  it("a `user` may read campaigns and record returns", async () => {
    expect((await alphaUser.get("/campaigns")).status).toBe(200);
    expect((await alphaUser.get(`/campaigns/${alphaCampaign}/packages`)).status).toBe(200);
    expect((await alphaUser.get(`/campaigns/${alphaCampaign}/export`)).status).toBe(200);
    expect((await alphaUser.get<unknown[]>("/returns/reasons")).body).toHaveLength(5);
  });

  it("a `user` may not create campaigns, upload, or link resends", async () => {
    expect((await alphaUser.post("/campaigns", { name: "Nope" })).status).toBe(403);
    expect(
      (
        await alphaUser.post(`/campaigns/${alphaCampaign}/packages`, {
          filename: "x.xlsx",
          columns: COLUMNS,
          senderColumn: 2,
          rows: [row("PQNOPE001ES", "Nowhere")],
        })
      ).status
    ).toBe(403);
    expect(
      (
        await alphaUser.post("/returns/resend", {
          packageId: alphaReturnedPackageId,
          newSenderId: "PQNOPE002ES",
          campaignId: alphaCampaign,
        })
      ).status
    ).toBe(403);
  });

  it("a customer admin may not use the platform admin API", async () => {
    const res = await alpha.get("/admin/customers");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "super-admin only" });
  });

  it("a super-admin has no customer data of its own", async () => {
    expect((await superadmin.get<CampaignRow[]>("/campaigns")).body).toEqual([]);
    expect((await superadmin.get(`/campaigns/${alphaCampaign}`)).status).toBe(404);
    expect((await superadmin.get<unknown[]>("/returns")).body).toEqual([]);
  });

  it("a super-admin can manage customers", async () => {
    const list = await superadmin.get<{ name: string }[]>("/admin/customers");
    expect(list.status).toBe(200);
    expect(list.body.map((c) => c.name)).toEqual(expect.arrayContaining(["Alpha Co", "Beta Co"]));

    const created = await superadmin.post<{ name: string }>("/admin/customers", {
      name: "Gamma Co",
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Gamma Co");
  });

  it("logging out ends the session", async () => {
    const temp = newClient(server.baseUrl);
    await temp.login("alpha-admin@test.local", "password123");
    expect((await temp.get("/campaigns")).status).toBe(200);
    await temp.post("/auth/logout");
    expect((await temp.get("/campaigns")).status).toBe(401);
  });
});
