-- Mentor Game Studio telemetry
-- Migration/reference: initial V1 schema
-- Source of truth for semantics: docs/telemetry.md
--
-- Apply once to the mentor-telemetry-db D1 database.
-- After this has been applied, future schema changes should be added as
-- 0002_*.sql, 0003_*.sql, etc. rather than modifying the applied migration.

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  viewport_width INTEGER,
  viewport_height INTEGER,
  screen_width INTEGER,
  screen_height INTEGER,
  primary_pointer_coarse INTEGER NOT NULL CHECK (primary_pointer_coarse IN (0, 1)),
  primary_pointer_fine INTEGER NOT NULL CHECK (primary_pointer_fine IN (0, 1)),
  any_pointer_coarse INTEGER NOT NULL CHECK (any_pointer_coarse IN (0, 1)),
  any_pointer_fine INTEGER NOT NULL CHECK (any_pointer_fine IN (0, 1)),
  hover_capable INTEGER NOT NULL CHECK (hover_capable IN (0, 1)),
  touch_capable INTEGER NOT NULL CHECK (touch_capable IN (0, 1)),
  country TEXT,
  telemetry_version INTEGER NOT NULL,
  site_version TEXT
) STRICT;

CREATE INDEX idx_sessions_started_at
  ON sessions(started_at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,

  target_type TEXT,
  target_id TEXT,

  appearance_id TEXT,
  view_instance_id TEXT,

  v50_ms INTEGER,
  v70_ms INTEGER,
  v85_ms INTEGER,
  v95_ms INTEGER,
  max_visibility_ratio REAL,

  playing_ms INTEGER,
  playing_v50_ms INTEGER,
  playing_v70_ms INTEGER,
  playing_v85_ms INTEGER,
  playing_v95_ms INTEGER,

  properties TEXT,

  telemetry_version INTEGER NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  UNIQUE(session_id, event_id)
) STRICT;

CREATE INDEX idx_events_session_elapsed
  ON events(session_id, elapsed_ms);
