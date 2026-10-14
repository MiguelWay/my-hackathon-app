-- 005_returns.sql
-- Task 7 — return reasons (data-driven, seeded) and recorded returns.
-- A package can be returned once. `closed_store` flags the "tienda cerrada" reason so the
-- export can list stores that must not be sent to again.
-- Isolation: every query is scoped by customer_id in the API.

CREATE TABLE return_reasons (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(64)     NOT NULL,  -- stable key used by the API/UI
  label       VARCHAR(128)    NOT NULL,  -- shown verbatim (Spanish, as used in-store)
  closed_store TINYINT(1)     NOT NULL DEFAULT 0,
  sort_order  INT             NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_return_reasons_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO return_reasons (code, label, closed_store, sort_order) VALUES
  ('tienda_cerrada',       'tienda cerrada',       1, 1),
  ('ausente',              'ausente',              0, 2),
  ('direccion_incorrecta', 'dirección incorrecta', 0, 3),
  ('estacionada',          'estacionada',          0, 4),
  ('otro',                 'otro',                 0, 5);

CREATE TABLE returns (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  BIGINT UNSIGNED NOT NULL,
  package_id   BIGINT UNSIGNED NOT NULL,
  reason_id    BIGINT UNSIGNED NOT NULL,
  note         VARCHAR(500)    NULL,
  recorded_by  BIGINT UNSIGNED NULL,
  returned_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_returns_package (package_id),
  KEY idx_returns_customer (customer_id),
  KEY idx_returns_reason (reason_id),
  CONSTRAINT fk_returns_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_returns_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE,
  CONSTRAINT fk_returns_reason FOREIGN KEY (reason_id) REFERENCES return_reasons (id),
  CONSTRAINT fk_returns_user FOREIGN KEY (recorded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
