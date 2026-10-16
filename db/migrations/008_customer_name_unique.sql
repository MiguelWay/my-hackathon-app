-- 008_customer_name_unique.sql
-- One name per customer.
--
-- The table's collation is utf8mb4_unicode_ci, which is case-insensitive and treats an accent as equal
-- to the plain letter. Without this index, "Plátano de Canarias 2026" and "plátano de canarias 2026"
-- are both allowed, and so are "Partners SL" and "partners sl" — which is exactly the pair that
-- appeared in the live data and prompted this.
--
-- A customer's name is also how it is chosen everywhere (the campaigns form's Company selector, the
-- customers list), so two customers sharing one is ambiguous to read and easy to mis-click.

ALTER TABLE customers ADD UNIQUE KEY uq_customers_name (name);
