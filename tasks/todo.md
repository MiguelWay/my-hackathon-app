# Task List: Package Returns & Store Traceability App

Task list target for this project. Index and rationale: `tasks/plan.md`. Spec: `SPECIFICATION.md`.

---

## Task 1: Project setup & Supabase link

**Description:** Scaffold the web app (Vite + React + TypeScript), add Supabase client config, and
link a Supabase project (local dev + migrations).

**Acceptance criteria:**
- [ ] App runs locally and `npm run build` succeeds.
- [ ] Supabase client configured via env vars (`.env.example` committed, real `.env` git-ignored).
- [ ] `supabase/` initialised; `npx supabase db push` applies an empty baseline.

**Verification:**
- [ ] `npm run build` passes · `npm run dev` serves · `npx supabase db push` runs clean.

**Dependencies:** None
**Files likely touched:** `package.json`, `vite.config.ts`, `src/main.tsx`, `src/lib/supabase.ts`, `.env.example`, `.gitignore`, `supabase/config.toml`
**Estimated scope:** Medium

---

## Task 2: Auth + profiles/roles + RLS foundation

**Description:** Supabase Auth (email/password or magic link), a `profiles` table with `role`
(`admin` | `user`) and `customer_id`, and baseline RLS policies.

**Acceptance criteria:**
- [ ] A user can sign in/out; a `profiles` row is created for them.
- [ ] `role` and `customer_id` are stored and readable by the app.
- [ ] RLS is enabled on `profiles`; a user can only read their own row / customer.

**Verification:**
- [ ] Tests pass · manual sign-in · SQL check that RLS blocks a cross-customer read.

**Dependencies:** Task 1
**Files likely touched:** `supabase/migrations/*_profiles.sql`, `src/auth/*`, `src/lib/supabase.ts`, `tests/rls/*`
**Estimated scope:** Medium

## Checkpoint: Foundation
- [ ] Build clean · sign-in works · RLS in place · review with human before Phase 2

---

## Task 3: Customers & campaigns

**Description:** CRUD for `customers` and `campaigns` (name, start date, finish date). Admin-only
writes; RLS scopes both by `customer_id`.

**Acceptance criteria:**
- [ ] Admin can create a customer and, within it, a campaign with start/finish dates.
- [ ] A non-admin cannot create customers/campaigns.
- [ ] A user only sees their customer's campaigns.

**Verification:**
- [ ] Tests pass · manual create · RLS check across two customers.

**Dependencies:** Task 2
**Files likely touched:** `supabase/migrations/*_customers_campaigns.sql`, `src/features/campaigns/*`
**Estimated scope:** Medium

## Task 4: Campaign-list upload — parse + column mapping confirm

**Description:** Upload an Excel file, parse it client-side (SheetJS), preview the columns, and
**auto-detect the sender-ID column with a one-click confirm**. Do not rename any columns.

**Acceptance criteria:**
- [ ] An `.xlsx` file is parsed and its columns/rows previewed.
- [ ] The likely sender-ID column is pre-selected; the user can confirm or change it.
- [ ] Nothing is written to the DB yet; the confirm step is the gate.

**Verification:**
- [ ] Tests on a sample file (incl. accented Spanish text) · manual upload + confirm.

**Dependencies:** Task 3
**Files likely touched:** `src/features/upload/*`, `tests/upload/*`
**Estimated scope:** Medium

## Task 5: Persist packages (uniqueness + verbatim columns)

**Description:** On confirm, insert rows into `packages` for the campaign: known fields plus **all
other columns verbatim** in `extra_columns jsonb`. Enforce `sender_id` unique **per campaign**.

**Acceptance criteria:**
- [ ] Uploading a list creates one `packages` row per store, with `sender_id` set.
- [ ] All other columns are preserved exactly (names and values) in `extra_columns`.
- [ ] A duplicate `sender_id` in the same campaign is rejected with a clear error.
- [ ] Multiple uploads can be added to the same campaign.

**Verification:**
- [ ] Tests pass · manual upload of a real list · verify row count + sample `extra_columns`.

