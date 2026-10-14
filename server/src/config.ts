import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.API_PORT ?? 3000),
  isProduction: process.env.NODE_ENV === "production",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    database: required("DB_NAME"),
  },
};
