import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
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
const SENDER_A_SECOND_RESEND = "PQSAMECAMP001ES";
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
  campaign_id: number;
  return_id: number | null;
  chain: unknown[];
}

// Campaigns require a full start/finish window, so every creation supplies one.
const newCampaign = (client: Client, name: string) =>
  client.post<CampaignRow>("/campaigns", {
    name,
    startDate: "2026-03-01",
    finishDate: "2026-03-31",
  });

let server: TestServer;
let anon: Client;
let alpha: Client;
let beta: Client;
let alphaUser: Client;
let superadmin: Client;

let alphaCampaign = 0;
let alphaCustomerId = 0;
let alphaReturnedPackageId = 0;
let betaCampaign = 0;
let betaCustomerId = 0;
let betaPackageId = 0;
let rootUserId = 0;

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
  alphaCustomerId = a.customerId;
  betaCustomerId = b.customerId;
  await seedUser(a.customerId, "alpha-user@test.local", "password123", "user");
  // The one account with no customer of its own, so it is the platform's only super-admin.
  rootUserId = await seedUser(null, "root@test.local", "password123", "superadmin");
  await alphaUser.login("alpha-user@test.local", "password123");
  await superadmin.login("root@test.local", "password123");

  // ---- customer A: a campaign with three packages, one returned and resent ----
  const campaign = await newCampaign(alpha, "Alpha March");
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
  const betaCampaignRes = await newCampaign(beta, "Beta March");
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
  await server?.close();
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

  it("cannot record a return on B's package without naming B", async () => {
    // No customer named, so the request is scoped to the caller's own company and B's package is
    // invisible to it.
    const res = await alpha.post("/returns", { senderId: SENDER_B, reasonCode: "otro" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "no package with that ID" });

    const asB = await beta.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_B}`);
    expect(asB.body[0].return_id).toBeNull();
  });

  it("refuses a resend aimed at another company's campaign", async () => {
    // Beta's package was never returned, so it cannot be resent at all.
    const notReturned = await alpha.post("/returns/resend", {
      packageId: betaPackageId,
      newSenderId: "PQHACK002ES",
      campaignId: alphaCampaign,
    });
    expect(notReturned.status).toBe(400);
    expect(notReturned.body).toEqual({ error: "only a returned package can be resent" });

    // Alpha's own returned package cannot be pushed into Beta's campaign.
    const foreignCampaign = await alpha.post("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: "PQHACK003ES",
      campaignId: betaCampaign,
    });
    expect(foreignCampaign.status).toBe(404);
    expect(foreignCampaign.body).toEqual({ error: "campaign not found" });

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
    ["GET", "/returns/summary"],
    ["GET", "/returns/chains"],
    ["GET", "/returns/chains/export"],
    ["GET", "/returns/customers"],
    ["GET", "/returns/customers/1/campaigns"],
    ["GET", "/returns/lookup?senderId=ANY"],
    ["POST", "/returns"],
    ["POST", "/returns/resend"],
    ["GET", "/admin/customers"],
    ["GET", "/admin/customers/1/campaigns"],
    ["GET", "/admin/campaigns/1/export"],
    ["PATCH", "/admin/users/1"],
    ["DELETE", "/admin/users/1"],
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
    expect((await alphaUser.get<unknown[]>("/returns/reasons")).body).toHaveLength(5);
  });

  it("a `user` may not export the flagged sheet", async () => {
    // The export buttons are hidden from a `user`; the route refuses them the same way.
    const res = await alphaUser.get(`/campaigns/${alphaCampaign}/export`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "super-admin only" });
  });

  it("a `user` may not create campaigns or upload lists", async () => {
    expect((await newCampaign(alphaUser, "Nope")).status).toBe(403);
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
  });

  it("a company super-admin CAN both run its company and manage customers", async () => {
    // Two roles only: `superadmin` (full access) and `user` (returns). A company super-admin is
    // the account that used to be `admin`, so it can now reach the platform screens as well.
    const list = await alpha.get<{ name: string }[]>("/admin/customers");
    expect(list.status).toBe(200);
    expect(list.body.map((c) => c.name)).toEqual(expect.arrayContaining(["Alpha Co"]));

    const users = await alpha.get<{ email: string; role: string }[]>(
      `/admin/customers/${alphaCustomerId}/users`
    );
    expect(users.status).toBe(200);
    expect(users.body.some((u) => u.role === "user")).toBe(true);
  });

  it("a `user` may not use the platform admin API", async () => {
    const res = await alphaUser.get("/admin/customers");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "super-admin only" });
  });

  it("a super-admin can create both account types for a customer", async () => {
    const asUser = await alpha.post<{ role: string }>(
      `/admin/customers/${alphaCustomerId}/users`,
      { email: "made-user@test.local", password: "password123", role: "user" }
    );
    expect(asUser.status).toBe(201);
    expect(asUser.body.role).toBe("user");

    const asSuper = await alpha.post<{ role: string }>(
      `/admin/customers/${alphaCustomerId}/users`,
      { email: "made-super@test.local", password: "password123", role: "superadmin" }
    );
    expect(asSuper.status).toBe(201);
    expect(asSuper.body.role).toBe("superadmin");

    const bogus = await alpha.post(`/admin/customers/${alphaCustomerId}/users`, {
      email: "made-bogus@test.local",
      password: "password123",
      role: "admin",
    });
    expect(bogus.status).toBe(400);

    // The new `user` really is restricted.
    const newUser = newClient(server.baseUrl);
    await newUser.login("made-user@test.local", "password123");
    expect((await newUser.get("/campaigns")).status).toBe(200);
    expect((await newCampaign(newUser, "nope")).status).toBe(403);
  });

  it("a super-admin has no customer data of its own", async () => {
    expect((await superadmin.get<CampaignRow[]>("/campaigns")).body).toEqual([]);
    expect((await superadmin.get(`/campaigns/${alphaCampaign}`)).status).toBe(404);
    expect((await superadmin.get<unknown[]>("/returns")).body).toEqual([]);
  });

  it("a resend with no campaign lands in the original package's campaign", async () => {
    // The UI no longer asks which campaign: a resend always stays where the original was sent.
    const created = await alpha.post<{ campaignId: number; campaignName: string }>(
      "/returns/resend",
      { packageId: alphaReturnedPackageId, newSenderId: SENDER_A_SECOND_RESEND }
    );
    expect(created.status).toBe(201);
    expect(created.body.campaignId).toBe(alphaCampaign);
    expect(created.body.campaignName).toBe("Alpha March");

    const chain = await alpha.get<LookupRow[]>(
      `/returns/lookup?senderId=${SENDER_A_SECOND_RESEND}`
    );
    expect(chain.body[0].chain).toHaveLength(3);
  });

  it("the recent list names the package a resend was sent as", async () => {
    // A resend can come back too, and then it shows up in the list in its own right.
    const resentAgain = await alpha.post("/returns", {
      senderId: SENDER_A_RESEND,
      reasonCode: "ausente",
    });
    expect(resentAgain.status).toBe(201);

    const recent = await alpha.get<{ sender_id: string; resent_as: string | null }[]>("/returns");

    // Each returned package names the next package in its chain.
    const original = recent.body.find((r) => r.sender_id === SENDER_A_RETURNED);
    expect(original?.resent_as).toBe(SENDER_A_RESEND);
    const resend = recent.body.find((r) => r.sender_id === SENDER_A_RESEND);
    expect(resend?.resent_as).toBe(SENDER_A_SECOND_RESEND);

    // A returned package that was never sent again names nothing.
    expect(recent.body.find((r) => r.sender_id === SENDER_A_THIRD)?.resent_as).toBeNull();
  });

  it("refuses a resend aimed at a different campaign", async () => {
    const other = await newCampaign(alpha, "Alpha Other");
    const res = await alpha.post("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: "PQWRONGCAMP001ES",
      campaignId: other.body.id,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "a resend stays in the same campaign as the original package",
    });
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

// A package ID is only unique within a campaign, so the returns screen can narrow a lookup to the
// campaign the operator is holding.
describe("narrowing a lookup to one campaign", () => {
  let repriseCampaign = 0;

  beforeAll(async () => {
    const campaign = await newCampaign(alpha, "Alpha Reprise");
    repriseCampaign = campaign.body.id;
    await alpha.post(`/campaigns/${repriseCampaign}/packages`, {
      filename: "reprise.xlsx",
      columns: COLUMNS,
      senderColumn: 2,
      rows: [row(SENDER_A, "Cádiz")],
    });
  });

  it("finds both uses of the same package ID when no campaign is given", async () => {
    const all = await alpha.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_A}`);
    expect(all.body.map((p) => p.campaign_id)).toEqual([alphaCampaign, repriseCampaign]);
  });

  it("finds only the chosen campaign's package", async () => {
    const reprise = await alpha.get<LookupRow[]>(
      `/returns/lookup?senderId=${SENDER_A}&campaignId=${repriseCampaign}`
    );
    expect(reprise.body).toHaveLength(1);
    expect(reprise.body[0].campaign_id).toBe(repriseCampaign);

    const original = await alpha.get<LookupRow[]>(
      `/returns/lookup?senderId=${SENDER_A}&campaignId=${alphaCampaign}`
    );
    expect(original.body).toHaveLength(1);
    expect(original.body[0].campaign_id).toBe(alphaCampaign);
  });

  it("cannot be pointed at another customer's campaign", async () => {
    const foreign = await alpha.get<
      { error: string }
    >(`/returns/lookup?senderId=${SENDER_A}&campaignId=${betaCampaign}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "campaign not found" });
  });

  it("rejects a campaign id that is not a positive number", async () => {
    const bad = await alpha.get<
      { error: string }
    >(`/returns/lookup?senderId=${SENDER_A}&campaignId=abc`);
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "campaignId must be a positive number" });
  });
});

// The Customers screen: a platform super-admin can list and export every customer's campaigns.
describe("a platform super-admin works across customers", () => {
  it("lists a customer's campaigns, with lines, packages and returns", async () => {
    const list = await superadmin.get<
      { name: string; total_rows: number; package_count: number; return_count: number }[]
    >(`/admin/customers/${alphaCustomerId}/campaigns`);
    expect(list.status).toBe(200);
    expect(list.body.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Alpha March", "Alpha Other", "Alpha Reprise"])
    );

    const of = (name: string) => list.body.find((c) => c.name === name)!;
    // Three uploaded lines, two resends added later, three of the five packages came back.
    expect(of("Alpha March")).toMatchObject({
      total_rows: 3,
      package_count: 5,
      return_count: 3,
    });
    // A campaign with nothing in it still appears, with zeroes.
    expect(of("Alpha Other")).toMatchObject({
      total_rows: 0,
      package_count: 0,
      return_count: 0,
    });
  });

  it("exports a campaign of a customer it is not attached to", async () => {
    const res = await superadmin.get(`/admin/campaigns/${betaCampaign}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
  });

  it("cannot use the tenant export route, which stays scoped to one company", async () => {
    expect((await superadmin.get(`/campaigns/${betaCampaign}/export`)).status).toBe(404);
  });

  it("gives a `user` neither the campaign list nor a campaign export", async () => {
    expect((await alphaUser.get(`/admin/customers/${alphaCustomerId}/campaigns`)).status).toBe(403);
    expect((await alphaUser.get(`/admin/campaigns/${alphaCampaign}/export`)).status).toBe(403);
  });
});

