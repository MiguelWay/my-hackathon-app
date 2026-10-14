# Package Returns & Store Traceability App

Web app to track packages sent to retail stores (via Correos España), record returns by reason, link
resends, and export a clearly-flagged list so closed stores are not sent to again.

**Stack:** React + Vite (SPA) · Node.js + Express (API) · MySQL / MariaDB. No Supabase.

Docs: `SPECIFICATION.md` (spec) · `tasks/plan.md` + `tasks/todo.md` (plan) · `docs/intent/` (intent).

## Prerequisites
- Node.js 20+ (tested with 24.21.0)
- MySQL 8 / MariaDB 8+ (local, or on Plesk)

## Setup
1. `npm install`
2. `cp .env.example .env` and fill in the values (frontend + DB + API).
3. `npm run db:migrate` — creates the tables (applies `db/migrations/*.sql`).
4. API: `npm run api:dev` (dev) or `npm run api:start`.
5. Frontend: `npm run dev`.

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (frontend) |
| `npm run build` | Build the frontend to `dist/` |
| `npm run api:dev` | Run the API with watch |
| `npm run api:start` | Run the API |
| `npm run db:migrate` | Apply `db/migrations/*.sql` in order |
| `npm run typecheck:api` | Type-check the server |
| `npm test` | Tests (vitest) |

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
