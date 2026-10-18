import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** First non-empty, numeric env var of `names`, else `fallback`. Tolerates `KEY=` in .env files. */
function num(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  // Plesk's Node.js integration sets PORT; API_PORT takes precedence when set (local dev).
  port: num(["API_PORT", "PORT"], 3000),
  isProduction,
  // Serve the built SPA (dist/) from this same process. On by default in production; set
  // SERVE_SPA=false if a web server (e.g. Plesk's Apache) serves the static files instead.
  serveSpa: (process.env.SERVE_SPA ?? String(isProduction)) === "true",
  sessionTtlDays: num(["SESSION_TTL_DAYS"], 30),
  // A session ends after this many minutes without a request. The SPA mirrors the default (30) so it
  // can sign out at the same moment; changing it here also needs the client constant updated.
  sessionIdleMinutes: num(["SESSION_IDLE_MINUTES"], 30),
  // Self-signup creates a whole new tenant, so it is closed in production unless opened deliberately.
  allowSelfSignup: (process.env.ALLOW_SELF_SIGNUP ?? String(!isProduction)) === "true",
  // Only needed if the SPA is served from a different origin than the API.
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  rateLimit: {
    // General ceiling per IP across /api.
    apiMax: num(["RATE_LIMIT_API_MAX"], 300),
    apiWindowMs: num(["RATE_LIMIT_API_WINDOW_MS"], 60_000),
    // Failed auth attempts per IP: ~10 per 15 minutes.
    authMax: num(["RATE_LIMIT_AUTH_MAX"], 10),
    authWindowMs: num(["RATE_LIMIT_AUTH_WINDOW_MS"], 15 * 60_000),
  },
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: num(["DB_PORT"], 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    database: required("DB_NAME"),
  },
};
