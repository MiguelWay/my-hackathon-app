# Statement of Intent — Package Returns & Store Traceability App

**Status:** IN PROGRESS — interview ongoing, not yet confirmed.
**Date started:** 2026-10-04
**Purpose:** A real operational tool to improve business performance (NOT a hackathon demo; nothing to present).

**One-liner:** Track physical packages sent to retail stores (via Correos España), classify returned packages by reason, and produce a clearly-flagged export so that closed/returning stores are not sent to again — plus reporting on return rates.

_Each step below shows what happens, followed by the points that are still open or unconfirmed for that step._

---

## Step 0 — The source list is created (outside the app)

The sending list lives in another database, is exported to an Excel file, and that file is used to print the labels.

**Open / to confirm:**
- Is the Excel produced per customer, per campaign, or both?
- Is the Excel exactly what gets uploaded, or does it need cleanup first?

## Step 1 — A user uploads the send file

A permitted user uploads the file into the app. One file contains **thousands of retail-store rows**, with all columns per store, **including the unique sender ID**. The **rasca y gana codes are associated with each store's sending ID**, but the app **does not track the individual rasca y gana codes**. Separate files are uploaded over time (one per sending round). Only certain users are allowed to upload.

**Open / to confirm:**
- Is one campaign = one file? (Can a campaign span multiple uploads?)
- How is the customer + campaign identified on upload — chosen in-app, or inferred from the file?
- Are columns always the same across customers/files, or must the app map varying column names?
- How does the app find the sending ID — auto-read the column header, or does the uploader specify the column name? (raised by user)
- Can the same store appear in several campaigns (or the same ID twice)?
- Is the Google Sheets / Playwright input path still wanted for v1?

## Step 2 — The app parses and stores the rows

The uploaded file is ingested into Supabase, storing every row with all of its columns.

**Open / to confirm:**
- Is one row = one store, or one row = one package?
- Is the unique sender ID unique across campaigns, or only within a campaign?

## Step 3 — Labels are printed and packages ship (outside the app)

Labels are printed from the list, and the physical packages are sent to the retail stores via Correos España.

**Open / to confirm:**
- Does the app need to know the ship date, or is the upload enough?

## Step 4 — A returned package is photographed

When a package comes back, someone **photographs its label**. Multiple people can do this at the same time (concurrent).

**Open / to confirm:**
- Device: phone camera in the app, a scanner, or a photo uploaded from a computer?
- Which role(s) are allowed to process returns?
- How is a bad/partial photo handled — retake prompt, or manual entry fallback?

## Step 5 — OCR reads the unique ID

The app reads the label photo and extracts the **unique ID** from it.

**Open / to confirm:**
- Read only the ID, or also the store name/address as a sanity check?
- OCR accuracy expectation — and is a manual ID-entry fallback required?
- Any constraint on which OCR engine/library must be used?

## Step 6 — The return is matched to the outbound row

The extracted ID is matched against the stored sending list to find that package's original row.

**Open / to confirm:**
- Match scope: within the campaign, the customer, or the whole system?
- What happens if the ID isn't found (misread, or not yet uploaded)?
- How is the same package scanned twice handled (duplicate return)?

## Step 7 — A return category is chosen

After the OCR reads the ID, the app **presents a list of 3–5 return categories** and the person **picks one**. The row is then marked as returned. Categories identified so far: **tienda cerrada** (store closed) and **dirección desconocida o incorrecta** (unknown or incorrect address). A store flagged **closed is scoped to the campaign** (not global to the customer).

**Open / to confirm:**
- The exact full set of categories (the list is 3–5; only 2 are named so far). ← biggest open item
- Can a category be corrected/edited later, and by whom?

## Step 8 — Resend (optional second action)

A returned package can be **sent again**. The **original sending ID must be matched to the new sender ID**, which gives full sending traceability.

**Open / to confirm:**
- How is a resend initiated — a new uploaded file, or an in-app action?
- Does the new sender ID come from a new send file, or is it generated in-app?
- How is the link shown, and does it chain across multiple resends?

## Step 9 — Reporting

Reports on **return rates by category**, using graphs. This is secondary to the main output.

**Open / to confirm:**
- Metric definition — what is the return-rate denominator: per campaign, per store, or over time?
- Which breakdowns/charts matter most?
- Which roles can view reports?

## Step 10 — Export the flagged list (main value)

The app produces an **Excel export containing all rows, with the returned packages clearly marked**, so those stores are not sent to again in future.

**Open / to confirm:**
- Exact columns, and the marking convention (a column, a colour, or a status word?).
- Scope of the export: per campaign, per customer, or everything?
- Format: .xlsx only?

## Step 11 — The source database is pruned (outside the app)

The operator removes the closed stores from the source database, so the member count drops and dead stores are gone. The app is **read-only on the source** — it only produces the flagged list.

**Open / to confirm:**
- Confirm this step is entirely manual (the app never writes back to the source).

---

## Cross-cutting points (not tied to a single step)

**Open / to confirm:**
- User roles/permissions model (uploader vs return-processor vs admin) — does Supabase Auth cover it?
- Binding constraint — data volume, OCR accuracy, device, or offline requirement?
- Multi-tenant isolation — how strictly are customers' data kept separate?
- Success metric — any sharper number than the qualitative outcomes below?
- Explicit out-of-scope items for v1.

---

## Business outcomes (why it matters)

1. Reduce/eliminate re-sending to stores that keep returning packages → less shipping cost and wasted stock.
2. See which categories cause the most returns (e.g. closed stores) → act on the biggest cause.
3. Keep the store database accurate by identifying closed stores so they're removed and the member count reflects reality.

## Data model

Customer (1 master store DB each) → Campaigns (many per customer) → uploaded file (thousands of store rows) → packages → returns (categorized; "closed" scoped per campaign) → flagged export.

## Known tech context (from setup, not part of the intent)

- Env: macOS, Zed editor, Node at `~/.local/node/bin`.
- Connected MCP servers in Zed: Supabase (DB/migrations) and Playwright (browser, optional).
