import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventQueue } from '../queue.ts';
import { Transport, buildBatch } from '../transport.ts';
import type { Fetch } from '../transport.ts';
import { buildSessionContext } from '../session.ts';
import {
	ViewportTracker,
	SETTLE_MS,
	INTERMEDIATE_INTERVAL_MS,
	MIN_CHANGE_PX,
	COARSE_HEIGHT_ONLY_MIN_CHANGE_PX,
} from '../viewport.ts';
import type { Size } from '../viewport.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';

/** Fake timers + a mutable "window size". */
function rig(initial: Size, coarsePointer = false) {
	let t = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const size = { ...initial };
	const emitted: Size[] = [];
	const tracker = new ViewportTracker(initial, {
		read: () => ({ ...size }),
		emit: (s) => emitted.push(s),
		setTimer: (fn, ms) => {
			const id = nextId++;
			timers.set(id, { at: t + ms, fn });
			return id;
		},
		clearTimer: (h) => void timers.delete(h as number),
		coarsePointer,
	});
	const advance = (ms: number) => {
		const end = t + ms;
		for (;;) {
			const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			t = due[1].at;
			timers.delete(due[0]);
			due[1].fn();
		}
		t = end;
	};
	const resizeTo = (width: number, height: number) => {
		size.width = width;
		size.height = height;
		tracker.onResize();
	};
	return { tracker, emitted, advance, resizeTo, pending: () => timers.size };
}

test('viewport: no event when dimensions are unchanged (and none on load)', () => {
	const r = rig({ width: 1200, height: 800 });
	r.advance(60_000);
	assert.equal(r.emitted.length, 0);
	r.resizeTo(1200, 800);
	r.advance(SETTLE_MS);
	assert.equal(r.emitted.length, 0);
});

test('viewport: a burst of resize callbacks coalesces into one settled event', () => {
	const r = rig({ width: 1200, height: 800 });
	for (let w = 1190; w >= 930; w -= 10) {
		r.resizeTo(w, 800);
		r.advance(16);
	}
	assert.equal(r.emitted.length, 0); // still resizing, not yet settled
	r.advance(SETTLE_MS);
	assert.deepEqual(r.emitted, [{ width: 930, height: 800 }]);
	assert.equal(r.pending(), 0);
});

test('viewport: rotation-like width/height swap is captured', () => {
	const r = rig({ width: 390, height: 844 }, true);
	r.resizeTo(844, 390);
	r.advance(SETTLE_MS);
	assert.deepEqual(r.emitted, [{ width: 844, height: 390 }]);
});

test('viewport: prolonged resizing emits sparsely, then the trailing settled size', () => {
	const r = rig({ width: 1200, height: 800 });
	let w = 1200;
	// 30 s of continuous dragging, a resize callback every 20 ms
	for (let ms = 0; ms < 30_000; ms += 20) {
		w = w <= 600 ? 1200 : w - 1;
		r.resizeTo(w, 800);
		r.advance(20);
	}
	const during = r.emitted.length;
	assert.ok(during >= 1 && during <= 30_000 / INTERMEDIATE_INTERVAL_MS, `intermediate events: ${during}`);
	r.advance(SETTLE_MS);
	assert.equal(r.emitted.length <= during + 1, true);
	assert.deepEqual(r.emitted[r.emitted.length - 1], { width: w, height: 800 });
});

test('viewport: tiny changes are ignored, small deliberate desktop resizes are kept', () => {
	const r = rig({ width: 1200, height: 800 });
	r.resizeTo(1200 + MIN_CHANGE_PX - 1, 800 - (MIN_CHANGE_PX - 1));
	r.advance(SETTLE_MS);
	assert.equal(r.emitted.length, 0);
	r.resizeTo(1200 + MIN_CHANGE_PX, 800);
	r.advance(SETTLE_MS);
	assert.equal(r.emitted.length, 1);
});

test('viewport: drift is measured against the last emitted size, not the last callback', () => {
	const r = rig({ width: 1200, height: 800 });
	r.resizeTo(1195, 800);
	r.advance(SETTLE_MS);
	r.resizeTo(1190, 800);
	r.advance(SETTLE_MS);
	r.resizeTo(1185, 800);
	r.advance(SETTLE_MS);
	assert.deepEqual(r.emitted, [{ width: 1190, height: 800 }]); // 5 px steps accumulate to 10 px once
});

