-- Rollback for 011_store_id.sql.
--
-- Run this BEFORE reverting the code, so the old code never sees a schema it does not expect:
--   mysql -u root --socket=/Users/Mike/.local/mysql/mysql.sock package_returns < db/rollbacks/011_store_id.sql
--
-- It removes the two columns, their index and the immutability trigger, and clears the migration row
-- so `npm run db:migrate` would apply 011 again. Everything the migration added is derivable from
-- `extra_columns`, so no uploaded data is lost.
DROP TRIGGER IF EXISTS trg_packages_store_id_immutable;

ALTER TABLE packages
  DROP INDEX idx_packages_customer_store,
  DROP COLUMN store_id;

ALTER TABLE campaign_uploads
  DROP COLUMN store_column;

DELETE FROM schema_migrations WHERE filename = '011_store_id.sql';
