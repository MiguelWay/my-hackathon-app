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

// The translation table: public read for the SPA, administrator-only editing, both languages saved.

interface PublicRow {
  key: string;
  english: string;
  spanish: string;
}

interface AdminRow extends PublicRow {
  id: number;
  screen: string;
  role: string;
  context: string;
  sort_order: number;
  updated_at: string;
}

let server: TestServer;
let anon: Client;
let admin: Client;
let operator: Client;

beforeAll(async () => {
  await resetDatabase();
  server = await startServer();
  anon = newClient(server.baseUrl);
  admin = newClient(server.baseUrl);
  operator = newClient(server.baseUrl);

  const tenant = await admin.register("Translations Co", "trans-admin@test.local", "password123");
  await seedUser(tenant.customerId, "trans-user@test.local", "password123", "user");
  await operator.login("trans-user@test.local", "password123");
});

afterAll(async () => {
  await closePool();
  await server?.close();
});

describe("translations", () => {
  it("serves the live copy without a session, because the login screen needs it", async () => {
    const res = await anon.get<PublicRow[]>("/translations");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(300);
    expect(res.body).toContainEqual({
      key: "login.title",
      english: "Log in",
      spanish: "Iniciar sesión",
    });
  });

  it("keeps the editor for an administrator", async () => {
    expect((await anon.get("/admin/translations")).status).toBe(401);
    expect((await operator.get("/admin/translations")).status).toBe(403);

    const res = await admin.get<AdminRow[]>("/admin/translations");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(300);
    expect(res.body.find((row) => row.key === "login.title")).toMatchObject({
      screen: "login",
      role: "all",
      context: "Page title",
      english: "Log in",
      spanish: "Iniciar sesión",
    });
  });

  it("saves both languages and shows the change to the public reader", async () => {
    const list = await admin.get<AdminRow[]>("/admin/translations");
    const row = list.body.find((entry) => entry.key === "login.title")!;

    const saved = await admin.request("PUT", "/admin/translations", {
      updates: [{ id: row.id, english: "Sign in", spanish: "Acceder" }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ updated: 1 });

    const live = await anon.get<PublicRow[]>("/translations");
    expect(live.body.find((entry) => entry.key === "login.title")).toEqual({
      key: "login.title",
      english: "Sign in",
      spanish: "Acceder",
    });

    const edited = await admin.get<AdminRow[]>("/admin/translations");
    expect(edited.body.find((entry) => entry.key === "login.title")).toMatchObject({
      english: "Sign in",
      spanish: "Acceder",
    });
  });

  it("refuses an empty English original or a malformed update", async () => {
    const list = await admin.get<AdminRow[]>("/admin/translations");
    const row = list.body[0];

    const empty = await admin.request("PUT", "/admin/translations", {
      updates: [{ id: row.id, english: "   ", spanish: "algo" }],
    });
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ error: "english is required" });

    const missing = await admin.request("PUT", "/admin/translations", { updates: [] });
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: "no updates" });
  });

  it("keeps an operator out of the save route too", async () => {
    const list = await admin.get<AdminRow[]>("/admin/translations");
    const row = list.body[0];
    const res = await operator.request("PUT", "/admin/translations", {
      updates: [{ id: row.id, english: "Hacked", spanish: "Hackeado" }],
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "super-admin only" });
  });
});