test('viewport: coarse pointer ignores URL-bar-sized height-only changes but not large ones', () => {
	const r = rig({ width: 390, height: 664 }, true);
	r.resizeTo(390, 664 + 90); // URL bar collapse
	r.advance(SETTLE_MS);
	assert.equal(r.emitted.length, 0);
	r.resizeTo(390, 664 + COARSE_HEIGHT_ONLY_MIN_CHANGE_PX);
	r.advance(SETTLE_MS);
	assert.equal(r.emitted.length, 1);
	const fine = rig({ width: 1200, height: 800 }, false);
	fine.resizeTo(1200, 890);
	fine.advance(SETTLE_MS);
	assert.equal(fine.emitted.length, 1); // fine pointer: 90 px is a real resize
});

test('viewport: maximize then restore are both captured', () => {
	const r = rig({ width: 1000, height: 700 });
	r.resizeTo(1920, 1000);
	r.advance(SETTLE_MS);
	r.resizeTo(1000, 700);
	r.advance(SETTLE_MS);
	assert.deepEqual(r.emitted, [
		{ width: 1920, height: 1000 },
		{ width: 1000, height: 700 },
	]);
});

test('viewport: finalize() (lifecycle hook) emits the pending size immediately and cancels timers', () => {
	const r = rig({ width: 1200, height: 800 });
	r.resizeTo(930, 800);
	assert.equal(r.emitted.length, 0);
	r.tracker.finalize();
	assert.deepEqual(r.emitted, [{ width: 930, height: 800 }]);
	assert.equal(r.pending(), 0);
	r.advance(60_000);
	assert.equal(r.emitted.length, 1); // no duplicate from the cancelled timers
});

// ---- integration with queue / transport / Worker validator --------------

test('viewport: pending resize is queued BEFORE the lifecycle flush; only the queue touches transport', async () => {
	let clockT = 1000;
	const clk = { now: () => clockT, iso: () => '2026-09-25T10:00:00.000Z' };
	const queue = new EventQueue(clk, clk.now());
	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1200, innerHeight: 800, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: false }),
		},
		'sess-id-0009', clk.iso(),
	);
	const bodies: any[] = [];
	const send: Fetch = async (_u, init) => {
		bodies.push(JSON.parse(init.body));
		return { ok: true, status: 200 };
	};
	const transport = new Transport('https://w.test/v1/batch', session, queue, send, () => clk.now());
	queue.emit('session_start');

	const r = rig({ width: 1200, height: 800 });
	const tracker = new ViewportTracker({ width: 1200, height: 800 }, {
		read: () => ({ width: 930, height: 800 }),
		emit: ({ width, height }) =>
			queue.emit('viewport_changed', { properties: { viewport_width: width, viewport_height: height } }),
		setTimer: () => 0,
		clearTimer: () => {},
		coarsePointer: false,
	});
	void r;
	tracker.onResize();
	assert.equal(bodies.length, 0); // tracking never sends directly
	assert.equal(queue.length, 1);

	// what client.ts safeFlush(true) does:
	tracker.finalize();
	assert.equal(queue.length, 2);
	assert.equal(bodies.length, 0);
	clockT += 300;
	await transport.flush({ lifecycle: true });

	assert.equal(bodies.length, 1);
	const types = bodies[0].events.map((e: any) => e.event_type);
	assert.deepEqual(types, ['session_start', 'viewport_changed']);
	const ev = bodies[0].events[1];
	assert.deepEqual(ev.properties, { viewport_width: 930, viewport_height: 800 });
	assert.equal('target_type' in ev, false);
	assert.match(ev.event_id, /^[A-Za-z0-9_-]{8,64}$/);
});

test('viewport: event passes the Worker strict validator', () => {
	const clk = { now: () => 5000, iso: () => '2026-09-25T10:00:05.000Z' };
	const queue = new EventQueue(clk, 1000);
	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1200, innerHeight: 800, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: false }),
		},
		'sess-id-0010', clk.iso(),
	);
	queue.emit('viewport_changed', { properties: { viewport_width: 930, viewport_height: 800 } });
	const events = queue.peek(100, 1e6);
	for (const followUp of [false, true]) {
		const res = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, followUp, events))));
		assert.equal(res.ok, true, res.ok ? '' : res.detail);
	}
});
