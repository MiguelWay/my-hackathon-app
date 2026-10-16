import bcrypt from "bcryptjs";
import readline from "node:readline";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { MIN_PASSWORD_LENGTH } from "../validate";

// Break-glass account maintenance — the way back in when the web login cannot help.
//
// This talks straight to the database, so it works with the app stopped, with the account
// deactivated, with a password that has been lost, and while the login rate limit is in force. It is
// the one recovery path that does not depend on being able to log in — which is the whole point,
// because anything reached through the login page is only available when the login page works.
//
// Run it on a machine that can reach the database (locally, or over SSH on the server):
//
//   npm run recover                                    the logins that exist, then the commands
//   npm run recover -- list                            just the logins
//   npm run recover -- reset <login> [new-password]    set a new password (prompted if omitted)
//   npm run recover -- rename <login> <new-login>      change the login itself
//   npm run recover -- unlock <login>                  active again, and a platform super-admin again
//
// A password given as an argument is visible in the shell history. Omit it and the prompt hides
// what you type.

const [command, ...args] = process.argv.slice(2);

const COMMANDS = [
  ["list", "the logins that exist"],
  ["reset <login> [new-password]", "set a new password (prompted, hidden, if omitted)"],
  ["rename <login> <new-login>", "change the login itself"],
  ["unlock <login>", "make an account active and a platform super-admin again"],
];

interface AccountRow extends RowDataPacket {
  id: number;
  customer_id: number | null;
  email: string;
  role: string;
  is_active: number;
}

function printUsage(): void {
  console.log("Account recovery — run it where the database is reachable, no login needed.\n");
  console.log("  npm run recover [command]\n");
  for (const [usage, what] of COMMANDS) console.log(`  ${usage.padEnd(34)} ${what}`);
}

function printAccounts(rows: AccountRow[]): void {
  if (rows.length === 0) {
    console.log(
      "There are no accounts at all. Create a platform super-admin with:\n" +
        "  npm run create:superadmin -- <login> <password>"
    );
    return;
  }
  console.log(`${rows.length} account${rows.length === 1 ? "" : "s"}:`);
  for (const row of rows) {
    const scope = row.customer_id === null ? "platform" : `customer ${row.customer_id}`;
    const state = row.is_active ? "active" : "DEACTIVATED";
    console.log(`  id=${row.id}  ${row.email}  —  ${row.role}, ${scope}, ${state}`);
  }
}

async function listAccounts(): Promise<AccountRow[]> {
  const [rows] = await pool.query<AccountRow[]>(
    "SELECT id, customer_id, email, role, is_active FROM users ORDER BY id"
  );
  return rows;
}

async function findAccount(login: string): Promise<AccountRow | null> {
  const [rows] = await pool.query<AccountRow[]>(
    "SELECT id, customer_id, email, role, is_active FROM users WHERE email = ?",
    [login]
  );
  return rows[0] ?? null;
}

/** Refuses to act on a login that does not exist, and says how to find the one that does. */
async function requireAccount(login: string | undefined, what: string): Promise<AccountRow> {
  if (!login) throw new Error(`usage: npm run recover -- ${what}`);
  const account = await findAccount(login);
  if (!account) {
    throw new Error(`no account with the login "${login}" — run: npm run recover -- list`);
  }
  return account;
}

/**
 * Reads a line without echoing it, so a password never lands in the terminal scrollback.
 *
 * If `_writeToOutput` ever stops being honoured, the prompt still works — the password is simply
 * visible while it is typed, which is why typing it is never the only way to supply one.
 */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => undefined;
    rl.question(question, (answer) => {
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

/** The new password: the argument if there was one, otherwise asked for twice so a typo cannot lock
 *  you out of the very thing you are using to get back in. */
async function readNewPassword(login: string, given: string | undefined): Promise<string> {
  if (given !== undefined) return given;
  for (;;) {
    const first = await askHidden(`New password for ${login}: `);
    if (first.length < MIN_PASSWORD_LENGTH) {
      console.log(`Too short — at least ${MIN_PASSWORD_LENGTH} characters.`);
      continue;
    }
    const again = await askHidden("Type it again:      ");
    if (first !== again) {
      console.log("Those did not match.");
      continue;
    }
    return first;
  }
}

async function reset(login: string | undefined, given: string | undefined): Promise<void> {
  const account = await requireAccount(login, "reset <login> [new-password]");
  const password = await readNewPassword(account.email, given);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, account.id]);
  // Every session for this account is dropped: a reset must not leave an old session alive, and it
  // is the honest way to say "this password is the only way in now".
  const [dropped] = await pool.query<ResultSetHeader>("DELETE FROM sessions WHERE user_id = ?", [
    account.id,
  ]);
  console.log(`Password set for ${account.email} (id=${account.id}).`);
  console.log(`${dropped.affectedRows} existing session(s) ended.`);
}

async function rename(oldLogin: string | undefined, newLogin: string | undefined): Promise<void> {
  if (!oldLogin || !newLogin) {
    throw new Error("usage: npm run recover -- rename <login> <new-login>");
  }
  const account = await requireAccount(oldLogin, "rename <login> <new-login>");
  if (await findAccount(newLogin)) throw new Error(`the login "${newLogin}" is already taken`);

  await pool.query("UPDATE users SET email = ? WHERE id = ?", [newLogin, account.id]);
  console.log(`Login changed: ${oldLogin} → ${newLogin} (id=${account.id}).`);
}

async function unlock(login: string | undefined): Promise<void> {
  const account = await requireAccount(login, "unlock <login>");
  if (account.is_active && account.role === "superadmin" && account.customer_id === null) {
    console.log(`${account.email} was already active and a platform super-admin — nothing to do.`);
    return;
  }

  await pool.query(
    "UPDATE users SET is_active = 1, role = 'superadmin', customer_id = NULL WHERE id = ?",
    [account.id]
  );
  console.log(`${account.email} is active again, and a platform super-admin (company cleared).`);
  console.log(
    `Log in with its current password. If that is what you lost: npm run recover -- reset ${account.email}`
  );
}

async function main(): Promise<void> {
  switch (command) {
    case undefined:
    case "help":
    case "--help":
      printUsage();
      console.log("");
      printAccounts(await listAccounts());
      return;
    case "list":
      printAccounts(await listAccounts());
      return;
    case "reset":
      return reset(args[0], args[1]);
    case "rename":
      return rename(args[0], args[1]);
    case "unlock":
      return unlock(args[0]);
    default:
      throw new Error(`unknown command "${command}" — run: npm run recover`);
  }
}

main()
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
