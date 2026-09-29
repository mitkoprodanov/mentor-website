import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BURST, BurstDetector } from '../clickBurst.ts';
import type { BurstActivation } from '../clickBurst.ts';
import { ActivationFilter } from '../pointerGesture.ts';
import type { RawPointerEvent } from '../pointerGesture.ts';
import { resolve, resolveContext } from '../interactionResolver.ts';
import type { ElementLike } from '../interactionResolver.ts';
import { startInteractionCapture } from '../interactions.ts';
import { attemptOpenProject, copyText, copyWithFeedback } from '../actionFlows.ts';
import { buildActionFailed, isLinkActivation, onLinkActivation } from '../explicitEvents.ts';
import { EventQueue } from '../queue.ts';
import { buildBatch } from '../transport.ts';
import { buildSessionContext, randomId } from '../session.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';
import type { EmitOptions } from '../types.ts';


function workerAccepts(entries: [string, EmitOptions][]): void {
	const clock = { now: () => 5000, iso: () => '2026-09-29T10:00:00.000Z' };
	const q = new EventQueue(clock, 1000, randomId);
	for (const [t, o] of entries) q.emit(t, o);
	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1280, innerHeight: 720, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: true }),
		},
		'sess_pass4_0001',
		'2026-09-29T10:00:00.000Z',
	);
	const events = q.peek(100, 1e6);
	assert.equal(events.length, entries.length);
	const result = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, false, events))));
	assert.equal(result.ok, true, result.ok ? '' : result.detail);
}

// ---- fake DOM ---------------------------------------------------------------

interface ElOpts {
	id?: string;
	cls?: string;
	attrs?: Record<string, string>;
}
function el(tagName: string, o: ElOpts = {}, parent: ElementLike | null = null): ElementLike {
	const classes = new Set((o.cls ?? '').split(/\s+/).filter(Boolean));
	const attrs = o.attrs ?? {};
	return {
		tagName: tagName.toUpperCase(),
		id: o.id ?? '',
		parentElement: parent,
		getAttribute: (n) => (n in attrs ? attrs[n] : null),
		hasAttribute: (n) => n in attrs,
		classList: { contains: (c) => classes.has(c) },
	};
}

// ---- burst harness ------------------------------------------------------------

function harness() {
	const emitted: { type: string; opts: EmitOptions }[] = [];
	let timers: { fn: () => void; id: number }[] = [];
	let nextId = 1;
	const det = new BurstDetector({
		toElapsed: (t) => Math.round(t),
		emit: (type, opts) => emitted.push({ type, opts }),
		setTimer: (fn) => {
			const id = nextId++;
			timers.push({ fn, id });
			return id;
		},
		clearTimer: (h) => {
			timers = timers.filter((t) => t.id !== h);
		},
		viewport: () => ({ width: 1000, height: 800 }),
	});
	return {
		det,
		emitted,
		fireTimers: () => {
			const t = timers;
			timers = [];
			t.forEach((x) => x.fn());
		},
		pending: () => timers.length,
	};
}

function act(t: number, x: number, y: number, over: Partial<BurstActivation> = {}): BurstActivation {
	return {
		t,
		x,
		y,
		pointerType: 'mouse',
		semantic: null,
		interactive: false,
		textLike: false,
		region: 'timeline',
		viewInstanceId: null,
		...over,
	};
}

// ---- burst: counts / timing ---------------------------------------------------

test('burst: 2 activations never form a burst', () => {
	const h = harness();
	h.det.onActivation(act(0, 100, 100));
	h.det.onActivation(act(200, 100, 100));
	h.fireTimers();
	h.det.finalizeConfirmed();
	assert.equal(h.emitted.length, 0);
});

test('burst: 3 qualifying activations confirm; idle finalisation emits once with count/timing', () => {
	const h = harness();
	h.det.onActivation(act(1000, 100, 100));
	h.det.onActivation(act(1300, 102, 101));
	h.det.onActivation(act(1600, 99, 100));
	assert.equal(h.emitted.length, 0, 'not emitted at start or at confirmation — only at the END');
	h.fireTimers();
	assert.equal(h.emitted.length, 1);
	const e = h.emitted[0];
	assert.equal(e.type, 'click_burst');
	assert.equal(e.opts.properties?.click_count, 3);
	assert.equal(e.opts.properties?.start_elapsed_ms, 1000);
	assert.equal(e.opts.properties?.duration_ms, 600);
	h.fireTimers();
	assert.equal(h.emitted.length, 1, 'never double-emits');
});

test('burst: 4+ activations report the correct final count', () => {
	const h = harness();
	for (let i = 0; i < 6; i++) h.det.onActivation(act(i * 200, 50 + i, 50));
	h.fireTimers();
	assert.equal(h.emitted.length, 1);
	assert.equal(h.emitted[0].opts.properties?.click_count, 6);
});

test('burst: a >1000 ms gap splits the candidate (2 + 2 never merge into a burst)', () => {
	const h = harness();
	h.det.onActivation(act(0, 100, 100));
	h.det.onActivation(act(300, 100, 100));
	h.det.onActivation(act(1400, 100, 100)); // gap 1100 → new candidate
	h.det.onActivation(act(1600, 100, 100));
	h.fireTimers();
	h.det.finalizeConfirmed();
	assert.equal(h.emitted.length, 0);
});

test('burst: exactly-1000 ms gaps still chain (3 clicks may span ~2 s)', () => {
	const h = harness();
	h.det.onActivation(act(0, 100, 100));
	h.det.onActivation(act(1000, 100, 100));
	h.det.onActivation(act(2000, 100, 100));
	h.fireTimers();
	assert.equal(h.emitted.length, 1);
	assert.equal(h.emitted[0].opts.properties?.duration_ms, 2000);
});

test('burst: an activation outside the radius terminates the burst and seeds a new candidate', () => {
	const h = harness();
	h.det.onActivation(act(0, 100, 100));
	h.det.onActivation(act(100, 100, 100));
	h.det.onActivation(act(200, 100, 100)); // confirmed (3)
	h.det.onActivation(act(300, 300, 300)); // outside → ends burst (3), seeds new
	h.det.onActivation(act(400, 300, 300));
	assert.equal(h.emitted.length, 1);
	assert.equal(h.emitted[0].opts.properties?.click_count, 3);
	h.det.onActivation(act(500, 300, 300)); // third at the new place → confirmed
	h.fireTimers();
	assert.equal(h.emitted.length, 2);
	assert.equal(h.emitted[1].opts.properties?.click_count, 3);
});

