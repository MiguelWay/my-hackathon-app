-- 010_session_idle.sql
-- A session now ends after a period of inactivity, not only when its absolute expiry passes. Every
-- authenticated request stamps `last_seen_at`; the auth lookup refuses a session whose stamp is older
-- than the configured idle window (default 30 minutes). Existing rows start their clock at deploy time.
ALTER TABLE sessions
  ADD COLUMN last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER user_id,
  ADD KEY idx_sessions_idle (last_seen_at);