// The Campaigns screen: how many lists each campaign holds and how many lines they carry.
describe("campaign list counts", () => {
  it("reports the uploaded lists and their total lines per campaign", async () => {
    const list = await alpha.get<
      { name: string; upload_count: number; total_rows: number }[]
    >("/campaigns");
    expect(list.status).toBe(200);

    const of = (name: string) => list.body.find((c) => c.name === name)!;
    // beforeAll imported one three-line list into Alpha March; Alpha Reprise got one line.
    expect(of("Alpha March")).toMatchObject({ upload_count: 1, total_rows: 3 });
    expect(of("Alpha Reprise")).toMatchObject({ upload_count: 1, total_rows: 1 });
    // A campaign with nothing uploaded still lists, with zeroes rather than nulls.
    expect(of("Alpha Other")).toMatchObject({ upload_count: 0, total_rows: 0 });
  });

  it("lists every uploaded list of the company, with its campaign", async () => {
    const res = await alpha.get<
      { campaign_id: number; filename: string; row_count: number }[]
    >("/campaigns/uploads");
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.filename).sort()).toEqual(["alpha.xlsx", "reprise.xlsx"]);
    expect(res.body.find((u) => u.filename === "alpha.xlsx")).toMatchObject({
      campaign_id: alphaCampaign,
      row_count: 3,
    });
    // Never another company's uploads.
    expect(res.body.some((u) => u.filename === "beta.xlsx")).toBe(false);
  });
});

