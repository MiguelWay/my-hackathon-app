# Implementation Plan: Package Returns & Store Traceability App

## Overview
Build a **web app** (React + Vite + TypeScript) backed by **Supabase** that lets an admin upload
per-customer campaign lists (Excel), lets users record package returns via **manual sender-ID
entry** + a reason, links resends under one Package Chain ID, reports return rates by category, and
exports a flagged .xlsx. Every row is isolated per customer by Row Level Security.

Spec: `SPECIFICATION.md`. Intent: `docs/intent/package-returns-traceability.md`.

## Architecture Decisions
- **Supabase** (Postgres + Auth + RLS) is the system of record. One master store DB per customer;
  campaigns are sub-lists; a campaign can have multiple uploads.
- **Roles:** `profiles.role ∈ {admin, user}`. Admin uploads; users process returns. RLS scopes every
  row by `customer_id` (total separation between customers).
- **Excel ingestion** is client-side (SheetJS): preview → auto-detect the sender-ID column → one-click
  confirm. **Column names are never changed**; unknown columns are stored verbatim in an
  `extra_columns jsonb` field.
- **Uniqueness:** `sender_id` is unique **per campaign**; one row = one store = one package.
- **Resends:** `packages.chain_id` groups a physical package's successive sender IDs.
- **Manual return capture** — no OCR, no camera.
- **Export:** a Supabase **Edge Function** (Deno + SheetJS) generates the .xlsx with appended columns
  and light-red fills.
- **Charts:** Recharts; exactly two — return rate by category (bar, per campaign) and resend volume.

## Dependency Graph
```
Project setup + Supabase link
        │
        └── Auth + profiles/roles + RLS
                │
                └── Customers & campaigns
                        │
                        └── Upload + parse + column mapping ──► Persist packages
                                                                      │
                                                                      └── Return capture (manual)
                                                                              │
                                                                              └── Resend linking (chain)
                                                                                      │
                                                        ┌─────────────────────────────┴───────────┐
                                                        ▼                                         ▼
                                                 Reporting (2 charts)                     Export .xlsx (Edge Fn)
                                                        │                                         │
                                                        └───────────────┬─────────────────────────┘
                                                                        ▼
                                                       RLS / isolation verification + polish
```

## Task List
Detailed tasks live in `tasks/todo.md` (task list target = `tasks/todo.md`).

### Phase 1: Foundation
- [ ] Task 1: Project setup & Supabase link
- [ ] Task 2: Auth + profiles/roles + RLS foundation

### Checkpoint: Foundation
- [ ] `npm run build` clean, app runs, a user can sign in, RLS exists

### Phase 2: Core data
- [ ] Task 3: Customers & campaigns
- [ ] Task 4: Campaign-list upload — parse + column mapping confirm
- [ ] Task 5: Persist packages (uniqueness + verbatim columns)

### Checkpoint: Core data
- [ ] A real campaign list uploads and every row is stored with original columns unchanged

### Phase 3: Returns & resends
- [ ] Task 6: Return capture (manual sender-ID entry + reason)
- [ ] Task 7: Resend linking (Package Chain ID)

### Checkpoint: Returns & resends
- [ ] A return is recorded end-to-end; a resend links original ↔ new sender ID

### Phase 4: Outputs
- [ ] Task 8: Reporting (return rate by category + resend volume)
- [ ] Task 9: Export .xlsx (Edge Function)

### Checkpoint: Outputs
- [ ] Both charts render; the .xlsx exports with returned rows flagged

### Phase 5: Harden
- [ ] Task 10: RLS / data-isolation verification + polish

### Checkpoint: Complete
- [ ] All success criteria in `SPECIFICATION.md` met; ready for review

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Customer Excel column names vary | High | Auto-detect + confirm the sender-ID column; store all other columns verbatim in `extra_columns` |
| RLS mistakes leak one customer's data | High | Write isolation tests early (Task 2 + Task 10); policy-per-table review |
| Large exports (thousands of rows × campaigns) time out | Med | Generate server-side and stream; test with a realistic file |
| Non-ASCII / accents in Excel (Spanish text) | Low | Parse and round-trip with correct encoding; test with real sample |
| Concurrent return submissions | Low | Unique constraints + clear error on duplicates |

## Parallelization Opportunities
- **Safe to parallelize:** Task 8 (Reporting) and Task 9 (Export) — both depend only on Tasks 6–7.
- **Must be sequential:** Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7 (database/migration chain).
- **Needs coordination:** Reporting + Export share the return/resend data model — freeze that schema
  (Tasks 5–7) before starting them.

## Open Questions
- **Hosting** for the web app (Vercel / Netlify / Cloudflare Pages / other?).
- **Excel parsing location** — client-side (planned) vs an Edge Function; client is simpler, confirm OK.
- Anything else from `SPECIFICATION.md` §11 (currently none open).
