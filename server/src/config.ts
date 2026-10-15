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
  // Only needed if the SPA is served from a different origin than the API.
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: num(["DB_PORT"], 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    database: required("DB_NAME"),
  },
};
