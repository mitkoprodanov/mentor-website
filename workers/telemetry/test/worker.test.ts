import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { validateBatch, LIMITS } from '../src/validate.ts';

const ORIGIN = 'https://mentorgamestudio.com';
const SID = 'sess_0123456789';

const session = (over: Record<string, unknown> = {}) => ({
  session_id: SID,
  started_at: '2026-09-25T10:00:00.000Z',
  telemetry_version: 1,
  referrer: 'https://example.com/',
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
  site_version: '1.0.0',
  ...over,
});

const event = (over: Record<string, unknown> = {}) => ({
  event_id: 'evt_00000001',
  occurred_at: '2026-09-25T10:00:12.345Z',
  elapsed_ms: 12345,
  event_type: 'visibility_delta',
  target_type: 'timeline_project',
  target_id: 'heroes6',
  appearance_id: 'app_00000001',
  view_instance_id: 'view_0000001',
  v50_ms: 5000,
  v70_ms: 4200,
  v85_ms: 3100,
  v95_ms: 1000,
  max_visibility_ratio: 0.97,
  playing_ms: 4000,
  properties: { pointer_type: 'mouse', count: 3, locked: false },
  ...over,
});

/** Minimal in-memory D1 emulating the schema's uniqueness + FK behavior. */
function fakeDb() {
  const sessions = new Map<string, unknown[]>();
  const events = new Map<string, unknown[]>();
  const db = {
    sessions,
    events,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({ sql, args }),
      };
    },
    async batch(stmts: { sql: string; args: unknown[] }[]) {
      const s2 = new Map(sessions);
      const e2 = new Map(events);
      for (const { sql, args } of stmts) {
        if (sql.includes('INTO sessions')) {
          if (!s2.has(args[0] as string)) s2.set(args[0] as string, args);
        } else {
          if (!s2.has(args[0] as string)) throw new Error('FOREIGN KEY constraint failed');
          const key = `${args[0]}/${args[1]}`;
          if (!e2.has(key)) e2.set(key, args);
        }
      }
      sessions.clear(); s2.forEach((v, k) => sessions.set(k, v));
      events.clear(); e2.forEach((v, k) => events.set(k, v));
      return [];
    },
  };
  return db;
}

