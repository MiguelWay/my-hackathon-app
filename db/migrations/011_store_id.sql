-- 011_store_id.sql
-- A package now also carries the store it is addressed to. In the Correos lists this is the
-- "Ref. 2" column; it is the company's own unique store identifier, and it repeats across packages
-- (one store can receive many parcels), so there is deliberately no unique key on it.
--
-- A store ID is fixed for life: the upload sets it and no route ever updates it. (An optional
-- database trigger is available in db/optional/011_store_id_trigger.sql for a root install.) That
-- keeps a historical report from being rewritten by a later edit.
ALTER TABLE packages
  ADD COLUMN store_id VARCHAR(128) NULL AFTER sender_id,
  ADD KEY idx_packages_customer_store (customer_id, store_id);

-- Which uploaded column held the store ID, kept beside the original list of columns.
ALTER TABLE campaign_uploads
  ADD COLUMN store_column VARCHAR(255) NULL AFTER columns;

-- Backfill: every import already stored the store ID with the other columns, so nothing is lost.
-- Rows whose list had no "Ref. 2" stay NULL until the column is made NOT NULL below; this database
-- has none (350 of 350 packages carry a Ref. 2).
UPDATE packages
   SET store_id = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(extra_columns, '$."Ref. 2"'))), '');

UPDATE campaign_uploads
   SET store_column = 'Ref. 2'
 WHERE JSON_SEARCH(columns, 'one', 'Ref. 2') IS NOT NULL;

-- Required from now on: the upload refuses a row without a store ID.
ALTER TABLE packages
  MODIFY COLUMN store_id VARCHAR(128) NOT NULL;

-- Immutability is enforced by the application: packages are only ever inserted (the upload) or
-- updated for resend bookkeeping (chain_id, attempt_no, resent_at), and no route exposes a way to
-- change store_id. A BEFORE UPDATE trigger would make that a hard database guarantee, but creating
-- one needs the SUPER privilege while binary logging is on, which the app's database user does not
-- have. The optional trigger is kept in db/optional/011_store_id_trigger.sql for a root install.
