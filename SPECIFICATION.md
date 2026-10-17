# Specification (PRD): Package Returns & Store Traceability App

**Status:** Draft (revised: no Supabase) — awaiting approval. Source of truth: `docs/intent/package-returns-traceability.md`.
**Scope note:** No blockchain / Solana. This is a logistics tool for physical packages sent via Correos España.

## 1. Objective
Track physical packages sent to retail stores, classify each returned package by reason, link
resends for full traceability, and export a clearly-flagged list so closed/returning stores are not
sent to again — plus return-rate reporting. The app reads a per-customer send list (Excel) and
**never modifies it**.

## 2. Target users
- **Admin** — uploads campaign send files; sees all reports.
- **User** — processes returns (picks the customer, then the campaign, then types the sender ID and the
  reason) and records the resend when the goods go out again; several users work at once.
- Multiple **customers** (client companies); each has exactly one master store database and many
  campaigns. One operator team handles returns for every one of them, so a **user picks the customer it
  is working in**. The boundary is the request, not the account: every query is scoped to the single
  customer that request names, and no query ever spans two.
- Non-user: the operator who prunes the source database (outside the app).

## 3. Core user flows
1. **Upload** — Admin picks customer + campaign (form fields: customer name, campaign name, start
   date, finish date) and uploads an Excel campaign list (thousands of store rows). The app
   auto-detects the sender-ID column and asks for a one-click confirm; existing column names are
   never changed.
2. **Return capture** — The user **manually types the sender ID** from the returned package. The app
   validates it against the campaign, then shows a dropdown of return reasons.
3. **Resend** — The returned package is sent again under a **new** sender ID. That ID **must already
   exist in the same campaign** (the new label normally arrives in another uploaded list); the app links
   it to the returned package as the next attempt of one chain. No package is created and no label data
   is copied at resend time.
4. **Report** — Return rate by category (bar) per campaign, and resend volume.
5. **Export** — .xlsx of all rows: returned rows light-red, resent rows light-green (red wins), with the
   status, reason and chain columns, per campaign and per customer.
6. **Return package list** — beside a campaign's counters, one table of the campaign's returned and
   resent package IDs (Status + Reason; red/green rows), and a second uncoloured **Resend links** table
   (Returned ID · Reason · Resent ID · Returned ID · Reason); both downloadable, one sheet each.

## 4. Features
**Must-have (v1)**
- Auth + roles (Admin, User), with every request scoped to the one customer it names.
- Excel upload per campaign (multiple uploads per campaign); sender-ID column auto-detect + confirm.
- Store every row with all columns; one row = one store = one sender ID = one package.
- Return capture: **manual sender-ID entry** → validate against the campaign → reason choice
  (tienda cerrada, ausente, dirección incorrecta, estacionada, otro); one return per package.
- Resend linking: the returned package → an existing package of the same campaign, as the next attempt
  of the chain; one resend per package; a returned package cannot be a resend target.
- **Return package list**: a campaign's returned and resent package IDs (Status + Reason, red/green),
  plus a second, uncoloured **Resend links** table (`Returned ID · Reason · Resent ID · Returned ID ·
  Reason`); opened inline beside the counters, in the campaign's row on Customers, and in each campaign
  card on Campaigns; downloadable as a workbook with one sheet each; available to both roles.
- Reporting: return rate by category (bar, per campaign) + resend volume.
- Export .xlsx: original columns unchanged + `Return Status` (Sent / Returned / Resent), `Return Reason`,
  `Original ID`, `Resent as`, `Resent again as`, …; returned rows light-red, resent rows light-green,
  red winning; scope per campaign & customer.

**Later (v2+)**
- Optional OCR (photo capture) or barcode/QR scanning to speed up sender-ID entry.
- Google Sheets / Playwright as an alternative input source.
- Optional write-back to the source database.
- More reports/charts; customer self-service portal.

## 5. Data model

As implemented in `db/migrations/`:

