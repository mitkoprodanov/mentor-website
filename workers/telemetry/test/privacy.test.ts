// Worker-side privacy hardening: per-event property allowlists and 90-day retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { EVENT_PROPERTIES, EVENT_TYPES, validateBatch, sanitizeReferrer } from '../src/validate.ts';
import { RETENTION_DAYS, purgeExpired, retentionCutoff } from '../src/retention.ts';

const SESSION = {
  session_id: 'sess_0123456789',
  started_at: '2026-09-25T10:00:00.000Z',
  telemetry_version: 1,
  primary_pointer_coarse: false,
  primary_pointer_fine: true,
  any_pointer_coarse: false,
  any_pointer_fine: true,
  hover_capable: true,
  touch_capable: false,
};

const ev = (event_type: string, properties?: unknown, over: Record<string, unknown> = {}) => ({
  event_id: `evt_${event_type}`.slice(0, 24).padEnd(12, '0'),
  occurred_at: '2026-09-25T10:00:12.345Z',
  elapsed_ms: 1000,
  event_type,
  ...(event_type === 'visibility_delta' ? { target_type: 'timeline_project', target_id: 'heroes6', appearance_id: 'app_00000001' } : {}),
  ...(properties === undefined ? {} : { properties }),
  ...over,
});

const check = (events: unknown[]) => validateBatch({ session: SESSION, events });

// ---- per-event property allowlists --------------------------------------------

/** Every property payload the shipped client can actually produce (audited against
 *  explicitEvents.ts, state.ts, interactions.ts, clickBurst.ts, visibility.ts, client.ts,
 *  visibility.client.ts). */
const LEGIT: Array<[string, Record<string, unknown> | undefined]> = [
  ['session_start', undefined],
  ['viewport_changed', { viewport_width: 1280, viewport_height: 720 }],
  ['skills_open', { trigger_person: 'mitko', trigger_method: 'hover', locked: false }],
  ['skills_lock', { trigger_person: 'adam', cause: 'click' }],
  ['skills_unlock', { trigger_person: 'adam' }],
  ['skills_close', { reason: 'explicit', locked: true, trigger_person: 'mitko' }],
  ['skill_filter_open', undefined],
  ['skill_filter_close', { reason: 'escape' }],
  ['project_open', undefined],
  ['project_close', { reason: 'backdrop' }],
  ['nav_click', { target: 'timeline', origin_surface: 'main', origin_section: 'about', pointer_type: 'mouse' }],
  ['nav_click', { target: 'contact', origin_surface: 'skills', skills_mode: 'locked', pointer_type: 'touch' }],
  ['skill_click', { trigger_person: 'mitko' }],
  ['cv_download', { pointer_type: 'mouse' }],
  ['linkedin_click', { pointer_type: 'pen' }],
  ['contact_email_copy', undefined],
  ['contact_email_open', { pointer_type: 'mouse' }],
  ['external_link_click', { destination_type: 'official_site', pointer_type: 'mouse' }],
  ['external_link_click', { destination_type: 'linkedin_post_fallback' }],
  ['video_start', { content_type: 'facebook-reel', person: 'both' }],
  ['context_menu', { element: 'project_link', destination_type: 'official_site', pointer_type: 'mouse' }],
  ['context_menu', { element: 'media', content_type: 'youtube' }],
  ['noninteractive_click', { element: 'tag_pill', project_id: 'heroes6', pointer_type: 'touch' }],
  [
    'click_burst',
    {
      start_elapsed_ms: 900, duration_ms: 400, click_count: 4, region: 'timeline', distinct_targets: 1,
      unresolved_clicks: 0, target_class: 'mixed', spread_px: 12, center_x_ratio: 0.47, center_y_ratio: 0.33,
      pointer_type: 'mouse',
    },
  ],
  ['action_failed', { action: 'contact_email_copy', reason: 'clipboard_denied' }],
  ['visibility_delta', { content_type: 'experience', person: 'adam' }],
  ['visibility_delta', { trigger_method: 'hover' }],
];

