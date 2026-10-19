# Implementation Plan: Package Returns & Store Traceability App

## Overview
Build a **web app** (React + Vite + TypeScript) with our **own backend API** (Node.js + Express,
TypeScript) and a **MySQL / MariaDB** database on the existing **Plesk** server. An admin uploads
per-customer campaign lists (Excel); users record returns by **manual sender-ID entry** + a reason;
resends are linked under one Package Chain ID; return rates are charted; and a flagged **.xlsx** is
exported. Per-customer isolation is enforced in the API. **No Supabase.**

Spec: `SPECIFICATION.md`. Intent: `docs/intent/package-returns-traceability.md`.

## Architecture Decisions
- **Database: MySQL / MariaDB** on Plesk. Schema lives in ordered SQL files under `db/migrations/`.
  No Row Level Security (MySQL has none) — isolation is enforced in the API.
- **Isolation:** every API query is scoped to the single customer the request names. This is the
  single most important rule; it gets its own verification task.
- **Backend: Node.js + Express (TypeScript)** — auth, data and export. API code lives in `server/`
  and runs via `tsx` (no build step); type-checked with `npm run typecheck:api`.
- **Auth:** our own. Email + password (hashed with bcrypt/argon2); server sessions stored in a
  `sessions` table, with the raw token only in an httpOnly cookie.
- **Roles:** `users.role ∈ {superadmin, user}`. Two roles only: a **super-admin** has full
  access (runs campaigns, uploads lists, exports, and manages customers); a **user** processes
  returns and records their resends. One operator team handles returns for every client company, so
  **returns are not scoped to the account**: a `user` picks the customer it is working in and every
  request is then scoped to that one customer. `users.customer_id` is the account's own company, used
  to default the picker and to scope what a super-admin runs.
- **Excel ingestion** is client-side (SheetJS): preview → auto-detect the sender-ID column →
  one-click confirm. **Column names are never changed**; unknown columns are stored verbatim in
  `extra_columns` (JSON).
- **Uniqueness:** `sender_id` unique **per campaign**; one row = one store = one package.
- **Resends:** `packages.chain_id` groups a physical package's successive sender IDs.
- **Manual return capture** — no OCR, no camera.
- **Export:** an API route generating the .xlsx (SheetJS) with appended columns and light-red fills.
- **Charts:** Recharts; two only — return rate by category (bar, per campaign) and resend volume.
- **Hosting:** Plesk serves the static SPA (`dist/`) and runs the Node API.

## Dependency Graph
```
Repo layout + migrations dir
        │
        └── DB schema foundation (users/roles/customers/sessions)
                │
                └── Backend API skeleton + auth (sessions)
                        │
                        └── Customers & campaigns (schema + API + UI)
                                │
                                └── Upload parse + column mapping (UI) ──► Persist packages (schema + API)
                                                                                   │
                                                                                   └── Return capture (schema + API + UI)
                                                                                           │
                                                                                           └── Resend linking (chain)
                                                                                                   │
                                                                     ┌─────────────────────────────┴───────────┐
                                                                     ▼                                         ▼
                                                              Reporting (2 charts)                     Export .xlsx (API route)
                                                                     │                                         │
                                                                     └───────────────┬─────────────────────────┘
                                                                                     ▼
                                                                    Isolation verification + polish ──► Deploy (Plesk)
```

## Task List
Detailed tasks live in `tasks/todo.md` (task list target = `tasks/todo.md`).

### Phase 1: Foundation
- [x] Task 1: Repo layout, frontend scaffold, migrations dir
- [x] Task 2: DB schema foundation (users / roles / customers / sessions)
- [x] Task 3: Backend API skeleton + auth (sessions)

### Checkpoint: Foundation
- [x] App builds; API runs; a user can register/sign in; schema applies cleanly

### Phase 2: Core data
- [x] Task 4a: Customers & campaigns — schema + API
- [x] Task 4c: Platform super-admin (create customers + their admins)
- [x] Task 4b: Customers & campaigns — UI (verified in a browser)
- [x] Task 5: Campaign-list upload — parse + column mapping confirm (UI)
- [x] Task 6: Persist packages (schema 004 + API)

### Checkpoint: Core data
- [x] A real campaign list uploads and every row is stored with original columns unchanged

