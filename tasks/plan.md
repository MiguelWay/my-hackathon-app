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
- **Isolation:** every API query is scoped by the caller's `customer_id`. This is the single most
  important rule; it gets its own verification task.
- **Backend: Node.js + Express (TypeScript)** — auth, data and export. *(Language pending final
  confirmation; PHP is the alternative.)*
- **Auth:** our own. Email + password (hashed with bcrypt/argon2); server sessions stored in a
  `sessions` table, with the raw token only in an httpOnly cookie.
- **Roles:** `users.role ∈ {admin, user}`. Admin uploads; users process returns.
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
- [ ] Task 2: DB schema foundation (users / roles / customers / sessions)
- [ ] Task 3: Backend API skeleton + auth (sessions)

### Checkpoint: Foundation
- [ ] App builds; API runs; a user can register/sign in; schema applies cleanly

### Phase 2: Core data
- [ ] Task 4: Customers & campaigns (schema 002 + API + UI)
- [ ] Task 5: Campaign-list upload — parse + column mapping confirm (UI)
- [ ] Task 6: Persist packages (schema 003 + API)

### Checkpoint: Core data
- [ ] A real campaign list uploads and every row is stored with original columns unchanged

### Phase 3: Returns & resends
- [ ] Task 7: Return capture (schema 004 + API + UI)
- [ ] Task 8: Resend linking (schema 005 + API + UI)

### Checkpoint: Returns & resends
- [ ] A return records end-to-end; a resend links original ↔ new sender ID

### Phase 4: Outputs
- [ ] Task 9: Reporting (return rate by category + resend volume)
- [ ] Task 10: Export .xlsx (API route)

### Checkpoint: Outputs
- [ ] Both charts render; the .xlsx exports with returned rows flagged

### Phase 5: Harden & Deploy
- [ ] Task 11: Isolation verification + polish
- [ ] Task 12: Deploy to Plesk (static SPA + Node API + MySQL)

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
- **Backend language:** Node.js + Express (recommended) **or PHP**? *(Blocks Tasks 3, 12.)*
- **Migration runner:** how `db/migrations/*.sql` are applied (a small Node/PHP runner, or a library) — decide with the language.
- **MySQL vs Postgres:** resolved — MySQL / MariaDB (already on Plesk).
- Anything else from `SPECIFICATION.md` §11 (currently none open).
