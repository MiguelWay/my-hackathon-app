import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";

// Bootstrap the first platform super-admin (not tied to a customer).
// Usage: npm run create:superadmin -- <email> <password>
const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: npm run create:superadmin -- <email> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("password must be at least 8 characters");
  process.exit(1);
}

async function main() {
  const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE email = ?", [
    email,
  ]);
  if (existing.length) {
    console.error("email already registered");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO users (customer_id, email, password_hash, role) VALUES (NULL, ?, ?, 'superadmin')",
    [email, hash]
  );
  console.log(`superadmin created: id=${result.insertId} email=${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