### Phase 3: Returns & resends
- [x] Task 7: Return capture (schema 005 + API + UI)
- [x] Task 8: Resend linking (schema 006 + API + UI)

### Checkpoint: Returns & resends
- [x] A return records end-to-end; a resend links original ↔ new sender ID

### Phase 4: Outputs
- [x] Task 9: Reporting (returned packages by category + resend volume)
- [x] Task 10: Export .xlsx (API route)

### Checkpoint: Outputs
- [x] The category bar chart renders per campaign; the .xlsx exports with returned rows flagged

### Phase 5: Harden & Deploy
- [x] Task 11: Isolation verification + polish
- [ ] Task 12: Deploy to Plesk (static SPA + Node API + MySQL) — **one-command script ready;
  awaiting server access**

### Checkpoint: Complete
- [ ] All success criteria in `SPECIFICATION.md` met; app live on Plesk; ready for review

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| No DB-level isolation (MySQL has no RLS) | High | Enforce `customer_id` scoping in every query; dedicated isolation test suite (Task 11) |
| Customer Excel column names vary | High | Auto-detect + confirm the sender-ID column; store all other columns verbatim |
| Running Node on Plesk (vs PHP) | Med | Confirm Plesk's Node.js support and Node version early (Task 12) |
| Session/auth security | Med | Hashed passwords; hashed session tokens; httpOnly + Secure cookies; expiry |
| Large exports time out | Med | Generate server-side and stream; test with a realistic file |
| Non-ASCII / accents in Excel | Low | utf8mb4 everywhere; test with real Spanish sample |

## Parallelization Opportunities
- **Safe to parallelize:** Task 9 (Reporting) and Task 10 (Export) — both depend on Tasks 7–8.
- **Must be sequential:** Tasks 1 → 2 → 3 → 4 → 6 → 7 → 8 (migration + API chain).
- **Needs coordination:** Reporting + Export share the return/resend data model — freeze it (Tasks 6–8) first.

## Open Questions
- **Backend language:** **decided — Node.js + Express (TypeScript)** (Plesk Node 24.21.0 / 26.11.0).
- **Migration runner:** resolved — `server/src/migrate.ts` (`npm run db:migrate`) applies
  `db/migrations/*.sql` in order and records them in `schema_migrations`; it also seeds/prunes the
  translation catalog.
- **MySQL vs Postgres:** resolved — MySQL / MariaDB (already on Plesk).
- Anything else from `SPECIFICATION.md` §11 (currently none open).

---

# Feature Plan: User profile — customer → campaign → returns

Spec: `docs/specs/user-profile-drilldown.md` (approved 2026-10-15). Detailed tasks: `tasks/todo.md`,
*Feature tasks* (Task 13 onward). The app-level plan above is untouched.

## Overview
Replace the operator's returns screen — a single page with the customer list in a left rail — with the
drill-down the owner asked for: a `user` lands on **Customers**, campaigns expand under a row, and
clicking one opens that campaign's **own** returns screen, carrying that campaign's counters. The full
reports become super-admin only. One returns screen serves both roles.

## Architecture decisions

- **The screen moves, the work does not.** The lookup, the match with its chain, the reasons and the
  resend form are already right; what changes is where they live — `/campaigns/:id/returns`, with the
  campaign named by the route instead of chosen in a picker. The rail, both pickers, "All campaigns"
  and their state are deleted rather than hidden.
- **One endpoint for the screen's head.** `GET /returns/campaigns/:id` returns the campaign's identity
  *and* its counters in one call. It lives on the returns router, not the campaigns router, because the
  counters are a returns concern and the router already carries the per-request customer model.
- **The boundary does not move again.** Every query stays scoped to the one customer the request names
  (`SECURITY.md` finding 21). Gating four endpoints to `requireSuperAdmin` narrows what a `user` may
  *read*, which is the point of this change, and touches nothing about how a request is scoped.
