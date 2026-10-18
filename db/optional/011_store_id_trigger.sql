-- Optional hard guarantee for 011_store_id.sql, for a root install.
--
-- Run it as a user with the SUPER privilege (or after setting
-- `log_bin_trust_function_creators = 1`):
--   mysql -u root --socket=/Users/Mike/.local/mysql/mysql.sock package_returns < db/optional/011_store_id_trigger.sql
--
-- The application already never updates `store_id`; this trigger makes that impossible at the
-- database level too. It is optional because the app's own database user lacks SUPER, and MySQL
-- requires SUPER to create a trigger while binary logging is enabled.
DROP TRIGGER IF EXISTS trg_packages_store_id_immutable;

CREATE TRIGGER trg_packages_store_id_immutable
BEFORE UPDATE ON packages
FOR EACH ROW
BEGIN
  IF NOT (NEW.store_id <=> OLD.store_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'a store ID cannot change once set';
  END IF;
END;
