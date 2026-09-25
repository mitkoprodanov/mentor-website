import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, PRODUCTION_ENDPOINT } from '../config.ts';
import { buildSessionContext, parseUtm, randomId } from '../session.ts';
import type { SessionEnv } from '../session.ts';
import { EventQueue, MAX_QUEUED } from '../queue.ts';
import { Transport, buildBatch } from '../transport.ts';
import type { Fetch } from '../transport.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';

const env = (over: Partial<SessionEnv> = {}): SessionEnv => ({
	search: '',
	referrer: '',
	innerWidth: 1280,
	innerHeight: 720,
	screenWidth: 1920,
	screenHeight: 1080,
	maxTouchPoints: 0,
	hasTouchStart: false,
	matchMedia: (q) => ({ matches: q === '(pointer: fine)' || q === '(any-pointer: fine)' || q === '(hover: hover)' }),
	...over,
});

const clock = () => {
	let t = 1000;
	return { now: () => t, iso: () => '2026-09-25T10:00:00.000Z', advance: (ms: number) => (t += ms) };
};

// ---- config -------------------------------------------------------------

test('config: on only for a production build on the real hostname', () => {
	const base = { forceEnable: false, search: '' };
	assert.equal(resolveConfig({ ...base, isProductionBuild: true, hostname: 'mentorgamestudio.com' }).enabled, true);
	assert.equal(resolveConfig({ ...base, isProductionBuild: true, hostname: 'localhost' }).enabled, false);
	assert.equal(resolveConfig({ ...base, isProductionBuild: false, hostname: 'localhost' }).enabled, false);
	assert.equal(resolveConfig({ ...base, isProductionBuild: false, hostname: 'mentorgamestudio.com' }).enabled, false);
});

test('config: explicit override enables + debug, endpoint override applies', () => {
	const c = resolveConfig({
		isProductionBuild: false, forceEnable: true, hostname: 'localhost', search: '',
		endpointOverride: 'http://localhost:8787/v1/batch',
	});
	assert.equal(c.enabled, true);
	assert.equal(c.debug, true);
	assert.equal(c.endpoint, 'http://localhost:8787/v1/batch');
	const prod = resolveConfig({ isProductionBuild: true, forceEnable: false, hostname: 'mentorgamestudio.com', search: '' });
	assert.equal(prod.endpoint, PRODUCTION_ENDPOINT);
	assert.equal(prod.debug, false);
});

test('config: ?telemetry_debug never enables telemetry by itself', () => {
	const c = resolveConfig({ isProductionBuild: true, forceEnable: false, hostname: 'localhost', search: '?telemetry_debug' });
	assert.equal(c.enabled, false);
	assert.equal(c.debug, false);
	assert.equal(resolveConfig({ isProductionBuild: true, forceEnable: false, hostname: 'mentorgamestudio.com', search: '?telemetry_debug' }).debug, true);
});

// ---- session / UTM ------------------------------------------------------

test('utm: only the four documented fields, trimmed, blanks dropped', () => {
	assert.deepEqual(
		parseUtm('?utm_source=li&utm_medium=%20social%20&utm_campaign=&utm_term=x&foo=bar&utm_content=a'),
		{ utm_source: 'li', utm_medium: 'social', utm_content: 'a' },
	);
	assert.deepEqual(parseUtm(''), {});
});

test('session context: exact documented fields with real booleans', () => {
	const ctx = buildSessionContext(
		env({ search: '?utm_source=x', referrer: 'https://example.com/a' }),
		'sess-id-0001', '2026-09-25T10:00:00.000Z', 'abc1234',
	);
	assert.deepEqual(ctx, {
		session_id: 'sess-id-0001',
		started_at: '2026-09-25T10:00:00.000Z',
		telemetry_version: 1,
		utm_source: 'x',
		primary_pointer_coarse: false,
		primary_pointer_fine: true,
		any_pointer_coarse: false,
		any_pointer_fine: true,
		hover_capable: true,
		touch_capable: false,
		referrer: 'https://example.com/a',
		viewport_width: 1280,
		viewport_height: 720,
		screen_width: 1920,
		screen_height: 1080,
		site_version: 'abc1234',
	});
});

