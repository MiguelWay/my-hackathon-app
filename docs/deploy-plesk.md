# Deploying to Plesk

One Node.js process serves **both** the JSON API (under `/api`) and the built React SPA, backed by one
MySQL/MariaDB database. Keeping them on a single origin is deliberate: the session cookie is
`SameSite=Lax`, which browsers will not send on cross-site requests, so a separate API domain would
break sign-in as third-party cookies are phased out.

> **Verified on a real Plesk server** (Obsidian 18.0.81, Node.js 26.12.0, MariaDB 10.11) with this exact
> layout: application root `/<domain>`, document root `/<domain>/dist`, startup file
> `server/start.mjs`, application mode `production`. `/api/health` returns `{"ok":true,"db":"up"}`,
> the SPA and its deep links load, and the admin sees Customers · Campaigns · Users · Translations
> with 321 texts. Everything below was also verified locally with
> `NODE_ENV=production node server/start.mjs`.
>
> **One-command path:** steps 4–5 are automated by `scripts/deploy-plesk.sh`. It validates `.env`,
> installs build dependencies, builds the SPA, type-checks the API, runs migrations (including the
> translation seed), optionally creates the first super-admin, and requests a Passenger restart.

## 0. Prerequisites

- Plesk with the **Node.js** extension
- Node.js **20+** (24 or 26 are both fine)
- A domain with **HTTPS** enabled (you need this before sign-in will work — see step 6)

## 1. Create the database

Plesk → **Databases** → *Add Database*:

| Field | Value |
|---|---|
| Database name | `package_returns` |
| User | e.g. `pkgreturns` |
| Password | a strong one (you'll paste it into `.env`) |

Leave the host as `localhost` — on Plesk the database is local to the server.

## 2. Get the code onto the server

```sh
cd /var/www/vhosts/example.com/httpdocs
git clone git@github.com:MiguelWay/my-hackathon-app.git .
```

The repo is private, so add a deploy key (Plesk → *Git* extension is the easiest route).

Without SSH, upload a zip of the project through **Files → Add New → Upload File** and extract it with
*Replace existing files*. Check afterwards that `index.html` is really yours: on a fresh Plesk site it
already exists as the *Plesk default page*, and extraction can leave it in place. The built app does
not use it (`dist/` is the document root), but `npm run build` does, so restore it before building —
locally it is the 337-byte file with `<div id="root">` and `/src/main.tsx`. A build that transforms
only one module and emits no `dist/assets/*.js` means the wrong `index.html` is on the server.

## 3. Create `.env` in the application root

```sh
cat > .env <<'EOF'
DB_HOST=localhost
DB_PORT=3306
DB_USER=pkgreturns
DB_PASSWORD=<the password from step 1>
DB_NAME=package_returns
SESSION_TTL_DAYS=30
SESSION_IDLE_MINUTES=30
ALLOW_SELF_SIGNUP=false
SERVE_SPA=true
APP_URL=https://example.com
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_FROM=no-reply@example.com
# Set to true when the local MTA refuses to relay (see the SMTP note below).
SMTP_DIRECT=false
EOF
chmod 600 .env
```

Notes:
- `CORS_ORIGIN` is **not needed** for this setup — the SPA calls the API on the same origin.
- `API_PORT` is not needed either; Plesk sets `PORT` and the app honours it (the app prefers `API_PORT`
  when it is set, which is why local dev uses it).
- `NODE_ENV=production` is set by Plesk's *Application mode* setting (step 5). Do not put it in `.env`.
- `APP_URL` is the public HTTPS address; the **Forgot password** link is built from it.
- `SMTP_HOST=localhost` + `SMTP_PORT=25` uses Plesk's own mail server. Set `SMTP_USER`/`SMTP_PASSWORD`
  only if your server requires authentication.
- If that server answers `554 5.7.1 ... Relay access denied` (common when Plesk's **mail service is off**
  for the domain), the local MTA cannot deliver to outside addresses and the reset email never leaves the
  box. Plesk's Node.js console shows the error in the app log; a one-off check is `node --import tsx -e
  "import('./server/src/mailer.ts').then(m => m.sendPasswordReset('you@example.com', 'test'))"`.
  Set `SMTP_DIRECT=true` in that case: the app then resolves the recipient domain's MX records and
  delivers straight to them over port 25, trying each host in priority order. `SMTP_FROM` must use a
  domain that resolves (it is the EHLO name and the address recipients see); `no-reply@<your domain>` is
  right. Direct delivery needs outbound port 25, and IP reputation matters — many providers want matching
  forward/reverse DNS and a DMARC record, so set one up before relying on this for anything important.
  When set, `SMTP_DIRECT=true` takes precedence over `SMTP_HOST`.

## 4. Install, build, migrate

From the application root, the short path is:

```sh
bash scripts/deploy-plesk.sh
```

The script runs the equivalent of:

```sh
npm ci --include=dev   # devDependencies are required by the SPA build step
npm run build          # writes dist/  (reads .env.production: VITE_API_BASE_URL=/api)
npm run typecheck:api
npm run db:migrate     # applies db/migrations/*.sql, tracked in schema_migrations

# first deploy only:
npm run create:superadmin -- you@example.com 'a-strong-password'
```

Without SSH, the **Node.js** panel's *Run Node.js commands* tab runs commands with an `npm` prefix:
run `install --include=dev`, `run build`, `run db:migrate` and
`run create:superadmin -- you@example.com 'a-strong-password'`. For anything else (inspecting files,
copying a file into place) use `npm exec -- node -e "..."`.

To create the first super-admin in the same run:

```sh
CREATE_SUPERADMIN=1 \
SUPERADMIN_EMAIL=you@example.com \
SUPERADMIN_PASSWORD='a-strong-password' \
bash scripts/deploy-plesk.sh
```

`npm run db:migrate` now also creates and seeds the `translations` table (`013_translations.sql`):
**321 static UI texts** with English and Spanish. Existing translation edits are preserved; new keys
are added and keys removed from the catalog are pruned.

Use `--include=dev` even in production mode: if the shell has `NODE_ENV=production`, a plain `npm ci`
skips TypeScript and Vite, and `npm run build` then fails.

Without the optional third argument, the account is the **platform owner**: it can manage every
company, create campaigns, upload lists, process returns and export. With a company id or name, the
account is a **company super-admin**, confined to that company. For a fresh install, the platform
owner is the simplest choice; create companies and their campaigns in the UI afterwards.

`npm run db:migrate` and `npm run create:superadmin` must be run **from the application root** (they
resolve `db/migrations` relative to the working directory).

## 5. Plesk Node.js settings

Plesk → your domain → **Node.js**:

| Setting | Value |
|---|---|
| Document root | `dist/` (the built app) — see the note below |
| Application root | the folder containing `package.json` |
| Application startup file | `server/start.mjs` |
| Application mode | production |
| Node.js version | 24.x (or 26.x) |

The deploy script requests the Passenger restart itself (`tmp/restart.txt`). If the app does not pick
up the change, press **Restart App**.

> **Document root:** use `dist/`. The repo root also contains Vite's **source** `index.html`, and nginx
> serves static files before handing misses to Node, so with the document root at the app root a
> request for `/` returns the source page (a blank app) instead of the built one. With the document
> root at `dist/`, nginx serves `index.html` and `/assets/*` from there, while Passenger hands `/api`
> and deep links to Node; `SERVE_SPA=true` keeps the SPA fallback for those deep links.

`server/start.mjs` registers the tsx loader and loads the TypeScript server, so production runs the
same source as development with no separate compiled artifact. `tsx` is a normal runtime dependency
for that reason.

If you would rather have Apache/nginx serve the static files, set `SERVE_SPA=false`, point the document
root at `dist/`, and add an SPA fallback rewrite to `index.html`. The default (Node serves everything)
needs no rewrite rules and is what I verified.

## 6. HTTPS

Plesk → **SSL/TLS Certificates** → *Install a free Let's Encrypt certificate*, and switch on
*Redirect from HTTP to HTTPS*. Let's Encrypt validation over HTTP (`http-01`) works with the document
root at `dist/`; the certificate is renewed automatically 30 days before it expires. Note that the
*www* alias is not covered unless you tick it (or the wildcard) in the Let's Encrypt dialog.

This matters beyond privacy: with `NODE_ENV=production` the session cookie is marked `Secure`, so
sign-in silently fails over plain HTTP.

## 7. Verify

```sh
curl -s https://your-domain.example/api/health
# {"ok":true,"db":"up"}

curl -s https://your-domain.example/api/translations | head -c 160
# [{"key":"header.brand","english":"Package Returns",...}]
```

Then in a browser:

1. Open the site, sign in as administrator → you land on **Customers**.
2. Hard-refresh on a deep link (e.g. `https://your-domain.example/returns`) → the page loads, not a 404.
3. Upload an `.xlsx` to a campaign and confirm the **package ID** and **store ID** columns (the app
   guesses `Ref. 1` and `Ref. 2`), then import.
4. Sign in through **Enter as operator**, then record a return: Customers → open a customer → open its campaign.
5. Download the `.xlsx` and check the returned rows are shaded.
6. Open **Forgot password** on the login screen and confirm the reset email arrives (check the spam
   folder; the link uses `APP_URL`).
7. The app opens in **Spanish**. Switch to **EN** and back with the header control.
8. Sign in with **Enter as administrator** (not the operator door), open **Traducciones**, change a
   text, save, and confirm it applies immediately. Operators do not see this link.

## Updating the app

```sh
cd /var/www/vhosts/example.com/httpdocs
git pull
bash scripts/deploy-plesk.sh
```

The script does `npm ci --include=dev`, `npm run build`, `npm run typecheck:api`, `npm run db:migrate`
(only new migration files run) and a Passenger restart. If you prefer the manual path:

```sh
git pull
npm ci --include=dev
npm run build
npm run db:migrate
```

then Plesk → **Node.js** → *Restart App*.

## Rollback

```sh
git log --oneline -5
git checkout <previous-commit>
npm ci --include=dev && npm run build
```

then restart. Migrations are additive and recorded in `schema_migrations`; **never edit a migration
that has already been applied** — add a new one instead.

## If you are locked out

Recovery deliberately does **not** go through the login page — anything reachable from that page is
only available while that page works. It is a command you run where the database is, and it needs no
login at all:

```sh
npm run recover                                  # the logins that exist, then the commands
npm run recover -- list
npm run recover -- reset <login>                 # prompts for the new password, hidden
npm run recover -- rename <login> <new-login>    # change the login itself
npm run recover -- unlock <login>                # active, and a platform super-admin, again
```

This works with the app stopped, with the account deactivated, with the password lost, and while the
login rate limit is in force, because it talks straight to the database. A password passed as an
argument is visible in the shell history, so omit it and let the prompt read it hidden. Resetting a
password also ends that account's existing sessions.

On Plesk: **SSH Terminal** → `cd` into the app directory → the command above. If there is no shell
access at all, say so — the fallback is a start-up repair from environment variables.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 502 / app not responding | Wrong startup file, or the app crashed — check Plesk's Node.js log. Confirm `server/start.mjs` exists and `npm ci` ran. |
| `Missing required env var: DB_USER` | `.env` missing, unreadable, or `DB_USER`/`DB_NAME` not set. |
| Sign-in seems to do nothing | HTTPS not enabled while in production mode (Secure cookie dropped over HTTP), or the SPA was built with the wrong `VITE_API_BASE_URL` — it must be `/api`. |
| Locked out, or the password is lost | Not a deployment fault — run `npm run recover` (see **If you are locked out** above). It needs no login. |
| Deep link 404s | `SERVE_SPA` must be true, or your web server needs an SPA rewrite to `index.html`. |
| Can't reach the database | On Plesk use `DB_HOST=localhost`; double-check the DB name and user from step 1. |
| Uploads fail with "invalid campaign id" / 404 | You're hitting the API without the `/api` prefix. |
| **Traducciones** is missing from the nav | You are in the operator view. Log out and enter through **Enter as administrator**; the operator door hides every admin item. |
| `npm ci` fails on `xlsx` | The dependency is installed from `cdn.sheetjs.com`; the server needs outbound HTTPS to it. |
| The app did not restart after the script | Press **Restart App** in Plesk → Node.js. The script only touches `tmp/restart.txt` (Passenger). |

## Security notes

- `.env` lives outside `dist/` and is git-ignored; keep it `chmod 600`.
- **Self-signup is disabled in production** unless you set `ALLOW_SELF_SIGNUP=true`. Create customers
  with the platform super-admin (step 4).
- Auth endpoints are rate limited (10 failed attempts per IP per 15 minutes). If you lock yourself out
  while testing, wait for the window to pass or restart the app.
- In production: passwords hashed with bcrypt (cost 12); sessions stored only as SHA-256 token hashes;
  cookie is `httpOnly` + `SameSite=Lax` + `Secure`; security headers (strict CSP) on every response.
- Per-customer isolation is enforced in every query and proved by `tests/api/isolation.test.ts`.
- Full review, including the accepted dependency risks: [`../SECURITY.md`](../SECURITY.md).
- Turn on Plesk's **Backup Manager** for the database.
- The server never needs to be reachable from the internet directly — only the domain's HTTPS port.