- **One customers page, two roles.** `/customers` renders the same list for everyone; the admin
  controls (*New customer* and the accounts inside a customer's row) and the export controls render only
  for a super-admin. `/superadmin/customers` redirects, so old links keep working. *(The separate
  *Users* panel this bullet first described was folded into the row on 2026-10-16 — see the plan below.)*

## Dependency graph
```
Task 13  GET /returns/campaigns/:id  +  return_count  +  the four report gates
   │
   └── Task 14  /campaigns/:id/returns  (header + counters + lookup/record/resend)
           │
           └── Task 15  /customers for both roles  +  nav  +  redirects
```

## Task List

- [x] Task 13: The campaign's own read, and the reports behind a super-admin
- [x] Task 14: The campaign's returns screen at `/campaigns/:id/returns`
- [x] Task 15: Customers is the way in — role-aware page, nav, redirects

### Checkpoint: After Task 13
- [x] `npm test` (six new API tests), `npm run typecheck:api` and `npm run build` clean

### Checkpoint: Feature complete
- [x] All eight success criteria in the spec hold
- [x] Browser walkthrough as `user@acme.test` and `owner@mycompany.test`
- [x] `SPECIFICATION.md`, `SECURITY.md` and `README.md` match the shipped behaviour
- [ ] Review with the human before the change log is closed

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| A super-admin who went straight to `/returns` loses their way | Med | `/returns` redirects to `/customers`, and Customers → campaign is the same number of clicks as the old rail |
| Sharing one customers page hides a control a super-admin needs | Med | Walk both roles in the browser at the checkpoint, not just the `user` |
| Gating four endpoints breaks a screen that quietly called one | Med | The reports page is their only caller and is itself super-admin only; the API tests assert both roles |
| Role-dependent routes in `App.tsx` get confusing | Low | Keep every redirect explicit and listed in the spec's route table; check each URL by hand |
| Removing `Packages returns` from the menu annoys the owner | Low | Agreed in the spec (§12, decision 1); recorded rather than quietly done |

## Parallelisation
Task 13 → 14 → 15 is sequential: each screen consumes what the previous one added. No safe parallel
split, and the whole feature is roughly one session.

## Open Questions
None. All three questions left open in the spec draft were decided by the owner on 2026-10-15.

---

# Feature Plan: Landing on Customers, one accordion per customer, and a campaign that names its company

*Requested by the owner on 2026-10-16, straight after the drill-down shipped. Four items, each answered
with a question first. They change where the app opens and how a customer's parts are arranged, not who
may see what.*

## Overview
The app opened on **Campaigns** for a super-admin, the *Users* button opened a panel *below* the whole
customers table, a new customer had to be given a campaign by hand afterwards, and the *New campaign*
form silently used the caller's own company. These four items fix exactly that.

## Architecture decisions

- **One way in.** `/` redirects to `/customers` for every role. *Campaigns* keeps its own URL
  (`/campaigns`), because it used to *be* `/` and the menu link would otherwise dead-end on the list.
- **The customer row is the accordion.** The row is the header; opening it shows its **campaigns** and —
  for a super-admin — its **accounts**, reusing the existing `details.section` disclosures. The
  `[Users]` and `[Campaigns]` buttons and the bottom accounts panel are deleted, not hidden: one
  pattern instead of three.
- **A customer arrives ready to work.** `POST /admin/customers` creates the customer *and* its first
  campaign in one transaction. The name is the caller's (defaulting to the customer's); the dates
  default to a one-day window on today, so the campaign is valid immediately and can be re-dated later.
- **The company is named, never inferred, at the platform level.** `POST /campaigns` takes an optional
  `customerId`. Only an account with **no company of its own** may set it; anyone else is fixed to the
  company they belong to, and naming another is a `403`. `GET /admin/campaigns` supplies the platform
  list the selector needs — the tenant `GET /campaigns` is untouched and still scoped, so a platform
  super-admin still reads `[]` there.

## Task List

- [x] `/` lands on Customers; Campaigns moves to `/campaigns`
- [x] The customer row is the accordion: campaigns + accounts, no buttons
- [x] A new customer comes with its first campaign
- [x] New campaign names its company; the platform gets its own campaign list

