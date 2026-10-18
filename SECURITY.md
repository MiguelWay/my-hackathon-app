# Security review

Reviewed: 2026-10-15 · Re-reviewed: 2026-10-18 · Scope: the whole app (`server/src`, `src`, migrations, tests, dependencies).

## Threat model

**Assets:** tenant data (store lists, sender IDs, return reasons, notes), user credentials, session
tokens, and the ability to act as a full-access account for a customer.

**Trust boundaries** — everything below is attacker-controlled input:

| Boundary | Notes |
|---|---|
| HTTP requests to `/api/*` | JSON bodies, query strings, cookies, headers |
| Uploaded `.xlsx` | Parsed in the *browser*, but the parsed rows are posted as JSON — so the client is untrusted and the server re-validates |
| The browser session | A user controls their own requests and can craft any payload |
| Generated `.xlsx` export | Contains data that came from an uploaded file, and is opened in Excel by staff |

**Primary abuse cases:** read or write another customer's data; brute-force a login; create a tenant
without permission; exhaust CPU/storage; get code or a formula to execute on a colleague's machine
from the exported file; learn whether an account exists.

## Fixed

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | No security headers at all — no CSP, no `nosniff`, clickjacking had no protection, `X-Powered-By: Express` advertised the stack | Medium | `helmet` with a strict CSP (`default-src 'self'`, no `unsafe-inline`/`unsafe-eval`), `frame-ancestors 'self'`, `nosniff`, `Referrer-Policy`, HSTS |
| 2 | Login was unlimited — passwords could be brute-forced at full speed | **High** | Per-IP limits: 10 *failed* attempts / 15 min on `/auth/login` + `/auth/register`, plus 300 req/min across `/api`. Only failures count, so normal use is unaffected. `Retry-After` + `RateLimit-*` headers, and a `[security] failed login` log line |
| 3 | **Anyone on the internet could create a tenant** via `POST /auth/register` | **High** (design) | Closed in production unless `ALLOW_SELF_SIGNUP=true`. Customers are created by the platform super-admin, as the spec intends |
| 4 | bcrypt hashed an unbounded password, so one request could burn arbitrary CPU (cost-12 hashing of a 5 MB body) | Medium | Password length capped at 100 chars *before* hashing; over-long values are rejected |
| 5 | Login timing revealed whether an email existed (no bcrypt work was done for unknown accounts) | Low | A dummy-hash comparison always runs, so both paths cost the same |
| 6 | Unbounded user input reached MySQL, turning bad input into `500`s: over-long campaign/customer names, sender IDs longer than `VARCHAR(128)` | Medium | Validated at the boundary with `400`s: email format, name ≤ 255, sender ID ≤ 128, password 8–100 |
| 7 | A real (if local) DB password was **hardcoded** in `tests/api/helpers.ts` | Medium | Removed. Test credentials come from `.env`; the test suite only overrides the database *name* |
| 8 | The API test files ran in parallel against one shared database and corrupted each other | Test integrity | Vitest now runs files serially (`fileParallelism: false`) |
| 23 | **A session never ended while it was used.** The cookie and the server row lasted 30 days, and a shared or unattended browser stayed signed in indefinitely | Medium | **30-minute idle timeout**, enforced twice: `sessions.last_seen_at` is stamped by every authenticated request and the auth lookup refuses an older stamp (deleting that row); the SPA signs out after the same 30 minutes without a click, key or scroll — shared across tabs through localStorage — logs the session out, and shows “You were signed out after 30 minutes without activity.” on the login screen. Any 401 from an authenticated request also ends the screen instead of leaving stale data visible. `SESSION_IDLE_MINUTES` (default 30) sets the server window |

## Verified as not vulnerable (checked, no change needed)