**Dependencies:** Task 4
**Files likely touched:** `supabase/migrations/*_packages.sql`, `src/features/upload/*`
**Estimated scope:** Medium

## Checkpoint: Core data
- [ ] A real campaign list uploads and every row is stored with original columns unchanged

---

## Task 6: Return capture (manual sender-ID entry + reason)

**Description:** A user types the sender ID; the app validates it against the campaign, then shows a
dropdown of the five reasons (tienda cerrada, ausente, dirección incorrecta, estacionada, otro) and
records the return.

**Acceptance criteria:**
- [ ] Entering a valid sender ID finds the package; an unknown ID shows a clear "not found".
- [ ] Choosing a reason creates a `returns` row and marks the package returned.
- [ ] Reasons are data-driven (seeded with the five), editable later per customer/campaign.

**Verification:**
- [ ] Tests pass · manual capture of a return · invalid-ID path checked.

**Dependencies:** Task 5
**Files likely touched:** `supabase/migrations/*_returns_reasons.sql`, `src/features/returns/*`
**Estimated scope:** Medium

## Task 7: Resend linking (Package Chain ID)

**Description:** When a returned package is resent with a new sender ID, link the original and new
records under one `chain_id`, so the chain is searchable from any sender ID.

**Acceptance criteria:**
- [ ] A resend ties the new sender ID to the original and shares one `chain_id`.
- [ ] Searching any sender ID in the chain shows the whole history.
- [ ] Chains can extend across multiple resends.

**Verification:**
- [ ] Tests pass · manual: build a 3-link chain and search from each ID.

**Dependencies:** Task 6
**Files likely touched:** `supabase/migrations/*_resends.sql`, `src/features/resends/*`
**Estimated scope:** Medium

## Checkpoint: Returns & resends
- [ ] A return records end-to-end; a resend links original ↔ new sender ID

---

## Task 8: Reporting (return rate by category + resend volume)

**Description:** Two charts with Recharts: return rate by category (bar, per campaign) and resend
volume. Admins see all; customer users see their own.

**Acceptance criteria:**
- [ ] Return-rate-by-category bar chart renders per campaign.
- [ ] Resend-volume chart renders.
- [ ] Visibility respects roles/customer scope.

**Verification:**
- [ ] Tests pass · manual: charts match known data · role check.

**Dependencies:** Task 6, Task 7
**Files likely touched:** `src/features/reports/*`, `tests/reports/*`
**Estimated scope:** Medium

## Task 9: Export .xlsx (Edge Function)

**Description:** A Supabase Edge Function generates the .xlsx: **all original columns unchanged**,
plus `Return Status`, `Return Reason`, `Resend Of`; **returned rows filled light red**; scope per
campaign and per customer.

**Acceptance criteria:**
- [ ] Export downloads a valid `.xlsx`.
- [ ] Original columns/names are unchanged; the three new columns are appended.
- [ ] Returned rows are visibly flagged (status + light-red fill).

**Verification:**
- [ ] Tests pass · manual: open the file, confirm columns + colours · realistic row count.

**Dependencies:** Task 6, Task 7
**Files likely touched:** `supabase/functions/export-xlsx/*`, `src/features/export/*`
**Estimated scope:** Medium

## Checkpoint: Outputs
- [ ] Both charts render; the .xlsx exports with returned rows flagged

---

## Task 10: RLS / data-isolation verification + polish

**Description:** Prove customer isolation across all tables, then polish copy, empty states and
delete-at-campaign-end behaviour.

**Acceptance criteria:**
- [ ] Automated tests show a user of customer A can never read/write customer B's rows.
- [ ] Every table carrying customer data has RLS enabled with correct policies.
- [ ] Empty states and error messages are clear.

**Verification:**
- [ ] Isolation test suite passes · manual review of each table's policies.

**Dependencies:** Tasks 2–9
**Files likely touched:** `supabase/migrations/*`, `tests/rls/*`, `src/**`
**Estimated scope:** Medium

## Checkpoint: Complete
- [ ] All success criteria in `SPECIFICATION.md` met · ready for review
