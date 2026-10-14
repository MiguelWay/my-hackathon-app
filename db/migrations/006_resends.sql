-- 006_resends.sql
-- Task 8 — link a resend's new sender ID to the original under one chain.
-- `chain_id` points at the FIRST package of the chain, so NULL means "this package starts a chain".
-- A resend is typed in by hand (it is not part of an uploaded file), so upload_id/source_row
-- become optional.

ALTER TABLE packages
  MODIFY upload_id  BIGINT UNSIGNED NULL,
  MODIFY source_row INT UNSIGNED    NULL,
  ADD COLUMN chain_id    BIGINT UNSIGNED NULL AFTER sender_id,
  ADD COLUMN created_via ENUM('upload','resend') NOT NULL DEFAULT 'upload' AFTER chain_id,
  ADD KEY idx_packages_chain (chain_id),
  ADD CONSTRAINT fk_packages_chain FOREIGN KEY (chain_id) REFERENCES packages (id) ON DELETE SET NULL;
