-- Every static piece of UI copy, with its screen and role, in English and Spanish.
-- `text_key` is the stable key the app asks for; the two text columns are what the Translations screen
-- edits. The catalog in shared/translations.ts seeds this table and is the fallback before it loads.

CREATE TABLE translations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  text_key    VARCHAR(160)    NOT NULL,
  screen      VARCHAR(64)     NOT NULL,
  role        VARCHAR(20)     NOT NULL DEFAULT 'all',
  context     VARCHAR(255)    NOT NULL DEFAULT '',
  english     TEXT            NOT NULL,
  spanish     TEXT            NOT NULL,
  sort_order  INT             NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_translations_key (text_key),
  KEY idx_translations_screen (screen, role, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