test('property allowlist: every legitimate current payload is accepted', () => {
  for (const [type, props] of LEGIT) {
    const r = check([ev(type, props)]);
    assert.ok(r.ok, `${type} ${JSON.stringify(props)}: ${r.ok ? '' : r.detail}`);
  }
});

test('property allowlist: every event type in the vocabulary has a declared schema', () => {
  for (const t of EVENT_TYPES) assert.ok(t in EVENT_PROPERTIES, `no property schema for ${t}`);
  for (const t of Object.keys(EVENT_PROPERTIES)) assert.ok(EVENT_TYPES.has(t), `schema for unknown event ${t}`);
});

test('property allowlist: an undeclared property is rejected on every event type', () => {
  for (const type of EVENT_TYPES) {
    const r = check([ev(type, { not_declared: 'x' })]);
    assert.equal(r.ok, false, `${type} accepted an undeclared property`);
  }
});

test('property allowlist: a declared property on the WRONG event type is rejected', () => {
  assert.equal(check([ev('nav_click', { locked: true })]).ok, false);
  assert.equal(check([ev('cv_download', { destination_type: 'official_site' })]).ok, false);
  assert.equal(check([ev('session_start', { pointer_type: 'mouse' })]).ok, false);
  assert.equal(check([ev('project_open', { reason: 'x' })]).ok, false);
  assert.equal(check([ev('visibility_delta', { pointer_type: 'mouse' })]).ok, false);
});

test('property allowlist: value kinds are enforced (no free text, URLs or wrong types)', () => {
  assert.equal(check([ev('nav_click', { target: 'https://evil.test/?q=1' })]).ok, false);
  assert.equal(check([ev('nav_click', { target: 'two words' })]).ok, false);
  assert.equal(check([ev('nav_click', { target: 'a@b.co' })]).ok, false);
  assert.equal(check([ev('skills_open', { locked: 'yes' })]).ok, false);
  assert.equal(check([ev('viewport_changed', { viewport_width: 12.5, viewport_height: 10 })]).ok, false);
  assert.equal(check([ev('viewport_changed', { viewport_width: -1, viewport_height: 10 })]).ok, false);
  assert.equal(check([ev('click_burst', { click_count: '3' })]).ok, false);
  assert.equal(check([ev('click_burst', { center_x_ratio: Number.POSITIVE_INFINITY })]).ok, false);
  assert.equal(check([ev('nav_click', { target: { nested: 1 } })]).ok, false);
  assert.equal(check([ev('nav_click', { target: ['a'] })]).ok, false);
});

test('property allowlist: prototype keys cannot sneak through', () => {
  assert.equal(check([ev('nav_click', JSON.parse('{"__proto__": "x"}'))]).ok, false);
  assert.equal(check([ev('nav_click', { constructor: 'x' })]).ok, false);
  assert.equal(check([ev('nav_click', { toString: 'x' })]).ok, false);
});

test('referrer: path kept; query, fragment and credentials dropped; junk omitted', () => {
  assert.equal(
    sanitizeReferrer('https://u:p@www.linkedin.com/feed/update/urn:li:activity:1/?trk=x&utm_source=y#frag', 512),
    'https://www.linkedin.com/feed/update/urn:li:activity:1/',
  );
  assert.equal(sanitizeReferrer('https://example.com', 512), 'https://example.com/');
  assert.equal(sanitizeReferrer('javascript:alert(1)', 512), null);
  assert.equal(sanitizeReferrer('about:blank', 512), null);
  assert.equal(sanitizeReferrer('not a url', 512), null);
  assert.equal(sanitizeReferrer('', 512), null);
});

// ---- 90-day retention against a real SQLite schema ---------------------------------

function realDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  // Just enough of D1Database for purgeExpired / the scheduled handler.
  const db = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
    async batch(stmts: { sql: string; args: unknown[] }[]) {
      sqlite.exec('BEGIN');
      try {
        const out = stmts.map(({ sql, args }) => ({ meta: { changes: Number(sqlite.prepare(sql).run(...(args as never[])).changes) } }));
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const addSession = (id: string, startedAt: string, events = 2) => {
    sqlite
      .prepare(
        `INSERT INTO sessions (session_id, started_at, primary_pointer_coarse, primary_pointer_fine, any_pointer_coarse,
           any_pointer_fine, hover_capable, touch_capable, telemetry_version, utm_campaign)
         VALUES (?, ?, 0, 1, 0, 1, 1, 0, 1, 'portfolio_launch')`,
      )
      .run(id, startedAt);
    for (let i = 0; i < events; i++) {
      sqlite
        .prepare(
          `INSERT INTO events (session_id, event_id, occurred_at, elapsed_ms, event_type, telemetry_version)
           VALUES (?, ?, ?, ?, 'nav_click', 1)`,
        )
        .run(id, `evt_${id}_${i}`, startedAt, i * 1000);
    }
  };
  const ids = (t: 'sessions' | 'events') =>
    (sqlite.prepare(`SELECT ${t === 'sessions' ? 'session_id' : 'DISTINCT session_id'} AS id FROM ${t} ORDER BY 1`).all() as { id: string }[]).map((r) => r.id);
  return { sqlite, db: db as unknown as D1Database, addSession, ids };
}

const NOW = new Date('2026-10-01T12:00:00.000Z');

test('retention: cutoff is exactly 90 days earlier, in canonical UTC ISO form', () => {
  assert.equal(RETENTION_DAYS, 90);
  assert.equal(retentionCutoff(NOW), '2026-07-03T12:00:00.000Z');
});

test('retention: expired sessions and their events are deleted; newer ones untouched', async () => {
  const { db, addSession, ids, sqlite } = realDb();
  addSession('sess_ancient', '2026-01-01T00:00:00.000Z');
  addSession('sess_91_days', '2026-07-02T12:00:00.000Z', 3);
  addSession('sess_just_over', '2026-07-03T11:59:59.999Z');
  addSession('sess_exactly_90', '2026-07-03T12:00:00.000Z'); // boundary: not yet expired (strict <)
  addSession('sess_89_days', '2026-07-04T12:00:00.000Z');
  addSession('sess_today', '2026-10-01T11:00:00.000Z');

  const r = await purgeExpired(db, NOW);
  assert.equal(r.sessions, 3);
  assert.equal(r.events, 2 + 3 + 2);
  assert.deepEqual(ids('sessions'), ['sess_89_days', 'sess_exactly_90', 'sess_today']);
  assert.deepEqual(ids('events'), ['sess_89_days', 'sess_exactly_90', 'sess_today']);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n, 6);

  // idempotent
  const again = await purgeExpired(db, NOW);
  assert.deepEqual([again.sessions, again.events], [0, 0]);
});

test('retention: an empty database is fine; a stricter window is honoured', async () => {
  const { db, addSession, ids } = realDb();
  assert.deepEqual(await purgeExpired(db, NOW).then((r) => [r.sessions, r.events]), [0, 0]);
  addSession('sess_10_days', '2026-09-21T12:00:00.000Z');
  addSession('sess_1_day', '2026-09-30T12:00:00.000Z');
  await purgeExpired(db, NOW, 5);
  assert.deepEqual(ids('sessions'), ['sess_1_day']);
});

test('retention: the Worker cron handler purges using the same logic', async () => {
  const { db, addSession, ids } = realDb();
  addSession('sess_ancient', '2026-01-01T00:00:00.000Z');
  addSession('sess_today', new Date().toISOString());
  const pending: Promise<unknown>[] = [];
  await worker.scheduled!({} as never, { DB: db } as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never);
  await Promise.all(pending);
  assert.deepEqual(ids('sessions'), ['sess_today']);
});