function post(body: unknown, headers: Record<string, string> = {}, raw = false) {
  return new Request('https://t.example/v1/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const call = (req: Request, db = fakeDb(), env: Record<string, unknown> = {}) =>
  worker.fetch(req, { DB: db, ...env } as never);

test('valid full batch is accepted and stored', async () => {
  const db = fakeDb();
  const res = await call(post({ session: session(), events: [event()] }), db);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(db.sessions.size, 1);
  assert.equal(db.events.size, 1);
});

test('retry does not duplicate sessions or events', async () => {
  const db = fakeDb();
  const body = { session: session(), events: [event()] };
  await call(post(body), db);
  await call(post(body), db);
  assert.equal(db.sessions.size, 1);
  assert.equal(db.events.size, 1);
});

test('later batch with minimal session appends events', async () => {
  const db = fakeDb();
  await call(post({ session: session(), events: [event()] }), db);
  const res = await call(
    post({
      session: { session_id: SID, telemetry_version: 1 },
      events: [event({ event_id: 'evt_00000002' })],
    }),
    db,
  );
  assert.equal(res.status, 200);
  assert.equal(db.events.size, 2);
});

test('events for an unknown session yield 409', async () => {
  const res = await call(
    post({ session: { session_id: SID, telemetry_version: 1 }, events: [event()] }),
  );
  assert.equal(res.status, 409);
});

test('country comes from request.cf only, never from the body', async () => {
  const db = fakeDb();
  const req = post({ session: session({ country: 'ZZ' }), events: [] });
  assert.equal((await call(req, db)).status, 400); // country is not a client field

  const req2 = post({ session: session(), events: [] });
  Object.defineProperty(req2, 'cf', { value: { country: 'BG' } });
  await call(req2, db);
  const args = db.sessions.get(SID)!;
  assert.equal(args[17], 'BG');
  assert.ok(!args.includes('1.2.3.4'));
});

test('unknown country markers are stored as null', async () => {
  const db = fakeDb();
  const req = post({ session: session(), events: [] });
  Object.defineProperty(req, 'cf', { value: { country: 'XX' } });
  await call(req, db);
  assert.equal(db.sessions.get(SID)![17], null);
});

test('CORS preflight: allowed origin', async () => {
  const res = await call(
    new Request('https://t.example/v1/batch', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
    }),
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Allow-Methods')!, /POST/);
  assert.match(res.headers.get('Access-Control-Allow-Headers')!, /Content-Type/i);
});

test('other browser origins are rejected without CORS grant', async () => {
  const db = fakeDb();
  const pre = await call(
    new Request('https://t.example/v1/batch', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
    db,
  );
  assert.equal(pre.status, 403);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), null);
  const res = await call(post({ session: session(), events: [] }, { Origin: 'https://evil.example' }), db);
  assert.equal(res.status, 403);
  assert.equal(db.sessions.size, 0);
});

test('extra origins only via ALLOWED_ORIGINS', async () => {
  const res = await call(
    post({ session: session(), events: [] }, { Origin: 'http://localhost:4321' }),
    fakeDb(),
    { ALLOWED_ORIGINS: 'http://localhost:4321' },
  );
  assert.equal(res.status, 200);
});

test('requests without Origin (non-browser) get no CORS header but are validated', async () => {
  const req = new Request('https://t.example/v1/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: session(), events: [] }),
  });
  const res = await call(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('routing and methods', async () => {
  assert.equal((await call(new Request('https://t.example/other', { method: 'POST' }))).status, 404);
  const get = await call(new Request('https://t.example/v1/batch', { method: 'GET' }));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('Allow'), 'POST, OPTIONS');
});

test('content type, malformed JSON, and size limits', async () => {
  assert.equal((await call(post('x', { 'Content-Type': 'text/plain' }, true))).status, 415);
  assert.equal((await call(post('{nope', {}, true))).status, 400);
  const big = JSON.stringify({ pad: 'a'.repeat(LIMITS.maxBodyBytes) });
  assert.equal((await call(post(big, {}, true))).status, 413);
});

test('oversized body without Content-Length is still capped', async () => {
  const big = JSON.stringify({ pad: 'a'.repeat(LIMITS.maxBodyBytes) });
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); },
  });
  const req = new Request('https://t.example/v1/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  assert.equal((await call(req)).status, 413);
});

test('errors never echo stored data and responses are not cacheable', async () => {
  const res = await call(post({ session: session(), events: [event({ elapsed_ms: -1 })] }));
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, 'invalid_payload');
});

test('D1 failure returns generic 500', async () => {
  const db = fakeDb();
  db.batch = async () => { throw new Error('secret internal detail'); };
  const res = await call(post({ session: session(), events: [] }), db);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal_error' });
});

// --- validation ---

const bad = (body: unknown) => assert.equal(validateBatch(body).ok, false, JSON.stringify(body).slice(0, 120));
const good = (body: unknown) => {
  const r = validateBatch(body);
  assert.ok(r.ok, r.ok ? '' : r.detail);
};

