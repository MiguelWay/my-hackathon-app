-- 004_packages.sql
-- Task 6 — campaign uploads and the packages they contain.
-- One campaign can have many uploads; each row of each upload becomes one package.
-- Isolation: every query is scoped by customer_id in the API.

CREATE TABLE campaign_uploads (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  BIGINT UNSIGNED NOT NULL,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  filename     VARCHAR(255)    NULL,
  columns      JSON            NOT NULL,  -- original header names, in order, kept verbatim
  row_count    INT UNSIGNED    NOT NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_uploads_customer (customer_id),
  KEY idx_uploads_campaign (campaign_id),
  CONSTRAINT fk_uploads_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_uploads_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE packages (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id   BIGINT UNSIGNED NOT NULL,
  campaign_id   BIGINT UNSIGNED NOT NULL,
  upload_id     BIGINT UNSIGNED NOT NULL,
  source_row    INT UNSIGNED    NOT NULL,  -- 1-based row number in the source file
  sender_id     VARCHAR(128)    NOT NULL,  -- the Correos sender ID (the column chosen at upload)
  extra_columns JSON            NOT NULL,  -- every other column, keyed by its original header
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_packages_campaign_sender (campaign_id, sender_id),
  KEY idx_packages_customer (customer_id),
  KEY idx_packages_upload (upload_id),
  CONSTRAINT fk_packages_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_packages_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT fk_packages_upload FOREIGN KEY (upload_id) REFERENCES campaign_uploads (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
