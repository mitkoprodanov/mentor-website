// Worker-side campaign attribution validation/storage (utm_* on sessions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { LIMITS } from '../src/validate.ts';

const ORIGIN = 'https://mentorgamestudio.com';
const SID = 'sess_0123456789';

const session = (over: Record<string, unknown> = {}) => ({
  session_id: SID,
  started_at: '2026-09-25T10:00:00.000Z',
  telemetry_version: 1,
  viewport_width: 1280,
  viewport_height: 720,
  screen_width: 1920,
  screen_height: 1080,
  primary_pointer_coarse: false,
  primary_pointer_fine: true,
  any_pointer_coarse: false,
  any_pointer_fine: true,
  hover_capable: true,
  touch_capable: false,
  ...over,
});

const event = (id: string) => ({
  event_id: id,
  occurred_at: '2026-09-25T10:00:12.345Z',
  elapsed_ms: 12345,
  event_type: 'nav_click',
  target_type: 'nav',
  target_id: 'about',
});

/** In-memory D1 that records positional bind args (sessions: id, started_at, referrer, utm x4 ...). */
function fakeDb() {
  const sessions = new Map<string, unknown[]>();
  const events = new Map<string, unknown[]>();
  return {
    sessions,
    events,
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
    async batch(stmts: { sql: string; args: unknown[] }[]) {
      for (const { sql, args } of stmts) {
        if (sql.includes('INTO sessions')) {
          if (!sessions.has(args[0] as string)) sessions.set(args[0] as string, args);
        } else {
          if (!sessions.has(args[0] as string)) throw new Error('FOREIGN KEY constraint failed');
          events.set(`${args[0]}/${args[1]}`, args);
        }
      }
      return [];
    },
  };
}

const call = (body: unknown, db = fakeDb()) =>
  worker.fetch(
    new Request('https://t.example/v1/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body),
    }),
    { DB: db } as never,
  );

const utmRow = (db: ReturnType<typeof fakeDb>, sid = SID) => {
  const a = db.sessions.get(sid) as unknown[];
  return [a[3], a[4], a[5], a[6]];
};

test('utm: all four values stored normalized on the session', async () => {
  const db = fakeDb();
  const res = await call(
    {
      session: session({
        utm_source: ' LinkedIn ',
        utm_medium: 'Social',
        utm_campaign: 'portfolio_launch',
        utm_content: 'company_post',
      }),
      events: [event('evt_00000001')],
    },
    db,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(utmRow(db), ['linkedin', 'social', 'portfolio_launch', 'company_post']);
});

test('utm: partial and absent attribution store nulls', async () => {
  const db = fakeDb();
  await call({ session: session({ utm_source: 'email', utm_campaign: 'studio_outreach' }), events: [] }, db);
  assert.deepEqual(utmRow(db), ['email', null, 'studio_outreach', null]);
  await call({ session: session({ session_id: 'sess_plain_01' }), events: [] }, db);
  assert.deepEqual(utmRow(db, 'sess_plain_01'), [null, null, null, null]);
});

test('utm: invalid, empty, whitespace and over-long values are omitted, never stored raw', async () => {
  const db = fakeDb();
  const res = await call(
    {
      session: session({
        utm_source: 'https://evil.test/?a=b',
        utm_medium: '   ',
        utm_campaign: 'a'.repeat(LIMITS.maxUtm + 1),
        utm_content: 'jane.doe@acme.com',
      }),
      events: [],
    },
    db,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(utmRow(db), [null, null, null, null]);
  const ok = await call({ session: session({ session_id: 'sess_edge_001', utm_source: 'a'.repeat(LIMITS.maxUtm) }), events: [] }, db);
  assert.equal(ok.status, 200);
  assert.equal((utmRow(db, 'sess_edge_001')[0] as string).length, LIMITS.maxUtm);
});

test('utm: non-string values and non-allowlisted attribution fields are rejected', async () => {
  for (const s of [
    session({ utm_source: 5 }),
    session({ utm_source: { a: 1 } }),
    session({ utm_term: 'kw' }),
    session({ url: 'https://mentorgamestudio.com/?utm_source=x' }),
    session({ search: '?utm_source=x' }),
  ]) {
    assert.equal((await call({ session: s, events: [] })).status, 400);
  }
});

test('utm: attribution survives batching; follow-ups reach the same session; sessions stay independent', async () => {
  const db = fakeDb();
  await call({ session: session({ utm_source: 'linkedin', utm_campaign: 'devlog' }), events: [event('evt_00000001')] }, db);
  await call({ session: { session_id: SID, telemetry_version: 1 }, events: [event('evt_00000002')] }, db);
  await call({ session: session({ session_id: 'sess_other_01' }), events: [event('evt_00000003')] }, db);
  assert.equal(db.events.size, 3);
  assert.deepEqual(utmRow(db), ['linkedin', null, 'devlog', null]); // unchanged by the follow-up batch
  assert.deepEqual(utmRow(db, 'sess_other_01'), [null, null, null, null]); // no inheritance
  assert.equal([...db.events.keys()].filter((k) => k.startsWith(`${SID}/`)).length, 2);
});

test('started_at is always stored as canonical UTC ISO-8601 (ms precision, Z)', async () => {
  const db = fakeDb();
  await call({ session: session({ started_at: '2026-09-25T12:00:00+02:00' }), events: [] }, db);
  assert.equal((db.sessions.get(SID) as unknown[])[1], '2026-09-25T10:00:00.000Z');
  await call({ session: session({ session_id: 'sess_secs_001', started_at: '2026-09-25T10:00:00Z' }), events: [] }, db);
  assert.match((db.sessions.get('sess_secs_001') as unknown[])[1] as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
