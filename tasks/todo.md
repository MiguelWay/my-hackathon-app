# Task List: Package Returns & Store Traceability App

Task list target for this project. Index and rationale: `tasks/plan.md`. Spec: `SPECIFICATION.md`.
Stack: React + Vite (SPA on Plesk) · Node + Express API *(pending language)* · MySQL/MariaDB · no Supabase.

---

## Task 1: Repo layout, frontend scaffold, migrations dir

**Description:** Frontend scaffolded (Vite + React + TS), build passes, `db/migrations/` created, and
Supabase removed.

**Acceptance criteria:**
- [x] App builds (`npm run build` → `dist/`).
- [x] API client stub (`src/lib/api.ts`) reading `VITE_API_BASE_URL`; `.env.example` committed.
- [x] `db/migrations/` exists for MySQL; no Supabase artifacts remain.

**Verification:**
- [x] `npm run build` passes.
- [x] `npm run dev` serves (verified in a browser via Playwright).

**Dependencies:** None
**Files:** `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/**`, `.env.example`, `.gitignore`, `db/migrations/`
**Scope:** Medium

---

## Task 2: DB schema foundation (users / roles / customers / sessions)

**Description:** MySQL migrations for the foundational tables: `customers`, `users` (with `role`),
`sessions`. No DB connection needed yet — files are applied when the database is connected.

**Acceptance criteria:**
- [x] `db/migrations/001_users.sql` defines `customers`, `users`, `sessions` (utf8mb4, InnoDB, FKs).
- [x] Migrations apply cleanly to a fresh **local MySQL 8.4.3** (verified).
- [x] The charset/collation round-trips Spanish accents (verified: `Panadería Ñoño`).

**Verification:**
- [x] Applied `001` to a fresh DB · inserted + read back an accented name.

**Dependencies:** Task 1
**Files:** `db/migrations/001_users.sql`
**Scope:** Small

## Checkpoint: Foundation
- [x] Schema applies cleanly · API runs · a user can register/sign in

---

## Task 3: Backend API skeleton + auth (sessions)

**Description:** Node + Express (TypeScript) API with email/password auth: register, login, logout,
"me". Passwords hashed; sessions stored as hashed tokens; cookie httpOnly + Secure.

**Progress:** **3a + 3b done & verified.** Skeleton (`server/`), config, MySQL pool, `/health`, and
the migration runner; plus auth: register / login / logout / me. Language: Node.js + Express (TS).

**Acceptance criteria:**
- [x] `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` work (verified).
- [x] Passwords hashed with bcrypt (`$2a$12$`); session token stored only as a SHA-256 hash.
- [x] Cookie httpOnly + SameSite=Lax (Secure in production); sessions expire (30 days).

**Verification:**
- [x] Manual end-to-end via curl: register 201, me, logout → 401, login, wrong password → 401.
- [ ] Automated API tests (follow-up).

**Dependencies:** Task 2
**Files:** `server/**`, `db/migrations/*` (if needed), `tests/api/*`
**Scope:** Large *(split into 3a skeleton, 3b register/login, 3c sessions/me if needed)*

---

## Task 4: Customers & campaigns (schema + API + UI)

**Description:** `002_campaigns.sql` + API + UI for `customers` and `campaigns` (name, start date,
finish date). Admin-only writes; every query scoped by `customer_id`.

**Progress:** **4a (schema + API) and 4b (UI) done & verified.** Note: customer creation happens
both at sign-up (`/auth/register`) and via the super-admin (`POST /admin/customers`).

**Acceptance criteria:**
- [x] Admin can create a campaign with start/finish dates (verified).
- [x] A non-admin (`role=user`) cannot create campaigns → 403 (verified).
- [x] A user only sees their own customer's campaigns (verified: cross-customer reads → `[]` / 404).
- [x] Frontend UI for customers & campaigns — verified in a real browser (login, create campaign, super-admin customers).

**Verification:**
- [x] Manual end-to-end across two customers (Acme vs Beta) · 401/403/404 paths checked.
- [ ] Automated API tests (follow-up).

**Dependencies:** Task 3
**Files:** `db/migrations/002_campaigns.sql`, `server/features/campaigns/*`, `src/features/campaigns/*`
**Scope:** Medium

## Task 5: Campaign-list upload — parse + column mapping confirm (UI)

**Description:** Upload an Excel file, parse client-side (SheetJS), preview columns, **auto-detect the
sender-ID column with a one-click confirm**. Never rename columns.

