// Test harness for the API. Everything here talks to a SEPARATE database
// (`package_returns_test`) so the dev data is never touched.
//
// The env vars below MUST be set before anything imports server/src/config, so the
// config-dependent modules are pulled in with dynamic import().

process.env.DB_NAME = process.env.TEST_DB_NAME ?? "package_returns_test";
process.env.DB_HOST = process.env.DB_HOST ?? "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT ?? "3306";
process.env.DB_USER = process.env.DB_USER ?? "appuser";
process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? "devpassword";
process.env.SESSION_TTL_DAYS = process.env.SESSION_TTL_DAYS ?? "30";

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const db = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

/** Drops every table in the test database, then re-applies all migrations. */
export async function resetDatabase(): Promise<void> {
  const conn = await mysql.createConnection({ ...db, multipleStatements: true });
  const [rows] = await conn.query<mysql.RowDataPacket[]>("SHOW TABLES");
  const key = `Tables_in_${db.database}`;
  const tables = rows.map((r) => String(r[key] ?? Object.values(r)[0]));
  if (tables.length) {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of tables) {
      if (!/^[A-Za-z0-9_]+$/.test(t)) throw new Error(`refusing to drop suspicious table: ${t}`);
      await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
    }
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  await conn.end();
  const { runMigrations } = await import("../../server/src/migrations");
  await runMigrations();
}

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const { app } = await import("../../server/src/app");
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

export async function closePool(): Promise<void> {
  const { pool } = await import("../../server/src/db");
  await pool.end();
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/** A tiny cookie-aware HTTP client, so each fake user keeps its own session. */
export class Client {
  private cookie = "";

  constructor(private readonly baseUrl: string) {}

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const headerBag = res.headers as unknown as { getSetCookie?: () => string[] };
    for (const raw of headerBag.getSetCookie?.() ?? []) {
      const pair = raw.split(";")[0];
      if (pair.startsWith("session=")) this.cookie = pair;
    }

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  readonly get = <T = unknown>(path: string) => this.request<T>("GET", path);
  readonly post = <T = unknown>(path: string, body?: unknown) =>
    this.request<T>("POST", path, body);
  readonly patch = <T = unknown>(path: string, body?: unknown) =>
    this.request<T>("PATCH", path, body);

  async register(customerName: string, email: string, password: string) {
    const res = await this.post<{ id: number; customerId: number; role: string }>(
      "/auth/register",
      { customerName, email, password }
    );
    if (res.status !== 201) {
      throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async login(email: string, password: string) {
    const res = await this.post<{ id: number; role: string; customerId: number | null }>(
      "/auth/login",
      { email, password }
    );
    if (res.status !== 200) {
      throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }
}

export const newClient = (baseUrl: string) => new Client(baseUrl);

/** Inserts a user directly (there is no API for creating `user`-role or super-admin accounts). */
export async function seedUser(
  customerId: number | null,
  email: string,
  password: string,
  role: "admin" | "user" | "superadmin"
): Promise<number> {
  const conn = await mysql.createConnection(db);
  // Low cost factor: these tests only care about the auth flow, not bcrypt strength.
  const hash = await bcrypt.hash(password, 4);
  const [result] = await conn.query<mysql.ResultSetHeader>(
    "INSERT INTO users (customer_id, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [customerId, email, hash, role]
  );
  await conn.end();
  return result.insertId;
}
