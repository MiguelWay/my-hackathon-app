# Specification (PRD): Package Returns & Store Traceability App

**Status:** Implemented (v1), current as of 2026-10-19; Plesk deployment pending. Source of truth:
`docs/intent/package-returns-traceability.md`.
**Scope note:** No blockchain / Solana. This is a logistics tool for physical packages sent via Correos España.

## 1. Objective
Track physical packages sent to retail stores, classify each returned package by reason, link
resends for full traceability, and export a clearly-flagged list so closed/returning stores are not
sent to again — plus return-rate reporting. The app reads a per-customer send list (Excel) and
**never modifies it**.

## 2. Target users
- **`superadmin`** — a platform super-admin (no company) or a company super-admin (pinned to its
  company). Uploads campaigns and lists, manages customers/accounts, sees every report, and can open
  the **Traducciones** editor. The login screen's two doors let a super-admin enter either the
  administrator view or the operator view; the door chooses the **view**, not the role.
- **`user`** — the operator. Processes returns (customer → campaign → type the sender ID and reason)
  and records the resend when the goods go out again; several users work at once. The operator view
  has no customer/account administration, no uploads and no downloads.
- Multiple **customers** (client companies); each has exactly one master store database and many
  campaigns. One operator team handles returns for every one of them, so a **user picks the customer it
  is working in**. The boundary is the request, not the account: every query is scoped to the single
  customer that request names, and no query ever spans two.
- Non-user: the operator who prunes the source database (outside the app).

## 3. Core user flows
1. **Customer and campaign** — a customer is created with its name; the Campaigns screen creates a
   campaign for a chosen company with a campaign name, start date and finish date. The list is then
   uploaded into that campaign. **Customer creation and campaign creation are separate**; the
   customer selector under the campaign list is independent from the **Company** selector in the form.
2. **Upload** — the administrator uploads one or more Excel campaign lists (thousands of store rows).
   The app auto-detects the **package ID** column and the **store ID** column (usually `Ref. 2`) and
   asks for a one-click confirm; both are required and must be different columns. Existing column
   names are never changed.
3. **Return capture** — The user **manually types the sender ID** from the returned package. The app
   validates it against the campaign, then shows the five return reasons.
4. **Resend** — The returned package is sent again under a **new** sender ID. That ID **must already
   exist in the same campaign** (the new label normally arrives in another uploaded list); the app links
   it to the returned package as the next attempt of one chain. No package is created and no label data
   is copied at resend time.
5. **Report** — Returned packages by category (bars) per campaign, plus resend volume.
6. **Export** — .xlsx of all rows: returned rows light-red, resent rows light-green (red wins), with the
   status, reason and chain columns, per campaign and per customer. Downloads are administrator-only;
   operators can read every report but cannot export it.
7. **Return package list** — a collapsed accordion inside each campaign (administrator Campaigns,
   administrator campaign screen, operator campaign screen, operator Customers expansion). It holds one
   table of returned/resent package IDs (Status + Reason; red/green), a second uncoloured **Resend
   links** table, and a **Returned packages by category** bar chart with every seeded reason, zeroes
   included. The administrator workbook has one sheet per table plus **Returns by category**.