### Checkpoint: Feature complete
- [x] `npm test`, `npm run typecheck:api`, `npx tsc --noEmit` and `npm run build` clean
- [x] Browser walkthrough: a platform super-admin and a company super-admin
- [ ] Review with the human before the change log is closed

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Moving *Campaigns* off `/` breaks a bookmark | Low | `/` still works — it redirects; only the menu link points at `/campaigns` |
| An auto-created campaign is unwanted bulk | Low | Its name is the caller's to set, its dates are defaulted rather than invented, and it is editable afterwards |
| A company super-admin plants a campaign in another company | **High** | `POST /campaigns` ignores any choice that is not the caller's own (`403`), proved by a test |
| The platform campaign list leaks one tenant's data to a `user` | **High** | All of `/admin` is `requireSuperAdmin`, and both new routes are in the anonymous-401 table |

## Parallelisation
One session, four small and sequential edits to the same two screens. No useful split.

## Open Questions
None — all four items were decided by the owner before any code was written.

---

# Feature Plan: Spanish UI + editable translations

*Requested by the owner on 2026-10-19.*

## Overview
Display the app in **Spanish** while keeping the original **English** available for easy updating. Add an
editable translation table for administrators, and a small **ES / EN** switch in the header. Server API
error messages are explicitly out of scope for this pass.

## Architecture decisions

- **One catalog, one table.** `shared/translations.ts` holds every static text (key, screen, role,
  context, English, Spanish). Migration `013_translations.sql` creates the `translations` table; the
  catalog seeds it and is the client fallback. Existing edits are preserved; new keys are inserted and
  dead keys are pruned by `npm run db:migrate`.
- **Spanish is the default.** Language lives in `localStorage` (`pkgreturns.language`), not on the
  account. The switch is in the header and on the auth screens; it is a view choice, not a permission.
- **The editor is an administrator screen.** `/translations` is behind `isAdmin` (so the operator door
  hides it) and `requireSuperAdmin` on the API. Operators get `403` from the admin endpoints.
- **Both columns are editable.** English is the original; Spanish is what the app shows. Saving
  refreshes the live dictionary immediately. A missing Spanish falls back to English.
- **Public read, private write.** `GET /api/translations` is public because the login screen needs it
  before a session; `GET/PUT /api/admin/translations` require a super-admin. The table is platform-wide
  UI copy, not tenant data.
- **No view changes.** Existing layouts, permissions and flows are untouched; only the copy moves
  through `t()`.

## Task List

- [x] Add the catalog and `translations` table (migration 013 + seed/prune)
- [x] Add the public read and administrator list/update API
- [x] Convert every page/component to translation keys
- [x] Add `I18nProvider`, `useI18n`, and the ES/EN switch
- [x] Add the administrator **Traducciones** screen (grouped by screen/role, search, bulk save)
- [x] Add API/permission tests and a catalog/source-key test
- [x] Verify Spanish and English in the browser; save a live edit and restore it
- [x] Add a one-command Plesk deploy script

### Checkpoint: Feature complete
- [x] `npm test` — **272 tests**
- [x] `npx tsc --noEmit`, `npm run typecheck:api`, `npm run build`
- [x] Browser: Spanish default, ES/EN switch, operator 403/redirect, live translation edit
- [ ] Plesk deployment itself — the script is ready, but the server target is still needed

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A translation key is missing and the raw key appears | Med | `tests/translationsCatalog.test.ts` scans every `t()`/`translate()` call against the catalog |
| A catalog change overwrites a hand-edited translation | High | The seed uses `INSERT IGNORE`; existing rows are never overwritten |
| The operator can reach the editor | High | `/translations` is `SuperAdminOnly`; `GET/PUT /api/admin/translations` are `requireSuperAdmin`; tests cover 401/403 |
| A translation string is injected as HTML | High | React renders it as text; no `dangerouslySetInnerHTML`/`innerHTML` exists |
| Server errors remain English | Low | Explicit scope decision; client-side fallbacks and notices are translated |

## Files

`shared/translations.ts`, `db/migrations/013_translations.sql`, `server/src/{translations,translationsRoutes}.ts`,
`server/src/migrations.ts`, `src/i18n/{runtime.ts,I18nContext.tsx}`, `src/components/LanguageSwitch.tsx`,
`src/pages/TranslationsPage.tsx`, every `src/pages/*` and shared component, `src/styles.css`,
`tests/api/translations.test.ts`, `tests/translationsCatalog.test.ts`, `scripts/deploy-plesk.sh`.