| # | Concern | How it was checked | Result |
|---|---|---|---|
| 9 | **Spreadsheet formula injection** — exported cells are opened in Excel, and the values come from an uploaded file | Wrote `=1+1`, `@SUM(1)`, `+2+3`, `-2+3`, `=cmd\|'/c calc'!A0` through ExcelJS, read the workbook back, and inspected the raw sheet XML | ExcelJS writes them as **shared strings** (`t="s"`), with no `<f>` formula element — Excel shows them as text and does not evaluate them. Not exploitable |
| 10 | SQL injection | Reviewed every statement in `server/src`; all use placeholders. The only interpolated SQL is `LIMIT ${RECENT_LIMIT}`, a module constant | Not exploitable |
| 11 | Broken access control / IDOR | `tests/api/isolation.test.ts` — 98 tests covering the per-request customer scope, anonymous access to every endpoint, and role gating | Not exploitable for a request that names no customer (it stays in the caller's own company). Returns are deliberately open across customers — see 21 |
| 12 | XSS | `grep` for `dangerouslySetInnerHTML`, `innerHTML`, `eval(` across `src/` and `server/src/` | None present; React auto-escaping is intact |
| 13 | Secrets in git history | `git log --full-history -- .env`, plus a grep of **every blob in history** for the DB password, test passwords, key material and vendor tokens | `.env` was never committed. One historical commit accidentally included Playwright page snapshots (test account emails only, no credentials or tokens) |
| 14 | Session handling | Code + tests | httpOnly + `SameSite=Lax` + `Secure` (production); only a SHA-256 token hash is stored; absolute expiry enforced in the query; **a 30-minute idle window** (`sessions.last_seen_at`, stamped by every authenticated request); logout deletes the server-side session |
| 15 | Stack traces / internals leaked to users | Code review | The central error handler logs server-side and returns a generic `internal error` |

## Accepted, with reasons

| # | Finding | Why it is accepted | Re-check when |
|---|---|---|---|
| 16a | **Every super-admin can manage customers** (create tenants, and create accounts for *any* customer). Merging the `admin` role into `superadmin` widened this: previously only a platform super-admin could reach `/admin`. | Deliberate, on request — the app is intended for a single operator, where the distinction was overhead. Tenant *data* is still separated per request: a query is scoped to the one customer the request names, and campaigns, uploads and exports stay scoped to the caller's own company, which `tests/api/isolation.test.ts` proves. | Before handing a login to someone who should only run their own company, or before a second company shares this deployment. Narrow it by giving that account customer-scoped access only. |
| 16 | `npm audit`: 1 high + 2 critical (vite, vitest, tinypool, esbuild, `@vitest/mocker`, vite-node) | **All are dev/test-only.** They affect the Vite dev server and the test runner, neither of which is exposed in production (production serves a pre-built `dist/` through Express). `npm audit fix` changes nothing without `--force`; the fixes are breaking major upgrades | Before the next dependency refresh, or if a dev server is ever exposed beyond localhost |
| 17 | `react-router` moderate: open redirect via a backslash in `<Link>`/`useNavigate` | The advisory covers all 6.x, so the fix is a v7 major upgrade. We never pass user-controlled values to `Link`/`navigate` — every destination is a literal or an app-generated id — so there is no reachable path. Deferred rather than taking a risky major upgrade at deploy time | When upgrading react-router, or if a redirect target ever becomes user-supplied |
| 18 | `exceljs` → `uuid` moderate (buffer bounds in `v3/v5/v6` with a `buf` argument) | exceljs calls **only `uuid.v4`**, and only to build conditional-formatting rules we never generate. Unreachable. There is no upstream fix — exceljs has not been released since 4.4.0 | If exceljs ships a release, or if we start using uuid directly |
| 19 | The rate limiter counts in process memory | Correct for the current single-Node-process Plesk deployment, and verified by tests. A shared store is required only if scaled out | If the app ever runs more than one process |
| 20 | Expired session rows are never garbage-collected | Housekeeping only — an expired or idle row cannot authenticate (`expires_at > NOW()` and the idle window are in the query), and the row is deleted when its cookie is presented again. Rows whose cookie is never presented linger | Add a periodic `DELETE FROM sessions WHERE expires_at < NOW() OR last_seen_at < NOW() - INTERVAL 30 MINUTE` |
| 21 | **Returns are processed across customers, by design.** `GET /returns/*`, `POST /returns` and `POST /returns/resend` take the customer the request names rather than the caller's own, and `/returns/customers` lists every client company. So any signed-in account can read and write the returns — and see the directory — of every customer. | Deliberate, on request, and it is the point of the tool: one operator team receives returned parcels for every client it ships for, so it must pick the customer, then the campaign. The isolation guarantee became *per request*: a response only ever contains the one customer it names, a write lands in the customer the named package belongs to, and a request naming nobody stays in the caller's own company. Admin actions stay super-admin only, and so do the company-wide reports: the recent-returns list, the counters, the chains and the chains download. The drill-down gives a `user` the customer directory and one campaign's own read, and nothing wider. | Before handing a login to anyone outside the operating team, or if a client ever gets a login that must not see the others. Then gate `/returns/customers` behind an entitlement and make the scope default to the account's own company. |
| 22 | **The returns request scope is not confined for a company super-admin.** `scopeOf()` (`server/src/returns.ts:32`) honours any `customerId` in the request; `GET /returns/campaigns/:id` and `GET /returns/customers/:id/campaigns` take an id with no `isConfined` check. An account that is **both** super-admin and attached to a company can therefore read another company's summary, recent returns (label columns included), lookup matches, chains and chain export, list its campaigns, and record a return against its packages by sender ID. Proven on 2026-10-18 with a temporary company-27 administrator reading customer 12's summary and campaign 10 (the account was deleted afterwards). | **Accepted by the owner on 2026-10-18 — not fixed.** The intended users today are platform super-admins (no company) and operators (`user`), neither of which is confined, so no live account can exercise it; the customer-manager role that would is not in use. The cross-customer returns workflow for the operating team is deliberate (finding 21). Two isolation tests currently encode the behaviour (“scopes a lookup to the customer it names”, “counts each customer separately”); a future fix must move them to the platform/operator clients and add 404 assertions for a company admin. | Before a company administrator account is handed out, before a second company shares this deployment, or before any client gets a login that must not see the others. Fix centrally: `scopeOf()` 404s a named customer other than the caller's when `isConfined`; the two id-taking routes check the campaign/customer owner; the directory returns only the caller's customer to a confined admin. |

## Known gaps (not vulnerabilities, but worth knowing)

- **Single factor.** Email + password only: no MFA, no account lockout beyond the IP rate limit.
- **Privacy.** Personal data is limited to user emails and free-text `note`/`Observación` values
  (which staff could type personal data into). There is no data-subject export/delete endpoint;
  deleting a `customers` row cascades to its campaigns, packages and returns, which is the practical
  erasure path today. If this ever holds customer PII at scale, add explicit retention and an erasure
  endpoint.
- **No audit log** of who changed what. `returns.recorded_by` is recorded; campaign edits are not.
- **CORS origin defaults to the dev server.** `CORS_ORIGIN` falls back to `http://localhost:5173`, and
  the API answers with that origin plus `Access-Control-Allow-Credentials: true`. Harmless while only a
  page on the operator's own machine could use it, but production should set `CORS_ORIGIN` to the real
  origin, or skip CORS entirely when the SPA is served from the same origin.

## Verification

```
npm test            # 235 tests: unit + API isolation + security hardening
npm run typecheck:api
npm run build
```

Header check against the production build:

```
curl -sD - -o /dev/null http://localhost/api/health | grep -iE "content-security|x-content-type|x-frame|referrer|strict-transport|x-powered-by"
```

The test suite covers: security headers present and CSP free of `unsafe-inline`/`unsafe-eval`, signup
refused when disabled, generic login errors for unknown users, over-long inputs rejected with `400`
(not a database error), rate-limit budget advertised, successful logins not consuming the budget, and
lockout after the configured number of failures.
