// "Forgot password": a one-time emailed link, hashed at rest, single-use and time-limited.
// The email itself is captured in-process by server/src/mailer.ts when the tests run.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const EMAIL = "reset-user@test.local";
const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "new-password-456";

let server: TestServer;
let anon: Client;
let customerId = 0;
let outbox: { to: string; subject: string; text: string }[] = [];

/** The token from the last captured reset email. */
function lastToken(): string {
  const text = outbox.at(-1)?.text ?? "";
  const match = /token=([a-f0-9]{64})/.exec(text);
  if (!match) throw new Error("no reset token in the captured email");
  return match[1];
}

beforeAll(async () => {
  await resetDatabase();
  server = await startServer();
  anon = newClient(server.baseUrl);
  customerId = await seedCustomer("Reset Co");
  await seedUser(customerId, EMAIL, OLD_PASSWORD, "user");
  // The server has already imported the mailer; this returns the same module instance.
  const mailer = await import("../../server/src/mailer");
  outbox = mailer.mailOutbox;
});

beforeEach(() => {
  outbox.length = 0;
});

afterAll(async () => {
  await closePool();
  await server?.close();
});

describe("forgot password", () => {
  it("answers the same way for an unknown address, and sends nothing", async () => {
    const res = await anon.post("/auth/forgot", { email: "nobody@test.local" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(outbox).toHaveLength(0);
  });

  it("emails a one-time link to a real account", async () => {
    const res = await anon.post("/auth/forgot", { email: EMAIL });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(EMAIL);
    expect(lastToken()).toHaveLength(64);
  });

  it("refuses a weak password without using the link", async () => {
    await anon.post("/auth/forgot", { email: EMAIL });
    const res = await anon.post("/auth/reset", { token: lastToken(), newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("at least 8") });
  });

  it("refuses an invented token", async () => {
    const res = await anon.post("/auth/reset", {
      token: "a".repeat(64),
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "that reset link is invalid or has expired" });
  });

  it("resets the password, ends existing sessions, and cannot be reused", async () => {
    const session = newClient(server.baseUrl);
    await session.login(EMAIL, OLD_PASSWORD);
    expect((await session.get("/campaigns")).status).toBe(200);

    await anon.post("/auth/forgot", { email: EMAIL });
    const token = lastToken();
    const res = await anon.post("/auth/reset", { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // The old session is gone, the old password no longer works, the new one does.
    expect((await session.get("/campaigns")).status).toBe(401);
    expect(
      (await anon.post("/auth/login", { email: EMAIL, password: OLD_PASSWORD })).status
    ).toBe(401);
    await anon.login(EMAIL, NEW_PASSWORD);

    // The same link cannot be used a second time.
    const again = await anon.post("/auth/reset", { token, newPassword: "third-password-789" });
    expect(again.status).toBe(400);
  });

  it("invalidates the previous link when a new one is requested", async () => {
    await anon.post("/auth/forgot", { email: EMAIL });
    const first = lastToken();
    await anon.post("/auth/forgot", { email: EMAIL });
    const second = lastToken();
    expect(second).not.toBe(first);

    expect(
      (await anon.post("/auth/reset", { token: first, newPassword: NEW_PASSWORD })).status
    ).toBe(400);
    expect(
      (await anon.post("/auth/reset", { token: second, newPassword: NEW_PASSWORD })).status
    ).toBe(200);
  });

  it("refuses an expired link", async () => {
    const crypto = await import("node:crypto");
    const { pool } = await import("../../server/src/db");
    const token = "b".repeat(64);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       SELECT id, ?, NOW() - INTERVAL 1 MINUTE FROM users WHERE email = ?`,
      [hash, EMAIL]
    );
    const res = await anon.post("/auth/reset", { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });
});
