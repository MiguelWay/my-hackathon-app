-- 009_resend_attempts.sql
-- A resend now reuses a package that already exists in the campaign — its own ID and its own label
-- (address) are the ones the parcel goes out under next. That means the resend target can have a
-- LOWER id than the package it replaces, so insertion order can no longer say which attempt came
-- first. `attempt_no` does: 1 for a package as uploaded, 2 for the package used as its resend, and
-- so on down the chain. `resent_at` is when the package was marked as someone's resend, which is
-- what the report colours green.
ALTER TABLE packages
  ADD COLUMN attempt_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER chain_id,
  ADD COLUMN resent_at  TIMESTAMP    NULL              AFTER attempt_no,
  ADD KEY idx_packages_chain_attempt (chain_id, attempt_no);

-- Rows created by the old resend flow (a fresh package inserted with created_via='resend') are
-- attempt 2 of the chain their chain_id points at.
UPDATE packages
   SET attempt_no = 2,
       resent_at  = created_at
 WHERE created_via = 'resend' AND chain_id IS NOT NULL;