test('burst: fine pointers use a 40 px radius, coarse/touch 60 px', () => {
	const fine = harness();
	fine.det.onActivation(act(0, 0, 0));
	fine.det.onActivation(act(100, 39, 0));
	fine.det.onActivation(act(200, 0, 39));
	fine.fireTimers();
	assert.equal(fine.emitted.length, 1, '39 px is inside 40');
	const fine2 = harness();
	fine2.det.onActivation(act(0, 0, 0));
	fine2.det.onActivation(act(100, 0, 0));
	fine2.det.onActivation(act(200, 0, 0));
	fine2.det.onActivation(act(300, 41, 0)); // outside 40 → ends at count 3
	assert.equal(fine2.emitted[0].opts.properties?.click_count, 3);
	assert.equal(BURST.FINE_RADIUS_PX, 40);

	const touch = harness();
	touch.det.onActivation(act(0, 0, 0, { pointerType: 'touch' }));
	touch.det.onActivation(act(100, 55, 0, { pointerType: 'touch' }));
	touch.det.onActivation(act(200, 0, 55, { pointerType: 'touch' }));
	touch.fireTimers();
	assert.equal(touch.emitted.length, 1, '55 px is inside touch 60');
	const touch2 = harness();
	touch2.det.onActivation(act(0, 0, 0, { pointerType: 'touch' }));
	touch2.det.onActivation(act(100, 0, 0, { pointerType: 'touch' }));
	touch2.det.onActivation(act(200, 0, 0, { pointerType: 'touch' }));
	touch2.det.onActivation(act(300, 61, 0, { pointerType: 'touch' }));
	assert.equal(touch2.emitted[0].opts.properties?.click_count, 3);
	assert.equal(BURST.COARSE_RADIUS_PX, 60);
});

test('burst: anchored to the FIRST activation — a drifting chain does not stay one burst', () => {
	const h = harness();
	// each step is 30 px (< 40) from the previous, but the 3rd is 60 px from the anchor.
	h.det.onActivation(act(0, 0, 0));
	h.det.onActivation(act(100, 30, 0));
	h.det.onActivation(act(200, 60, 0)); // outside anchor radius → terminates, seeds new
	h.fireTimers();
	h.det.finalizeConfirmed();
	assert.equal(h.emitted.length, 0, 'never confirmed: drift is not chained');
});

test('burst: hard caps — 30 activations end immediately; >10 s duration ends and reseeds', () => {
	const h = harness();
	for (let i = 0; i < 30; i++) h.det.onActivation(act(i * 100, 10, 10));
	assert.equal(h.emitted.length, 1);
	assert.equal(h.emitted[0].opts.properties?.click_count, 30);

	const d = harness();
	for (let i = 0; i < 12; i++) d.det.onActivation(act(i * 950, 10, 10)); // gaps < 1000 but total > 10 s
	d.fireTimers();
	assert.ok(d.emitted.length >= 1);
	for (const e of d.emitted) assert.ok((e.opts.properties?.duration_ms as number) <= BURST.MAX_DURATION_MS);
});

test('burst: per-session safety cap bounds emitted bursts', () => {
	const h = harness();
	let t = 0;
	for (let b = 0; b < BURST.MAX_PER_SESSION + 5; b++) {
		for (let i = 0; i < 3; i++) h.det.onActivation(act((t += 100), 10, 10));
		t += 5000;
	}
	h.fireTimers();
	h.det.finalizeConfirmed();
	assert.equal(h.emitted.length, BURST.MAX_PER_SESSION);
});

// ---- burst: lifecycle -----------------------------------------------------------

test('lifecycle: a confirmed burst is finalised immediately (count so far), without waiting for idle', () => {
	const h = harness();
	h.det.onActivation(act(0, 5, 5));
	h.det.onActivation(act(100, 5, 5));
	h.det.onActivation(act(200, 5, 5));
	assert.equal(h.pending(), 1, 'idle timer is armed');
	h.det.finalizeConfirmed(); // pagehide / hidden
	assert.equal(h.emitted.length, 1);
	assert.equal(h.emitted[0].opts.properties?.click_count, 3);
	assert.equal(h.pending(), 0, 'timer cleared');
});

test('lifecycle: hidden then pagehide (and a late idle timer) never double-emit', () => {
	const h = harness();
	for (let i = 0; i < 4; i++) h.det.onActivation(act(i * 100, 5, 5));
	h.det.finalizeConfirmed(); // visibilitychange → hidden
	h.det.finalizeConfirmed(); // pagehide
	h.fireTimers();
	assert.equal(h.emitted.length, 1);
	assert.equal(h.emitted[0].opts.properties?.click_count, 4);
});

test('lifecycle: hidden with only 1–2 activations does not promote them to a burst', () => {
	for (const n of [1, 2]) {
		const h = harness();
		for (let i = 0; i < n; i++) h.det.onActivation(act(i * 100, 5, 5));
		h.det.finalizeConfirmed();
		h.fireTimers();
		assert.equal(h.emitted.length, 0);
	}
});

test('lifecycle: after finalisation a fresh burst starts cleanly (no leaked state)', () => {
	const h = harness();
	for (let i = 0; i < 3; i++) h.det.onActivation(act(i * 100, 5, 5));
	h.det.finalizeConfirmed();
	for (let i = 0; i < 3; i++) h.det.onActivation(act(10_000 + i * 100, 5, 5));
	h.det.finalizeConfirmed();
	assert.equal(h.emitted.length, 2);
});

