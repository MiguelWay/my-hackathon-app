// Brute-force protection on the login endpoint, exercised over real HTTP.
//
// Its own file so the rate-limit bucket starts empty: the env override below must be set before the
// harness (and therefore server/src/config) loads.

process.env.ALLOW_SELF_SIGNUP = "false";
process.env.RATE_LIMIT_AUTH_MAX = "3";

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

const EMAIL = "ratelimit-admin@test.local";
const PASSWORD = "password123";

let server: TestServer;
let anon: Client;

beforeAll(async () => {
  await resetDatabase();
  server = await startServer();
  anon = newClient(server.baseUrl);
  const customerId = await seedCustomer("Rate Limit Co");
  await seedUser(customerId, EMAIL, PASSWORD, "admin");
});

afterAll(async () => {
  await closePool();
  await server?.close();
});

describe("login rate limiting", () => {
  it("does not spend the brute-force budget on successful logins", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await anon.post("/auth/login", { email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(Number(res.headers.get("ratelimit-remaining"))).toBe(3);
    }
  });

  it("blocks once the failed-attempt budget is used up", async () => {
    const bad = () => anon.post("/auth/login", { email: EMAIL, password: "definitely-wrong" });

    for (let i = 0; i < 3; i++) {
      const res = await bad();
      expect(res.status).toBe(401);
    }

    const blocked = await bad();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: expect.stringContaining("too many requests") });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses even the correct password while the bucket is exhausted", async () => {
    const res = await anon.post("/auth/login", { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(429);
  });
});