test('validation: session', () => {
  good({ session: session(), events: [] });
  bad({ events: [] });
  bad({ session: session({ telemetry_version: 2 }), events: [] });
  bad({ session: session({ session_id: 'short' }), events: [] });
  bad({ session: session({ session_id: 'has spaces here!' }), events: [] });
  bad({ session: session({ started_at: 'yesterday' }), events: [] });
  bad({ session: session({ started_at: '1999-01-01T00:00:00Z' }), events: [] });
  bad({ session: session({ hover_capable: 1 }), events: [] });
  bad({ session: session({ touch_capable: 'true' }), events: [] });
  bad({ session: session({ viewport_width: -5 }), events: [] });
  bad({ session: session({ viewport_width: 1.5 }), events: [] });
  bad({ session: session({ extra: 'x' }), events: [] });
  bad({ session: { session_id: SID, telemetry_version: 1, referrer: 'x' }, events: [event()] });
  bad({ session: { session_id: SID, telemetry_version: 1 }, events: [] });
  const { primary_pointer_fine: _omit, ...missing } = session();
  bad({ session: missing, events: [] });
});

test('validation: long free-form context is truncated, not rejected', () => {
  const r = validateBatch({ session: session({ referrer: 'https://a.example/' + 'x'.repeat(5000) }), events: [] });
  assert.ok(r.ok && r.value.session!.referrer!.length === LIMITS.maxReferrer);
});

test('validation: events', () => {
  good({ session: session(), events: [event()] });
  good({ session: session(), events: [event({ event_type: 'nav_click', target_type: undefined, target_id: undefined, v50_ms: undefined, v70_ms: undefined, v85_ms: undefined, v95_ms: undefined, max_visibility_ratio: undefined, playing_ms: undefined })] });
  bad({ session: session(), events: [event({ event_type: 'drop_table' })] });
  bad({ session: session(), events: [event({ elapsed_ms: -1 })] });
  bad({ session: session(), events: [event({ elapsed_ms: 1.5 })] });
  bad({ session: session(), events: [event({ elapsed_ms: LIMITS.maxElapsedMs + 1 })] });
  bad({ session: session(), events: [event({ v50_ms: -1 })] });
  bad({ session: session(), events: [event({ v50_ms: LIMITS.maxDeltaMs + 1, v70_ms: 0, v85_ms: 0, v95_ms: 0 })] });
  bad({ session: session(), events: [event({ v70_ms: 6000 })] }); // exceeds v50
  bad({ session: session(), events: [event({ max_visibility_ratio: 1.01 })] });
  bad({ session: session(), events: [event({ max_visibility_ratio: -0.1 })] });
  bad({ session: session(), events: [event({ max_visibility_ratio: 'high' })] });
  bad({ session: session(), events: [event({ target_id: undefined })] });
  bad({ session: session(), events: [event({ target_type: undefined, target_id: undefined })] });
  bad({ session: session(), events: [event({ event_type: 'nav_click', v50_ms: 5 })] });
  bad({ session: session(), events: [event({ occurred_at: 'nope' })] });
  bad({ session: session(), events: [event({ unexpected: 1 })] });
  bad({ session: session(), events: [event({ event_id: 'evt_00000001' }), event()] }); // duplicate id
  bad({ session: session(), events: 'x' });
  bad({ session: session(), events: Array.from({ length: LIMITS.maxEvents + 1 }, (_, i) => event({ event_id: `evt_${String(i).padStart(8, '0')}` })) });
  good({ session: session(), events: Array.from({ length: LIMITS.maxEvents }, (_, i) => event({ event_id: `evt_${String(i).padStart(8, '0')}` })) });
});

test('validation: properties', () => {
  bad({ session: session(), events: [event({ properties: 'str' })] });
  bad({ session: session(), events: [event({ properties: { nested: { a: 1 } } })] });
  bad({ session: session(), events: [event({ properties: { arr: [1] } })] });
  bad({ session: session(), events: [event({ properties: { 'Bad Key': 1 } })] });
  bad({ session: session(), events: [event({ properties: { s: 'x'.repeat(LIMITS.maxPropertyString + 1) } })] });
  bad({ session: session(), events: [event({ properties: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])) })] });
  const r = validateBatch({ session: session(), events: [event({ properties: { a: 'x', b: 2, c: true, d: null } })] });
  assert.ok(r.ok && r.value.events[0].properties === '{"a":"x","b":2,"c":true,"d":null}');
});