// The Download selector on a campaign: the whole campaign, or the rows of one uploaded list.
describe("exporting one uploaded list", () => {
  it("exports only the rows that came from that list", async () => {
    const lists = await alpha.get<{ id: number; filename: string; row_count: number }[]>(
      `/campaigns/${alphaCampaign}/uploads`
    );
    const list = lists.body[0];
    expect(list.row_count).toBe(3);

    const res = await alpha.raw(`/campaigns/${alphaCampaign}/export?uploadId=${list.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    // Named after the list it came from, not the campaign.
    expect(res.headers.get("content-disposition")).toContain("alpha");

    const wb = XLSX.read(new Uint8Array(res.buffer), { type: "array" });
    const matrix = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      raw: false,
    });
    // A header row plus the three uploaded lines: the two resends are not in any list.
    expect(matrix).toHaveLength(4);
    expect(matrix.slice(1).map((r) => String(r[2])).sort()).toEqual(
      [SENDER_A, SENDER_A_RETURNED, SENDER_A_THIRD].sort()
    );
  });

  it("will not export a list that belongs to another campaign", async () => {
    const betaLists = await beta.get<{ id: number }[]>(`/campaigns/${betaCampaign}/uploads`);
    const foreign = await alpha.get<{ error: string }>(
      `/campaigns/${alphaCampaign}/export?uploadId=${betaLists.body[0].id}`
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "list not found" });
  });

  it("wants an uploadId that is a positive number", async () => {
    const bad = await alpha.get<{ error: string }>(
      `/campaigns/${alphaCampaign}/export?uploadId=abc`
    );
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "uploadId must be a positive number" });
  });
});

// The counters above the recent list: how many returns and resends there are in total.
describe("return counters", () => {
  it("counts every package sent, every return and every resend of the company", async () => {
    const summary = await alpha.get<{
      sent: number;
      returns: number;
      resends: number;
      recent: number;
    }>("/returns/summary");
    expect(summary.status).toBe(200);
    // Six packages exist (three uploaded, three resends), three of them came back, two were resent.
    expect(summary.body.sent).toBe(6);
    expect(summary.body.returns).toBe(3);
    expect(summary.body.resends).toBe(2);
    expect(summary.body.recent).toBe(100);
  });

  it("counts only the caller's own company", async () => {
    const betaSummary = await beta.get<{ sent: number; returns: number; resends: number }>(
      "/returns/summary"
    );
    expect(betaSummary.body).toMatchObject({ sent: 1, returns: 0, resends: 0 });
  });
});

// The chain report: the original sending ID, then each package it was sent again as.
describe("resend chains", () => {
  interface ChainRow {
    original_id: number;
    original_sender_id: string;
    campaign_name: string;
    reason_label: string | null;
    resends: string[];
  }

  it("lays a chain out as the original then each resend, in order", async () => {
    const res = await alpha.get<ChainRow[]>("/returns/chains");
    expect(res.status).toBe(200);

    const chain = res.body.find((c) => c.original_sender_id === SENDER_A_RETURNED);
    expect(chain).toBeDefined();
    // The returned package opens the row and is never repeated as one of its own resends.
    expect(chain!.original_id).toBe(alphaReturnedPackageId);
    expect(chain!.resends[0]).toBe(SENDER_A_RESEND);
    expect(chain!.resends).toContain(SENDER_A_SECOND_RESEND);
    expect(chain!.resends).not.toContain(SENDER_A_RETURNED);
    // Where it was sent, and why it came back.
    expect(chain!.campaign_name).toBe("Alpha March");
    expect(chain!.reason_label).toBe("estacionada");
  });

  it("lists only chains that were actually resent, and only the caller's company", async () => {
    const mine = await alpha.get<ChainRow[]>("/returns/chains");
    // A package that never went out again is not a chain of one in the report.
    expect(mine.body.map((c) => c.original_sender_id)).not.toContain(SENDER_A);
    expect(mine.body.every((c) => c.resends.length > 0)).toBe(true);

    // Customer B has a campaign but no resends, so it has no chains at all.
    expect((await beta.get<ChainRow[]>("/returns/chains")).body).toEqual([]);
  });

  it("shows a `user` their own company's chains", async () => {
    const res = await alphaUser.get<ChainRow[]>("/returns/chains");
    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.original_sender_id)).toContain(SENDER_A_RETURNED);
  });

  it("downloads the same rows as a .xlsx", async () => {
    const res = await alpha.raw("/returns/chains/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("resend-chains.xlsx");

    const wb = XLSX.read(new Uint8Array(res.buffer), { type: "array" });
    const matrix = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      raw: false,
    });
    // As many resend columns as the deepest chain needs, then where it went and why it came back.
    expect(matrix[0]).toEqual([
      "Original ID",
      "Resent as",
      "Resent again as",
      "Campaign",
      "Return Reason",
    ]);
    const row = matrix.find((r) => String(r[0]) === SENDER_A_RETURNED);
    expect(row).toBeDefined();
    expect(row!.slice(1)).toEqual([
      SENDER_A_RESEND,
      SENDER_A_SECOND_RESEND,
      "Alpha March",
      "estacionada",
    ]);
  });

  it("says so when the company has no resends to report", async () => {
    const res = await beta.get<{ error: string }>("/returns/chains/export");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "this company has no resends to report" });
  });

  it("puts the same chain columns on the campaign export", async () => {
    const res = await alpha.raw(`/campaigns/${alphaCampaign}/export`);
    expect(res.status).toBe(200);

    const wb = XLSX.read(new Uint8Array(res.buffer), { type: "array" });
    const matrix = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      raw: false,
    });
    // The uploaded columns, the two report columns, then the chain — original first. The single
    // "Resend Of" column is gone: one column could not show a chain of three.
    expect(matrix[0].slice(-5)).toEqual([
      "Return Status",
      "Return Reason",
      "Original ID",
      "Resent as",
      "Resent again as",
    ]);
    const row = matrix.find((r) => String(r[2]) === SENDER_A_RESEND);
    expect(row).toBeDefined();
    // Every member of the chain carries the whole row of IDs, so any row names the original.
    expect(row!.slice(-3)).toEqual([SENDER_A_RETURNED, SENDER_A_RESEND, SENDER_A_SECOND_RESEND]);
  });
});

// The Customers screen: the accounts of a customer, and what can be done to them.
describe("managing accounts", () => {
  const madeEmail = "managed@test.local";

  const accountId = async (email: string): Promise<number> => {
    const list = await alpha.get<{ id: number; email: string }[]>(
      `/admin/customers/${alphaCustomerId}/users`
    );
    const found = list.body.find((u) => u.email === email);
    if (!found) throw new Error(`no account for ${email}`);
    return found.id;
  };

  it("lists accounts with whether they are active", async () => {
    const created = await alpha.post<{ id: number }>(`/admin/customers/${alphaCustomerId}/users`, {
      email: madeEmail,
      password: "password123",
      role: "user",
    });
    expect(created.status).toBe(201);

    const list = await alpha.get<{ email: string; is_active: number }[]>(
      `/admin/customers/${alphaCustomerId}/users`
    );
    expect(list.body.find((u) => u.email === madeEmail)?.is_active).toBe(1);
    expect(list.body.some((u) => u.email === "alpha-admin@test.local")).toBe(true);
  });

  it("deactivating an account ends its session and blocks the login", async () => {
    const id = await accountId(madeEmail);
    const victim = newClient(server.baseUrl);
    await victim.login(madeEmail, "password123");
    expect((await victim.get("/campaigns")).status).toBe(200);

    const off = await alpha.patch<{ is_active: number }>(`/admin/users/${id}`, { active: false });
    expect(off.status).toBe(200);
    expect(off.body.is_active).toBe(0);

    // The session it already had is gone, and it cannot log in again.
    expect((await victim.get("/campaigns")).status).toBe(401);
    expect(
      (await victim.post("/auth/login", { email: madeEmail, password: "password123" })).status
    ).toBe(401);

    const on = await alpha.patch<{ is_active: number }>(`/admin/users/${id}`, { active: true });
    expect(on.status).toBe(200);
    await victim.login(madeEmail, "password123");
    expect((await victim.get("/campaigns")).status).toBe(200);
  });

  it("deleting an account removes it, and its sessions with it", async () => {
    const id = await accountId(madeEmail);
    const victim = newClient(server.baseUrl);
    await victim.login(madeEmail, "password123");

    const gone = await alpha.delete(`/admin/users/${id}`);
    expect(gone.status).toBe(200);
    expect((await victim.get("/campaigns")).status).toBe(401);

    const list = await alpha.get<{ email: string }[]>(`/admin/customers/${alphaCustomerId}/users`);
    expect(list.body.some((u) => u.email === madeEmail)).toBe(false);
  });

  it("refuses to delete an account that recorded returns", async () => {
    // It recorded a return earlier in this file, so returns.recorded_by points at it.
    const id = await accountId("alpha-user@test.local");
    const res = await alpha.delete<{ error: string }>(`/admin/users/${id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("deactivate it instead");

    const after = await alpha.get<{ id: number; is_active: number }[]>(
      `/admin/customers/${alphaCustomerId}/users`
    );
    expect(after.body.find((u) => u.id === id)?.is_active).toBe(1);
  });

  it("refuses to touch your own account", async () => {
    const me = await accountId("alpha-admin@test.local");
    expect((await alpha.patch(`/admin/users/${me}`, { active: false })).status).toBe(400);
    expect((await alpha.delete(`/admin/users/${me}`)).status).toBe(400);
  });

  it("keeps the last active platform super-admin", async () => {
    // root@test.local is the only account with no customer of its own.
    const res = await alpha.patch<{ error: string }>(`/admin/users/${rootUserId}`, {
      active: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("platform super-admin");
    expect((await alpha.delete(`/admin/users/${rootUserId}`)).status).toBe(400);
  });

  it("wants a real boolean and a real account", async () => {
    expect((await alpha.patch(`/admin/users/${rootUserId}`, { active: "yes" })).status).toBe(400);
    expect((await alpha.patch("/admin/users/999999", { active: false })).status).toBe(404);
    expect((await alpha.delete("/admin/users/999999")).status).toBe(404);
  });

  it("lets nobody with a `user` role near accounts", async () => {
    expect((await alphaUser.patch(`/admin/users/${rootUserId}`, { active: false })).status).toBe(403);
    expect((await alphaUser.delete(`/admin/users/${rootUserId}`)).status).toBe(403);
  });
});

// A resend is the same operator's job as the return it follows: whoever picked the box off the shelf
// knows it went out again. A `user` may link it, but only inside their own company.
// Kept last in the file: it adds a package, and the counter tests above count them.
describe("a `user` links the resend that follows a return", () => {
  interface ChainLookup {
    id: number;
    sender_id: string;
    chain_id: number | null;
    campaign_id: number;
    chain: { id: number; sender_id: string }[];
  }

  it("links a resend of a returned package, in the original's campaign", async () => {
    const res = await alphaUser.post<{ senderId: string; campaignId: number }>("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: "PQUSERRESEND01ES",
    });
    expect(res.status).toBe(201);
    expect(res.body.senderId).toBe("PQUSERRESEND01ES");
    expect(res.body.campaignId).toBe(alphaCampaign);

    const found = await alphaUser.get<ChainLookup[]>("/returns/lookup?senderId=PQUSERRESEND01ES");
    expect(found.body).toHaveLength(1);
    // The link is stored as the ORIGINAL package's id, not as "the package it replaced".
    expect(found.body[0].chain_id).toBe(alphaReturnedPackageId);
    // And the original opens the chain, whichever attempt you looked up.
    expect(found.body[0].chain[0].id).toBe(alphaReturnedPackageId);
    expect(found.body[0].chain.map((n) => n.sender_id)).toEqual(
      expect.arrayContaining([SENDER_A_RETURNED, "PQUSERRESEND01ES"])
    );
  });

  it("attaches to the original even when the package resent is itself a resend", async () => {
    // The attempt in the middle of a chain must not become the thing the next link points at:
    // every resend in a chain names the same original.
    const middle = await alphaUser.get<ChainLookup[]>(`/returns/lookup?senderId=${SENDER_A_RESEND}`);
    expect(middle.body[0].id).not.toBe(alphaReturnedPackageId);
    expect(middle.body[0].chain_id).toBe(alphaReturnedPackageId);

    const res = await alphaUser.post<{ senderId: string }>("/returns/resend", {
      packageId: middle.body[0].id,
      newSenderId: "PQUSERRESEND04ES",
    });
    expect(res.status).toBe(201);

    const created = await alphaUser.get<ChainLookup[]>("/returns/lookup?senderId=PQUSERRESEND04ES");
    expect(created.body).toHaveLength(1);
    expect(created.body[0].chain_id).toBe(alphaReturnedPackageId);
    expect(created.body[0].chain[0].sender_id).toBe(SENDER_A_RETURNED);
  });

  it("may not resend a package that was never returned", async () => {
    const res = await alphaUser.post("/returns/resend", {
      packageId: betaPackageId,
      newSenderId: "PQUSERFOREIGN01ES",
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "only a returned package can be resent" });
  });
});

// The boundary is the REQUEST, not the account: one team processes returns for every client company,
// so a caller names the customer it is working in and no query ever spans two.
describe("the boundary is the request, not the account", () => {
  it("shows an operator every customer, and each one's campaigns", async () => {
    const customers = await alphaUser.get<{ id: number; name: string }[]>("/returns/customers");
    expect(customers.status).toBe(200);
    expect(customers.body.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Alpha Co", "Beta Co"])
    );

    const campaigns = await alphaUser.get<{ name: string; package_count: number }[]>(
      `/returns/customers/${betaCustomerId}/campaigns`
    );
    expect(campaigns.status).toBe(200);
    expect(campaigns.body).toEqual([
      expect.objectContaining({ name: "Beta March", package_count: 1 }),
    ]);

    expect(
      (await alphaUser.get<{ error: string }>("/returns/customers/999999/campaigns")).status
    ).toBe(200);
  });

  it("scopes a lookup to the customer it names, and never mixes two", async () => {
    // With no customer named, only the caller's own company is searched.
    expect((await alpha.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_B}`)).body).toEqual([]);

    // Naming Beta finds Beta's package, and nothing of Alpha's.
    const asBeta = await alpha.get<LookupRow[]>(
      `/returns/lookup?senderId=${SENDER_B}&customerId=${betaCustomerId}`
    );
    expect(asBeta.body).toHaveLength(1);
    expect(asBeta.body[0].campaign_id).toBe(betaCampaign);
  });

  it("records a return in the customer the package belongs to, not the caller's", async () => {
    const res = await alphaUser.post("/returns", {
      senderId: SENDER_B,
      packageId: betaPackageId,
      reasonCode: "tienda_cerrada",
    });
    expect(res.status).toBe(201);

    // It belongs to Beta...
    const asBeta = await beta.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_B}`);
    expect(asBeta.body[0].return_id).not.toBeNull();
    // ...and never appears in the caller's own company.
    const alphaRecent = await alpha.get<{ sender_id: string }[]>("/returns");
    expect(alphaRecent.body.map((r) => r.sender_id)).not.toContain(SENDER_B);
  });

  it("resends another customer's returned package, still inside that customer", async () => {
    const res = await alphaUser.post<{ campaignId: number }>("/returns/resend", {
      packageId: betaPackageId,
      newSenderId: "PQCROSS001ES",
    });
    expect(res.status).toBe(201);
    expect(res.body.campaignId).toBe(betaCampaign);

    const betaPackages = await beta.get<PackageRow[]>(`/campaigns/${betaCampaign}/packages`);
    expect(betaPackages.body.map((p) => p.sender_id)).toContain("PQCROSS001ES");
  });

  it("counts each customer separately, whichever one the caller asked for", async () => {
    const betaSummary = await alpha.get<{ sent: number; returns: number; resends: number }>(
      `/returns/summary?customerId=${betaCustomerId}`
    );
    expect(betaSummary.body).toMatchObject({ sent: 2, returns: 1, resends: 1 });
  });

  it("refuses a customer that does not exist", async () => {
    const res = await alpha.get<{ error: string }>("/returns/summary?customerId=999999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "customer not found" });
    expect((await alpha.get<{ error: string }>("/returns/summary?customerId=abc")).status).toBe(400);
  });
});