test('session context: touch capability, empty referrer omitted, bad dimensions omitted', () => {
	const ctx = buildSessionContext(env({ maxTouchPoints: 5, innerWidth: NaN, screenWidth: 99999 }), 'sess-id-0002', '2026-09-25T10:00:00.000Z');
	assert.equal(ctx.touch_capable, true);
	assert.equal('referrer' in ctx, false);
	assert.equal('viewport_width' in ctx, false);
	assert.equal('screen_width' in ctx, false);
	assert.equal('site_version' in ctx, false);
});

test('randomId: unique, Worker-valid; null without crypto', () => {
	const a = randomId()!;
	assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
	assert.notEqual(a, randomId());
	assert.match(randomId({ getRandomValues: (a: Uint8Array) => a } as unknown as Crypto)!, /^[0-9a-f]{32}$/);
});

// ---- queue / payload ----------------------------------------------------

test('queue: elapsed_ms is monotonic-based from session origin; ids stable', () => {
	const c = clock();
	const q = new EventQueue(c, c.now());
	const first = q.emit('session_start')!;
	c.advance(1234.4);
	const second = q.emit('nav_click', { target_type: 'nav', target_id: 'about' })!;
	assert.equal(first.elapsed_ms, 0);
	assert.equal(second.elapsed_ms, 1234);
	assert.equal(second.target_id, 'about');
	assert.notEqual(first.event_id, second.event_id);
	assert.equal(q.peek(100, 1e6)[0].event_id, first.event_id);
	assert.equal(q.peek(100, 1e6)[0].event_id, first.event_id); // peek does not consume
});

test('payload: a full creation batch and a follow-up batch pass the real Worker validator', () => {
	const c = clock();
	const q = new EventQueue(c, c.now());
	q.emit('session_start');
	const session = buildSessionContext(env({ referrer: 'https://x.test/' }), randomId()!, c.iso(), 'abc1234');
	const events = q.peek(100, 1e6);
	const full = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, false, events))));
	assert.equal(full.ok, true, full.ok ? '' : full.detail);
	const follow = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, true, events))));
	assert.equal(follow.ok, true, follow.ok ? '' : follow.detail);
	assert.deepEqual(Object.keys(buildBatch(session, true, events).session).sort(), ['session_id', 'telemetry_version']);
});

// ---- transport: retry / idempotency / overlap ---------------------------

function harness(responses: Array<'ok' | 'throw' | number>) {
	const c = clock();
	const q = new EventQueue(c, c.now());
	const session = buildSessionContext(env(), 'sess-id-0003', c.iso());
	const bodies: any[] = [];
	const inits: any[] = [];
	let i = 0;
	const send: Fetch = async (_u, init) => {
		bodies.push(JSON.parse(init.body));
		inits.push(init);
		const r = responses[Math.min(i++, responses.length - 1)];
		if (r === 'throw') throw new TypeError('blocked');
		const status = r === 'ok' ? 200 : r;
		return { ok: status >= 200 && status < 300, status };
	};
	const t = new Transport('https://w.test/v1/batch', session, q, send, () => c.now());
	return { c, q, t, bodies, inits };
}

test('retry: failed request keeps events and resends identical IDs; success removes them', async () => {
	const h = harness(['throw', 'ok']);
	h.q.emit('session_start');
	const id = h.q.peek(1, 1e6)[0].event_id;
	await h.t.flush();
	assert.equal(h.q.length, 1);
	h.c.advance(30_000); // past first backoff
	await h.t.flush();
	assert.equal(h.q.length, 0);
	assert.equal(h.bodies[0].events[0].event_id, id);
	assert.equal(h.bodies[1].events[0].event_id, id);
	assert.ok('started_at' in h.bodies[0].session && 'started_at' in h.bodies[1].session);
});

test('retry: backoff suppresses non-lifecycle flushes but lifecycle flush still tries', async () => {
	const h = harness(['throw', 'ok']);
	h.q.emit('session_start');
	await h.t.flush();
	await h.t.flush(); // within backoff: no request
	assert.equal(h.bodies.length, 1);
	await h.t.flush({ lifecycle: true });
	assert.equal(h.bodies.length, 2);
	assert.equal(h.inits[1].keepalive, true);
	assert.equal(h.inits[0].keepalive, false);
	assert.equal(h.q.length, 0);
});

