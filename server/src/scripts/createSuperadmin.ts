import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";

// Create a platform super-admin (full access).
//
// Usage: npm run create:superadmin -- <email> <password> [customer]
//   [customer] is optional: a customer id, or a customer name (created if it does not exist).
//   With it, the account is attached to that customer and can also run its campaigns,
//   uploads, returns and exports. Without it, the account only manages customers.
const email = process.argv[2];
const password = process.argv[3];
const customer = process.argv[4];

if (!email || !password) {
  console.error("Usage: npm run create:superadmin -- <email> <password> [customer]");
  process.exit(1);
}
if (password.length < 8) {
  console.error("password must be at least 8 characters");
  process.exit(1);
}

/** Resolves the optional third argument to a customer id, creating the customer if needed. */
async function resolveCustomer(value: string): Promise<number> {
  const [byName] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM customers WHERE name = ?",
    [value]
  );
  if (byName[0]) return byName[0].id;

  if (/^\d+$/.test(value)) {
    const [byId] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM customers WHERE id = ?",
      [Number(value)]
    );
    if (byId[0]) return byId[0].id;
    throw new Error(`no customer with id ${value}`);
  }

  const [created] = await pool.query<ResultSetHeader>("INSERT INTO customers (name) VALUES (?)", [
    value,
  ]);
  console.log(`customer created: id=${created.insertId} name=${value}`);
  return created.insertId;
}

async function main() {
  const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE email = ?", [
    email,
  ]);
  if (existing.length) {
    console.error("email already registered");
    process.exit(1);
  }

  const customerId = customer ? await resolveCustomer(customer) : null;
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO users (customer_id, email, password_hash, role) VALUES (?, ?, ?, 'superadmin')",
    [customerId, email, hash]
  );
  console.log(
    `superadmin created: id=${result.insertId} email=${email} customer=${
      customerId ?? "(platform only)"
    }`
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
