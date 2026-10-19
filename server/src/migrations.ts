import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { config } from "./config";
import { translationCatalog } from "../../shared/translations";

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

    // Seed any catalog keys the table does not hold yet. `INSERT IGNORE` deliberately never overwrites
    // an edited row: the table becomes the source of truth once a translation has been changed. Keys
    // the code no longer asks for are removed, so the editor always mirrors the app's copy.
    const catalogKeys = translationCatalog.map((entry) => entry.key);
    if (catalogKeys.length > 0) {
      await conn.query(
        `DELETE FROM translations WHERE text_key NOT IN (${catalogKeys.map(() => "?").join(",")})`,
        catalogKeys
      );
    }
    const values = translationCatalog.map((entry, index) => [
      entry.key,
      entry.screen,
      entry.role,
      entry.context,
      entry.english,
      entry.spanish,
      index,
    ]);
    if (values.length > 0) {
      await conn.query(
        `INSERT IGNORE INTO translations
           (text_key, screen, role, context, english, spanish, sort_order)
         VALUES ?`,
        [values]
      );
    }

    return ran;
  } finally {
    await conn.end();
  }
}
