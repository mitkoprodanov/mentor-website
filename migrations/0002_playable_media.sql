-- Mentor Game Studio telemetry
-- Telemetry Pass 2: playable-media exposure and known playback.
-- Source of truth for semantics: docs/telemetry.md (section 9, 17.7)
--
-- Adds the playable_v* family (playable-media exposure at each nested
-- visibility threshold — does not assert playback occurred). The playing_v*
-- family (known actual playback) already exists from the initial migration.
--
-- Drops the standalone playing_ms column added speculatively in the initial
-- migration: never populated by any client (grep confirms no writer ever
-- existed), and explicitly out of the final Pass 2 design — 50% is the
-- baseline for every measurement family here, so an un-nested "total
-- playing time regardless of visibility" field is redundant/inconsistent
-- with the rest of the model, matching the deliberate omission of a
-- standalone playable_ms too (never added at all).

ALTER TABLE events ADD COLUMN playable_v50_ms INTEGER;
ALTER TABLE events ADD COLUMN playable_v70_ms INTEGER;
ALTER TABLE events ADD COLUMN playable_v85_ms INTEGER;
ALTER TABLE events ADD COLUMN playable_v95_ms INTEGER;

ALTER TABLE events DROP COLUMN playing_ms;
