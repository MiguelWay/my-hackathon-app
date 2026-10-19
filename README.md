# Package Returns & Store Traceability App

Web app to track packages sent to retail stores (via Correos España), record returns by reason, link
resends, and export the original list with returned rows in **red** and resent rows in **green**, so
closed stores are not sent to again.

**Stack:** React + Vite (SPA) · Node.js + Express (API) · MySQL / MariaDB. No Supabase.
**Languages:** Spanish by default, with the original English kept; ES/EN switch in the header and an
editable translation table for administrators.

Docs: `SPECIFICATION.md` (spec) · `docs/specs/` (feature specs) · `tasks/plan.md` + `tasks/todo.md`
(plan) · `docs/intent/` (intent) · `docs/deploy-plesk.md` (deployment) · `SECURITY.md` (security
review) · `shared/translations.ts` (translation catalog).

## Prerequisites
- Node.js 20+ (tested with 24.21.0)
- MySQL 8 / MariaDB 8+ (local, or on Plesk)

## Setup
1. `npm install`
2. `cp .env.example .env` and fill in the values (frontend + DB + API).
3. `npm run db:migrate` — creates the tables (applies `db/migrations/*.sql`) and seeds the
   translation table (`013_translations.sql`).
4. API: `npm run api:dev` (dev) or `npm run api:start`.
5. Frontend: `npm run dev`.

## Languages and translations

- **Spanish is the default** for every screen. The **ES / EN** switch in the header (and on the auth
  screens) changes the view; the choice is remembered in the browser.
- The original **English** copy is kept beside every Spanish text, so a translation can be checked and
  updated in context.
- Administrators get **Traducciones** in the top nav (`/translations`). It lists every static text
  grouped by screen and role, with both columns editable and one **Guardar cambios** action. Changes
  apply immediately. Operators cannot open the editor.
- The editor writes to the MySQL `translations` table. The catalog in `shared/translations.ts` seeds it
  and is the fallback before the table loads; `npm run db:migrate` adds new keys and removes keys the
  code no longer uses.
- `GET /api/translations` is public because the login screen needs it. `GET/PUT /api/admin/translations`
  are administrator-only.
- Server API error messages remain in English; static UI copy, client-side validation and download
  notices are translated.
- If **Traducciones** is missing, you are in the operator view. Log out and enter again with **Entrar
  como administrador** / **Enter as administrator**.

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (frontend) |
| `npm run build` | Build the frontend to `dist/` |
| `npm start` | Run the API (production entrypoint, `server/start.mjs`) |
| `npm run api:dev` | Run the API with watch |
| `npm run api:start` | Run the API |
| `npm run db:migrate` | Apply `db/migrations/*.sql` in order and seed/prune translations |
| `npm run typecheck:api` | Type-check the server |
| `npm test` | Tests (vitest): unit tests + the API isolation suite |
| `npm run create:superadmin -- email password` | Create the first super-admin |
| `npm run recover` | List logins / reset a password / unlock an account from the database |
| `bash scripts/deploy-plesk.sh` | One-command Plesk deploy: install, build, type-check, migrate, restart |

## Production
In production **one process serves both the API and the SPA**: JSON endpoints live under `/api`, and
the built `dist/` is served from the same origin with an SPA deep-link fallback. See
[`docs/deploy-plesk.md`](docs/deploy-plesk.md) for the full Plesk deployment guide, or run the
one-command deploy script on the Plesk application root:

```sh
bash scripts/deploy-plesk.sh
```

The script validates `.env`, installs build dependencies, builds the SPA, type-checks the API, applies
migrations (including the translation seed), optionally creates the first super-admin, and requests a
Passenger restart. Plesk's Node.js settings and HTTPS are one-time UI settings.

## Security
See [`SECURITY.md`](SECURITY.md) for the threat model, what was fixed, what was checked and found
safe, and the accepted risks. Three defaults worth knowing:

- **Self-signup is off in production** (`ALLOW_SELF_SIGNUP`) — create customers with the platform
  super-admin instead.
- **Sessions end after 30 minutes without use** (`SESSION_IDLE_MINUTES`) — enforced by the API on every
  request and by the SPA, which signs out at the same point.
- **Auth endpoints are rate limited** — 10 failed attempts per IP per 15 minutes.

`npm test` resets a dedicated test database, so the API suites run one file at a time
(`vitest.config.ts` → `fileParallelism: false`). The current suite is **272 tests**.

## Local dev database (standalone MySQL, no Homebrew)
This machine runs a self-contained MySQL at `~/.local/mysql`:
- basedir `~/.local/mysql/mysql-8.4.3-macos14-arm64` · datadir `~/.local/mysql/data`
- socket `~/.local/mysql/mysql.sock` · port 3306

**Start:**
```
~/.local/mysql/mysql-8.4.3-macos14-arm64/bin/mysqld \
  --basedir=$HOME/.local/mysql/mysql-8.4.3-macos14-arm64 \
  --datadir=$HOME/.local/mysql/data \
  --socket=$HOME/.local/mysql/mysql.sock \
  --port=3306 --bind-address=127.0.0.1 --mysqlx=0 \
  --daemonize --log-error=$HOME/.local/mysql/mysqld.err --pid-file=$HOME/.local/mysql/mysqld.pid
```
**Stop:** `~/.local/mysql/mysql-8.4.3-macos14-arm64/bin/mysqladmin --socket=$HOME/.local/mysql/mysql.sock -u root shutdown`

Dev database: `package_returns`, user `appuser` (credentials in `.env`, which is git-ignored).

Tests run against a **separate** database (`package_returns_test`) so dev data is never touched.
Create it once (as an admin user):

```sql
CREATE DATABASE package_returns_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

The suite drops and recreates every table in that database on each run, and applies all migrations.