- `customers(id, name)` — one name per customer (case- and accent-insensitive).
- `users(id, customer_id, email, password_hash, role ∈ {superadmin, user}, is_active, created_at)`.
- `sessions(id, user_id, token_hash, expires_at, …)` — server sessions, httpOnly cookie.
- `campaigns(id, customer_id, name, start_date, finish_date, created_at)`.
- `campaign_uploads(id, customer_id, campaign_id, filename, columns json, row_count, created_at)`.
- `packages(id, customer_id, campaign_id, upload_id, source_row, sender_id, chain_id, attempt_no,
  resent_at, created_via ∈ {upload, resend}, extra_columns json, created_at)` — unique `sender_id` per
  campaign; one row = one store = one package. `chain_id` points at the chain's first package;
  `attempt_no` is 1 as uploaded and N for the package used as the Nth attempt; `resent_at` marks a
  package used as a resend.
- `returns(id, customer_id, package_id, reason_id, note, recorded_by, returned_at)` — one per package.
- `return_reasons(id, code, label, closed_store, sort_order)`: tienda cerrada, ausente, dirección
  incorrecta, estacionada, otro.

## 6. Tech stack
- **Frontend:** web app — React + Vite + TypeScript, mobile-friendly (manual entry; no camera).
- **Backend API:** **Node.js + Express (TypeScript)** — auth, data and export. (Plesk Node: 24.21.0 /
  26.11.0.)
- **Database:** **MySQL / MariaDB** on the existing Plesk server — the source of truth.
- **Auth:** our own — email + password (hashed) with server sessions in an httpOnly cookie.
- **Isolation:** enforced in the API — every query is scoped to the one customer the request names
  (MySQL has no Row Level Security). The boundary is the request, not the account.
- **Export:** an API route generating the .xlsx (SheetJS).
- **Hosting:** Plesk serves the static SPA and runs the Node API.

## 7. External integrations
- Correos España — outbound shipping (labels printed outside the app; no API assumed).
- (No Supabase, no OCR, no Solana / blockchain.)

## 8. Security & privacy boundaries
- **Always:** scope every API query to the single customer the request names (isolation is enforced in
  the API, not the database); validate the entered sender ID against the campaign; hash passwords and
  store only hashed session tokens.
- **Ask first:** changing the DB schema; adding dependencies; changing auth/roles.
- **Never:** log or transmit secrets/credentials; expose one customer's data to another; write back
  to the source database in v1.
- *(Supabase is no longer used; crypto items from the original request — seed phrases, Mobile Wallet
  Adapter — are N/A.)*

## 9. Commands / Structure / Testing
- **Commands (frontend):** `npm run dev`, `npm run build`, `npm test`.
- **Commands (backend / DB):** migration runner TBD with the language (e.g. `npm run db:migrate`);
  API dev server TBD.
- **Structure:** `src/` (web frontend), `server/` (Node API — pending language),
  `db/migrations/` (MySQL schema), `docs/`, `scripts/`.
- **Testing:** unit tests for upload parsing and export; API tests including per-customer isolation.

## 10. Success criteria (business outcomes)
1. An admin can upload a real campaign list and every row is stored with its original columns
   unchanged.
2. Processing a return: the user types the sender ID, it validates against the campaign, the reason
   is chosen, and the row is marked returned — in seconds.
3. A resent package links to the next package ID, which already exists in the campaign: one chain,
   ordered by attempt, searchable from any of its IDs.
4. The export is a .xlsx of all rows with returned rows red and resent rows green (red winning), per
   campaign and customer.
5. Return rate by category (bar) per campaign and resend volume are visible to the right roles.
6. Each request is scoped to exactly one customer: a response only ever contains that customer's rows,
   and a write always lands in the customer the named package belongs to.

## 11. Decisions on previously-open points
- **Return reasons (decided):** data-driven, seeded with the five — tienda cerrada, ausente, dirección
  incorrecta, estacionada, otro — editable per customer/campaign later.
- **Extra per-customer columns:** no decision needed; every uploaded column is stored verbatim.
- **OCR:** out of v1 (manual sender-ID entry); optional OCR / barcode is deferred to v2.

_**No open questions.**_
