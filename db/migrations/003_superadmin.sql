-- 003_superadmin.sql
-- Task 4c — platform super-admin who manages customers (and their admins).
-- A super-admin is NOT tied to a customer, so customer_id becomes nullable.

ALTER TABLE users
  MODIFY COLUMN role ENUM('superadmin', 'admin', 'user') NOT NULL DEFAULT 'user';

ALTER TABLE users
  MODIFY COLUMN customer_id BIGINT UNSIGNED NULL;