test('lifecycle ordering: client.ts finalises the burst after visibility.materialize and before the transport flush', () => {
	const src = readFileSync(new URL('../client.ts', import.meta.url), 'utf8');
	const body = src.slice(src.indexOf('safeFlush = (lifecycle'));
	const iMat = body.indexOf('visibility.materialize()');
	const iBurst = body.indexOf('interactions.finalizeConfirmed()');
	const iFlush = body.indexOf('transport.flush(');
	assert.ok(iMat >= 0 && iBurst > iMat && iFlush > iBurst, 'order: materialize → burst finalise → flush');
	assert.match(body.slice(0, iBurst), /if \(lifecycle\) \{\s*(\/\/[^\n]*\n\s*)*try \{\s*$/m);
});

// ---- burst: triple-click suppression ------------------------------------------

test('triple-click selection: exactly 3, tight, fast, on text → suppressed', () => {
	const h = harness();
	for (let i = 0; i < 3; i++) h.det.onActivation(act(i * 150, 200 + i, 200, { textLike: true }));
	h.fireTimers();
	assert.equal(h.emitted.length, 0);
});

test('triple activation on a real control is NOT suppressed', () => {
	const h = harness();
	for (let i = 0; i < 3; i++) h.det.onActivation(act(i * 150, 200, 200, { interactive: true, textLike: false }));
	h.fireTimers();
	assert.equal(h.emitted.length, 1);
});

test('triple-click heuristic is narrow: 4 activations, slower, or wider are not suppressed', () => {
	const four = harness();
	for (let i = 0; i < 4; i++) four.det.onActivation(act(i * 100, 200, 200, { textLike: true }));
	four.fireTimers();
	assert.equal(four.emitted.length, 1);

	const slow = harness();
	for (let i = 0; i < 3; i++) slow.det.onActivation(act(i * 400, 200, 200, { textLike: true })); // 800 ms
	slow.fireTimers();
	assert.equal(slow.emitted.length, 1);

	const wide = harness();
	for (let i = 0; i < 3; i++) wide.det.onActivation(act(i * 100, 200 + i * 6, 200, { textLike: true })); // 12 px
	wide.fireTimers();
	assert.equal(wide.emitted.length, 1);

	const affordance = harness(); // known semantic affordances are not "plain text"
	for (let i = 0; i < 3; i++) affordance.det.onActivation(act(i * 100, 200, 200, { textLike: false }));
	affordance.fireTimers();
	assert.equal(affordance.emitted.length, 1);
});

test('rapid exit of a suppressible triple-click-selection still emits nothing', () => {
	const h = harness();
	for (let i = 0; i < 3; i++) h.det.onActivation(act(i * 100, 9, 9, { textLike: true }));
	h.det.finalizeConfirmed();
	assert.equal(h.emitted.length, 0);
});

// ---- burst: context payload -----------------------------------------------------

test('burst payload: same semantic target → target_type/id, distinct_targets 1, interactive class', () => {
	const h = harness();
	const s = { type: 'skill', id: 'gameplay' };
	for (let i = 0; i < 3; i++) h.det.onActivation(act(i * 100, 100, 100, { semantic: s, interactive: true, viewInstanceId: 'view-instance-1' }));
	h.det.finalizeConfirmed();
	const e = h.emitted[0].opts;
	assert.equal(e.target_type, 'skill');
	assert.equal(e.target_id, 'gameplay');
	assert.equal(e.view_instance_id, 'view-instance-1');
	assert.equal(e.properties?.distinct_targets, 1);
	assert.equal(e.properties?.unresolved_clicks, 0);
	assert.equal(e.properties?.target_class, 'interactive');
	assert.equal(e.properties?.center_x_ratio, 0.1);
	assert.equal(e.properties?.center_y_ratio, 0.13);
	assert.equal(e.properties?.spread_px, 0);
	assert.ok(!('x_ratio' in (e.properties ?? {})) && !('y_ratio' in (e.properties ?? {})), 'old ambiguous names are gone');
	assert.equal(e.properties?.pointer_type, 'mouse');
});

test('burst payload: mixed semantic targets → no target_*, distinct_targets counted', () => {
	const h = harness();
	h.det.onActivation(act(0, 100, 100, { semantic: { type: 'skill', id: 'ai' }, interactive: true }));
	h.det.onActivation(act(100, 105, 100, { semantic: { type: 'skill', id: 'ui' }, interactive: true }));
	h.det.onActivation(act(200, 100, 105, { semantic: { type: 'skill', id: 'ai' }, interactive: true }));
	h.det.finalizeConfirmed();
	const e = h.emitted[0].opts;
	assert.equal(e.target_type, undefined);
	assert.equal(e.target_id, undefined);
	assert.equal(e.properties?.distinct_targets, 2);
});

test('burst payload: unresolved activations are counted; all-unresolved has no target', () => {
	const h = harness();
	for (let i = 0; i < 3; i++) h.det.onActivation(act(i * 100, 100, 100));
	h.det.finalizeConfirmed();
	const e = h.emitted[0].opts;
	assert.equal(e.target_type, undefined);
	assert.equal(e.properties?.distinct_targets, 0);
	assert.equal(e.properties?.unresolved_clicks, 3);
	assert.equal(e.properties?.target_class, 'noninteractive');

	const partial = harness();
	partial.det.onActivation(act(0, 1, 1, { semantic: { type: 'person', id: 'mitko' } }));
	partial.det.onActivation(act(100, 1, 1));
	partial.det.onActivation(act(200, 1, 1, { semantic: { type: 'person', id: 'mitko' } }));
	partial.det.finalizeConfirmed();
	const p = partial.emitted[0].opts;
	assert.equal(p.target_id, 'mitko', 'all RESOLVED activations agree');
	assert.equal(p.properties?.unresolved_clicks, 1);
});

test('burst payload: target_class is interactive | noninteractive | mixed', () => {
	const mk = (flags: boolean[]) => {
		const h = harness();
		flags.forEach((f, i) => h.det.onActivation(act(i * 100, 10, 10, { interactive: f })));
		h.det.finalizeConfirmed();
		return h.emitted[0].opts.properties?.target_class;
	};
	assert.equal(mk([true, true, true]), 'interactive');
	assert.equal(mk([false, false, false]), 'noninteractive');
	assert.equal(mk([true, false, true]), 'mixed');
});

test('burst payload: spread, quantised position, region, no free-text fields, Worker-valid', () => {
	const h = harness();
	h.det.onActivation(act(0, 100, 100, { region: 'contact' }));
	h.det.onActivation(act(100, 130, 100, { region: 'timeline' }));
	h.det.onActivation(act(200, 100, 100));
	h.det.finalizeConfirmed();
	const e = h.emitted[0].opts;
	assert.equal(e.properties?.spread_px, 20, 'max distance from the centroid (110,100), not from the first click');
	assert.equal(e.properties?.region, 'contact', 'region of the first activation');
	assert.deepEqual(
		Object.keys(e.properties ?? {}).sort(),
		['center_x_ratio', 'center_y_ratio', 'click_count', 'distinct_targets', 'duration_ms', 'pointer_type', 'region', 'spread_px', 'start_elapsed_ms', 'target_class', 'unresolved_clicks'],
	);
	workerAccepts([['click_burst', e]]);
});

// ---- burst: centroid + spread reporting -----------------------------------------

function burstOf(points: [number, number][], over: Partial<BurstActivation> = {}, vp = { width: 1000, height: 800 }) {
	const emitted: EmitOptions[] = [];
	const det = new BurstDetector({
		toElapsed: (t) => Math.round(t),
		emit: (_t, opts) => emitted.push(opts),
		setTimer: () => 0,
		clearTimer: () => {},
		viewport: () => vp,
	});
	points.forEach(([x, y], i) => det.onActivation(act(i * 100, x, y, over)));
	det.finalizeConfirmed();
	return emitted[0]?.properties;
}

test('centroid: identical points → centroid at that point, spread 0', () => {
	const p = burstOf([[500, 400], [500, 400], [500, 400]]);
	assert.equal(p?.center_x_ratio, 0.5);
	assert.equal(p?.center_y_ratio, 0.5);
	assert.equal(p?.spread_px, 0);
});

test('centroid: symmetric points → the middle; spread is the distance to the farthest point', () => {
	const p = burstOf([[480, 400], [520, 400], [500, 380], [500, 420]]);
	assert.equal(p?.center_x_ratio, 0.5);
	assert.equal(p?.center_y_ratio, 0.5);
	assert.equal(p?.spread_px, 20);
});

test('centroid: asymmetric cluster → arithmetic mean; spread = max distance from the centroid (not first-click, bbox or pairwise)', () => {
	// points (100,100) (100,100) (130,100) (100,140): centroid (107.5, 110)
	const p = burstOf([[100, 100], [100, 100], [130, 100], [100, 140]]);
	assert.equal(p?.center_x_ratio, 0.11); // 107.5/1000 = 0.1075 → 0.11
	assert.equal(p?.center_y_ratio, 0.14); // 110/800 = 0.1375 → 0.14
	// distances from (107.5,110): 12.5, 12.5, 24.6, 30.9 → 31
	assert.equal(p?.spread_px, 31);
	// NOT: max from first click = 40; bounding-box width 30; pairwise max 50
});

test('centroid: reporting does not change first-click-anchored qualification', () => {
	// two points 30 px either side of the first click: 60 px apart from each other and
	// the centroid, yet each is inside the 40 px anchor radius → one 3-click burst.
	const inside = burstOf([[500, 400], [470, 400], [530, 400]]);
	assert.equal(inside?.click_count, 3);
	// a 4th click 41 px from the first is outside the anchor radius and never joins the
	// burst, so it cannot influence the summary.
	const emitted: EmitOptions[] = [];
	const det = new BurstDetector({ toElapsed: (t) => t, emit: (_t, o) => emitted.push(o), setTimer: () => 0, clearTimer: () => {}, viewport: () => ({ width: 1000, height: 800 }) });
	det.onActivation(act(0, 0, 0));
	det.onActivation(act(100, 0, 0));
	det.onActivation(act(200, 0, 0));
	det.onActivation(act(300, 41, 0));
	assert.equal(emitted[0].properties?.click_count, 3);
	assert.equal(emitted[0].properties?.spread_px, 0);
});

test('centroid: rapid-exit finalisation summarises every activation accumulated so far', () => {
	const h = harness();
	h.det.onActivation(act(0, 100, 100));
	h.det.onActivation(act(100, 120, 100));
	h.det.onActivation(act(200, 140, 100)); // confirmed, still waiting on the idle timer
	h.det.finalizeConfirmed(); // pagehide
	const p = h.emitted[0].opts.properties;
	assert.equal(p?.click_count, 3);
	assert.equal(p?.center_x_ratio, 0.12); // centroid x = 120
	assert.equal(p?.center_y_ratio, 0.13); // 100/800 = 0.125 → 0.13
	assert.equal(p?.spread_px, 20);
	assert.ok(!('x_ratio' in (p ?? {})));
});

// ---- activation filter ----------------------------------------------------------

const ptr = (o: Partial<RawPointerEvent> = {}): RawPointerEvent => ({
	isTrusted: true,
	pointerId: 1,
	pointerType: 'mouse',
	isPrimary: true,
	button: 0,
	clientX: 100,
	clientY: 100,
	timeStamp: 10,
	...o,
});

test('activation: a still primary press/release qualifies and carries a real pointer type only', () => {
	const f = new ActivationFilter();
	f.down(ptr());
	assert.deepEqual(f.up(ptr({ timeStamp: 50 })), { t: 50, x: 100, y: 100, pointerType: 'mouse' });
	f.down(ptr({ pointerType: '' }));
	assert.equal(f.up(ptr({ pointerType: '' }))?.pointerType, undefined);
});

test('activation: drag / scroll / text-selection movement (> 10 px) is not an activation', () => {
	const f = new ActivationFilter();
	f.down(ptr());
	assert.equal(f.up(ptr({ clientX: 111 })), null);
	f.down(ptr());
	assert.ok(f.up(ptr({ clientX: 110 })), '10 px exactly is still an activation');
});

test('activation: pointercancel, synthetic, secondary button, non-primary and keyboard are excluded', () => {
	const f = new ActivationFilter();
	f.down(ptr());
	f.cancel({ pointerId: 1 });
	assert.equal(f.up(ptr()), null, 'cancelled (browser took over scroll)');
	f.down(ptr({ isTrusted: false }));
	assert.equal(f.up(ptr({ isTrusted: false })), null, 'untrusted / synthetic');
	f.down(ptr({ button: 2 }));
	assert.equal(f.up(ptr({ button: 2 })), null, 'right button');
	f.down(ptr({ button: 1 }));
	assert.equal(f.up(ptr({ button: 1 })), null, 'middle button');
	f.down(ptr({ isPrimary: false }));
	assert.equal(f.up(ptr({ isPrimary: false })), null, 'second finger');
	f.down(ptr({ ctrlKey: true }));
	assert.equal(f.up(ptr({ ctrlKey: true })), null, 'ctrl+click (mac context menu)');
	assert.equal(f.up(ptr()), null, 'an up with no matching down (keyboard clicks produce no pointer events)');
});

// ---- resolver -------------------------------------------------------------------

/** A miniature page: navbar, person-bar card, timeline row with modal, filtered card. */
function page() {
	const body = el('body');
	const section = el('section', { id: 'timeline' }, body);
	const row = el('div', { cls: 'project-row', attrs: { 'data-visibility-target-type': 'timeline_project', 'data-visibility-target-id': 'heroes6' } }, section);
	const rowOpen = el('button', { cls: 'row-open', attrs: { 'data-project-open': 'tl-heroes6' } }, row);
	const card = el('div', { cls: 'card', attrs: { 'data-person': 'mitko', 'data-visibility-target-type': 'project_content', 'data-visibility-target-id': 'heroes6:mitko-heroes6' } }, row);
	const para = el('p', {}, el('div', { cls: 'content' }, card));

	const dialog = el('dialog', { cls: 'project-modal', attrs: { 'data-project-modal': 'tl-heroes6', 'data-project-id': 'heroes6' } }, body);
	const panel = el('div', { cls: 'project-modal__panel' }, dialog);
	const tags = el('ul', { cls: 'project-modal__tags' }, panel);
	const pill = el('li', { cls: 'tag', attrs: { 'data-tag-id': 'gameplay' } }, tags);
	const logo = el('img', { cls: 'project-modal__logo', attrs: { 'data-partner-logo': 'riot-games' } }, panel);
	const shot = el('figure', { cls: 'shot', attrs: { 'data-visibility-target-type': 'project_content', 'data-visibility-target-id': 'heroes6-map', 'data-visibility-content-type': 'image' } }, panel);
	const img = el('img', {}, el('div', { cls: 'shot-frame' }, shot));
	const caption = el('figcaption', {}, shot);
	const vidShot = el('figure', { cls: 'shot', attrs: { 'data-visibility-target-type': 'project_content', 'data-visibility-target-id': 'heroes6-clip', 'data-visibility-content-type': 'video' } }, panel);
	const video = el('video', { attrs: { controls: '' } }, el('div', { cls: 'shot-frame' }, vidShot));
	const chip = el('a', { cls: 'project-link-chip', attrs: { href: 'https://example.invalid', 'data-external-link-type': 'official_site', 'data-project-id': 'heroes6' } }, panel);

	const bar = el('div', { id: 'person-bar' }, body);
	const side = el('div', { cls: 'side-panel', attrs: { 'data-person': 'adam' } }, bar);
	const header = el('div', { cls: 'person-header' }, side);
	const stack = el('div', { cls: 'side-panel-stack', attrs: { 'data-visibility-target-type': 'skills_person', 'data-visibility-target-id': 'adam' } }, side);
	const skillBtn = el('button', { cls: 'tag tag--linked', attrs: { 'data-tag-id': 'ai' } }, stack);
	const unlinked = el('span', { cls: 'tag', attrs: { 'data-tag-id': 'balance' } }, stack);
	const cv = el('a', { cls: 'cv-download', attrs: { href: '/cv.pdf' } }, side);
	const cvLabel = el('span', {}, cv);

	const frResults = el('div', { id: 'filter-results' }, body);
	const fr = el('article', { cls: 'fr-card', attrs: { 'data-fr-card': '', 'data-visibility-target-type': 'filtered_project', 'data-visibility-target-id': 'supernova' } }, frResults);
	const frHead = el('header', { cls: 'project-modal__head' }, fr);
	const frTitle = el('h4', {}, frHead);
	const frBody = el('div', { cls: 'project-modal__body' }, fr);
	const frProse = el('p', {}, el('div', { cls: 'modal-exp', attrs: { 'data-person': 'adam' } }, frBody));

	const staticRow = el('div', { attrs: { 'data-visibility-target-type': 'timeline_project', 'data-visibility-target-id': 'ericsson-consulting' } }, section);
	const staticCard = el('div', { cls: 'card card--static', attrs: { 'data-static-card': 'true', 'data-visibility-target-type': 'project_content', 'data-visibility-target-id': 'ericsson-consulting:mitko-ericsson' } }, staticRow);
	const staticContent = el('div', { cls: 'content' }, staticCard);
	const staticProse = el('p', {}, staticContent);

	const titlePill = el('span', { cls: 'title-toggle', attrs: { 'data-section-title': 'timeline' } }, el('h2', {}, section));
	const nav = el('header', { cls: 'navbar' }, body);
	const navLink = el('a', { attrs: { href: '#contact' } }, nav);
	const backdrop = el('div', { cls: 'filter-backdrop' }, body);
	const email = el('button', { cls: 'email-copy-btn', attrs: { 'data-email': 'x' } }, el('div', { cls: 'contact-pill contact-email-pill' }, el('section', { id: 'contact' }, body)));
	return { body, row, rowOpen, para, dialog, pill, logo, img, caption, video, chip, header, stack, skillBtn, unlinked, cv, cvLabel, fr, frHead, frTitle, frProse, frBody, staticCard, staticContent, staticProse, titlePill, navLink, backdrop, email, panel };
}

test('resolver: canonical identity comes from existing stable attributes, innermost first', () => {
	const p = page();
	assert.deepEqual(resolve(p.rowOpen, 'main')?.semantic, { type: 'timeline_project', id: 'heroes6' });
	assert.deepEqual(resolve(p.para, 'main')?.semantic, { type: 'project_content', id: 'heroes6:mitko-heroes6' });
	assert.deepEqual(resolve(p.pill, 'project_modal')?.semantic, { type: 'skill', id: 'gameplay' });
	assert.deepEqual(resolve(p.cvLabel, 'main')?.semantic, { type: 'person', id: 'adam' });
	assert.deepEqual(resolve(p.navLink, 'main')?.semantic, { type: 'navbar', id: 'contact' });
	assert.deepEqual(resolve(p.chip, 'project_modal')?.semantic, { type: 'project', id: 'heroes6' });
	assert.deepEqual(resolve(p.email, 'main')?.semantic, { type: 'company', id: 'mentor-game-studio' });
	assert.deepEqual(resolve(p.frProse, 'skill_filtered')?.semantic, { type: 'person', id: 'adam' });
	for (const t of [p.rowOpen, p.pill, p.cv, p.dialog]) {
		const s = resolve(t, 'main')?.semantic;
		assert.ok(!s || !s.id.startsWith('tl-'), 'never a presentation id');
	}
});

test('resolver: regions are a closed enum', () => {
	const p = page();
	assert.equal(resolve(p.navLink, 'main')?.region, 'navbar');
	assert.equal(resolve(p.para, 'main')?.region, 'timeline');
	assert.equal(resolve(p.pill, 'project_modal')?.region, 'project_modal');
	assert.equal(resolve(p.header, 'main')?.region, 'person_bar');
	assert.equal(resolve(p.frProse, 'skill_filtered')?.region, 'skill_filtered');
	assert.equal(resolve(p.email, 'main')?.region, 'contact');
	assert.equal(resolve(el('div'), 'main')?.region, 'other');
	assert.equal(resolve(el('div'), 'project_modal')?.region, 'project_modal', 'falls back to semantic state');
});

test('classification: controls and known dismiss surfaces are interactive; prose is not', () => {
	const p = page();
	assert.equal(resolve(p.rowOpen, 'main')?.interactive, true);
	assert.equal(resolve(p.cvLabel, 'main')?.interactive, true, 'child of an anchor');
	assert.equal(resolve(p.skillBtn, 'main')?.interactive, true);
	assert.equal(resolve(p.video, 'project_modal')?.interactive, true, 'controlled video');
	assert.equal(resolve(p.backdrop, 'main')?.interactive, true, 'delegated dismiss surface');
	assert.equal(resolve(p.dialog, 'project_modal')?.interactive, true, 'dialog itself == backdrop click');
	assert.equal(resolve(p.para, 'main')?.interactive, false);
	assert.equal(resolve(p.pill, 'project_modal')?.interactive, false);
	assert.equal(resolve(el('div', { attrs: { role: 'button' } }), 'main')?.interactive, true);
	assert.equal(resolve(el('div', { attrs: { tabindex: '0' } }), 'main')?.interactive, true);
	assert.equal(resolve(el('div', { attrs: { tabindex: '-1' } }), 'main')?.interactive, false);
});

// ---- noninteractive_click allowlist ----------------------------------------------

const hit = (t: ElementLike, surface = 'main', pt?: string) => resolve(t, surface, pt)?.noninteractive ?? null;

test('noninteractive: modal tag pill → canonical tag id + project context', () => {
	const p = page();
	assert.deepEqual(hit(p.pill, 'project_modal'), { type: 'skill', id: 'gameplay', element: 'tag_pill', projectId: 'heroes6' });
});

test('noninteractive: unlinked skill tag (span in the Skills panel) but never the linked button', () => {
	const p = page();
	assert.deepEqual(hit(p.unlinked), { type: 'skill', id: 'balance', element: 'unlinked_skill_tag' });
	assert.equal(hit(p.skillBtn), null);
});

test('noninteractive: gallery image frames only — not captions, not controlled video', () => {
	const p = page();
	assert.deepEqual(hit(p.img, 'project_modal'), { type: 'project_content', id: 'heroes6-map', element: 'gallery_media', projectId: 'heroes6' });
	assert.equal(hit(p.caption, 'project_modal'), null, 'caption is prose');
	assert.equal(hit(p.video, 'project_modal'), null, 'video controls are interactive');
});

test('noninteractive: partner logo emits the canonical LOGO id (not the project id); project context is separate', () => {
	const p = page();
	assert.deepEqual(hit(p.logo, 'project_modal'), { type: 'partner_logo', id: 'riot-games', element: 'partner_logo', projectId: 'heroes6' });
});

test('noninteractive: section title pill', () => {
	const p = page();
	assert.deepEqual(hit(p.titlePill), { type: 'section', id: 'timeline', element: 'section_title' });
});

test('noninteractive: static project card box/content only — not the prose inside', () => {
	const p = page();
	const want = { type: 'timeline_project', id: 'ericsson-consulting', element: 'static_project_card' };
	assert.deepEqual(hit(p.staticCard), want);
	assert.deepEqual(hit(p.staticContent), want);
	assert.equal(hit(p.staticProse), null);
	assert.equal(hit(p.para), null, 'ordinary (interactive-row) prose never emits');
});

test('noninteractive: filtered card chrome (card box + header) but not prose or the project link chip', () => {
	const p = page();
	assert.deepEqual(hit(p.fr, 'skill_filtered'), { type: 'filtered_project', id: 'supernova', element: 'filtered_card' });
	assert.equal(hit(p.frHead, 'skill_filtered')?.element, 'filtered_card');
	assert.equal(hit(p.frTitle, 'skill_filtered')?.element, 'filtered_card');
	assert.equal(hit(p.frProse, 'skill_filtered'), null, 'prose is not tracked');
	assert.equal(hit(p.frBody, 'skill_filtered')?.element, 'filtered_card', 'the body container itself is spacing/chrome');
	assert.equal(hit(p.chip, 'skill_filtered'), null, 'a real control inside a tracked container');
});

test('noninteractive: person card body only for touch, never controls or Skills content', () => {
	const p = page();
	assert.deepEqual(hit(p.header, 'main', 'touch'), { type: 'person', id: 'adam', element: 'person_card' });
	assert.equal(hit(p.header, 'main', 'mouse'), null);
	assert.equal(hit(p.header, 'main', undefined), null);
	assert.equal(hit(p.cvLabel, 'main', 'touch'), null, 'CV control');
	assert.equal(hit(p.stack, 'main', 'touch'), null, 'Skills content');
});

test('noninteractive: ordinary prose, timeline geometry and backdrops never emit', () => {
	const p = page();
	for (const t of [p.para, el('div', { cls: 'track-connector' }), p.backdrop, p.dialog, p.navLink, p.rowOpen]) {
		assert.equal(hit(t), null);
	}
});

// ---- context_menu ------------------------------------------------------------------

test('context menu: meaningful semantic targets resolve; prose/background do not', () => {
	const p = page();
	assert.deepEqual(resolveContext(p.email), { type: 'company', id: 'mentor-game-studio', element: 'company_email' });
	assert.deepEqual(resolveContext(p.cvLabel), { type: 'person', id: 'adam', element: 'cv' });
	assert.deepEqual(resolveContext(p.chip), { type: 'project', id: 'heroes6', element: 'project_link', properties: { destination_type: 'official_site' } });
	assert.deepEqual(resolveContext(p.skillBtn), { type: 'skill', id: 'ai', element: 'skill_tag' });
	assert.deepEqual(resolveContext(p.pill), { type: 'skill', id: 'gameplay', element: 'skill_tag' });
	assert.deepEqual(resolveContext(p.img), { type: 'project_content', id: 'heroes6-map', element: 'media', properties: { content_type: 'image' } });
	assert.equal(resolveContext(p.para), null);
	assert.equal(resolveContext(p.frProse), null);
	assert.equal(resolveContext(p.body), null);
	assert.equal(resolveContext(null), null);
});

// ---- wiring (fake window) -----------------------------------------------------------

function wired(state = { surface: 'main', viewInstanceId: null as string | null }) {
	const listeners: Record<string, ((e: any) => void)[]> = {};
	const emitted: { type: string; opts?: EmitOptions }[] = [];
	const h = harness();
	const cap = startInteractionCapture({
		target: { addEventListener: (t, fn) => void (listeners[t] ??= []).push(fn) },
		emit: (type, opts) => emitted.push({ type, opts }),
		getState: () => state,
		toElapsed: (t) => Math.round(t),
		setTimer: (fn, ms) => setTimeout(fn, ms),
		clearTimer: (h2) => clearTimeout(h2 as ReturnType<typeof setTimeout>),
		viewport: () => ({ width: 1000, height: 800 }),
	});
	const fire = (type: string, e: any) => listeners[type]?.forEach((fn) => fn(e));
	const tap = (target: ElementLike, t: number, over: Partial<RawPointerEvent> = {}) => {
		fire('pointerdown', ptr({ timeStamp: t, ...over }));
		fire('pointerup', { ...ptr({ timeStamp: t + 5, ...over }), target });
	};
	void h;
	return { cap, emitted, fire, tap, listeners };
}

test('wiring: all listeners are capture + passive', () => {
	const opts: unknown[] = [];
	startInteractionCapture({
		target: { addEventListener: (_t, _fn, o) => void opts.push(o) },
		emit: () => {},
		getState: () => ({ surface: 'main', viewInstanceId: null }),
		toElapsed: (t) => t,
		setTimer: () => 0,
		clearTimer: () => {},
		viewport: () => ({ width: 1, height: 1 }),
	});
	assert.equal(opts.length, 4);
	for (const o of opts) assert.deepEqual(o, { capture: true, passive: true });
});

test('wiring: one allowlisted activation → one noninteractive_click immediately, no global click row', () => {
	const p = page();
	const w = wired({ surface: 'project_modal', viewInstanceId: 'modal-view-01' });
	w.tap(p.pill, 100);
	assert.equal(w.emitted.length, 1);
	assert.equal(w.emitted[0].type, 'noninteractive_click');
	assert.equal(w.emitted[0].opts?.target_type, 'skill');
	assert.equal(w.emitted[0].opts?.target_id, 'gameplay');
	assert.equal(w.emitted[0].opts?.view_instance_id, 'modal-view-01');
	assert.deepEqual(w.emitted[0].opts?.properties, { element: 'tag_pill', project_id: 'heroes6', pointer_type: 'mouse' });
});

test('wiring: prose and controls emit nothing individually (ordinary clicks are never sent)', () => {
	const p = page();
	const w = wired();
	w.tap(p.para, 100);
	w.tap(p.skillBtn, 700);
	w.tap(p.body, 1400);
	assert.equal(w.emitted.length, 0);
});

test('wiring: untracked-area triple activation → exactly one click_burst (finalised on lifecycle), not three rows', () => {
	const p = page();
	const w = wired();
	// interactive-free but NOT text (an image): not a triple-click selection
	for (let i = 0; i < 3; i++) w.tap(p.img, 1000 + i * 150);
	assert.equal(w.emitted.filter((e) => e.type === 'click_burst').length, 0, 'nothing before the end');
	w.cap.finalizeConfirmed();
	w.cap.finalizeConfirmed();
	const bursts = w.emitted.filter((e) => e.type === 'click_burst');
	assert.equal(bursts.length, 1);
	assert.equal(bursts[0].opts?.properties?.click_count, 3);
	assert.equal(w.emitted.filter((e) => e.type === 'noninteractive_click').length, 3, 'allowlisted image taps are their own individual events');
});

test('wiring: rapid activation of a real control → click_burst with interactive class', () => {
	const p = page();
	const w = wired();
	for (let i = 0; i < 4; i++) w.tap(p.skillBtn, 1000 + i * 120);
	w.cap.finalizeConfirmed();
	const b = w.emitted.find((e) => e.type === 'click_burst');
	assert.equal(b?.opts?.properties?.target_class, 'interactive');
	assert.equal(b?.opts?.target_id, 'ai');
	assert.equal(b?.opts?.properties?.click_count, 4);
});

test('wiring: drag between down and up, and synthetic events, never count', () => {
	const p = page();
	const w = wired();
	for (let i = 0; i < 4; i++) {
		w.fire('pointerdown', ptr({ timeStamp: i * 100 }));
		w.fire('pointerup', { ...ptr({ timeStamp: i * 100 + 5, clientX: 160 }), target: p.img });
	}
	for (let i = 0; i < 4; i++) w.tap(p.img, 1000 + i * 100, { isTrusted: false });
	w.cap.finalizeConfirmed();
	assert.equal(w.emitted.length, 0);
});

test('wiring: rapid exit with 3 activations emits the burst; 2 do not', () => {
	const p = page();
	const three = wired();
	for (let i = 0; i < 3; i++) three.tap(p.img, i * 100);
	three.cap.finalizeConfirmed();
	assert.equal(three.emitted.filter((e) => e.type === 'click_burst').length, 1);
	const two = wired();
	for (let i = 0; i < 2; i++) two.tap(p.img, i * 100);
	two.cap.finalizeConfirmed();
	assert.equal(two.emitted.filter((e) => e.type === 'click_burst').length, 0);
});

test('wiring: context menu emits on a meaningful target only; pointer type is never guessed', () => {
	const p = page();
	const w = wired({ surface: 'project_modal', viewInstanceId: 'modal-view-02' });
	w.fire('contextmenu', { target: p.chip, pointerType: 'mouse' });
	w.fire('contextmenu', { target: p.email }); // keyboard / unknown pointer
	w.fire('contextmenu', { target: p.email, pointerType: '' });
	w.fire('contextmenu', { target: p.para, pointerType: 'mouse' }); // prose
	w.fire('contextmenu', { target: p.body, pointerType: 'mouse' }); // background
	assert.equal(w.emitted.length, 3);
	assert.deepEqual(w.emitted[0].opts?.properties, { element: 'project_link', destination_type: 'official_site', pointer_type: 'mouse' });
	assert.equal(w.emitted[0].opts?.view_instance_id, 'modal-view-02');
	assert.deepEqual(w.emitted[1].opts?.properties, { element: 'company_email' }, 'unknown pointer stays unknown');
	assert.deepEqual(w.emitted[2].opts?.properties, { element: 'company_email' });
	for (const e of w.emitted) {
		assert.equal(e.type, 'context_menu');
		assert.ok(!JSON.stringify(e.opts).match(/copy|open|save/i), 'no inference about the chosen command');
	}
});

// ---- action_failed / copy / project open --------------------------------------------

const okClipboard = { writeText: async () => {} };
const denied = { writeText: async () => Promise.reject(Object.assign(new Error('secret message'), { name: 'NotAllowedError' })) };
const broken = { writeText: async () => Promise.reject(new Error('boom')) };

test('copy: primary API success → ok, fallback never consulted', async () => {
	let legacy = 0;
	const r = await copyText('a', { clipboard: okClipboard, legacyCopy: () => (legacy++, false) });
	assert.deepEqual(r, { ok: true });
	assert.equal(legacy, 0);
});

test('copy: primary rejected but fallback succeeds → success (no failure)', async () => {
	const r = await copyText('a', { clipboard: denied, legacyCopy: () => true });
	assert.deepEqual(r, { ok: true });
});

test('copy: every mechanism fails → closed reason enum, never an exception message', async () => {
	assert.deepEqual(await copyText('a', { clipboard: denied, legacyCopy: () => false }), { ok: false, reason: 'clipboard_denied' });
	assert.deepEqual(await copyText('a', { clipboard: broken, legacyCopy: () => false }), { ok: false, reason: 'copy_failed' });
	assert.deepEqual(await copyText('a', { clipboard: undefined, legacyCopy: () => false }), { ok: false, reason: 'clipboard_unavailable' });
	assert.deepEqual(await copyText('a', { clipboard: {}, legacyCopy: () => { throw new Error('x'); } }), { ok: false, reason: 'clipboard_unavailable' });
	assert.deepEqual(await copyText('a', { clipboard: undefined, legacyCopy: () => true }), { ok: true });
});

test('copy feedback: a failed copy never runs the success (checkmark) callback, success never runs failure', async () => {
	const calls: string[] = [];
	await copyWithFeedback('a', { clipboard: denied, legacyCopy: () => false }, { onSuccess: () => calls.push('success'), onFailure: (r) => calls.push(`fail:${r}`) });
	assert.deepEqual(calls, ['fail:clipboard_denied']);
	calls.length = 0;
	await copyWithFeedback('a', { clipboard: okClipboard, legacyCopy: () => false }, { onSuccess: () => calls.push('success'), onFailure: (r) => calls.push(`fail:${r}`) });
	assert.deepEqual(calls, ['success']);
});

test('action_failed payloads: closed action/reason vocabulary, canonical target, Worker-valid', () => {
	const opts = buildActionFailed('contact_email_copy', 'clipboard_denied', 'company', 'mentor-game-studio');
	assert.deepEqual(opts, { target_type: 'company', target_id: 'mentor-game-studio', properties: { action: 'contact_email_copy', reason: 'clipboard_denied' } });
	assert.equal(buildActionFailed('contact_email_copy', 'dialog_not_found', 'company', 'x'), null, 'reason must belong to the action');
	assert.equal(buildActionFailed('made_up', 'copy_failed'), null);
	assert.deepEqual(buildActionFailed('project_open', 'dialog_not_found', 'project', 'bad id!'), { properties: { action: 'project_open', reason: 'dialog_not_found' } });
	workerAccepts([
		['action_failed', opts!],
		['noninteractive_click', { target_type: 'skill', target_id: 'gameplay', properties: { element: 'tag_pill' } }],
		['context_menu', { target_type: 'company', target_id: 'mentor-game-studio', properties: { element: 'company_email' } }],
	]);
});

test('project open: missing dialog / throwing showModal → failure reasons; success and already-open are not failures', () => {
	assert.deepEqual(attemptOpenProject(null), { ok: false, reason: 'dialog_not_found' });
	assert.deepEqual(attemptOpenProject(undefined), { ok: false, reason: 'dialog_not_found' });
	const throwing = { open: false, showModal() { throw new Error('InvalidStateError'); } };
	assert.deepEqual(attemptOpenProject(throwing), { ok: false, reason: 'dialog_open_error' });
	let opened = 0;
	assert.deepEqual(attemptOpenProject({ open: false, showModal: () => void opened++ }), { ok: true });
	assert.equal(opened, 1);
	assert.deepEqual(attemptOpenProject({ open: true, showModal: () => void opened++ }), { ok: true });
	assert.equal(opened, 1, 'already open: no second showModal');
});

// ---- auxclick ----------------------------------------------------------------------

test('auxclick: only the middle button (1) is an activation; click always is', () => {
	assert.equal(isLinkActivation('click', 0), true);
	assert.equal(isLinkActivation('click', undefined), true);
	assert.equal(isLinkActivation('auxclick', 1), true);
	assert.equal(isLinkActivation('auxclick', 2), false, 'right button');
	assert.equal(isLinkActivation('auxclick', 3), false, 'back button');
	assert.equal(isLinkActivation('auxclick', 4), false, 'forward button');
	assert.equal(isLinkActivation('mouseup', 1), false);
});

test('auxclick: one physical activation → one handler call (left, middle, other buttons)', () => {
	const handlers: Record<string, (e: any) => void> = {};
	let count = 0;
	let last: { pointerType?: string } | undefined;
	onLinkActivation({ addEventListener: (t, fn) => void (handlers[t] = fn) }, (e) => {
		count++;
		last = e;
	});
	handlers.click({ button: 0, pointerType: 'mouse' }); // left click: browser fires click only
	assert.equal(count, 1);
	handlers.auxclick({ button: 1, pointerType: 'mouse' }); // middle click: auxclick only
	assert.equal(count, 2);
	assert.equal(last?.pointerType, 'mouse');
	handlers.auxclick({ button: 2 }); // right button
	handlers.auxclick({ button: 3 });
	assert.equal(count, 2);
	handlers.click({ button: 0, pointerType: '' }); // keyboard-activated
	assert.equal(count, 3);
});