**Progress:** **Done & verified.** SheetJS pulled from the official CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/`)
— the npm `xlsx` package is stale. Matching logic lives in `src/lib/senderColumn.ts`; the page is
`src/pages/CampaignDetailPage.tsx` (route `/campaigns/:id`). Import into the DB is Task 6.

**Acceptance criteria:**
- [x] `.xlsx` is parsed and columns/rows previewed (first 10 rows).
- [x] The likely sending-ID column is pre-selected; user can confirm/change it.
- [x] Nothing persists yet — the confirm is the gate.

**Verification:**
- [x] `npm test` — 11 unit tests for `guessSenderColumn`/`normalize` (accents, case, specificity).
- [x] Manual upload + confirm in a real browser (Playwright): detected `ID de envio` and `ID de envío`
      (3rd column, accented) · 5 rows → 4 unique IDs · headers preserved verbatim · no-match guard fires.

**Dependencies:** Task 4
**Files:** `src/pages/CampaignDetailPage.tsx`, `src/lib/senderColumn.ts`, `tests/senderColumn.test.ts`
**Scope:** Medium

## Task 6: Persist packages (schema 004 + API)

**Description:** On confirm, POST rows to the API, which inserts into `packages`: known fields + **all
other columns verbatim** in `extra_columns` (JSON). `sender_id` unique **per campaign**.

**Progress:** **Done & verified.** Migration `004_packages.sql` adds `campaign_uploads` (filename,
original column order, row count) and `packages` (`sender_id`, `extra_columns`, `source_row`). Routes are
mounted under `/campaigns/:campaignId` and scoped by `customer_id`. Note: `row_number` is reserved in
MySQL 8.4, so the column is `source_row`.

**Acceptance criteria:**
- [x] Upload creates one `packages` row per store with `sender_id` set.
- [x] All other columns preserved exactly in `extra_columns` (keyed by original header, accents intact).
- [x] Duplicate `sender_id` in a campaign is rejected with a clear error (409; 400 if duplicated inside one file).
- [x] Multiple uploads can be added to one campaign (`campaign_uploads`).

**Verification:**
- [x] `npm test` — 13 unit tests for `parseImportBody`; 24 tests total across the suite.
- [x] curl end-to-end: import 201 · in-file duplicate 400 · cross-upload duplicate 409 · ragged row 400 ·
      blank sender 400 · bad `senderColumn` 400 · duplicate column names 400 · anon 401.
- [x] Isolation/roles: another customer's admin gets 404 (read and write); a `user` gets 403 on write.
- [x] Manual upload in a browser: two uploads onto one campaign, accents + column order preserved.

**Dependencies:** Task 5
**Files:** `db/migrations/004_packages.sql`, `server/src/packages.ts`, `server/src/importValidation.ts`,
`src/pages/CampaignDetailPage.tsx`, `tests/importValidation.test.ts`
**Scope:** Medium

## Checkpoint: Core data
- [x] A real campaign list uploads and every row is stored with original columns unchanged

---

## Task 4c: Platform super-admin (create customers + their admins)

**Description:** A `superadmin` role (not tied to a customer) that manages customers and each
customer's admin users. Bootstrapped with `npm run create:superadmin -- <email> <password>`.

**Acceptance criteria:**
- [x] `users.role` includes `superadmin`; `users.customer_id` nullable (migration 003).
- [x] `GET /admin/customers`, `POST /admin/customers`, `POST /admin/customers/:id/admins` (super-admin only).
- [x] Bootstrap script creates the first super-admin.

**Verification:**
- [x] Verified: super-admin created a customer + its admin; that admin logged in and created a campaign; a customer admin gets **403** on `/admin`.

**Dependencies:** Task 2, Task 4a
**Files:** `db/migrations/003_superadmin.sql`, `server/src/admin.ts`, `server/src/scripts/createSuperadmin.ts`
**Scope:** Medium

---

## Task 7: Return capture (schema 005 + API + UI)

**Description:** A user types the sender ID; the API validates it against the campaign, returns the
reason list, and records the return. Reasons data-driven, seeded with the five.

**Progress:** **Done & verified.** `005_returns.sql` seeds `return_reasons` (with a `closed_store`
flag on "tienda cerrada" for the export) and adds `returns` (`UNIQUE(package_id)` → one return per
package). API under `/returns`: `GET /reasons`, `GET /` (recent), `GET /lookup?senderId=`, `POST /`.
New page `/returns` (nav: **Process returns**) for admins and users; super-admins see a pointer instead.

**Decision:** returns are searched across all of the customer's campaigns (operators don't know
campaign IDs). `UNIQUE(campaign_id, sender_id)` means one sender ID *could* appear in two campaigns,
so lookup returns a list and the client sends `packageId` back when recording.

**Acceptance criteria:**
- [x] A valid sender ID finds the package; unknown ID → clear "not found".
- [x] Choosing a reason creates a `returns` row and marks the package returned.
- [x] Reasons seeded: tienda cerrada, ausente, dirección incorrecta, estacionada, otro.

**Verification:**
- [x] `npm test` — 4 unit tests for `normalizeSenderId`; 28 tests total.
- [x] curl: lookup hit/miss, blank `senderId` 400, record 201, re-record 409, unknown reason 400,
      unknown sender 404, anon 401.
- [x] Isolation: another customer's admin gets `[]` and 404 (including with a foreign `packageId`).
- [x] Browser: recorded returns as an `admin` and as a `user` (accented reason label round-trips).

**Dependencies:** Task 6
**Files:** `db/migrations/005_returns.sql`, `server/src/returns.ts`, `server/src/senderId.ts`,
`src/pages/ReturnsPage.tsx`, `tests/senderId.test.ts`
**Scope:** Medium

## Task 8: Resend linking (schema 006 + API + UI)

**Description:** Link a resend's new sender ID to the original under one `chain_id`; searchable from
any sender ID; chains extend across multiple resends.

**Progress:** **Done & verified.** `006_resends.sql` adds `packages.chain_id` (points at the FIRST
package of the chain; NULL = chain root) and `created_via` (`upload` | `resend`); `upload_id` and
`source_row` become nullable because a resend is typed in by hand rather than uploaded.
`POST /returns/resend` (admin-only) creates the new package in a chosen campaign, and `/returns/lookup`
now returns the whole `chain` for each match — so any sender ID in the chain shows every attempt.

**Acceptance criteria:**
- [x] A resend shares one `chain_id` with the original.
- [x] Searching any sender ID in the chain shows the whole history.
- [x] Chains extend across multiple resends (verified with a 4-attempt chain).

**Verification:**
- [x] `npm test` — 8 unit tests for the chain helpers + resend body parsing; 36 tests total.
- [x] curl: resend 201 · not-returned 400 · duplicate sender ID in the target campaign 409 ·
      unknown package 404 · foreign package 404 · foreign campaign 404 · non-admin 403 · anon 401.
- [x] Browser: chain history renders · a resend created from the returns screen · found again by the new ID.

**Dependencies:** Task 7
**Files:** `db/migrations/006_resends.sql`, `server/src/resends.ts`, `server/src/returns.ts`,
`src/pages/ReturnsPage.tsx`, `tests/resends.test.ts`
**Scope:** Medium

## Checkpoint: Returns & resends
- [x] A return records end-to-end; a resend links original ↔ new sender ID

---

## Task 9: Reporting (return rate by category + resend volume)

**Description:** Recharts bar chart of return rate by category per campaign, and a resend-volume
chart. Admins see all; customer users see their own.

**Acceptance criteria:**
- [ ] Return-rate-by-category bar chart renders per campaign.
- [ ] Resend-volume chart renders.
- [ ] Visibility respects roles/customer scope.

**Verification:**
- [ ] Tests pass · charts match known data · role check.

**Dependencies:** Task 7, Task 8
**Files:** `server/features/reports/*`, `src/features/reports/*`
**Scope:** Medium

## Task 10: Export .xlsx (API route)

**Description:** An API route generates the .xlsx: **all original columns unchanged**, plus
`Return Status`, `Return Reason`, `Resend Of`; **returned rows filled light red**; scope per campaign
and per customer.

**Progress:** **Done & verified.** `GET /campaigns/:campaignId/export` rebuilds the campaign's sheet:
the original header row verbatim and in order, the three reporting columns appended, and every returned
row shaded `FFFFC7CE`. `Resend Of` holds the sender ID the resend replaced.
Uses **ExcelJS** because the community SheetJS build cannot write cell styles (fills are silently
dropped); ExcelJS is server-side only, so the SPA bundle is unaffected.

**Notes:** A campaign can hold several uploads, so their columns are merged in first-seen order. The
sender header is recovered as the one column the upload kept out of `extra_columns`. Hand-typed rows
(resends) borrow the uploaded sender header; a campaign of only resends falls back to `Sender ID`.
`Content-Disposition` is exposed via CORS so the SPA can name the download.

**Acceptance criteria:**
- [x] Export downloads a valid `.xlsx`.
- [x] Original columns/names unchanged; the three new columns appended.
- [x] Returned rows visibly flagged (status + light-red fill).

**Verification:**
- [x] `npm test` — 15 unit tests for the export layout + resend map; 51 tests total.
- [x] Realistic row count: a 500-row upload + 41 returns exported in **32 ms** (22 KB); the sheet held
      504 rows, all 42 returned rows shaded, and no blank sender IDs.
- [x] `Resend Of` verified across campaigns (a resend in "March drop" points back to a sender ID that
      lives in "April drop").
- [x] Browser: the button downloads `campaign-3-april-drop.xlsx`; the saved file opens with the
      expected columns and fills.

**Dependencies:** Task 7, Task 8
**Files:** `server/src/export.ts`, `server/src/exportLayout.ts`, `server/src/index.ts`,
`src/pages/CampaignDetailPage.tsx`, `tests/exportLayout.test.ts`
**Scope:** Medium

## Checkpoint: Outputs
- [ ] Both charts render; the .xlsx exports with returned rows flagged

---

## Task 11: Isolation verification + polish

**Description:** Prove per-customer isolation across every endpoint, then polish copy, empty states
and error messages.

**Progress:** **Done & verified.** `server/src/app.ts` exports the Express app without listening (so
tests can mount it on an ephemeral port) and `server/src/migrations.ts` exposes `runMigrations()`.
A new API suite (`tests/api/`) drives the real HTTP surface with cookie-aware clients against a
throwaway database (`package_returns_test`), so dev data is never touched.

**Acceptance criteria:**
- [x] Tests show a user of customer A can never read/write customer B's data.
- [x] Every data endpoint scopes by `customer_id`.
- [x] Empty states and errors are clear.

**Verification:**
- [x] `npm test` — 90 tests, of which 39 are API isolation/auth/role tests.
- [x] **The suite has teeth:** deliberately removing two `customer_id` guards made 4 tests fail,
      including a cross-tenant *write* that returned 201 instead of 404. Guards restored; green again.
- [x] Audited every SQL statement: tenant tables are all scoped; `/admin/*` (super-admin) and
      `return_reasons` are platform-wide by design and now say so in comments.
- [x] Hardened the three queries that had been relying on an earlier ownership check.
- [x] Polish: non-admin hints on Campaigns/Returns, and a Customers empty state.

**Dependencies:** Tasks 3–10
**Files:** `server/src/app.ts`, `server/src/migrations.ts`, `server/src/{index,migrate}.ts`,
`tests/api/*`, `src/pages/*`, `README.md`
**Scope:** Medium

## Task 12: Deploy to Plesk (static SPA + Node API + MySQL)

**Description:** Create the MySQL database in Plesk, run migrations, deploy the Node API, build the
SPA to `dist/` and serve it, with SPA fallback and HTTPS.

**Progress:** **Prepared & verified locally; the final push to Plesk needs your server access** (there
are no credentials in the repo). The app is now production-shaped:

- All JSON endpoints moved under `/api`, and the same process serves the built SPA with a deep-link
  fallback. Single origin ⇒ `SameSite=Lax` session cookies work and no cross-site cookie problem.
- `server/start.mjs` is the Plesk startup file (registers tsx, loads the TS server); `tsx` moved to
  runtime dependencies. `npm start` runs it.
- `Port` honours Plesk's `PORT` as well as `API_PORT`; empty env values are ignored.
- `SERVE_SPA` / `.env.production` (`VITE_API_BASE_URL=/api`); `trust proxy` in production.
- `docs/deploy-plesk.md`: step-by-step runbook (DB, code, `.env`, build, migrate, Node.js settings,
  HTTPS, update/rollback, troubleshooting, security).

**Acceptance criteria:**
- [~] MySQL DB created; migrations applied. *(runbook ready; local DB migrated)*
- [~] API reachable over HTTPS; env vars set. *(verified locally over HTTP in production mode)*
- [~] SPA served with deep-link fallback; sign-in works in production. *(verified locally)*

**Verification (local, running the production config exactly as Plesk does):**
- [x] `NODE_ENV=production node server/start.mjs` → `/` and `/returns` and `/campaigns/3` return the
      SPA (HTML), while `/api/returns` returns 401 JSON and `/api/nope` returns 404 JSON.
- [x] Fresh sign-in in a browser against the production build; session survives a reload.
- [x] Return lookup, resend chain and the `.xlsx` export all work on the production build.
- [x] `npm test` (90) · `npm run typecheck:api` · `npm run build` · no diagnostics.
- [x] The client bundle contains **no** secrets (checked for DB password/user/name and test passwords).
- [x] `PORT` fallback verified with `API_PORT` deliberately empty.

**Remaining:** run the runbook against the real Plesk server (needs access + the DB password).

**Dependencies:** Tasks 1–11
**Files:** `server/start.mjs`, `server/src/app.ts`, `server/src/config.ts`, `.env.production`,
`.env.example`, `docs/deploy-plesk.md`, `README.md`, `package.json`
**Scope:** Medium

## Checkpoint: Complete
- [ ] All success criteria in `SPECIFICATION.md` met · app live on Plesk · ready for review

---

## UI wording: "package ID" instead of "sender ID"

**Requested:** change the *Sender-ID column* label to *Choose package ID column*.

**Progress:** **Done, applied consistently** — changing one label alone would have left the app
saying "package ID" in one place and "sender ID" in six others, including the error messages.

All user-facing copy now says **package ID**: the upload label, the pick-a-column prompt, the
import notice, the "Stored packages" column header, the whole Process returns screen, and the
validation messages from the API (`package ID is empty on row(s): 2`, `duplicate package IDs in
this file`, `no package with that ID`, ...). The exported spreadsheet's fallback header for
hand-typed rows is now `Package ID` too.

The example placeholders were also wrong for this business — they suggested `PQ987654321ES` style
IDs, while a real sheet uses `PortaP_1`. They now read `e.g. PortaP_1` / `e.g. PortaP_151`.

**Deliberately unchanged:** the database column (`sender_id`), the API parameter (`senderId`) and
the internal helper names. `sender_id` is unique per campaign, so a better name would be
`package_ref` — worth doing only alongside a migration, not as a copy change.

**Verification:** `npm test` (135) · typecheck:api · build · grepped for leftover user-facing
"sender" copy · live check of the new API messages.

**Files:** `src/pages/{CampaignDetailPage,ReturnsPage}.tsx`, `server/src/importValidation.ts`,
`server/src/{returns,resends,packages,exportLayout}.ts`, `tests/{importValidation,resends}.test.ts`
**Scope:** Small

---

## Campaign dates are mandatory

**Requested:** "end date is mandatory. thus no campaign can be created without start and end date."

**Progress:** **Done.** Both `startDate` and `finishDate` are now required on create, and the pair is
validated on update too. `parseIsoDate` rejects anything that is not a real calendar day, so
`2026-02-31` and `2026-13-01` are refused rather than silently rolled over, and `finishDate` may not
precede `startDate`.

- API: `POST /campaigns` → 400 with a specific message for each failure; `PATCH` validates the
  *resulting* pair (so an update cannot leave the dates out of order), while a rename on its own is
  still allowed.
- UI: both date inputs are `required`, with a note explaining why.
- Columns stay nullable in the database so existing rows are not invented data. Two campaigns predate
  the rule and have gaps: "Delta Q1" (Delta Ltd, both missing) and "vuelta al cole" (Plátano, no
  finish). Note a legacy date-less campaign can no longer be renamed via `PATCH` until it is given
  dates — that is deliberate, but worth knowing.

**Verification:** `npm test` — **132 tests** (was 123), including a "campaign dates are mandatory"
suite covering missing/both-missing/impossible dates, reversed windows, a single-day window, and the
update path. Live check of all five cases against the running API.

**Files:** `server/src/{campaigns,validate}.ts`, `src/pages/CampaignsPage.tsx`,
`tests/validate.test.ts`, `tests/api/security.test.ts`, `tests/api/isolation.test.ts`
**Scope:** Small

---

## Role model change (post-Task 12): two roles instead of three

**Requested:** "admin and super admin roles can be merged. Super admin can create campaigns."
→ **2 roles: `superadmin` and `user`.**

**Progress:** **Done.**

- `007_role_merge.sql`: existing `admin` rows become `superadmin` (keeping their `customer_id`), then
  the column becomes `ENUM('superadmin','user')`.
- A super-admin is a full-access account. Attached to a customer it runs that customer's campaigns,
  uploads, returns and exports (what `admin` did) **and** manages customers. With no customer it is a
  pure platform owner — `requireCompany` refuses company-scoped writes with a clear message rather
  than a confusing 404.
- `user` is unchanged: processes returns, read-only elsewhere.
- `POST/GET /admin/customers/:id/users` (was `/admins`) now takes a `role`, so **both** account types
  can be created from the UI — this also closes the earlier gap where no `user` account could be created.
- `npm run create:superadmin -- <email> <password> [customer]` — the optional customer (id or name,
  created if missing) is what makes a login able to create campaigns.
- **Customers page rewritten:** the `window.prompt` flow is gone. Each customer row opens a panel
  listing its accounts plus an inline form (email, password **with Show/Hide**, role). This fixes the
  prompt/checkbox friction and the double-add confusion.

**Verification:** `npm test` — **123 tests** (was 121). Live check of all three shapes:
company super-admin creates a campaign (201) and lists customers (200); company super-admin with no
company gets 403 "this account is not attached to a company"; `user` can read and record returns but
gets 403 on campaign creation and on `/admin`; bad `role` value → 400.

**Files:** `db/migrations/007_role_merge.sql`, `server/src/{auth,campaigns,packages,returns,admin}.ts`,
`server/src/scripts/createSuperadmin.ts`, `src/{auth/AuthContext.tsx,components/Layout.tsx,pages/*}`,
`src/styles.css`, `tests/api/*`, docs
**Scope:** Medium

---

## Security hardening (post-Task 12)

**Description:** Threat-model and audit the app, then fix what is actually exploitable.

**Progress:** **Done.** Full write-up in `SECURITY.md`.

**Fixed:** security headers via helmet (strict CSP, `nosniff`, `frame-ancestors`, HSTS, no
`X-Powered-By`) · brute-force protection on login/register (10 failed attempts per IP per 15 min, plus
300 req/min across `/api`) · **open self-signup closed in production** (`ALLOW_SELF_SIGNUP`) · password
length capped before bcrypt (CPU DoS) · constant-time login (no user enumeration by timing) · boundary
length/format validation so bad input returns 400 instead of a database 500 · hardcoded test DB
password removed.

**Checked and found safe (with evidence):** spreadsheet formula injection in the export (ExcelJS
writes `=`, `+`, `-`, `@` as shared strings, not formulas — raw XML verified) · SQL injection ·
IDOR/access control (mutation-tested) · XSS · secrets in git history · session handling · error
disclosure.

**Accepted with reasons:** dev-only dependency advisories (vite/vitest/tinypool/esbuild), the
react-router 6.x open redirect (no user-controlled destinations), exceljs→uuid (only `uuid.v4` is
used), in-memory rate limiter (single process), stale session rows.

**Verification:** `npm test` — **121 tests** (was 90), including a new `tests/api/security.test.ts` and
`tests/api/loginRateLimit.test.ts`; API test files now run serially so they don't share-clobber the
test database. Browser-verified that the strict CSP does not break the SPA: zero console errors on the
production build, and the `.xlsx` export still downloads.

**Files:** `SECURITY.md`, `server/src/{app,config,auth,admin,campaigns,validate,rateLimit,importValidation,resends}.ts`,
`tests/{validate,rateLimit}.test.ts`, `tests/api/*`, `vitest.config.ts`, `.env.example`, `README.md`,
`docs/deploy-plesk.md`
**Scope:** Medium

## Recent returns: where a resend went, and going there

**Description:** Feedback from using the tool for real: "Process returns" should read "Packages
returns", "Recently recorded" belongs in the top menu next to Campaigns, the resend form should not
ask which campaign a resend goes into, saving a resend should land on "Recently recorded", and that
page must show when a package was sent again and as which package ID.

**Progress:** **Done.**

- Nav is `Customers | Campaigns | Return packages | Packages returns` (Customers only for a
  super-admin).
- "Return packages" (originally "Recently recorded") is its own page (`/returns/recent`), not a block
  on the returns screen.
- The resend form has no campaign picker: the server derives the campaign from the original package
  and rejects a mismatching one (400), so a resend always stays where the original was sent.
- `GET /returns` returns `resent_as` — the next package in the same chain — and the page shows it as
  a **Resent as** column (`—` when the package was never sent again). The list now covers the newest
  100 returns.
- Saving a resend navigates to `/returns/recent` with a short confirmation ("Linked X as a resend of
  Y in “Campaign””) instead of clearing the lookup screen.

**Verification:** `npm test` — **141 tests**, with a case in `tests/api/isolation.test.ts` that walks
`PQA000002ES → PQA000004ES → PQSAMECAMP001ES` and checks each row names the next one. `npm run
typecheck:api` and `npm run build` clean. Browser-verified on the production build: `/returns` has
no `<select>` and no "Campaign sent in" text; saving a resend of an Acme fixture redirected to
`/returns/recent`, showed the confirmation, and that row then read `Resent as = PQAUTO_REDIRECT_1`
(scratch row removed afterwards). The seeded chain `PQ555000002ES → PQ777000123ES → PQ888000999ES`
renders each link in turn.

**Files:** `src/pages/{ReturnsPage,RecentReturnsPage}.tsx`, `src/components/Layout.tsx`,
`server/src/returns.ts`, `tests/api/isolation.test.ts`
**Scope:** Small

## Export straight from Recently recorded

**Description:** A super-admin should be able to download the flagged `.xlsx` without opening the
campaign first — the request was a download button on "Recently recorded", or export functionality
in the top menu.

**Progress:** **Done:** the page has a **Download a campaign** card with a `Campaign` dropdown of
**every** campaign of the company (from `GET /campaigns`, so a campaign with no returns is included)
and a `Download .xlsx` button; the success notice names the file. Shown to super-admins only (they
are the ones who run campaigns); the API would allow a `user` to export too. The download itself
moved to `src/lib/campaignExport.ts` and is shared with the campaign screen, so there is one
implementation of it.

**Verification:** `npm test` — **141 tests** · `npm run typecheck:api` and `npm run build` clean ·
browser-verified on the production build: as `admin@delta.test`, whose campaign has no returns at
all ("Nothing recorded yet."), the dropdown still offers `Delta Q1`, proving the list comes from
`GET /campaigns` and not from the returns shown; as `admin@acme.test` the dropdown matched
`/api/campaigns` exactly and downloading gave `campaign-3-april-drop.xlsx` (and
`campaign-1-march-drop.xlsx`, 22 KB, `file`: Microsoft Excel 2007+) with the notice shown.

**Files:** `src/lib/campaignExport.ts`, `src/pages/{RecentReturnsPage,CampaignDetailPage}.tsx`
**Scope:** Small

## A campaign selector on Packages returns

**Description:** In the super-admin role the returns screen has to let the operator say which campaign
they are processing — "package returns must have a campaign selector" — because a package ID is only
unique within a campaign.

**Progress:** **Done.** `GET /returns/lookup` now takes an optional `campaignId`: 400 if it is not a
positive number, 404 if the campaign is not the caller's own (a foreign id deliberately stays
indistinguishable from a missing one). The returns screen shows super-admins a `Campaign` dropdown
defaulting to **All campaigns**, so a `user` — and a super-admin who ignores it — behaves exactly as
before; changing it clears the results on screen, the results keep being re-looked-up under the
chosen campaign after a return is recorded, and an empty lookup names the campaign it searched.

**Verification:** `npm test` — **145 tests**, including four new ones in `tests/api/isolation.test.ts`
that put the same package ID in a second campaign of the same company (both found with no filter,
one each with a filter, 404 for Beta's campaign, 400 for `campaignId=abc`). `npm run typecheck:api`
and `npm run build` clean. Browser-verified: as `admin@acme.test` the dropdown lists All campaigns /
April drop / March drop; looking up a March drop package while filtered to April drop gives
"No package with that ID in April drop." and no card, and switching back to All campaigns finds it;
`user@acme.test` sees no dropdown.

**Files:** `server/src/returns.ts`, `src/pages/ReturnsPage.tsx`, `tests/api/isolation.test.ts`
**Scope:** Medium

## Every customer's campaigns on the Customers screen

**Description:** The platform admin screen should list each customer's campaigns and let any of them
be picked for download — "I would like to see a list of all campaigns per customer ... select any
campaign from any customer".

**Progress:** **Done.** Each customer row has a `Campaigns` button next to `Users`, opening a panel
with that customer's campaigns (name, start, finish, package count, return count) and a
`Download .xlsx` button each. Two platform routes back it: `GET /admin/customers/:id/campaigns`
(counts from `LEFT JOIN`s, so a campaign with no packages still appears with zeroes) and
`GET /admin/campaigns/:id/export`. Both sit on `adminRouter`, which is `requireSuperAdmin`. The
export moved into `sendCampaignExport(res, campaignId, scopeToCustomer)` in `server/src/export.ts`:
the tenant route passes the caller's own customer — and now answers 404 for a super-admin who has no
company, where before it fell through to an empty match — while the platform route passes null.
Every later query uses the campaign's real owner, so one sheet can never mix two companies.

**Verification:** `npm test` — **151 tests**: the campaign list and its counts (5 packages / 3
returns for the fixture campaign, 0/0 for an empty one), exporting another customer's campaign, the
tenant route still 404 for a platform super-admin, 403 for a `user`, plus both routes added to the
"anonymous callers are rejected" table. `npm run typecheck:api` and `npm run build` clean.
Browser-verified as `root@platform.test` (a super-admin with no company of its own): the Acme Retail
panel lists April drop (5 packages, 4 returns) and March drop (503, 42); downloading April drop gave
`campaign-3-april-drop.xlsx`; the `Users` panel still works.

**Files:** `server/src/{admin,export}.ts`, `src/pages/CustomersPage.tsx`,
`src/lib/campaignExport.ts`, `tests/api/isolation.test.ts`
**Scope:** Medium

## Campaigns: create one, or add a list to one that exists

**Description:** The Campaigns screen should separate the two things done there — creating a campaign,
and adding a list (the uploaded .xlsx) to a campaign that already exists — and show, per campaign,
every list uploaded and how many lines in total.

**Progress:** **Done.** Three headed sections: **New campaign** (unchanged form), **Add a list to an
existing campaign** (a campaign dropdown defaulting to the newest, plus the upload, mapping and
preview flow), and **All campaigns** — a table with `Lists` and `Lines` columns and a `Lists` button
per row opening that campaign's uploads (file, lines, uploaded). `GET /campaigns` now returns
`upload_count` and `total_rows`; the sum is `CAST(... AS UNSIGNED)` so it stays a number instead of a
DECIMAL string. The upload flow (SheetJS parse, sender-column guess, mapping confirm, 10-row preview)
moved into `src/components/CampaignListUpload.tsx`, now shared with the campaign screen, which lost
its duplicate copy of it.

**Verification:** `npm test` — **152 tests**, including a new one asserting `upload_count`/`total_rows`
per campaign (and zeroes rather than nulls for a campaign with nothing uploaded). `npm run
typecheck:api` and `npm run build` clean. Browser-verified: as `owner@mycompany.test` the sections read
New campaign / Add a list to an existing campaign / All campaigns, and *vuelta al cole* shows 1 list ·
150 lines with `Lists` opening `EtqVueltaC.xlsx · 150 lines`; as `user@acme.test` only All campaigns
renders and there is no file input; as `admin@acme.test` a two-line list uploaded into *April drop*,
auto-detected `ID de envío` as the package ID column, and the table went from 2 lists / 5 lines to
3 / 7 (scratch rows deleted afterwards).

**Files:** `src/pages/CampaignsPage.tsx`, `src/components/CampaignListUpload.tsx`,
`src/pages/CampaignDetailPage.tsx`, `server/src/campaigns.ts`, `tests/api/isolation.test.ts`
**Scope:** Medium

## Account lifecycle on the Customers screen

**Description:** A report that the `Users` button on Customers "does not work" — it needed to show all
active users and allow adding, deactivating and deleting an account.

**Progress:** **Done.** The button works (checked live before changing anything: it opens the panel and
lists the accounts); what was missing was the lifecycle. The accounts panel is now a table — email,
role, status (`active` / `disabled`), added — with `Deactivate`/`Activate` and a two-step `Delete`
(`Yes, delete <email>` / `Cancel`). Adding an account keeps the panel open, so the new row is visible.
Backend: `PATCH /admin/users/:id {active}` and `DELETE /admin/users/:id`, both on the
`requireSuperAdmin` router; `GET /admin/customers/:id/users` now returns `is_active`, and the customer
list gained `active_user_count` (shown as "3 · 2 active"). `users.is_active` already existed and both
login and every authenticated request already honoured it, so deactivating only had to set the flag
and drop the open sessions. Guards: you cannot deactivate or delete your own account, and the last
active platform super-admin (the one with no customer of its own) cannot be deactivated or deleted,
since otherwise nobody could manage customers again. Returns reference whoever recorded them, so
deleting such an account is refused with 409 `this account recorded returns; deactivate it instead of
deleting it`; sessions are removed with the account through `ON DELETE CASCADE`.

**Verification:** `npm test` — **162 tests**, ten new: the account list with `is_active`, deactivation
ending a live session and blocking the login (reactivation restoring it), deletion, the 409 for an
account that recorded returns, the self-guards, the last-platform-admin guard, `active` type
validation, 404s, and 403 for a `user`; both admin routes were added to the anonymous-401 table.
`npm run typecheck:api` and `npm run build` clean. Browser-verified as `root@platform.test`: a
throwaway account for Beta Stores was created, deactivated (status `disabled`, login 401),
reactivated, deleted (login 401); deleting `user@acme.test`, which recorded returns, was refused with
that message and the account stayed.

**Files:** `server/src/admin.ts`, `src/pages/CustomersPage.tsx`, `src/lib/api.ts`,
`tests/api/{isolation.test.ts,helpers.ts}`
**Scope:** Medium

## A customer's campaigns open under its own row

**Description:** "When clicking on campaigns it should open up a list below the customer name. I must
be able to select by pinching [clicking] on the individual campaign."

**Progress:** **Done.** The campaigns are no longer a card under the whole table: they open as an extra
`tr.expand` directly beneath that customer's row (a `Fragment` per customer), and each campaign is one
full-width click target carrying its name, dates, `packages · returns` and a `Download .xlsx` label,
which downloads its flagged sheet. The one clicked stays highlighted (`aria-pressed` plus a blue left
edge) so it is obvious which was taken. A `null` campaigns state shows "Loading…" instead of briefly
claiming the customer has no campaigns. `Users` still opens as a card below the table, because that was
not part of this request.

**Verification:** `npm test` — 162 tests (unchanged; markup only) · `npm run build` clean ·
browser-verified on the production build: the expanded row is the next sibling of the *Acme Retail* row
and inside the customers table; the list shows *April drop* (5 packages · 4 returns) and *March drop*
(503 · 42); clicking *April drop* downloaded `campaign-3-april-drop.xlsx` and left the row highlighted;
`Close` removed the row and left the table at six rows.

**Files:** `src/pages/CustomersPage.tsx`, `src/styles.css`
**Scope:** Small

## Current users: form first, and no scroll trap

**Description:** "Put add new user above accounts, change the name from accounts to current users. Make
sure that scroll is active because I can't scroll between the two sections."

**Progress:** **Done.** The panel is titled `<customer>: new users`; the add-user form (Email,
Password, Role, `Add user`) sits directly under the heading with its hint, the users table follows, and
the active/disabled summary closes the card. The card is titled with the customer's name and holds two
accordion sections — **New users** (the form, collapsed) and **Current users** (the table with
activate/deactivate/delete, open by default) — each a native `<details>`/`<summary>`, so either can be
folded away. `Added` now shows the date only, and the delete
confirmation is a compact `Confirm delete` / `Cancel` pair (the row already says who), so nothing wraps
awkwardly. The table is no longer wrapped in `.scroll` inside the panel, and `.scroll` itself became
`overflow-x: auto; overflow-y: hidden` — `overflow-x: auto` alone silently computes `overflow-y` to
`auto`, which turned every wide table into a nested vertical scroll container; that is the likely
reason a trackpad gesture got stuck between the two sections.

**Verification:** `npm test` — **162 tests** · `npm run build` clean · browser-verified on the
production build: the heading reads `Beta Stores: current users`; the form precedes the table in the
DOM; the table is not inside a `.scroll` wrapper; the page scrolls (1093 vs 900) with **zero** nested
vertical scroll containers and the closing paragraph reachable; and the rewritten add/delete flow still
works (a throwaway account was added, appeared in the list, then deleted).

**Files:** `src/pages/CustomersPage.tsx`, `src/styles.css`
**Scope:** Small

## The campaign list under a customer: named, highlighted, scrolled to

**Description:** A report that clicking *Campaigns* on Customers did not show the list "directly below
the customer".

**Progress:** **Done.** The list was already rendered as the next row of the customers table (measured
live: the expand row is the customer row's next sibling, 106/148/70 px tall, with the campaign buttons
visible), so the work was making it impossible to miss: the expanded cell now opens with
`<customer> — N campaigns. Click one to download…`; the customer row it belongs to is highlighted with
the same tint and a blue left edge as the panel; and the panel scrolls itself into view
(`scrollIntoView({ block: "nearest" })`), which matters when the customer sits at the bottom of a short
window. Two labels were sharpened at the same time: the row reads `150 lines · 151 packages · 1 return`
(the 151st package is a resend, which has no uploaded line) and `return` is singular for one.
`GET /admin/customers/:id/campaigns` gained `total_rows`, computed with correlated subqueries — a
`LEFT JOIN` on two one-to-many tables multiplies the counts once a campaign has more than one upload —
and wrapped in `CAST(... AS UNSIGNED)` so it arrives as a number, not a MySQL DECIMAL string.

**Verification:** `npm test` — **162 tests** (the campaign-list case now asserts `total_rows`,
`package_count` and `return_count` together) · `npm run typecheck:api` and `npm run build` clean ·
browser-verified at 1440×900 and at 1200×520: the expand row is the next sibling of the customer row,
that row is highlighted, the heading names the customer, the panel is fully in the viewport (at 520 px
tall the page scrolled itself from 0 to 183 px when the list opened), and the counts read
`150 lines · 151 packages · 1 return` for *vuelta al cole*, and `5 lines · 5 packages · 4 returns` and
`500 lines · 503 packages · 42 returns` for Acme.

**Files:** `src/pages/CustomersPage.tsx`, `src/styles.css`, `server/src/admin.ts`,
`tests/api/isolation.test.ts`
**Scope:** Small

## Campaigns: collapsed tools, and every list under its campaign

**Description:** "Remove the title Campaigns. Redo the view: new campaign and add list to existing
campaign collapsed, and when clicked they open to show the functionality. I want all campaigns to show
a list of all databases uploaded — I must be able to see easily for each campaign a list of all
uploaded lists."

**Progress:** **Done.** The page has no `h1`. The two tools are `<details class="card">` bars
("New campaign", "Add a list to an existing campaign") that start collapsed and open on click. Below
them, every campaign is a block: its name (linking to the campaign), the date window, `N lists · M
lines`, and then **every uploaded file** — name, lines, uploaded — always visible, no click needed.
`GET /campaigns/uploads` returns the company's uploads keyed by campaign, so the screen needs one
request instead of one per campaign; it is declared before `/:id`, which would otherwise swallow
"uploads". `CampaignListUpload` no longer wraps itself in a card, so it sits inside a `<details>` bar
without nesting.

**Verification:** `npm test` — **163 tests**, with a new case for `/campaigns/uploads` (only the
company's own uploads, each carrying its campaign) · `npm run typecheck:api` and `npm run build` clean ·
browser-verified: no `h1`; both bars start collapsed and open to the dates form and to the campaign
select plus file input; *vuelta al cole* shows `1 list · 150 lines` with `EtqVueltaC.xlsx · 150 lines ·
uploaded 2026-10-15 12:29:49`; a `user` sees no bars at all; and Acme's *April drop* shows both of its
files (`envios-abril.xlsx`, `new.xlsx`).

**Files:** `src/pages/CampaignsPage.tsx`, `src/components/CampaignListUpload.tsx`, `src/styles.css`,
`server/src/campaigns.ts`, `tests/api/isolation.test.ts`
**Scope:** Medium

## Scrolling: the page is the only scroller, and it shows

**Description:** "Make sure scrolling is enabled because I can't see all 3 sections."

**Progress:** **Done.** The document was already the only scroller — re-checked: no `overflow: hidden` on
`html`/`body`, no fixed heights, no sticky or fixed bars — so three things were made explicit.
`html { overflow-y: scroll }` keeps the scroll bar visible on macOS instead of appearing only while
scrolling; `.content` gained bottom padding (`24px 18px 64px`) so the last section is never flush against
the window edge; and opening a panel now scrolls it into view, because the users panel opens below the
customers table and on a short window used to appear just out of sight.

**Verification:** `npm test` — **163 tests** · `npm run build` clean · measured in a 1200×520 window
(about half a laptop screen): `overflow-y: scroll` on `<html>`, no nested scroll containers besides the
page itself, 748 px of content in a 578 px viewport, clicking *Users* on the first customer auto-scrolled
0 → 292 px so the panel and its title are in view, and scrolling to the bottom (564 px) put the third
part — **Current users** with both accounts — fully on screen.

**Files:** `src/styles.css`, `src/pages/CustomersPage.tsx`
**Scope:** Small

## Collapsible tools everywhere

**Description:** Make the *New customer* form an accordion too, matching the campaign tools and the two
user sections.

**Progress:** **Done.** *New customer* is a `details.card` bar, collapsed on load, opening to the same
Name field and Create button. Every tool in the app — new customer, new campaign, add a list, new users
— is now a collapsed bar that opens on click, with the lists themselves always visible. The bars were
then made bigger and nicer: 52 px card headers at 17 px and 46 px in-card sections at 16 px, a tinted
header that fills its card, a hover tint, and a triangle drawn in CSS that turns a quarter as the bar
opens.

**Verification:** `npm test` — **163 tests** · `npm run build` clean · browser-verified: a closed bar
fills its card exactly (52 px bar in a 53 px card, the 1 px being the border), the open card regains its
padding around the form, the triangle reports `rotate(90deg)` when open, and both campaign bars measure
52 px.

**Files:** `src/pages/CustomersPage.tsx`, `src/styles.css`
**Scope:** Small

## Adding a list moved onto the campaign, off the home page

**Description:** "Eliminate add a new list from home page, maintain within the campaign page. Maintain
accordion. Maintain on homepage the list of campaigns and lists added to each campaign."

**Progress:** **Done.** The *Add a list to an existing campaign* bar is gone from the campaigns home
page (with its campaign dropdown, the `target` state and the after-import refresh); the home page now
holds one tool — *New campaign* — followed by the campaign blocks, which still list every uploaded file
with its lines and upload time. Uploading lives on the campaign itself as *Add a list to this campaign*,
an accordion in the same style, wrapping the unchanged `CampaignListUpload` flow (parse, sender-column
guess, mapping confirm, preview).

**Verification:** `npm test` — **163 tests** · `npm run build` clean · browser-verified: the home page
has exactly one `details.card` (*New campaign*) and its blocks still read
`April drop · 2 lists · 5 lines` with both files, and `vuelta al cole · 1 list · 150 lines`; a campaign
page has one bar, *Add a list to this campaign*, which opens to the file input (2 lines read); importing
from there gave `Imported 2 lines · package ID column: "ID de envío"` and the home page block became
`April drop · 3 lists · 7 lines` including the new `auto-list.xlsx` (scratch rows deleted afterwards).

**Files:** `src/pages/CampaignsPage.tsx`, `src/pages/CampaignDetailPage.tsx`
**Scope:** Small

## Choose which list to download

**Description:** "Add a selector to decide where to download the list."

**Progress:** **Done.** The campaign screen's export row has a `Download` selector: **Whole campaign (N
packages)** by default, or any one of that campaign's uploaded lists by name and line count. The sheet
is the same flagged export either way; a list only limits it to the rows that came from that file, which
leaves out the resends because they have no file line. `GET /campaigns/:id/export?uploadId=` and
`/admin/campaigns/:id/export?uploadId=` accept it: the id is validated (400 when it is not a positive
number) and must belong to that campaign and company (404 `list not found`), and the file is named after
the list (`campaign-6-etqvueltac.xlsx`) rather than the campaign. The shared `optionalPositiveInt` moved
into `validate.ts`, so the returns lookup and both export routes parse query ids the same way.

**Verification:** `npm test` — **166 tests**, three new: the filtered export is read back with SheetJS and
holds exactly the three uploaded lines and no resend rows, a list from another campaign gives 404, and
`uploadId=abc` gives 400 (a `Client.raw()` helper was added so a test can read a binary body).
`npm run typecheck:api` and `npm run build` clean · browser-verified on *vuelta al cole*: the selector
reads `Whole campaign (151 packages)` and `EtqVueltaC.xlsx (150 lines)`; one click made exactly one
request, saving `campaign-6-vuelta-al-cole.xlsx` and `campaign-6-etqvueltac.xlsx`, which parse to **151**
and **150** data rows with 19 columns each.

**Files:** `server/src/{export,admin,returns,validate}.ts`, `src/lib/campaignExport.ts`,
`src/pages/CampaignDetailPage.tsx`, `tests/api/{helpers,isolation.test.ts}`
**Scope:** Medium
