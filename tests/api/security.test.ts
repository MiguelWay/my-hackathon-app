// Security-hardening assertions, run over the real HTTP surface.
//
// Self-signup is switched off BEFORE the harness loads, so production-ish behaviour is exercised.

process.env.ALLOW_SELF_SIGNUP = "false";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closePool,
  newClient,
  resetDatabase,
  seedCustomer,
  seedUser,
  startServer,
  type Client,
  type TestServer,
} from "./helpers";

const COLUMNS = ["Fecha de envío", "ID de envío", "Ref. 2"];

const WINDOW = { startDate: "2026-05-01", finishDate: "2026-05-31" };

let server: TestServer;
let anon: Client;
let admin: Client;

const ADMIN_EMAIL = "sec-admin@test.local";
const ADMIN_PASSWORD = "password123";

beforeAll(async () => {
  await resetDatabase();
  server = await startServer();
  anon = newClient(server.baseUrl);
  admin = newClient(server.baseUrl);

  // Signup is disabled in this suite, so seed the tenant directly.
  const customerId = await seedCustomer("Sec Co");
  await seedUser(customerId, ADMIN_EMAIL, ADMIN_PASSWORD, "superadmin");
  await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
});

afterAll(async () => {
  await closePool();
  await server?.close();
});

describe("security headers", () => {
  it("sets a strict CSP and the usual protections, and hides the framework", async () => {
    const res = await anon.get("/health");
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");

    // Compare directive values as whole tokens: `'wasm-unsafe-eval'` would trip a substring match on
    // "unsafe-eval" even though it only lets the on-device OCR compile WebAssembly and never eval().
    const scriptSrc = csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src ")) ?? "";
    const scriptTokens = scriptSrc.split(/\s+/);
    // Inline script/style would otherwise be required to make the SPA work — it isn't.
    expect(csp).not.toContain("'unsafe-inline'");
    expect(scriptTokens).not.toContain("'unsafe-eval'");
    expect(scriptTokens).not.toContain("'unsafe-inline'");
    expect(scriptTokens).toContain("'wasm-unsafe-eval'");

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBeTruthy();
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    // Don't advertise the stack.
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("advertises the rate-limit budget", async () => {
    const res = await anon.post("/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(Number(res.headers.get("ratelimit-limit"))).toBeGreaterThan(0);
    expect(res.headers.get("ratelimit-policy")).toContain("auth");
  });
});

describe("self-signup is closed when disabled", () => {
  it("refuses to create a tenant", async () => {
    const res = await anon.post("/auth/register", {
      customerName: "Sneaky Co",
      email: "sneaky@test.local",
      password: "password123",
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "self-signup is disabled" });
  });
});

describe("input validation happens at the boundary", () => {
  it("rejects a malformed email on login with a generic message", async () => {
    const res = await anon.post("/auth/login", { email: "not-an-email", password: "whatever" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid email or password" });
  });

  it("does not reveal whether an account exists", async () => {
    const unknown = await anon.post("/auth/login", {
      email: "nobody@test.local",
      password: "password123",
    });
    const wrongPassword = await anon.post("/auth/login", {
      email: ADMIN_EMAIL,
      password: "wrong-password",
    });
    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body).toEqual(wrongPassword.body);
  });

  it("rejects an over-long campaign name with 400, not a database error", async () => {
    const res = await admin.post("/campaigns", { name: "x".repeat(300), ...WINDOW });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("name is required") });
  });

  it("rejects an over-long sender ID with 400, not a database error", async () => {
    const campaign = await admin.post<{ id: number }>("/campaigns", {
      name: "Limits",
      ...WINDOW,
    });
    const res = await admin.post(`/campaigns/${campaign.body.id}/packages`, {
      filename: "x.xlsx",
      columns: COLUMNS,
      senderColumn: 1,
      storeColumn: 2,
      rows: [["2026-03-01", "P".repeat(200), "STORE1"]],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringContaining("longer than 128 characters"),
    });
  });

  it("rejects an over-long password instead of hashing it (bcrypt CPU DoS)", async () => {
    const res = await anon.post("/auth/login", {
      email: ADMIN_EMAIL,
      password: "x".repeat(100_000),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed JSON body with 400, not a 500", async () => {
    // A bad body is the caller's fault; a 500 would hide it and pollute the error log.
    const res = await fetch(`${server.baseUrl}/api/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON body" });
  });

  it("accepts a sender ID exactly at the column limit", async () => {
    const campaign = await admin.post<{ id: number }>("/campaigns", {
      name: "Boundary",
      ...WINDOW,
    });
    const res = await admin.post(`/campaigns/${campaign.body.id}/packages`, {
      filename: "x.xlsx",
      columns: COLUMNS,
      senderColumn: 1,
      storeColumn: 2,
      rows: [["2026-03-01", "P".repeat(128), "STORE1"]],
    });
    expect(res.status).toBe(201);
  });
});

describe("campaign dates are mandatory", () => {
  const post = (body: unknown) =>
    admin.post<{ id: number; start_date: string; finish_date: string }>("/campaigns", body);

  it("rejects a campaign with no dates at all", async () => {
    const res = await post({ name: "No window" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("startDate is required") });
  });

  it("rejects a campaign with only a start date", async () => {
    const res = await post({ name: "Half window", startDate: "2026-05-01" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("finishDate is required") });
  });

  it("rejects a date that is not a real calendar day", async () => {
    for (const bad of ["2026-02-31", "2026-13-01", "2026-5-1", "tomorrow"]) {
      const res = await post({ name: "Bad date", startDate: bad, finishDate: "2026-05-31" });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a finish date before the start date", async () => {
    const res = await post({ name: "Backwards", startDate: "2026-05-31", finishDate: "2026-05-01" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "finishDate cannot be before startDate" });
  });

  it("accepts a valid window, including a single day", async () => {
    const res = await post({ name: "One day", startDate: "2026-05-01", finishDate: "2026-05-01" });
    expect(res.status).toBe(201);
    expect(res.body.start_date).toBe("2026-05-01");
    expect(res.body.finish_date).toBe("2026-05-01");
  });

  it("will not let an update put the dates out of order", async () => {
    const created = await post({ name: "Patch me", ...WINDOW });
    const res = await admin.patch(`/campaigns/${created.body.id}`, { finishDate: "2026-04-01" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "finishDate cannot be before startDate" });

    // A rename on its own is still fine.
    expect((await admin.patch(`/campaigns/${created.body.id}`, { name: "Renamed" })).status).toBe(
      200
    );
  });
});

// A session is not permanent: thirty minutes without a request ends it, even inside the absolute
// 30-day expiry. The clock is `sessions.last_seen_at`, stamped by every authenticated request.
describe("a session ends after 30 minutes of inactivity", () => {
  it("refuses an idle session before its absolute expiry", async () => {
    const client = newClient(server.baseUrl);
    await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect((await client.get("/campaigns")).status).toBe(200);

    const { pool } = await import("../../server/src/db");
    await pool.query(
      `UPDATE sessions s JOIN users u ON u.id = s.user_id
          SET s.last_seen_at = NOW() - INTERVAL 31 MINUTE
        WHERE u.email = ?`,
      [ADMIN_EMAIL]
    );

    expect((await client.get("/campaigns")).status).toBe(401);
  });

  it("keeps a session that is being used, and moves its idle clock forward", async () => {
    const client = newClient(server.baseUrl);
    await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    const { pool } = await import("../../server/src/db");
    await pool.query(
      `UPDATE sessions s JOIN users u ON u.id = s.user_id
          SET s.last_seen_at = NOW() - INTERVAL 29 MINUTE
        WHERE u.email = ?`,
      [ADMIN_EMAIL]
    );

    expect((await client.get("/campaigns")).status).toBe(200);

    const [rows] = await pool.query(
      `SELECT TIMESTAMPDIFF(SECOND, s.last_seen_at, NOW()) AS age
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE u.email = ?
        ORDER BY s.last_seen_at DESC
        LIMIT 1`,
      [ADMIN_EMAIL]
    );
    const age = Number((rows as { age: number }[])[0]?.age);
    expect(age).toBeLessThan(60);
  });
});
