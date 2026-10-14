-- 002_campaigns.sql
-- Task 4 — campaigns (a customer's sending rounds). `customers` exists from 001.
-- Isolation: every query is scoped by customer_id in the API.

CREATE TABLE campaigns (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(255)    NOT NULL,
  start_date   DATE            NULL,
  finish_date  DATE            NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_campaigns_customer (customer_id),
  CONSTRAINT fk_campaigns_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
