-- Mentor Game Studio telemetry
-- Campaign attribution queries. Source of truth for semantics: docs/telemetry.md (section 13.1)
--
-- The utm_source / utm_medium / utm_campaign / utm_content columns already exist on
-- `sessions` (0001), so attribution needs no new columns. This only adds an index for
-- "sessions of campaign X, newest first" and leaves existing rows untouched (their
-- utm_* values stay NULL = unattributed).

CREATE INDEX idx_sessions_utm_campaign
  ON sessions(utm_campaign, started_at);
