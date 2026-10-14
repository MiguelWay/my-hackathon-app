# Statement of Intent — Package Returns & Store Traceability App

**Status:** COMPLETE (v1) — for your review.
**Date started:** 2026-10-04
**Purpose:** A real operational tool to improve business performance (NOT a hackathon demo; nothing to present).

**One-liner:** Track physical packages sent to retail stores (via Correos España), classify returned packages by reason, and produce a clearly-flagged export so that closed/returning stores are not sent to again — plus reporting on return rates.

_This is the complete statement of intent. Where you asked me to decide, my choice is included — change anything you disagree with._

**Terminology:** Sender unique code = Sender ID = sending ID = package ID = ID = id. The sender ID equals the Rasca y Gana code. (That association is handled by another app.)

---

## Step 0 — The source list is created (outside the app)

There is **one master database per customer**. Each campaign is a **sub-list created from the master database** (the "campaign list"), and that list is used to print the labels. Lists are uploaded as **Excel**, and the app reads the column names and **never changes them**. **Column names will not change.** Many campaign lists are combined within the one master database.

## Step 1 — A user uploads the send file

An **admin** user uploads the campaign list. **A campaign can have multiple uploads**, and each upload is a **new list of packages to be sent**; each upload must contain the package **sender ID**. The **customer and campaign are chosen via form fields**. Per campaign a store appears **once**, and an **ID cannot appear twice**. The **Google Sheets / Playwright** input path is deferred to **V2**.

- **Form fields:** customer name, campaign name, start date, finish date.
- **Sending-ID mapping:** the app auto-detects the likely sending-ID column and shows a **one-click confirm**, remembered per customer.

## Step 2 — The app stores the rows

**One row = one store = one Sender ID = one package.** The **sender ID is unique only within a campaign**. The app stores every row with all of its columns. **Storage: a MySQL/MariaDB database (on Plesk)** is the system of record; Excel/Sheets are used for import/export only.

## Step 3 — Labels are printed and packages ship (outside the app)

Labels are printed from the campaign list, and packages are sent via Correos España. **Each label contains the package ID.** The **ship date is a form field, not mandatory**.

## Step 4 — Package returns (capture and categorise)

Each returned package carries the **original sender ID**. The user **manually types the sender ID** (no OCR, no photos), the app **validates it against the campaign**, and then **asks for the return reason**, from a dropdown of five: **tienda cerrada, ausente, dirección incorrecta, estacionada, otro**. **Campaign form fields: start date, stop date.**

- **Roles:** one **admin** role uploads files; returns are handled by a normal **user** role; **more than one** user is allowed.
- **OCR:** removed from v1 (manual entry). Optional OCR / barcode scanning is deferred to v2.

## Step 5 — Resending of packages

Returned packages can be **resent to other retailers**. After the sender ID is known and registered, a **new label with a new sender ID** is applied. The app must **register the new sender ID and associate it with the return package's original ID** — this is why **multiple sender-ID files can be uploaded per campaign**. Match scope is **within the campaign**. If the ID is not found, the package **cannot be resent**. Duplicates do not exist: the original sender ID is marked as a return, the package is reused with a new label, and the key point is linking the **original sender ID** to the **new sender ID** so the **Rasca y Gana codes** can be tracked. A resend is initiated by **uploading a new Excel sheet into the campaign**.

- **Resend link:** every physical package gets **one permanent "Package Chain ID"**. Each time it is sent it takes a new sender ID, so the chain is simply the list of sender IDs for that one physical package, in order. Example: Chain `PKG-001` = sender ID **A** (returned: tienda cerrada) → sender ID **B** (returned: ausente) → sender ID **C** (delivered). In the app you can search any of A, B or C and see the whole chain; in the export each row shows `Package Chain ID` and `Resend Of` (the previous sender ID).

## Step 6 — Reporting

Reports on **return rates by category**, using graphs. Secondary to the main output. **Denominator: per campaign.**

- **Charts:** (a) return rate by category (bar), per campaign; (b) resend volume.
- **Who can view:** admins see everything; customer users see only their customer's campaigns.

## Step 7 — Export the flagged list (main value)

The app produces an **Excel export of all rows, with returned packages clearly marked**, so those stores are not sent to again.

- **Columns & marking:** keep all original columns unchanged; **append** `Return Status` (OK / RETURNED), `Return Reason`, `Resend Of`; **colour-fill returned rows light red**.
- **Scope:** per campaign and per customer.
- **Format:** **.xlsx**.

## Step 8 — The source database is pruned (outside the app)

The operator removes closed stores from the source database, so the member count drops. The app is **read-only on the source**; writing back is a possible **V2**.

---

## Cross-cutting

- **Roles & auth:** our own email/password auth with two roles — **Admin** (can upload) and **User** (can process returns). Per-customer isolation is enforced in the **API** (every query scoped by `customer_id`); the database itself has no row-level security.
- **Constraints:** none binding.
- **Success metric:** not important.
- **Out of scope for v1:** (1) writing back to the source database (V2); (2) Google Sheets / Playwright input (V2); (3) barcode/QR scanning; (4) reporting beyond return-rate-by-category and resend volume; (5) a native mobile app (v1 is the web app, mobile-friendly for the camera); (6) a customer self-service login portal.

## Business outcomes (why it matters)

1. Reduce/eliminate re-sending to stores that keep returning packages → less shipping cost and wasted stock.
2. See which categories cause the most returns (e.g. closed stores) → act on the biggest cause.
3. Keep the store database accurate by identifying closed stores so they are removed and the member count reflects reality.

## Data model

Customer (1 master DB each) → Campaigns (many per customer) → campaign lists (multiple uploads) → store rows / packages → returns (reason; "closed" scoped per campaign) → resends (linked sender IDs, one Package Chain ID) → flagged export.

## Known tech context (from setup, not part of the intent)

- Env: macOS, Zed editor, Node at `~/.local/node/bin`.
- Stack: React + Vite web app, Node/Express API, MySQL/MariaDB on Plesk (no Supabase).
