# Spec: User profile — customer → campaign → returns

**Status:** implemented (Tasks 13–15; see `tasks/todo.md`)
**Owner:** Miguel
**Date:** 2026-10-15
**Builds on:** `SPECIFICATION.md` (app-level PRD), `SECURITY.md`, `tasks/plan.md`

The operator's flow was agreed with the owner in an interview on 2026-10-15. This spec turns that
agreed intent into something buildable. It does not design the reports, the chains or the exports
beyond taking them away from a `user`.

---

## 1. Objective

**Who:** the operator — the `user` role. One team processes returns for every client company.

**Problem today:** the returns screen is a single page with the customer list in a left rail, which
puts the customer choice *inside* the work instead of before it, and gives the operator no numbers at
all — while the reports page they cannot usefully act on stays in their menu.

**Outcome:** the operator signs in, lands on **Customers**, clicks a customer, sees its campaigns,
clicks a campaign, and is immediately typing a returned package ID with that campaign's own totals in
view. Nothing in their way belongs to someone else's job.

**Success looks like:** a parcel in hand, a package ID typed, a reason picked, and the resend linked —
in one screen, with the campaign's count ticking up.

---

## 2. Scope

**In**

- A role-aware **Customers** page, and it becomes a `user`'s home.
- Campaigns listed **inline under a customer row** (the same logic as the admin `Campaigns` button).
- A **per-campaign returns screen** — its own route — holding that campaign's work.
- **Campaign-scoped counters** on that screen.
- Route and nav changes, and hiding the reports from a `user`.

**Out (explicitly, for now)**

- The campaign's **returns list** on that screen, and richer metrics — agreed as "B", to add later
  only if the counters prove insufficient.
- Return-rate charts, per-reason breakdowns.
- Changing anything a super-admin can do, beyond sharing the one returns screen.
- The meaning of `users.customer_id` — it keeps its value and stops deciding what an operator sees.

---

## 3. Screens and routes

| Route | Who | What |
|---|---|---|
| `/customers` | both | The customer list. Admin controls render for a super-admin only. |
| `/customers?customer=<id>` | both | Opens on that customer, campaigns expanded. |
| `/campaigns/:id/returns` | both | That campaign's returns screen (section 4). |
| `/superadmin/customers` | any | Redirects to `/customers` (old links, the README, bookmarks). |
| `/returns` | any | Redirects to `/customers`. The rail screen is gone. |
| `/returns?customer=<id>&campaign=<id>` | any | Redirects to `/campaigns/:id/returns`. |
| `/returns/recent` | super-admin | The reports page. A `user` is sent to `/customers`. |
| `/` | super-admin | The Campaigns screen, unchanged. |
| `/` | `user` | Redirects to `/customers`. |

**Nav.** A `user` sees exactly one item: **Customers**. A super-admin keeps `Customers · Campaigns ·
Returned Packages`.

**`Packages returns` comes off the menu for everyone** (decided). With the drill-down it has no campaign
behind it, and the way in is Customers → campaign. It was put back in the menu only because the
processing screen could not be found otherwise, and that reason is gone.

**A campaign row** — on the customers page, and for either role — shows its name, its
`start_date → finish_date`, and its counts: **`N packages · M returns`** (decided; see section 6 for the
field). The admin row additionally keeps `lines` and its export controls, which an operator does not
get.

**One screen for both roles.** The super-admin's campaign link opens `/campaigns/:id/returns` too —
one implementation, not two.

---

## 4. The campaign's returns screen

Holds just that campaign's work, and nothing else:

1. **A header** — the campaign's name, its `start_date → finish_date`, the customer it belongs to, and
   a way back to that customer's campaigns (`/customers?customer=<id>`).
2. **The counters** — see section 5.
3. **The input** — the package-ID box and *Find package*.
4. **The match** — exactly what the screen shows today: the sender ID, the campaign, a `closed store`
   chip, the chain as attempts, the uploaded columns, and either the recorded return or the reason
   buttons plus the optional note.
5. **The resend form** — for a returned package, under the match.

**No customer picker, no campaign picker, no rail, no "All campaigns".** In this flow a search always
has a campaign behind it. The state that goes with them (`customers`, `selectedCustomer`,
`selectedCampaign`, the left rail markup and its styles) is deleted, not hidden.

---

## 5. The counters

The campaign's own numbers, in the wording and shape the reports page already uses:

```
<N> packages sent · <M> returned packages (<P>% of sent) · <K> Resent (<Q>% of sent)
```

- Scoped to **this campaign**, not the customer.
- `sent` = packages in the campaign (resends included); `returns` = returns on its packages;
  `resends` = its packages with `created_via = 'resend'`.
- Re-fetched after every recorded return and every saved resend, so the number moves as the operator
  works.

---

## 6. API

**New**

| Endpoint | Returns |
|---|---|
| `GET /returns/campaigns/:id` | `{ id, name, start_date, finish_date, customer_id, customer_name, sent, returns, resends }` |

