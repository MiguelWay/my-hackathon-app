import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { config } from "./config";

// Applies every db/migrations/*.sql in filename order, once each, tracked in `schema_migrations`.
export async function runMigrations(): Promise<string[]> {
  const dir = path.resolve(process.cwd(), "db/migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: "utf8mb4_unicode_ci",
    multipleStatements: true,
  });

  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   VARCHAR(255) NOT NULL,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (filename)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    const [rows] = await conn.query<(mysql.RowDataPacket & { filename: string })[]>(
      "SELECT filename FROM schema_migrations"
    );
    const applied = new Set(rows.map((r) => r.filename));

    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file}`);
        continue;
      }
      console.log(`apply ${file}`);
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await conn.query(sql);
      await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
      ran.push(file);
    }
    return ran;
  } finally {
    await conn.end();
  }
}
