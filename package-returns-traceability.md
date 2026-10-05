# Statement of Intent — Package Returns & Store Traceability App

**Status:** IN PROGRESS — interview ongoing, not yet confirmed.
**Date started:** 2026-10-04
**Purpose:** A real operational tool to improve business performance (NOT a hackathon demo; nothing to present).

**One-liner:** Track physical packages sent to retail stores (via Correos España), classify returned packages by reason, and produce a clearly-flagged export so that closed/returning stores are not sent to again — plus reporting on return rates.

_Each step shows what happens and the decisions made, followed by the points that are still open. Open points are marked with a red question mark. Items marked "Zed proposal" are my suggestions awaiting your confirmation._

**Terminology:** Sender unique code = Sender ID = sending ID = package ID = ID = id. The sender ID equals the Rasca y Gana code. (That association is handled by another app.)

---

## Step 0 — The source list is created (outside the app)

There is **one master database per customer**. Each campaign is a **sub-list created from the master database** (the "campaign list"), and that list is used to print the labels. The list is uploaded to the app as an **Excel file**, and the app must **read the column names and never change them**.

**Open / to confirm:**
- ? Do column names stay fixed, or must the app map varying names? (Your notes say both "column names will not change" and "app maps varying column names" — which is it?)
- ? Is each campaign list stored separately per campaign (one master DB, many campaign lists)?

## Step 1 — A user uploads the send file

A permitted user uploads the campaign list. **A campaign can have multiple uploads**, and each upload is a **new list of packages to be sent**. Each upload must contain the package **sender ID** (column names are consistent). The **customer and campaign are chosen via form fields** (field names still to be defined). Per campaign a store appears **once**, and an **ID cannot appear twice**. The **Google Sheets / Playwright** input path is deferred to **V2**.

**Open / to confirm:**
- ? How does the app find the sending ID — auto-read the header, the uploader names the column, or auto-read then confirm? **Zed proposal:** auto-detect the likely column and show a one-click confirm, remembered per customer.
- ? Form field names for Customer and Campaign still to be defined.
- ? Reconcile "fixed column names" vs "map varying column names" (same as Step 0).

## Step 2 — The app stores the rows

**One row = one store = one Sender ID = one package.** The **sender ID is unique only within a campaign**. The app stores every row with all of its columns.

**Open / to confirm:**
- ? Storage: **Supabase (Postgres)** vs **Google Sheets/Drive**? **Zed proposal:** use **Supabase as the system of record**, keep Excel/Sheets for import/export. Reasons: concurrent multi-user writes, roles/permissions, relational links (customer → campaign → package → resend), uniqueness guarantees, report queries, and scale (thousands of rows × many campaigns). Sheets struggle with concurrent writes, permissions, and relational integrity. You already have Supabase connected.

## Step 3 — Labels are printed and packages ship (outside the app)

Labels are printed from the campaign list, and the packages are sent via Correos España. **Each package label contains the package ID.** The **ship date is a form field, not mandatory**.

**No open points at this stage.**

## Step 4 — Package returns (capture and categorise)

Each returned package carries the **original sender ID**. The user records that value together with the **return reason**, chosen from a dropdown of five: **tienda cerrada, ausente, dirección incorrecta, estacionada, otro**.

On **campaign setup**, a form field defines the **Name_Code** for each sender ID; the OCR uses that to read the photos. Return packages are **photographed**, and the OCR reads the **Name_Code and the Sender ID**. The Sender ID is **auto-read into the database and validated**, and the app then **asks for the return reason** (dropdown). Photos must use **minimal disk space**, and at the end of each campaign the files can be deleted. **Campaign form fields: start date, stop date.**

Using a phone camera + OCR is **optional** — it is a trade-off of time and disk space versus doing it manually.

