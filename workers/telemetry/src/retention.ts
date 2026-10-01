// Raw telemetry retention: `sessions` and `events` are deleted 90 days after the session
// started (docs/privacy.md). Runs daily from the Worker's Cron Trigger (wrangler.jsonc) and is
// also used by `npm run telemetry:prune` against the LOCAL database only.
//
// `started_at` is always canonical UTC ISO-8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`, enforced in
// validate.ts), so a plain lexical `<` against another `toISOString()` is chronologically exact.

export const RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sessions that started strictly before this instant are expired. */
export function retentionCutoff(now: Date, days: number = RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

// Events first: events.session_id has a FOREIGN KEY to sessions. One D1 batch = one transaction.
export const PURGE_EVENTS_SQL = `DELETE FROM events
  WHERE occurred_at < ?1 OR session_id IN (SELECT session_id FROM sessions WHERE started_at < ?1)`;
export const PURGE_SESSIONS_SQL = `DELETE FROM sessions WHERE started_at < ?1`;

export interface PurgeResult {
  cutoff: string;
  events: number;
  sessions: number;
}

export async function purgeExpired(
  db: D1Database,
  now: Date = new Date(),
  days: number = RETENTION_DAYS,
): Promise<PurgeResult> {
  const cutoff = retentionCutoff(now, days);
  const [events, sessions] = await db.batch([
    db.prepare(PURGE_EVENTS_SQL).bind(cutoff),
    db.prepare(PURGE_SESSIONS_SQL).bind(cutoff),
  ]);
  return { cutoff, events: events.meta.changes ?? 0, sessions: sessions.meta.changes ?? 0 };
}
