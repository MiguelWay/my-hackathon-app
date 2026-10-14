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
- **User** — processes returns (types the sender ID, picks the reason); several users work at once.
- Multiple **customers** (tenants); each has exactly one master store database and many campaigns.
  Data is **totally separated** per customer.
- Non-user: the operator who prunes the source database (outside the app).

## 3. Core user flows
1. **Upload** — Admin picks customer + campaign (form fields: customer name, campaign name, start
   date, finish date) and uploads an Excel campaign list (thousands of store rows). The app
   auto-detects the sender-ID column and asks for a one-click confirm; existing column names are
   never changed.
2. **Return capture** — The user **manually types the sender ID** from the returned package. The app
   validates it against the campaign, then shows a dropdown of return reasons.
3. **Resend** — The returned package is sent again under a **new** sender ID (uploaded as a new
   Excel list into the same campaign). The app links original ↔ new sender ID under one **Package
   Chain ID**.
4. **Report** — Return rate by category (bar) per campaign, and resend volume.
5. **Export** — .xlsx of all rows with returned rows flagged (status + light-red fill), per campaign
   and per customer.

## 4. Features
**Must-have (v1)**
- Auth + roles (Admin, User) with per-customer row-level isolation.
- Excel upload per campaign (multiple uploads per campaign); sender-ID column auto-detect + confirm.
- Store every row with all columns; one row = one store = one sender ID = one package.
- Return capture: **manual sender-ID entry** → validate against the campaign → reason dropdown
  (tienda cerrada, ausente, dirección incorrecta, estacionada, otro).
- Resend linking (Package Chain ID; original ↔ new sender ID).
- Reporting: return rate by category (bar, per campaign) + resend volume.
- Export .xlsx: original columns unchanged + `Return Status`, `Return Reason`, `Resend Of`; returned
  rows light-red; scope per campaign & customer.

**Later (v2+)**
- Optional OCR (photo capture) or barcode/QR scanning to speed up sender-ID entry.
- Google Sheets / Playwright as an alternative input source.
- Optional write-back to the source database.
- More reports/charts; customer self-service portal.

## 5. Data model
- `customers(id, name)`
- `profiles(id → auth.users, customer_id, role ∈ {admin, user})`
- `campaigns(id, customer_id, name, start_date, finish_date)`
- `uploads(id, campaign_id, uploaded_by, uploaded_at, source_filename)`
- `packages(id, campaign_id, upload_id, chain_id, sender_id, store_name, address, ship_date,
  extra_columns jsonb)` — unique sender_id per campaign; one row = one store = one package.
- `returns(id, package_id, reason, returned_at, recorded_by)`
- `resends(id, chain_id, original_sender_id, new_sender_id, created_at, created_by)`
- Reasons: tienda cerrada, ausente, dirección incorrecta, estacionada, otro.

## 6. Tech stack
- **Frontend:** web app — React + Vite + TypeScript, mobile-friendly (manual entry; no camera).
- **Backend API:** Node.js + Express (TypeScript) — auth, data and export. *(Language pending final
  confirmation; PHP is the alternative.)*
- **Database:** **MySQL / MariaDB** on the existing Plesk server — the source of truth.
- **Auth:** our own — email + password (hashed) with server sessions in an httpOnly cookie.
- **Isolation:** enforced in the API — every query scoped by the caller's `customer_id` (MySQL has no
  Row Level Security).
- **Export:** an API route generating the .xlsx (SheetJS).
- **Hosting:** Plesk serves the static SPA and runs the Node API.

## 7. External integrations
- Correos España — outbound shipping (labels printed outside the app; no API assumed).
- (No Supabase, no OCR, no Solana / blockchain.)

## 8. Security & privacy boundaries
- **Always:** scope every API query by the caller's `customer_id` (isolation is enforced in the API,
  not the database); validate the entered sender ID against the campaign; hash passwords and store
  only hashed session tokens.
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
3. A resent package links its new sender ID to the original (one Package Chain ID, searchable from
   any ID).
4. The export is a .xlsx of all rows with returned rows clearly marked (status + colour), per
   campaign and customer.
5. Return rate by category (bar) per campaign and resend volume are visible to the right roles.
6. One customer's data is never visible to another.

## 11. Decisions on previously-open points
- **Return reasons (decided):** data-driven, seeded with the five — tienda cerrada, ausente, dirección
  incorrecta, estacionada, otro — editable per customer/campaign later.
- **Extra per-customer columns:** no decision needed; every uploaded column is stored verbatim.
- **OCR:** out of v1 (manual sender-ID entry); optional OCR / barcode is deferred to v2.

_**No open questions.**_