**Open / to confirm:**
- ? Roles allowed to process returns: you said "Users" — does that mean **any** user (while only uploads are restricted), or a specific role?
- ? Which OCR engine? **Zed proposal (3 choices):** (1) **Google ML Kit Text Recognition** — on-device, free, best for a mobile app; (2) **Apple Vision** (`VNRecognizeTextRequest`) — on-device, free, if iOS/macOS; (3) **Tesseract / tesseract.js** — free, self-hosted/on-device, runs on a server or desktop. Cloud OCR (Google Vision, AWS Textract, Azure) is more accurate but costs per call. **Also consider:** if the sender ID could be printed as a **barcode or QR**, scanning would be far more reliable than OCR.
- ? Time estimate for the OCR flow: **Zed estimate:** ~10–20 s per package (photo 5–10 s + OCR 1–3 s + reason 5 s), versus ~30–60 s manual — worthwhile at volume.
- ? Bad/partial photo → **manual entry** (already decided).

## Step 5 — Resending of packages

Returned packages can be **resent to other retailers**. After the sender ID is known and registered, a **new label with a new sender ID** is applied. The app must **register the new sender ID and associate it with the return package's original ID** — this is why **multiple sender-ID files can be uploaded per campaign**. Match scope is **within the campaign**. If the ID is not found, the package **cannot be resent**. Duplicates do not exist: the original sender ID is marked as a return, the package is reused with a new label, and the key point is linking the **original sender ID** to the **new sender ID** so the **Rasca y Gana codes** can be tracked. A resend is initiated by **uploading a new Excel sheet into the campaign**.

**Open / to confirm:**
- ? How is the link shown, and does it chain across multiple resends? **Zed proposal:** keep one "lineage" ID per physical package; each resend adds a link (original sender ID → new sender ID, with date and reason). The app shows a **timeline chain**, and the export carries a `Resend Of` / lineage column. Example: A → returned (tienda cerrada) → resent as B → B returned → resent as C.

## Step 6 — Reporting

Reports on **return rates by category**, using graphs. This is secondary to the main output. The **return-rate denominator is per campaign**.

**Open / to confirm:**
- ? Which breakdowns/charts matter most? **Zed proposal:** (a) return rate by category (bar), per campaign; (b) return-rate trend over time (line), per campaign; (c) top returning stores (bar/table); (d) resend volume; (e) a per-customer overview for admins.
- ? Which roles can view reports? **Zed proposal:** admins see everything; customer-scoped users see only their customer's campaigns.

## Step 7 — Export the flagged list (main value)

The app produces an **Excel export containing all rows, with the returned packages clearly marked**, so those stores are not sent to again. **Scope: per campaign and per customer.**

**Open / to confirm:**
- ? Exact columns and marking convention. **Zed proposal:** keep all original columns **unchanged** and append new columns — `Return Status` (OK / RETURNED), `Return Reason`, `Resend Of` — **and** colour-fill the returned rows (light red) via conditional formatting, so it is both machine-readable and visually obvious.
- ? Format. **Zed proposal:** **.xlsx** — it supports cell colours and multiple sheets (one per campaign or customer as needed).

## Step 8 — The source database is pruned (outside the app)

The operator removes the closed stores from the source database, so the member count drops. The app is **read-only on the source** at this point; writing back is a possible **V2**.

**No open points at this stage** (V2 noted).

---

## Cross-cutting points (still open)

**Open / to confirm:**
- ? User roles/permissions model (uploader vs return-processor vs admin) — does Supabase Auth cover it?
- ? Binding constraint — data volume, OCR accuracy, device, or offline requirement?
- ? Multi-tenant isolation — how strictly are customers' data kept separate?
- ? Success metric — any sharper number than the qualitative outcomes below?
- ? Explicit out-of-scope items for v1.

## Business outcomes (why it matters)

1. Reduce/eliminate re-sending to stores that keep returning packages → less shipping cost and wasted stock.
2. See which categories cause the most returns (e.g. closed stores) → act on the biggest cause.
3. Keep the store database accurate by identifying closed stores so they are removed and the member count reflects reality.

## Data model

Customer (1 master DB each) → Campaigns (many per customer) → campaign lists (multiple uploads) → store rows / packages → returns (reason; "closed" scoped per campaign) → resends (linked sender IDs) → flagged export.

## Known tech context (from setup, not part of the intent)

- Env: macOS, Zed editor, Node at `~/.local/node/bin`.
- Connected MCP servers in Zed: Supabase (DB/migrations) and Playwright (browser, optional).
