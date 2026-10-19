import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
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
const USER_RESEND_1 = "PQUSERRESEND01ES";
const USER_RESEND_2 = "PQUSERRESEND04ES";
const SENDER_B = "PQB000001ES";
const BETA_RESEND = "PQCROSS001ES";

const COLUMNS = ["Fecha de envío", "Dirección", "ID de envío", "Ref. 2"];
const STORE_COLUMN = 3;
const storeOf = (sender: string) => `ST-${sender}`;
const row = (sender: string, city: string) => ["2026-03-01", city, sender, storeOf(sender)];

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

  // ---- customer A: a campaign of seven packages, one returned and resent ----
  // A resend goes out as a package that already exists in the campaign, so every package used later
  // as a resend is uploaded here, exactly as a real list holds it.
  const campaign = await newCampaign(alpha, "Alpha March");
  alphaCampaign = campaign.body.id;
  await alpha.post(`/campaigns/${alphaCampaign}/packages`, {
    filename: "alpha.xlsx",
    columns: COLUMNS,
    senderColumn: 2,
    storeColumn: STORE_COLUMN,
    rows: [
      row(SENDER_A, "Cádiz"),
      row(SENDER_A_RETURNED, "Málaga"),
      row(SENDER_A_THIRD, "Sevilla"),
      row(SENDER_A_RESEND, "Córdoba"),
      row(SENDER_A_SECOND_RESEND, "Granada"),
      row(USER_RESEND_1, "Toledo"),
      row(USER_RESEND_2, "Cuenca"),
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

  // ---- customer B: its own campaign and two packages ----
  const betaCampaignRes = await newCampaign(beta, "Beta March");
  betaCampaign = betaCampaignRes.body.id;
  await beta.post(`/campaigns/${betaCampaign}/packages`, {
    filename: "beta.xlsx",
    columns: COLUMNS,
    senderColumn: 2,
    storeColumn: STORE_COLUMN,
    rows: [row(SENDER_B, "Bilbao"), row(BETA_RESEND, "Vigo")],
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
    expect(packages.body).toHaveLength(7); // the uploaded list
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
      storeColumn: STORE_COLUMN,
      rows: [row("PQHACK001ES", "Nowhere")],
    });
    expect(attempt.status).toBe(404);

    const bPackages = await beta.get<PackageRow[]>(`/campaigns/${betaCampaign}/packages`);
    expect(bPackages.body).toHaveLength(2);
    expect(bPackages.body.map((p) => p.sender_id)).toEqual([SENDER_B, BETA_RESEND]);
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

  it("cannot record a return on B's package by naming its id", async () => {
    // The package id names its own customer, and that customer is not the caller's.
    const res = await alpha.post("/returns", {
      senderId: SENDER_B,
      packageId: betaPackageId,
      reasonCode: "otro",
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "package not found" });

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
    expect(bPackages.body).toHaveLength(2);
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
    ["GET", "/returns/campaigns/1"],
    ["GET", "/returns/lookup?senderId=ANY"],
    ["POST", "/returns"],
    ["POST", "/returns/resend"],
    ["GET", "/admin/customers"],
    ["GET", "/admin/customers/1/campaigns"],
    ["GET", "/admin/users"],
    ["GET", "/admin/campaigns"],
    ["GET", "/admin/campaigns/uploads"],
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

  it("an operator works every client: another company's campaign, packages and uploads", async () => {
    expect((await alphaUser.get(`/campaigns/${betaCampaign}`)).status).toBe(200);
    expect((await alphaUser.get(`/campaigns/${betaCampaign}/packages`)).status).toBe(200);
    expect((await alphaUser.get(`/campaigns/${betaCampaign}/uploads`)).status).toBe(200);
  });

  it("an operator looks inside any campaign it names", async () => {
    const found = await alphaUser.get<LookupRow[]>(
      `/returns/lookup?senderId=${SENDER_B}&campaignId=${betaCampaign}`
    );
    expect(found.body).toHaveLength(1);
    expect(found.body[0].campaign_id).toBe(betaCampaign);
  });

  it("but a tenant's own administrator still cannot name another company's campaign", async () => {
    const res = await alpha.get<{ error: string }>(
      `/returns/lookup?senderId=${SENDER_B}&campaignId=${betaCampaign}`
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "campaign not found" });
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
          storeColumn: STORE_COLUMN,
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

  it("the Users screen lists every account with the customer it belongs to", async () => {
    const res = await alpha.get<
      { email: string; customer_id: number | null; customer_name: string | null }[]
    >("/admin/users");
    expect(res.status).toBe(200);

    const operator = res.body.find((u) => u.email === "alpha-user@test.local");
    expect(operator?.customer_name).toBe("Alpha Co");
    // A platform super-admin has no customer of its own.
    expect(res.body.some((u) => u.customer_id === null)).toBe(true);
  });

  it("keeps the Users screen away from a `user`", async () => {
    expect((await alphaUser.get("/admin/users")).status).toBe(403);
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

  it("a super-admin has no customer data of its own, but is not shut out of what a request names", async () => {
    // The list and the company-wide reports stay scoped to a company, and this account has none...
    expect((await superadmin.get<CampaignRow[]>("/campaigns")).body).toEqual([]);
    expect((await superadmin.get<unknown[]>("/returns")).body).toEqual([]);
    // ...but the boundary is the request (`SECURITY.md` finding 21), so naming a campaign reaches it.
    expect((await superadmin.get(`/campaigns/${alphaCampaign}`)).status).toBe(200);
  });

  it("a resend with no campaign lands in the original package's campaign", async () => {
    // One resend per package, so the next attempt has to come from the one before it: return the first
    // resend, then send that again. The UI no longer asks which campaign — it always stays where the
    // original was sent.
    const middle = await alpha.get<LookupRow[]>(`/returns/lookup?senderId=${SENDER_A_RESEND}`);
    const middleId = middle.body[0].id;
    await alpha.post("/returns", { senderId: SENDER_A_RESEND, reasonCode: "ausente" });

    const created = await alpha.post<{ campaignId: number; campaignName: string }>(
      "/returns/resend",
      { packageId: middleId, newSenderId: SENDER_A_SECOND_RESEND }
    );
    expect(created.status).toBe(201);
    expect(created.body.campaignId).toBe(alphaCampaign);
    expect(created.body.campaignName).toBe("Alpha March");

    const chain = await alpha.get<LookupRow[]>(
      `/returns/lookup?senderId=${SENDER_A_SECOND_RESEND}`
    );
    expect(chain.body[0].chain).toHaveLength(3);
  });

  it("refuses a second resend of the same package", async () => {
    // The original already has a later attempt in its chain, so it cannot go out again: a chain is a
    // line, not a fork.
    const res = await alpha.post<{ error: string }>("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: SENDER_A,
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "this package has already been resent" });
  });

  it("refuses a resend to a package that is not in the campaign", async () => {
    const res = await alpha.post<{ error: string }>("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: "PQNOTHERE001ES",
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "no package with that ID in this campaign" });
  });

  it("refuses to resend a package as itself", async () => {
    const res = await alpha.post<{ error: string }>("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: SENDER_A_RETURNED,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "a package cannot be resent as itself" });
  });

  it("refuses a package that is already part of a chain", async () => {
    const res = await alpha.post<{ error: string }>("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: SENDER_A_RESEND,
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "that package is already part of a resend chain" });
  });

  it("refuses a returned package as the resend", async () => {
    // SENDER_A_THIRD came back in an earlier test and is not part of any chain.
    const res = await alpha.post<{ error: string }>("/returns/resend", {
      packageId: alphaReturnedPackageId,
      newSenderId: SENDER_A_THIRD,
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "that package has already been returned" });
  });

  it("the recent list names the package a resend was sent as", async () => {
    // The first resend was returned by the test above, so it shows up in the list in its own right.
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

    // A customer is registered on its own, so nothing is created with it.
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
      storeColumn: STORE_COLUMN,
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
    // Seven uploaded lines; the resend target is one of them, marked as the second attempt.
    expect(of("Alpha March")).toMatchObject({
      total_rows: 7,
      package_count: 7,
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
    // beforeAll imported one seven-line list into Alpha March; Alpha Reprise got one line.
    expect(of("Alpha March")).toMatchObject({ upload_count: 1, total_rows: 7 });
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
      row_count: 7,
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
    expect(list.row_count).toBe(7);

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
    // A header row plus the seven uploaded lines. A resend target is an uploaded line too, so it is
    // here — the report says which attempt it is in the chain columns.
    expect(matrix).toHaveLength(8);
    expect(matrix.slice(1).map((r) => String(r[2])).sort()).toEqual(
      [
        SENDER_A,
        SENDER_A_RETURNED,
        SENDER_A_THIRD,
        SENDER_A_RESEND,
        SENDER_A_SECOND_RESEND,
        USER_RESEND_1,
        USER_RESEND_2,
      ].sort()
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
    // Eight packages exist across the company (seven uploaded to Alpha March, one to Alpha Reprise),
    // three came back, two were resent.
    expect(summary.body.sent).toBe(8);
    expect(summary.body.returns).toBe(3);
    expect(summary.body.resends).toBe(2);
    expect(summary.body.recent).toBe(100);
  });

  it("counts only the caller's own company", async () => {
    const betaSummary = await beta.get<{ sent: number; returns: number; resends: number }>(
      "/returns/summary"
    );
    expect(betaSummary.body).toMatchObject({ sent: 2, returns: 0, resends: 0 });
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

  it("keeps the chain report for a super-admin", async () => {
    // A `user` has no company-wide reports; the gate test below spells that out endpoint by endpoint.
    expect((await alphaUser.get("/returns/chains")).status).toBe(403);

    const res = await alpha.get<ChainRow[]>("/returns/chains");
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

  it("shades returned rows red and resent rows green in the campaign export", async () => {
    // The colours are the point of the export: the operator's original list, marked up.
    const res = await alpha.raw(`/campaigns/${alphaCampaign}/export`);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    const sheet = wb.worksheets[0];

    const fillOf = (sender: string): string | undefined => {
      let found: string | undefined;
      sheet.eachRow((row) => {
        if (String(row.getCell(3).value) === sender) {
          const fill = row.getCell(1).fill as { fgColor?: { argb?: string } } | undefined;
          found = fill?.fgColor?.argb;
        }
      });
      return found;
    };

    expect(fillOf(SENDER_A)).toBeUndefined(); // never came back
    expect(fillOf(SENDER_A_RETURNED)).toBe("FFFFC7CE"); // red
    expect(fillOf(SENDER_A_SECOND_RESEND)).toBe("FFC6EFCE"); // green
    // Returned wins over resent: this one went out again AND came back.
    expect(fillOf(SENDER_A_RESEND)).toBe("FFFFC7CE");
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
    // One resend per package: the latest attempt has to come back before it can be sent again.
    await alphaUser.post("/returns", { senderId: SENDER_A_SECOND_RESEND, reasonCode: "ausente" });
    const latest = await alphaUser.get<ChainLookup[]>(
      `/returns/lookup?senderId=${SENDER_A_SECOND_RESEND}`
    );

    const res = await alphaUser.post<{ senderId: string; campaignId: number }>("/returns/resend", {
      packageId: latest.body[0].id,
      newSenderId: USER_RESEND_1,
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
    // every resend in a chain names the same original. This one has to come back before it can be
    // sent again, since a package may be resent only once.
    await alphaUser.post("/returns", { senderId: "PQUSERRESEND01ES", reasonCode: "ausente" });
    const middle = await alphaUser.get<ChainLookup[]>(
      "/returns/lookup?senderId=PQUSERRESEND01ES"
    );
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
      expect.objectContaining({ name: "Beta March", package_count: 2 }),
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
      newSenderId: BETA_RESEND,
    });
    expect(res.status).toBe(201);
    expect(res.body.campaignId).toBe(betaCampaign);

    const betaPackages = await beta.get<PackageRow[]>(`/campaigns/${betaCampaign}/packages`);
    expect(betaPackages.body.map((p) => p.sender_id)).toContain(BETA_RESEND);
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

// One campaign's identity and its own counters: what the campaign returns screen loads, and what a
// campaign row in the picker prints.
describe("a campaign's own read", () => {
  interface CampaignHead {
    id: number;
    name: string;
    start_date: string | null;
    finish_date: string | null;
    customer_id: number;
    customer_name: string;
    sent: number;
    returns: number;
    resends: number;
  }

  it("hands back any campaign's identity and counters, from the same session", async () => {
    // The request names the campaign, and the campaign names its customer — so a `user` of Alpha can
    // read Beta's campaign without naming Beta at all.
    const res = await alphaUser.get<CampaignHead>(`/returns/campaigns/${betaCampaign}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: betaCampaign,
      name: "Beta March",
      customer_id: betaCustomerId,
      customer_name: "Beta Co",
    });
    expect(res.body.sent).toBeGreaterThan(0);
  });

  it("counts only the campaign, never its customer", async () => {
    // A second campaign of the same customer, empty. If these counters were the customer's, the two
    // would read the same.
    const empty = await newCampaign(alpha, "Alpha Empty");
    const idle = await alpha.get<CampaignHead>(`/returns/campaigns/${empty.body.id}`);
    expect(idle.body.customer_id).toBe(alphaCustomerId);
    expect(idle.body).toMatchObject({ sent: 0, returns: 0, resends: 0 });

    const busy = await alpha.get<CampaignHead>(`/returns/campaigns/${alphaCampaign}`);
    expect(busy.body.sent).toBeGreaterThan(0);
    expect(busy.body.returns).toBeGreaterThan(0);
  });

  it("refuses a campaign that does not exist", async () => {
    expect((await alpha.get<{ error: string }>("/returns/campaigns/999999")).status).toBe(404);
    expect((await alpha.get<{ error: string }>("/returns/campaigns/abc")).status).toBe(400);
  });

  it("reports each campaign's package and return counts for the picker", async () => {
    const list = await alphaUser.get<
      { name: string; package_count: number; return_count: number }[]
    >(`/returns/customers/${betaCustomerId}/campaigns`);
    expect(list.status).toBe(200);
    // Beta March holds its uploaded package and the resend added earlier, and one return.
    expect(list.body).toEqual([
      expect.objectContaining({ name: "Beta March", package_count: 2, return_count: 1 }),
    ]);
  });

  it("keeps the company-wide reports for a super-admin", async () => {
    const reports = ["/returns", "/returns/summary", "/returns/chains", "/returns/chains/export"];
    for (const path of reports) {
      expect((await alphaUser.get(path)).status).toBe(403);
      expect((await alpha.get(path)).status).toBe(200);
    }
  });
});

// A customer is created on its own; the screen then sends you to the campaign form with that customer
// already chosen, so its first campaign is made the same way as every campaign after it.
describe("a customer starts with no campaigns", () => {
  let newCustomerId = 0;

  it("registers the customer alone", async () => {
    const created = await superadmin.post<{ id: number; name: string }>("/admin/customers", {
      name: "Zeta Co",
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Zeta Co");
    newCustomerId = created.body.id;

    // Nothing came with it: no campaign is invented on its behalf.
    const campaigns = await superadmin.get<unknown[]>(
      `/admin/customers/${newCustomerId}/campaigns`
    );
    expect(campaigns.body).toEqual([]);
  });

  it("takes its first campaign, aimed at it by name", async () => {
    const campaign = await superadmin.post<{ customer_id: number; name: string }>("/campaigns", {
      customerId: newCustomerId,
      name: "Zeta launch",
      startDate: "2026-05-01",
      finishDate: "2026-05-31",
    });
    expect(campaign.status).toBe(201);
    expect(campaign.body.customer_id).toBe(newCustomerId);

    const theirs = await superadmin.get<{ name: string }[]>(
      `/admin/customers/${newCustomerId}/campaigns`
    );
    expect(theirs.body.map((c) => c.name)).toEqual(["Zeta launch"]);
  });

  it("lists every campaign on the platform, each with the company it belongs to", async () => {
    const res = await superadmin.get<
      {
        name: string;
        customer_id: number;
        customer_name: string;
        package_count: number;
        return_count: number;
        resend_count: number;
      }[]
    >("/admin/campaigns");
    expect(res.status).toBe(200);
    expect(res.body.find((c) => c.name === "Zeta launch")).toMatchObject({
      customer_id: newCustomerId,
      customer_name: "Zeta Co",
      // The Campaigns screen draws the same counters as a campaign's own screen.
      package_count: 0,
      return_count: 0,
      resend_count: 0,
    });
    // The tenant route is unchanged: a platform super-admin has no company, so it still reads empty.
    expect((await superadmin.get<unknown[]>("/campaigns")).body).toEqual([]);
  });

  it("creates a campaign for the company the platform super-admin names", async () => {
    const created = await superadmin.post<{ customer_id: number; name: string }>("/campaigns", {
      customerId: alphaCustomerId,
      name: "Alpha Placed",
      startDate: "2026-07-01",
      finishDate: "2026-07-31",
    });
    expect(created.status).toBe(201);
    expect(created.body.customer_id).toBe(alphaCustomerId);

    // It lands in Alpha's own list, and in nobody else's.
    expect((await alpha.get<{ name: string }[]>("/campaigns")).body.map((c) => c.name)).toContain(
      "Alpha Placed"
    );
    expect(
      (await beta.get<{ name: string }[]>("/campaigns")).body.map((c) => c.name)
    ).not.toContain("Alpha Placed");
  });

  it("makes a platform super-admin name a company, and refuses one that does not exist", async () => {
    const window = { startDate: "2026-07-01", finishDate: "2026-07-31" };

    const unnamed = await superadmin.post("/campaigns", { name: "Nowhere", ...window });
    expect(unnamed.status).toBe(400);

    const unknown = await superadmin.post("/campaigns", {
      customerId: 999999,
      name: "Nowhere",
      ...window,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "customer not found" });

    const bad = await superadmin.post("/campaigns", {
      customerId: "abc",
      name: "Nowhere",
      ...window,
    });
    expect(bad.status).toBe(400);
  });

  it("keeps a company super-admin inside its own company", async () => {
    // Naming its own company is a no-op, and is allowed.
    const own = await alpha.post<{ customer_id: number }>("/campaigns", {
      customerId: alphaCustomerId,
      name: "Alpha Own",
      startDate: "2026-08-01",
      finishDate: "2026-08-31",
    });
    expect(own.status).toBe(201);
    expect(own.body.customer_id).toBe(alphaCustomerId);

    // Naming somebody else's is not.
    const foreign = await alpha.post<{ error: string }>("/campaigns", {
      customerId: betaCustomerId,
      name: "Planted",
      startDate: "2026-08-01",
      finishDate: "2026-08-31",
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({
      error: "you can only create campaigns for your own company",
    });
    expect(
      (await beta.get<{ name: string }[]>("/campaigns")).body.map((c) => c.name)
    ).not.toContain("Planted");
  });

  it("keeps the platform campaign lists away from a `user`", async () => {
    expect((await alphaUser.get("/admin/campaigns")).status).toBe(403);
    expect((await alphaUser.get("/admin/campaigns/uploads")).status).toBe(403);
  });

  it("lists the uploaded lists of every campaign for a platform super-admin", async () => {
    const res = await superadmin.get<{ filename: string }[]>("/admin/campaigns/uploads");
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.filename)).toEqual(
      expect.arrayContaining(["alpha.xlsx", "beta.xlsx"])
    );
  });

  it("creates a platform account with no customer, and it reaches every campaign", async () => {
    const created = await superadmin.post<{
      id: number;
      role: string;
      customerId: number | null;
    }>("/admin/users", {
      email: "platform-operator@test.local",
      password: "password123",
      role: "user",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ role: "user", customerId: null });

    const operator = newClient(server.baseUrl);
    await operator.login("platform-operator@test.local", "password123");
    expect((await operator.get(`/campaigns/${alphaCampaign}`)).status).toBe(200);
  });

  it("refuses a company super-admin the customer-less account route", async () => {
    const res = await alpha.post("/admin/users", {
      email: "escalate@test.local",
      password: "password123",
      role: "superadmin",
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringContaining("platform super-admin") });
  });

  it("lists customers A to Z for the administrator and for the operator", async () => {
    const sources = [
      { client: superadmin, path: "/admin/customers" },
      { client: alphaUser, path: "/returns/customers" },
    ];
    for (const { client, path } of sources) {
      const res = await client.get<{ name: string }[]>(path);
      expect(res.status).toBe(200);
      const names = res.body.map((c) => c.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });
});

// Deleting a campaign or a customer: the admin's destructive actions. Campaigns cascade to their
// uploads, packages and returns; a customer's campaigns are removed with it, but its accounts are not.
describe("deleting campaigns and customers", () => {
  const window = { startDate: "2026-08-01", finishDate: "2026-08-31" };

  async function makeCustomer(name: string): Promise<number> {
    const res = await superadmin.post<{ id: number }>("/admin/customers", { name });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function makeCampaign(customerId: number | null, name: string): Promise<number> {
    const res = await superadmin.post<{ id: number }>("/campaigns", {
      ...window,
      name,
      ...(customerId === null ? {} : { customerId }),
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function upload(campaignId: number, sender: string): Promise<void> {
    const res = await superadmin.post(`/campaigns/${campaignId}/packages`, {
      filename: "delete-test.xlsx",
      columns: COLUMNS,
      senderColumn: 2,
      storeColumn: STORE_COLUMN,
      rows: [row(sender, "Madrid")],
    });
    expect(res.status).toBe(201);
  }

  it("deletes a campaign with its packages, leaving the customer", async () => {
    const customerId = await makeCustomer("Campaign Delete Co");
    const campaignId = await makeCampaign(customerId, "Disposable campaign");
    await upload(campaignId, "PQDELETE0001ES");

    const res = await superadmin.delete<{ id: number }>(`/campaigns/${campaignId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(campaignId);
    expect((await superadmin.get(`/campaigns/${campaignId}`)).status).toBe(404);

    // The customer is still there.
    const customers = await superadmin.get<{ id: number }[]>("/admin/customers");
    expect(customers.body.some((c) => c.id === customerId)).toBe(true);
    await superadmin.delete(`/admin/customers/${customerId}`);
  });

  it("deletes a customer with its campaigns and packages", async () => {
    const customerId = await makeCustomer("Customer Delete Co");
    const campaignId = await makeCampaign(customerId, "Goes with the customer");
    await upload(campaignId, "PQDELETE0002ES");

    const res = await superadmin.delete<{ deletedCampaigns: number }>(
      `/admin/customers/${customerId}`
    );
    expect(res.status).toBe(200);
    expect(res.body.deletedCampaigns).toBe(1);

    const customers = await superadmin.get<{ id: number }[]>("/admin/customers");
    expect(customers.body.some((c) => c.id === customerId)).toBe(false);
    expect((await superadmin.get(`/campaigns/${campaignId}`)).status).toBe(404);
  });

  it("lets a company super-admin delete a campaign in its own company", async () => {
    const created = await alpha.post<{ id: number }>("/campaigns", {
      ...window,
      name: "Alpha disposable",
    });
    expect(created.status).toBe(201);
    expect((await alpha.delete(`/campaigns/${created.body.id}`)).status).toBe(200);
  });

  it("refuses a company super-admin deleting a customer", async () => {
    const res = await alpha.delete(`/admin/customers/${alphaCustomerId}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "only a platform super-admin can delete a customer" });
  });

  it("refuses an operator both deletions", async () => {
    expect((await alphaUser.delete(`/campaigns/${alphaCampaign}`)).status).toBe(403);
    expect((await alphaUser.delete(`/admin/customers/${alphaCustomerId}`)).status).toBe(403);
  });

  it("refuses a customer that still has an account attached", async () => {
    const customerId = await makeCustomer("Has Accounts Co");
    const made = await superadmin.post<{ id: number }>(`/admin/customers/${customerId}/users`, {
      email: "attached@test.local",
      password: "password123",
      role: "user",
    });
    expect(made.status).toBe(201);

    const blocked = await superadmin.delete<{ error: string }>(`/admin/customers/${customerId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain("accounts attached");

    // Once the account is gone, the customer can go.
    expect((await superadmin.delete(`/admin/users/${made.body.id}`)).status).toBe(200);
    expect((await superadmin.delete(`/admin/customers/${customerId}`)).status).toBe(200);
  });
});
describe("one customer name, one customer", () => {
  it("refuses a name that is already taken, whatever its case", async () => {
    const first = await superadmin.post("/admin/customers", { name: "Duplicado SA" });
    expect(first.status).toBe(201);

    const again = await superadmin.post("/admin/customers", { name: "duplicado sa" });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: 'a customer called "duplicado sa" already exists' });
  });

  it("treats an accent as the same name, which is how the pair that prompted this appeared", async () => {
    const accented = await superadmin.post("/admin/customers", { name: "Plátano Nuevo" });
    expect(accented.status).toBe(201);

    const plain = await superadmin.post("/admin/customers", { name: "platano nuevo" });
    expect(plain.status).toBe(409);
  });
});

// The boundary is the request: a list goes into the campaign it was uploaded to, and that campaign's
// customer owns it. Without this, a platform super-admin — who has no company of its own — cannot
// upload the list for the customer and campaign it just created.
describe("a platform super-admin fills in a campaign it is not attached to", () => {
  it("opens the campaign, its lists and its packages", async () => {
    const res = await superadmin.get<{ customer_id: number; name: string }>(
      `/campaigns/${alphaCampaign}`
    );
    expect(res.status).toBe(200);
    expect(res.body.customer_id).toBe(alphaCustomerId);
    expect((await superadmin.get(`/campaigns/${alphaCampaign}/uploads`)).status).toBe(200);
    expect((await superadmin.get(`/campaigns/${alphaCampaign}/packages`)).status).toBe(200);
  });

  it("uploads a list into it, and the packages belong to that campaign's customer", async () => {
    const res = await superadmin.post<{ imported: number }>(`/campaigns/${betaCampaign}/packages`, {
      filename: "platform.xlsx",
      columns: COLUMNS,
      senderColumn: 2,
      storeColumn: STORE_COLUMN,
      rows: [row("PQAPLATFORM01ES", "Lugo")],
    });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);

    // Beta sees it: the campaign's customer is Beta, not the platform admin, which has none.
    const betaPackages = await beta.get<PackageRow[]>(`/campaigns/${betaCampaign}/packages`);
    expect(betaPackages.body.map((p) => p.sender_id)).toContain("PQAPLATFORM01ES");
  });

  it("renames and re-dates it, and refuses a blank name", async () => {
    const renamed = await superadmin.patch<{ name: string }>(`/campaigns/${betaCampaign}`, {
      name: "Beta March renamed",
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Beta March renamed");
    expect((await superadmin.patch(`/campaigns/${betaCampaign}`, { name: "  " })).status).toBe(400);
  });

  it("still keeps a company super-admin inside its own company", async () => {
    expect((await alpha.get(`/campaigns/${alphaCampaign}`)).status).toBe(200);
    expect((await alpha.get(`/campaigns/${betaCampaign}`)).status).toBe(404);
    expect(
      (
        await alpha.post(`/campaigns/${betaCampaign}/packages`, {
          filename: "x.xlsx",
          columns: COLUMNS,
          senderColumn: 2,
          storeColumn: STORE_COLUMN,
          rows: [row("PQNOPE004ES", "Nowhere")],
        })
      ).status
    ).toBe(404);
  });
});

// The campaign's return package list: the IDs behind the two counters, one row each.
describe("a campaign's return package list", () => {
  interface ListRow {
    sender_id: string;
    status: "Returned" | "Resent";
    reason_label: string | null;
  }
  interface LinkRow {
    returned_id: string;
    reason: string | null;
    resent_id: string;
    returned_again_id: string | null;
    returned_again_reason: string | null;
  }
  interface ReasonRow {
    code: string;
    label: string;
    count: number;
  }
  interface ListBody {
    campaign: { id: number; name: string };
    rows: ListRow[];
    links: LinkRow[];
    reasons: ReasonRow[];
  }

  it("lists every returned and resent package once, a return winning", async () => {
    const res = await alpha.get<ListBody>(`/returns/campaigns/${alphaCampaign}/return-list`);
    expect(res.status).toBe(200);
    expect(res.body.campaign).toEqual({ id: alphaCampaign, name: "Alpha March" });

    const byId = new Map(res.body.rows.map((r) => [r.sender_id, r]));
    expect(byId.get(SENDER_A_RETURNED)).toMatchObject({
      status: "Returned",
      reason_label: "estacionada",
    });
    expect(byId.get(USER_RESEND_2)).toMatchObject({ status: "Resent", reason_label: null });
    // Returned and resent: one row, and it reads as a return.
    expect(res.body.rows.filter((r) => r.sender_id === SENDER_A_RESEND)).toHaveLength(1);
    expect(byId.get(SENDER_A_RESEND)?.status).toBe("Returned");
    // Never returned and never resent → not on the list.
    expect(byId.has(SENDER_A)).toBe(false);

    // One row per return → resend pair, in chain order, with the resent package's own return beside it.
    expect(res.body.links).toHaveLength(4);
    expect(res.body.links[0]).toEqual({
      returned_id: SENDER_A_RETURNED,
      reason: "estacionada",
      resent_id: SENDER_A_RESEND,
      returned_again_id: SENDER_A_RESEND,
      returned_again_reason: "ausente",
    });
    // The last resend has not come back, so its own two columns are empty.
    expect(res.body.links[3]).toEqual({
      returned_id: USER_RESEND_1,
      reason: "ausente",
      resent_id: USER_RESEND_2,
      returned_again_id: null,
      returned_again_reason: null,
    });

    // The category summary counts returned packages only, and keeps every seeded category in its
    // configured order — zeroes included, so the chart never changes shape between campaigns.
    expect(res.body.reasons.map((r) => r.code)).toEqual([
      "tienda_cerrada",
      "ausente",
      "direccion_incorrecta",
      "estacionada",
      "otro",
    ]);
    const returnedByLabel = new Map<string, number>();
    for (const r of res.body.rows) {
      if (r.status !== "Returned" || !r.reason_label) continue;
      returnedByLabel.set(r.reason_label, (returnedByLabel.get(r.reason_label) ?? 0) + 1);
    }
    for (const reason of res.body.reasons) {
      expect(reason.count).toBe(returnedByLabel.get(reason.label) ?? 0);
    }
    expect(res.body.reasons.reduce((n, r) => n + r.count, 0)).toBe(
      res.body.rows.filter((r) => r.status === "Returned").length
    );
  });

  it("is open to an operator, and never mixes campaigns", async () => {
    const mine = await alphaUser.get<ListBody>(
      `/returns/campaigns/${alphaCampaign}/return-list`
    );
    expect(mine.status).toBe(200);
    expect(mine.body.rows.every((r) => r.sender_id !== SENDER_B)).toBe(true);
  });

  it("refuses another company's campaign to a confined administrator", async () => {
    expect((await beta.get(`/returns/campaigns/${alphaCampaign}/return-list`)).status).toBe(404);
    expect(
      (await beta.get(`/returns/campaigns/${alphaCampaign}/return-list/export`)).status
    ).toBe(404);
  });

  it("wants a real campaign", async () => {
    expect((await alpha.get("/returns/campaigns/999999/return-list")).status).toBe(404);
    expect((await alpha.get("/returns/campaigns/abc/return-list")).status).toBe(400);
  });

  it("keeps the workbook for an administrator", async () => {
    // The operator can read the list, but not take it away; the route refuses the same way the
    // hidden button does.
    expect(
      (await alphaUser.raw(`/returns/campaigns/${alphaCampaign}/return-list/export`)).status
    ).toBe(403);
  });

  it("downloads the same rows and the category summary as an .xlsx, marked red and green", async () => {
    const res = await alpha.raw(`/returns/campaigns/${alphaCampaign}/return-list/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("return-package-list");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Return package list",
      "Resend links",
      "Returns by category",
    ]);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).values.slice(1)).toEqual(["Package ID", "Status", "Reason"]);

    const ids: string[] = [];
    const fills = new Map<string, string | undefined>();
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const id = String(row.getCell(1).value);
      ids.push(id);
      const fill = row.getCell(1).fill as { fgColor?: { argb?: string } } | undefined;
      fills.set(id, fill?.fgColor?.argb);
    });
    expect(ids).toContain(USER_RESEND_2);
    expect(fills.get(USER_RESEND_2)).toBe("FFC6EFCE"); // resent, green
    expect(fills.get(SENDER_A_RETURNED)).toBe("FFFFC7CE"); // returned, red
    expect(fills.get(SENDER_A_RESEND)).toBe("FFFFC7CE"); // both: red wins

    // The second sheet is the links table, and it carries no colours.
    const links = wb.worksheets[1];
    expect(links.getRow(1).values.slice(1)).toEqual([
      "Returned ID",
      "Reason",
      "Resent ID",
      "Returned ID",
      "Reason",
    ]);
    expect(links.getRow(2).values.slice(1)).toEqual([
      SENDER_A_RETURNED,
      "estacionada",
      SENDER_A_RESEND,
      SENDER_A_RESEND,
      "ausente",
    ]);
    const linkFill = links.getRow(2).getCell(1).fill as
      | { fgColor?: { argb?: string } }
      | undefined;
    expect(linkFill?.fgColor?.argb).toBeUndefined();

    // The third sheet is the category summary, in the same seeded order as the screen.
    const reasonsSheet = wb.worksheets[2];
    expect(reasonsSheet.getRow(1).values.slice(1)).toEqual(["Category", "Returned packages"]);
    const categories: string[] = [];
    let exportedTotal = 0;
    reasonsSheet.eachRow((row, n) => {
      if (n === 1) return;
      categories.push(String(row.getCell(1).value));
      exportedTotal += Number(row.getCell(2).value);
    });
    expect(categories).toEqual([
      "tienda cerrada",
      "ausente",
      "dirección incorrecta",
      "estacionada",
      "otro",
    ]);
    expect(exportedTotal).toBe([...fills.values()].filter((argb) => argb === "FFFFC7CE").length);
  });
});

// The separate returns + store ID report: one row per return → resend link, with each package's store.
describe("a campaign's returns + store ID report", () => {
  interface StoreRow {
    returned_store_id: string;
    returned_id: string;
    reason: string | null;
    resend_store_id: string;
    resend_id: string;
  }
  interface Body {
    campaign: { id: number; name: string };
    rows: StoreRow[];
  }

  it("pairs each returned package with the store of its resend", async () => {
    const res = await alpha.get<Body>(`/returns/campaigns/${alphaCampaign}/store-report`);
    expect(res.status).toBe(200);
    expect(res.body.campaign).toEqual({ id: alphaCampaign, name: "Alpha March" });
    expect(res.body.rows).toHaveLength(4);
    expect(res.body.rows[0]).toEqual({
      returned_store_id: storeOf(SENDER_A_RETURNED),
      returned_id: SENDER_A_RETURNED,
      reason: "estacionada",
      resend_store_id: storeOf(SENDER_A_RESEND),
      resend_id: SENDER_A_RESEND,
    });
    expect(res.body.rows[3]).toEqual({
      returned_store_id: storeOf(USER_RESEND_1),
      returned_id: USER_RESEND_1,
      reason: "ausente",
      resend_store_id: storeOf(USER_RESEND_2),
      resend_id: USER_RESEND_2,
    });
  });

  it("is open to an operator, and closed to another company", async () => {
    expect(
      (await alphaUser.get(`/returns/campaigns/${alphaCampaign}/store-report`)).status
    ).toBe(200);
    expect((await beta.get(`/returns/campaigns/${alphaCampaign}/store-report`)).status).toBe(404);
    expect(
      (await beta.get(`/returns/campaigns/${alphaCampaign}/store-report/export`)).status
    ).toBe(404);
  });

  it("wants a real campaign", async () => {
    expect((await alpha.get("/returns/campaigns/999999/store-report")).status).toBe(404);
    expect((await alpha.get("/returns/campaigns/abc/store-report")).status).toBe(400);
  });

  it("keeps the workbook for an administrator", async () => {
    expect(
      (await alphaUser.raw(`/returns/campaigns/${alphaCampaign}/store-report/export`)).status
    ).toBe(403);
  });

  it("downloads as one plain sheet with both pairs of columns", async () => {
    const res = await alpha.raw(`/returns/campaigns/${alphaCampaign}/store-report/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("returns-store-id");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Returns + Store ID"]);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).values.slice(1)).toEqual([
      "Store ID",
      "Return package ID",
      "Reason",
      "Store ID",
      "Resend package ID",
    ]);
    expect(sheet.getRow(2).values.slice(1)).toEqual([
      storeOf(SENDER_A_RETURNED),
      SENDER_A_RETURNED,
      "estacionada",
      storeOf(SENDER_A_RESEND),
      SENDER_A_RESEND,
    ]);
  });
});