8. **Returns + Store ID** — a separate collapsed accordion and administrator download: one row per
   return → resend link, with each package's store ID (`Store ID · Return package ID · Reason · Store
   ID · Resend package ID`).
9. **Languages** — the app opens in Spanish; an **ES / EN** switch in the header keeps the original
   English available for comparison. Administrators edit both languages in **Traducciones**, grouped by
   screen and role; the live copy is stored in MySQL and applied immediately.

## 4. Features
**Must-have (v1)**
- Auth + roles (`superadmin`, `user`), with every request scoped to the one customer it names.
  Self-signup is closed in production; **Forgot password** emails a single-use, 30-minute reset link.
  The login screen's two doors choose the administrator or operator **view**.
- Excel upload per campaign (multiple uploads per campaign); **package ID and store ID column**
  auto-detect + confirm; both are required.
- Store every row with all columns; one row = one package. The store ID is the company's own unique
  store reference and may repeat across packages.
- Return capture: **manual sender-ID entry** → validate against the campaign → reason choice
  (tienda cerrada, ausente, dirección incorrecta, estacionada, otro); one return per package.
- **Package ID scan** (added post-v1): photograph the printed ID and the app fills the field. The OCR
  runs **on the phone** (Tesseract.js in a Web Worker, assets served from `/tesseract`), so no photo
  leaves the device. The characters are then matched against the campaign's own IDs
  (`POST /returns/resolve`): routinely confused characters (`0/O/Q`, `1/I/L`, `2/Z`, `5/S`, `8/B`,
  `6/G`, `4/A`, `U/V`), a dropped or doubled character and a missing separator are tolerated, and a
  tie is shown as a short list for the operator to settle. Manual typing stays available.
- Resend linking: the returned package → an existing package of the same campaign, as the next attempt
  of the chain; one resend per package; a returned package cannot be a resend target.
- Admin deletion: a super-admin can delete a campaign (with its uploads, packages and returns) and a
  customer (with its campaigns); a customer with accounts attached is refused until they are moved.
- **Return package list**: a campaign's returned and resent package IDs (Status + Reason, red/green),
  a second uncoloured **Resend links** table (`Returned ID · Reason · Resent ID · Returned ID ·
  Reason`), and a **Returned packages by category** bar chart (five seeded reasons, zeroes included).
  Opened as a **collapsed accordion** in the operator's Customers expansion, in each campaign card on
  Campaigns, and on the campaign's returns screen; available to both roles. The administrator's
  workbook has one sheet for each table plus **Returns by category**; operators have no download.
- **Returns + Store ID**: a separate report and administrator download for the campaign, one row per
  return → resend link (`Store ID · Return package ID · Reason · Store ID · Resend package ID`).
- **Languages**: Spanish by default, original English retained; an **ES / EN** switch in the header;
  an administrator-only **Traducciones** editor (`/translations`) grouped by screen and role, with both
  columns editable and saved to the `translations` table.
- Reporting: returned packages by category (bar, per campaign) + resend volume.
- Export .xlsx: original columns unchanged + `Return Status` (Sent / Returned / Resent), `Return Reason`,
  `Original ID`, `Resent as`, `Resent again as`, …; returned rows light-red, resent rows light-green,
  red winning; scope per campaign & customer.

**Later (v2+)**
- Barcode / QR scanning (the printed ID is text; the scan path reads it with OCR).
- Google Sheets / Playwright as an alternative input source.
- Optional write-back to the source database.
- More reports/charts; customer self-service portal.

## 5. Data model

As implemented in `db/migrations/`:

- `customers(id, name)` — one name per customer (case- and accent-insensitive).
- `users(id, customer_id, email, password_hash, role ∈ {superadmin, user}, is_active, created_at)`.
- `sessions(id, user_id, token_hash, expires_at, …)` — server sessions, httpOnly cookie.
- `campaigns(id, customer_id, name, start_date, finish_date, created_at)`.
- `campaign_uploads(id, customer_id, campaign_id, filename, columns json, store_column, row_count,
  created_at)`.
- `packages(id, customer_id, campaign_id, upload_id, source_row, sender_id, store_id, chain_id,
  attempt_no, resent_at, created_via ∈ {upload, resend}, extra_columns json, created_at)` — unique
  `sender_id` per campaign; one row = one package. `store_id` is required and never changes after the
  upload (no route updates it); it is the company's unique store reference and may repeat across
  packages. `chain_id` points at the chain's first package;
  `attempt_no` is 1 as uploaded and N for the package used as the Nth attempt; `resent_at` marks a
  package used as a resend.
- `returns(id, customer_id, package_id, reason_id, note, recorded_by, returned_at)` — one per package.
- `return_reasons(id, code, label, closed_store, sort_order)`: tienda cerrada, ausente, dirección
  incorrecta, estacionada, otro.
- `password_resets(id, user_id, token_hash, expires_at, used_at, created_at)` — single-use reset links.
- `translations(id, text_key, screen, role, context, english, spanish, sort_order, updated_at)` — every
  static UI text, seeded from `shared/translations.ts`; the table is the live editable copy and a
  missing key falls back to the catalog. It is platform-wide (not tenant-scoped).

## 6. Tech stack
- **Frontend:** web app — React + Vite + TypeScript, mobile-friendly (manual entry; no camera).
  Spanish/English UI through a small i18n layer (`src/i18n/`, `shared/translations.ts`).
- **Backend API:** **Node.js + Express (TypeScript)** — auth, data, translations and export. (Plesk
  Node: 24.21.0 / 26.11.0.)
- **Database:** **MySQL / MariaDB** on the existing Plesk server — the source of truth, including the
  `translations` table.
- **Auth:** our own — email + password (hashed) with server sessions in an httpOnly cookie.
- **Isolation:** enforced in the API — every query is scoped to the one customer the request names
  (MySQL has no Row Level Security). The boundary is the request, not the account. UI translations
  are platform-wide copy, not tenant data.
- **Export:** an API route generating the .xlsx (ExcelJS).
- **Hosting:** Plesk serves the static SPA and runs the Node API; `scripts/deploy-plesk.sh` is the
  one-command deploy.

## 7. External integrations
- Correos España — outbound shipping (labels printed outside the app; no API assumed).
- No third-party OCR service: the package-ID scan runs on-device (see §4).
- (No Supabase, no Solana / blockchain.)

## 8. Security & privacy boundaries
- **Always:** scope every API query to the single customer the request names (isolation is enforced in
  the API, not the database); validate the entered sender ID against the campaign; hash passwords and
  store only hashed session tokens; keep translation writes administrator-only.
- **Public by design:** `GET /api/translations` returns only the static UI copy (no tenant data, no
  secrets) because the login screen needs it before a session exists. `GET/PUT /api/admin/translations`
  require a super-admin.
- **Ask first:** changing the DB schema; adding dependencies; changing auth/roles.
- **Never:** log or transmit secrets/credentials; expose one customer's data to another; write back
  to the source database in v1.
- *(Supabase is no longer used; crypto items from the original request — seed phrases, Mobile Wallet
  Adapter — are N/A.)*

## 9. Commands / Structure / Testing
- **Commands (frontend):** `npm run dev`, `npm run build`, `npm test`.
- **Commands (backend / DB):** `npm run api:dev`, `npm run api:start`, `npm run db:migrate`,
  `npm run typecheck:api`, `npm run create:superadmin`, `npm run recover`.
- **Deployment:** `bash scripts/deploy-plesk.sh` on the Plesk application root.
- **Structure:** `src/` (web frontend), `server/` (Node API), `shared/` (translation catalog),
  `db/migrations/` (MySQL schema), `docs/`, `scripts/`, `tests/`.
- **Testing:** unit tests for upload parsing, export layout, the translation catalog, and API tests
  including per-customer isolation and translation permissions. Current suite: **272 tests**.

## 10. Success criteria (business outcomes)
1. An admin can upload a real campaign list and every row is stored with its original columns
   unchanged.
2. Processing a return: the user types the sender ID, it validates against the campaign, the reason
   is chosen, and the row is marked returned — in seconds.
3. A resent package links to the next package ID, which already exists in the campaign: one chain,
   ordered by attempt, searchable from any of its IDs.
4. The export is a .xlsx of all rows with returned rows red and resent rows green (red winning), per
   campaign and customer.
5. Returned packages by category (bar) per campaign and resend volume are visible to the right roles.
6. Each request is scoped to exactly one customer: a response only ever contains that customer's rows,
   and a write always lands in the customer the named package belongs to.
7. The app opens in Spanish; the original English is one switch away, and an administrator can edit
   either language without a deploy.

## 11. Decisions on previously-open points
- **Return reasons (decided):** data-driven, seeded with the five — tienda cerrada, ausente, dirección
  incorrecta, estacionada, otro — editable per customer/campaign later.
- **Extra per-customer columns:** no decision needed; every uploaded column is stored verbatim.
- **OCR:** shipped after v1 as an on-device scan (see §4). The browser reads the label; the server only
  receives the text it read and matches it against the campaign, so no image is stored or uploaded.
  Barcode/QR decoding remains out of scope.
- **Language (decided):** Spanish is the default for everyone, with an **ES / EN** switch in the header;
  English is kept beside every text for easy updating. Only administrators edit the table; operators
  never see the editor. Server API error messages remain English in this phase.

_**No open questions for v1.**_
