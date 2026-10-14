import mysql from "mysql2/promise";
import { config } from "./config";

// Shared connection pool for the API. Isolation is enforced per-query via customer_id.
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  charset: "utf8mb4_unicode_ci",
});
