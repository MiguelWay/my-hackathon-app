why i# Statement of Intent — Package Returns & Store Traceability App

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
  including the **unique sender ID**.
- The **rasca y gana codes are associated with each store's sending ID**, but the app **does NOT
  track the individual rasca y gana codes**.
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

## End-to-end process (step by step, with open points)

_Legend: ✅ decided · ❓ open_

**Step 0 — Source list exists (outside the app).** The sending list lives in another database,
exported to Excel, and used to print labels.
- ❓ Is the Excel produced per customer, per campaign, or both?
- ❓ Is the Excel exactly what gets uploaded, or does it need cleanup first?

**Step 1 — Upload the send file.** A permitted user uploads the file; it contains thousands of store
rows with all columns.
- ✅ Only certain users may upload.
- ✅ One file = thousands of stores; separate files uploaded over time.
- ❓ Campaign = one file? (can a campaign span multiple uploads?)
- ❓ How is customer + campaign identified on upload — chosen in-app or inferred from the file?
- ❓ Are columns always the same across customers/files, or must the app map varying column names?
- ❓ **How does the app find the sending ID** — auto-read the column header, or does the uploader
  specify the column name? _(raised by user)_
- ❓ Same store in several campaigns (or same ID twice)?
- ❓ Is the Google Sheets / Playwright path still wanted for v1?

**Step 2 — Parse & store the rows.** App ingests the file into Supabase.
- ❓ Is one row = one store, or one row = one package?
- ✅ Rasca y gana codes are associated with each store's sending ID; the app does **not** track the
  individual codes.
- ❓ Is the unique sender ID unique across campaigns, or only within a campaign?

**Step 3 — Print labels & ship (physical, outside app).** Labels printed; packages sent via Correos
España.
- ❓ Does the app need to know the ship date, or is upload enough?

**Step 4 — Capture the return.** Someone photographs the returned label.
- ✅ Multiple people can do this concurrently.
- ❓ Device: phone camera in-app, a scanner, or photo upload from a computer?
- ❓ Which role(s) can process returns?
- ❓ Bad/partial photo handling — retake prompt / manual entry fallback?

**Step 5 — OCR reads the label.** App extracts the unique ID.
- ❓ Read only the ID, or also store name/address as a sanity check?
- ❓ OCR accuracy expectation; is a manual ID-entry fallback required?
- ❓ Any constraint on which OCR engine/library?

**Step 6 — Match to the outbound record.**
- ❓ Match scope: within the campaign / the customer / the whole system?
- ❓ What if the ID isn't found (misread / not yet uploaded)?
- ❓ How to handle the same package scanned twice (duplicate return)?

**Step 7 — Choose the return category.** App shows the list; person picks one; row marked returned.
- ✅ Prompt is a pre-shown list of 3–5 categories, after OCR.
- ✅ Known so far: tienda cerrada, dirección desconocida o incorrecta.
- ❓ The exact full set of categories ← the big one.
- ❓ Can a category be corrected/edited later, and by whom?
- ✅ "Closed" is per campaign (not global to the customer).

**Step 8 — Resend (optional second action).** Original ID ↔ new ID must be linked.
- ❓ How is a resend initiated — a new uploaded file, or an in-app action?
- ❓ Does the new sender ID come from a new send file, or is it generated in-app?
- ❓ How is the link shown; does it chain across multiple resends?

**Step 9 — Reporting.** Return-rate reports by category, with graphs.
- ❓ Metric definition — rate denominator: per campaign / per store / over time?
- ❓ Which breakdowns/charts matter most?
- ❓ Which roles can view reports?

**Step 10 — Export the flagged list (main value).** Excel with all rows, returned packages marked.
- ❓ Exact columns and marking convention (column / colour / status word?).
- ❓ Scope: per campaign / per customer / everything?
- ❓ Format: .xlsx only?

**Step 11 — Prune the source database (manual, outside app).** Closed stores drop out; member count
falls.
- ✅ App is read-only on the source; it only produces the flagged list.

**Cross-cutting (not tied to one step).**
- ❓ User roles/permissions model (uploader vs return-processor vs admin) — does Supabase Auth cover it?
- ❓ Binding constraint — data volume, OCR accuracy, device, offline requirement?
- ❓ Multi-tenant isolation — how strictly are customers' data kept separate?
- ❓ Success metric — any sharper number than the qualitative outcomes?
- ❓ Explicit out-of-scope for v1.

## Open questions (to resolve before spec)
1. **Exact full set of return categories** (the 3–5).
2. ~~Hierarchy~~ **RESOLVED:** `Customer (1 master DB) → Campaign(s) → uploaded file → store rows →
   packages → returns (categorized) → flagged export`.
3. ~~Closed scope~~ **RESOLVED:** a closed flag is **per campaign**.
4. **Auth model:** what roles exist (e.g. uploader vs return-processor vs admin), and does Supabase
   Auth cover it?
5. **Constraints:** any binding limits (data volume, OCR accuracy expectations, offline use, device —
   phone camera vs desktop/scanner)?
4. **Explicit out-of-scope** items for v1.
5. **Sending-ID column detection** — auto-read the header, or does the uploader name the column?

## Known tech context (from setup, not part of the intent)
- Env: macOS, Zed editor, Node at `~/.local/node/bin`.
- Connected MCP servers in Zed: **Supabase** (DB/migrations) and **Playwright** (browser, optional).