One call for the screen's header and its counters. The campaign names its own customer, so the request
needs nothing else, and it is open to any signed-in account — that is the model agreed in
`SECURITY.md` finding 21. A campaign that does not exist is a `404`.

**Changed**

| Endpoint | Change |
|---|---|
| `GET /returns/customers/:id/campaigns` | Also returns `return_count`, so a campaign row can show `N packages · M returns`. |

**Unchanged** — already scoped by the customer a request names:

- `GET /returns/customers`
- `GET /returns/reasons`
- `GET /returns/lookup?senderId=&customerId=[&campaignId=]`
- `POST /returns`, `POST /returns/resend`

**Now super-admin only** (`requireSuperAdmin`):

- `GET /returns` — the company-wide recent list, which only the reports page uses.
- `GET /returns/summary` — the company-wide counters; the campaign screen has its own now.
- `GET /returns/chains` and `GET /returns/chains/export`.

A `user` calling any of those gets `403 super-admin only`, the same shape as the campaign export.

---

## 7. Files

| File | Change |
|---|---|
| `src/pages/CustomersPage.tsx` | Role-aware: hide *New customer*, the *Users* panel, account management and the export controls from a `user`; campaign row shows name, dates and counts; campaign click links to `/campaigns/:id/returns` |
| `src/pages/ReturnsPage.tsx` | Becomes the campaign's screen: takes `:id` from the route, drops the rail, the pickers and their state, loads the header and counters, keeps the lookup/record/resend |
| `src/pages/RecentReturnsPage.tsx` | Unchanged (super-admin only) |
| `src/App.tsx` | Routes and redirects per section 3; role-aware `/` |
| `src/components/Layout.tsx` | Nav per role |
| `src/styles.css` | Remove `.workspace`, `.rail`, `ul.picker`, `button.picker-item` |
| `server/src/returns.ts` | Add `GET /returns/campaigns/:id`; gate the four report endpoints |
| page-local interfaces | The new response type |

---

## 8. Commands

```bash
npm run dev            # Vite dev server (SPA)
npm run api:dev        # API with watch
npm test               # vitest: unit + the API suite
npm run typecheck:api  # tsc -p server/tsconfig.json
npm run build          # tsc && vite build
```

---

## 9. Testing strategy

Following the existing split — pure helpers as unit tests, everything else through the API suite that
runs against a throwaway database, and a browser walkthrough by hand.

**New API tests** (`tests/api/isolation.test.ts`)

1. `GET /returns/campaigns/:id` returns the campaign's own name, dates, customer and numbers, from the
   same session, for a campaign of a customer the caller is **not** attached to.
2. Its numbers are the **campaign's**, not the customer's — a second campaign of the same customer does
   not leak into them.
3. An unknown campaign id is a `404`.
4. `GET /returns/customers/:id/campaigns` reports each campaign's own `package_count` and
   `return_count`, which is what a campaign row prints.
5. A `user` gets `403` from `GET /returns`, `/returns/summary`, `/returns/chains` and
   `/returns/chains/export`; a super-admin still gets `200` from each.
6. All five endpoints stay in the anonymous-`401` table.

**Not covered by tests, checked by hand in the browser:** the nav per role, the redirects, campaigns
expanding under a customer row, and the counters moving after a return and a resend.

---

## 10. Boundaries

- **Always:** scope every query to the one customer the request names; keep the per-request isolation
  suite passing; update `SPECIFICATION.md` / `SECURITY.md` if the role model moves again.
- **Ask first:** any schema change; gating anything else to super-admin; dropping a nav item beyond the
  ones listed in section 3.
- **Never:** let a query span two customers; leave a `user` with a route that only shows them their own
  company's data; delete the reports for a super-admin.

---

## 11. Success criteria

1. A `user` signing in lands on **Customers**; their nav shows only *Customers*, and *Packages returns*
   is gone from every nav.
2. Clicking a customer expands its campaigns inline, each row reading `name · dates · N packages ·
   M returns`; clicking a campaign opens `/campaigns/:id/returns`.
3. That screen shows the campaign name, dates, customer and the three counters, then the ID box, the
   match with its chain, the reasons and the resend form — and **no** pickers.
4. Recording a return and saving a resend both work from it, and the counters move afterwards.
5. A `user` is refused (`403`) by `/returns`, `/returns/summary`, `/returns/chains` and
   `/returns/chains/export`, and is redirected away from `/returns/recent`.
6. A `user` sees no *New customer*, no *Users* panel, no account management and no download control on
   the customers page.
7. A super-admin reaches the same returns screen through Customers → campaign, and keeps every report.
8. `npm test`, `npm run typecheck:api` and `npm run build` are clean.

---

## 12. Decisions

The three questions left open in the first draft, as decided by the owner:

1. **`Packages returns`** comes off the top menu for everyone; Customers → campaign is the way in.
2. **No campaign download controls** on the operator's customers page — the `.xlsx` stays with a
   super-admin, as agreed in `SECURITY.md` finding 21's era.
3. **Campaign rows carry counts**, not just the name: `N packages · M returns` alongside the dates.

No open questions remain. Once this spec is approved, the plan and task list come next; no code is
written before that.
