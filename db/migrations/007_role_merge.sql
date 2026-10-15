-- 007_role_merge.sql
-- Fold the `admin` role into `superadmin`: two roles remain, `superadmin` | `user`.
--
-- A super-admin is a full-access account. It may optionally be attached to a customer
-- (users.customer_id), in which case it also runs that customer's campaigns, uploads,
-- returns and exports — exactly what `admin` used to do, plus the platform screens.
-- A super-admin with no customer is a pure platform owner (creates customers).
--
-- `user` is unchanged: it processes returns and can read its own customer's data.

UPDATE users SET role = 'superadmin' WHERE role = 'admin';

ALTER TABLE users
  MODIFY COLUMN role ENUM('superadmin', 'user') NOT NULL DEFAULT 'user';
