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

**Acceptance criteria:**
- [ ] Export downloads a valid `.xlsx`.
- [ ] Original columns/names unchanged; the three new columns appended.
- [ ] Returned rows visibly flagged (status + light-red fill).

**Verification:**
- [ ] Tests pass · manual: open the file, check columns + colours · realistic row count.

**Dependencies:** Task 7, Task 8
**Files:** `server/features/export/*`, `src/features/export/*`
**Scope:** Medium

## Checkpoint: Outputs
- [ ] Both charts render; the .xlsx exports with returned rows flagged

---

## Task 11: Isolation verification + polish

**Description:** Prove per-customer isolation across every endpoint, then polish copy, empty states
and error messages.

**Acceptance criteria:**
- [ ] Tests show a user of customer A can never read/write customer B's data.
- [ ] Every data endpoint scopes by `customer_id`.
- [ ] Empty states and errors are clear.

**Verification:**
- [ ] Isolation test suite passes.

**Dependencies:** Tasks 3–10
**Files:** `server/**`, `tests/api/*`, `src/**`
**Scope:** Medium

## Task 12: Deploy to Plesk (static SPA + Node API + MySQL)

**Description:** Create the MySQL database in Plesk, run migrations, deploy the Node API, build the
SPA to `dist/` and serve it, with SPA fallback and HTTPS.

**Acceptance criteria:**
- [ ] MySQL DB created; migrations applied.
- [ ] API reachable over HTTPS; env vars set (DB creds, session secret).
- [ ] SPA served with deep-link fallback; sign-in works in production.

**Verification:**
- [ ] Manual: load the app, sign in, open a deep link, run one upload.

**Dependencies:** Tasks 1–11
**Files:** `server/**`, `.env.production`, Plesk config, `README.md`
**Scope:** Medium

## Checkpoint: Complete
- [ ] All success criteria in `SPECIFICATION.md` met · app live on Plesk · ready for review
