# Statement of Intent — Package Returns & Store Traceability App

**Status:** IN PROGRESS — interview ongoing, **not yet confirmed**. Open questions at the bottom.
**Date started:** 2026-10-04
**Purpose:** A real operational tool to improve business performance (NOT a hackathon demo; nothing to present).

---

## One-liner

Track physical packages sent to retail stores (via **Correos España**), classify returned
packages by reason, and produce a clearly-flagged export so that closed/returning stores are
**not sent to again** — plus reporting on return rates.

## Confirmed so far

### Domain / context
- Packages are **physical**, sent to **retail stores** via **Correos España**.
- Each package carries a **label** with values such as **store name, address, and unique IDs**.
- Packages also contain **"rasca y gana" codes**, associated with each retail store.

### Input — sending lists
- The sending list is **extracted from another (source) database**, stored in an **Excel
  spreadsheet**, and used to **print the labels**.
- **One uploaded file contains thousands of retail stores** (rows), with all columns per store —
  including the **unique sender ID** and the store's **rasca y gana codes**.
- **Separate files are uploaded over time** (e.g. one per sending round).
- The app must **ingest and store these files with all their columns**.
- **Google Sheets** is an alternative source of send files; **Playwright can read them** — this is
  **optional**, and the **core app does not depend on Playwright**.

### Returns capture
- Returns are detected by **photographing the returned package's label** and **OCR-reading it in
  the app**.
- OCR yields the **unique ID**, which the app uses to **match the outbound row**.

### Return categorization
- After the OCR reads the ID, the app **presents a list of 3–5 return categories** and the person
  **picks one**.
- Categories identified so far (others still to be defined):
  - **tienda cerrada** (store closed)
  - **dirección desconocida o incorrecta** (unknown or incorrect address)
  - *…others TBD*
- The app then **updates the sending list** (marks the row returned).

### Resends / traceability
- A returned package can be **sent again**.
- The **original sending ID must be matched to the new sender ID** → gives **full sending
  traceability**.

### Outputs
- **Reporting on return rates by category** (reports use graphs). *Secondary.*
- **Main value / main output:** mark the original rows so stores are **not resent to in future** —
  the export is an **Excel file containing all rows, with returned packages clearly marked**.

### Closed-store pruning
- Returns effectively reveal **how many stores did not receive** packages → in real terms the store
  is **closed** → it leaves the "original database" → the **member count of that database drops**.
- The app **does NOT write back to the source database**; it only **produces the flagged list** for
  the operator to act on. Source is **read-only** to the app.
- A store flagged **closed is scoped to the campaign** (not global to the customer), because a
  customer runs **several campaigns from the same master database**.

### Users / tenancy
- **Multiple users.**
- **User/permission management** — only certain users may **upload files**.
- **Multiple people can manage the return process at the same time** (concurrent).
- The app must support **multiple customers**, and **multiple campaigns per customer**.
- **Data model:** **one master store database per customer**; **several campaigns** run against that
  database; **multiple customers** exist, each with exactly **one** master database.

## Business outcomes (why it matters)
1. Reduce/eliminate **re-sending to stores that keep returning** packages → less shipping cost and
   wasted stock.
2. See **which categories cause the most returns** (e.g. closed stores) → act on the biggest cause.
3. Keep the store database accurate by identifying **closed stores** so they're removed and the
   member count reflects reality.

## Open questions (to resolve before spec)
1. **Exact full set of return categories** (the 3–5).
2. ~~Hierarchy~~ **RESOLVED:** `Customer (1 master DB) → Campaign(s) → uploaded file → store rows →
   packages → returns (categorized) → flagged export`.
3. ~~Closed scope~~ **RESOLVED:** a closed flag is **per campaign**.
4. **Auth model:** what roles exist (e.g. uploader vs return-processor vs admin), and does Supabase
   Auth cover it?
5. **Constraints:** any binding limits (data volume, OCR accuracy expectations, offline use, device —
   phone camera vs desktop/scanner)?
6. **Explicit out-of-scope** items for v1.

## Known tech context (from setup, not part of the intent)
- Env: macOS, Zed editor, Node at `~/.local/node/bin`.
- Connected MCP servers in Zed: **Supabase** (DB/migrations) and **Playwright** (browser, optional).