test('after ack, later batches send only the minimal session reference', async () => {
	const h = harness(['ok']);
	h.q.emit('session_start');
	await h.t.flush();
	h.q.emit('nav_click', { target_type: 'nav', target_id: 'about' });
	await h.t.flush();
	assert.deepEqual(Object.keys(h.bodies[1].session).sort(), ['session_id', 'telemetry_version']);
	assert.equal(h.bodies[1].events.length, 1);
});

test('events emitted during an in-flight request are kept, not lost or duplicated', async () => {
	const h = harness(['ok']);
	h.q.emit('session_start');
	const p1 = h.t.flush();
	h.q.emit('nav_click', { target_type: 'nav', target_id: 'about' }); // while in flight
	const p2 = h.t.flush(); // overlapping call: must not send concurrently
	await Promise.all([p1, p2]);
	const ids = h.bodies.flatMap((b) => b.events.map((e: any) => e.event_id));
	assert.equal(new Set(ids).size, 2);
	assert.equal(ids.length, 2);
	assert.equal(h.q.length, 0);
});

test('deterministic 4xx drops the poisoned batch instead of blocking the queue', async () => {
	const h = harness([400, 'ok']);
	h.q.emit('session_start');
	await h.t.flush();
	assert.equal(h.q.length, 0);
	h.q.emit('nav_click', { target_type: 'nav', target_id: 'about' });
	await h.t.flush();
	assert.equal(h.q.length, 0);
});

test('5xx keeps events; 409 resends the full session context', async () => {
	const h = harness([500]);
	h.q.emit('session_start');
	await h.t.flush();
	assert.equal(h.q.length, 1);
	const h2 = harness(['ok', 409, 'ok']);
	h2.q.emit('session_start');
	await h2.t.flush();
	h2.q.emit('nav_click', { target_type: 'nav', target_id: 'about' });
	await h2.t.flush(); // 409
	assert.equal(h2.q.length, 1);
	h2.c.advance(30_000);
	await h2.t.flush();
	assert.ok('started_at' in h2.bodies[2].session);
	assert.equal(h2.q.length, 0);
});

test('large queue is split into batches within worker limits', async () => {
	const h = harness(['ok']);
	for (let i = 0; i < 250; i++) h.q.emit('nav_click', { target_type: 'nav', target_id: 'about' });
	await h.t.flush();
	assert.equal(h.q.length, 0);
	assert.ok(h.bodies.every((b) => b.events.length <= 100));
	assert.equal(h.bodies.length, 3);
});

test('queue overflow drops NEW events, keeps oldest, warns once', () => {
	const c = clock();
	let warnings = 0;
	const q = new EventQueue(c, c.now(), undefined, () => warnings++);
	const first = q.emit('session_start')!;
	for (let i = 1; i < MAX_QUEUED; i++) q.emit('nav_click');
	assert.equal(q.length, MAX_QUEUED);
	assert.equal(q.emit('nav_click'), null);
	assert.equal(q.emit('nav_click'), null);
	assert.equal(q.length, MAX_QUEUED);
	assert.equal(q.peek(1, 1e6)[0].event_id, first.event_id);
	assert.equal(warnings, 1);
});

test('flush with nothing queued sends no request, even lifecycle, even before session ack', async () => {
	const h = harness(['ok']);
	await h.t.flush({ lifecycle: true });
	assert.equal(h.bodies.length, 0);
	h.q.emit('session_start');
	await h.t.flush();
	await h.t.flush({ lifecycle: true });
	assert.equal(h.bodies.length, 1);
});

test('early flush racing the periodic flush sends each event exactly once', async () => {
	const h = harness(['ok']);
	h.q.emit('session_start');
	await Promise.all([h.t.flush(), h.t.flush(), h.t.flush({ lifecycle: true })]);
	const ids = h.bodies.flatMap((b) => b.events.map((e: any) => e.event_id));
	assert.equal(ids.length, 1);
	assert.equal(h.q.length, 0);
});
