import type { RowDataPacket } from "mysql2";
import { pool } from "./db";

// The translation table holds every static piece of UI copy in both languages. `shared/translations.ts`
// seeds it and is the client's fallback, but once seeded the table is the editable source of truth.

export interface PublicTranslation {
  key: string;
  english: string;
  spanish: string;
}

export interface AdminTranslation extends PublicTranslation {
  id: number;
  screen: string;
  role: string;
  context: string;
  sort_order: number;
  updated_at: string;
}

interface TranslationRow extends RowDataPacket {
  id: number;
  key: string;
  screen: string;
  role: string;
  context: string;
  english: string;
  spanish: string;
  sort_order: number;
  updated_at: string;
}

/** What the SPA loads at startup: the live copy for every key, in both languages. */
export async function loadPublicTranslations(): Promise<PublicTranslation[]> {
  const [rows] = await pool.query<TranslationRow[]>(
    "SELECT text_key AS `key`, english, spanish FROM translations ORDER BY sort_order, id"
  );
  return rows.map((row) => ({
    key: row.key,
    english: row.english,
    spanish: row.spanish,
  }));
}

/** What the administrator's editor loads: the same rows plus where each text belongs. */
export async function loadAdminTranslations(): Promise<AdminTranslation[]> {
  const [rows] = await pool.query<TranslationRow[]>(
    `SELECT id, text_key AS \`key\`, screen, role, context, english, spanish, sort_order, updated_at
       FROM translations
      ORDER BY sort_order, id`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    key: row.key,
    screen: row.screen,
    role: row.role,
    context: row.context,
    english: row.english,
    spanish: row.spanish,
    sort_order: Number(row.sort_order),
    updated_at: String(row.updated_at),
  }));
}

export interface TranslationUpdate {
  id: number;
  english: string;
  spanish: string;
}

/** Applies the editor's changes in one transaction, so a bad row cannot leave half a save behind. */
export async function updateTranslations(updates: TranslationUpdate[]): Promise<number> {
  if (updates.length === 0) return 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const update of updates) {
      await conn.query(
        "UPDATE translations SET english = ?, spanish = ? WHERE id = ?",
        [update.english, update.spanish, update.id]
      );
    }
    await conn.commit();
    return updates.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
