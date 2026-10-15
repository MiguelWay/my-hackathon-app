# Deploying to Plesk

One Node.js process serves **both** the JSON API (under `/api`) and the built React SPA, backed by one
MySQL/MariaDB database. Keeping them on a single origin is deliberate: the session cookie is
`SameSite=Lax`, which browsers will not send on cross-site requests, so a separate API domain would
break sign-in as third-party cookies are phased out.

> **Not yet done:** these steps have not been run against a real Plesk server — I have no access to
> yours. Everything below was verified locally by running the production build the same way Plesk does
> (`NODE_ENV=production node server/start.mjs`): the SPA and its deep links are served, `/api` stays
> JSON, and sign-in, uploads, returns and the export all work.

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

## 3. Create `.env` in the application root

```sh
cat > .env <<'EOF'
DB_HOST=localhost
DB_PORT=3306
DB_USER=pkgreturns
DB_PASSWORD=<the password from step 1>
DB_NAME=package_returns
SESSION_TTL_DAYS=30
SERVE_SPA=true
EOF
chmod 600 .env
```

Notes:
- `CORS_ORIGIN` is **not needed** for this setup — the SPA calls the API on the same origin.
- `API_PORT` is not needed either; Plesk sets `PORT` and the app honours it (the app prefers `API_PORT`
  when it is set, which is why local dev uses it).
- `NODE_ENV=production` is set by Plesk's *Application mode* setting (step 5). Do not put it in `.env`.

## 4. Install, build, migrate

```sh
npm ci                 # devDependencies are required by the SPA build step
npm run build          # writes dist/  (reads .env.production: VITE_API_BASE_URL=/api)
npm run db:migrate     # applies db/migrations/*.sql, tracked in schema_migrations
npm run create:superadmin -- you@example.com 'a-strong-password'
```

`npm run db:migrate` and `npm run create:superadmin` must be run **from the application root** (they
resolve `db/migrations` relative to the working directory).

## 5. Plesk Node.js settings

Plesk → your domain → **Node.js**:

| Setting | Value |
|---|---|
| Document root | the folder containing `package.json` |
| Application root | same folder |
| Application startup file | `server/start.mjs` |
| Application mode | production |
| Node.js version | 24.x (or 26.x) |

Then **Restart App**.

`server/start.mjs` registers the tsx loader and loads the TypeScript server, so production runs the
same source as development with no separate compiled artifact. `tsx` is a normal runtime dependency
for that reason.

If you would rather have Apache/nginx serve the static files, set `SERVE_SPA=false`, point the document
root at `dist/`, and add an SPA fallback rewrite to `index.html`. The default (Node serves everything)
needs no rewrite rules and is what I verified.

## 6. HTTPS

Plesk → **SSL/TLS Certificates** → *Install a free Let's Encrypt certificate*, and switch on
*Redirect from HTTP to HTTPS*.

This matters beyond privacy: with `NODE_ENV=production` the session cookie is marked `Secure`, so
sign-in silently fails over plain HTTP.

## 7. Verify

```sh
curl -s https://your-domain.example/api/health
# {"ok":true,"db":"up"}
```

Then in a browser:

1. Open the site and sign in → you land on **Campaigns**.
2. Hard-refresh on a deep link (e.g. `https://your-domain.example/returns`) → the page loads, not a 404.
3. Upload an `.xlsx` to a campaign, confirm the sender-ID column.
4. Record a return on the **Process returns** page.
5. Download the `.xlsx` and check the returned rows are shaded.

## Updating the app

```sh
git pull
npm ci
npm run build
npm run db:migrate      # only applies new files
```

then Plesk → **Node.js** → *Restart App*.

## Rollback

```sh
git log --oneline -5
git checkout <previous-commit>
npm ci && npm run build
```

then restart. Migrations are additive and recorded in `schema_migrations`; **never edit a migration
that has already been applied** — add a new one instead.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 502 / app not responding | Wrong startup file, or the app crashed — check Plesk's Node.js log. Confirm `server/start.mjs` exists and `npm ci` ran. |
| `Missing required env var: DB_USER` | `.env` missing, unreadable, or `DB_USER`/`DB_NAME` not set. |
| Sign-in seems to do nothing | HTTPS not enabled while in production mode (Secure cookie dropped over HTTP), or the SPA was built with the wrong `VITE_API_BASE_URL` — it must be `/api`. |
| Deep link 404s | `SERVE_SPA` must be true, or your web server needs an SPA rewrite to `index.html`. |
| Can't reach the database | On Plesk use `DB_HOST=localhost`; double-check the DB name and user from step 1. |
| Uploads fail with "invalid campaign id" / 404 | You're hitting the API without the `/api` prefix. |

## Security notes

- `.env` lives outside `dist/` and is git-ignored; keep it `chmod 600`.
- In production: passwords hashed with bcrypt (cost 12); sessions stored only as SHA-256 token hashes;
  cookie is `httpOnly` + `SameSite=Lax` + `Secure`.
- Per-customer isolation is enforced in every query and proved by `tests/api/isolation.test.ts`.
- Turn on Plesk's **Backup Manager** for the database.
- The server never needs to be reachable from the internet directly — only the domain's HTTPS port.
