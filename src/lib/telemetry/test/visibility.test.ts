import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventQueue } from '../queue.ts';
import { Transport, buildBatch } from '../transport.ts';
import type { Fetch } from '../transport.ts';
import { buildSessionContext, randomId } from '../session.ts';
import { VisibilityMatrixEngine, GRACE_MS } from '../visibility.ts';
import type { VisibilityDeps } from '../visibility.ts';
import type { SemanticState } from '../state.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';

// ---- fixtures -------------------------------------------------------------

const MAIN: SemanticState = {
	surface: 'main', projectId: null, skillId: null, skillsMode: null,
	viewInstanceId: null, underlying: 'main', navbarAvailable: true,
};
const SKILLS = (viewInstanceId: string): SemanticState => ({
	surface: 'skills', projectId: null, skillId: null, skillsMode: 'hover',
	viewInstanceId, underlying: 'main', navbarAvailable: true,
});
const PROJECT = (viewInstanceId: string): SemanticState => ({
	surface: 'project_modal', projectId: 'p1', skillId: null, skillsMode: null,
	viewInstanceId, underlying: 'main', navbarAvailable: false,
});
const FILTERED = (viewInstanceId: string): SemanticState => ({
	surface: 'skill_filtered', projectId: null, skillId: 's1', skillsMode: null,
	viewInstanceId, underlying: 'main', navbarAvailable: false,
});

const fakeEl = (): Element => ({ isConnected: true }) as unknown as Element;

/** Fake clock/timers/geometry/state so the engine is fully deterministic —
 *  no real DOM, no real IntersectionObserver, no real setTimeout. */
function rig(initial: SemanticState = MAIN) {
	let t = 0;
	let nextTimerId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
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

	const emitted: any[] = [];
	let state = initial;
	const listeners: Array<(s: SemanticState) => void> = [];
	const ratioCallbacks = new Map<Element, (ratio: number) => void>();
	const observed = new Set<Element>();
	let idCounter = 0;
	let flushRequests = 0;

	const deps: VisibilityDeps = {
		clock: { now: () => t },
		setTimer: (fn, ms) => {
			const id = nextTimerId++;
			timers.set(id, { at: t + ms, fn });
			return id;
		},
		clearTimer: (h) => void timers.delete(h as number),
		newId: () => `appear_${++idCounter}`,
		emit: (type, opts) => emitted.push({ type, ...opts }),
		getState: () => state,
		subscribe: (fn) => {
			listeners.push(fn);
			return () => {};
		},
		observeElement: (el, onRatio) => {
			observed.add(el);
			ratioCallbacks.set(el, onRatio);
			return () => ratioCallbacks.delete(el);
		},
		requestFlush: () => {
			flushRequests += 1;
		},
	};

	const engine = new VisibilityMatrixEngine(deps);

	return {
		engine,
		emitted,
		/** `emitted` filtered to `visibility_delta` only — convenient when a
		 *  test also expects interleaved `video_start` events (docs section 17.7). */
		deltas: () => emitted.filter((e) => e.type === 'visibility_delta'),
		videoStarts: () => emitted.filter((e) => e.type === 'video_start'),
		advance,
		observed,
		setRatio: (el: Element, ratio: number) => ratioCallbacks.get(el)!(ratio),
		setState: (next: SemanticState) => {
			state = next;
			listeners.slice().forEach((fn) => fn(state));
		},
		pendingTimers: () => timers.size,
		flushRequests: () => flushRequests,
	};
}

// ---- thresholds / nesting / max ratio -------------------------------------

test('49% never starts an appearance: no eligible time, nothing emitted', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.49);
	r.advance(5000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 0);
});

test('exact 50% counts; nested thresholds accumulate exactly per the docs example; max ratio is the running max', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.5); // exactly the v50 boundary
	r.advance(2000);
	r.setRatio(el, 0.9); // now also >=70 and >=85, still <95 — 2s at 90% (docs section 7 example)
	r.advance(2000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	const d = r.emitted[0];
	assert.equal(d.v50_ms, 4000);
	assert.equal(d.v70_ms, 2000);
	assert.equal(d.v85_ms, 2000);
	assert.equal(d.v95_ms, 0);
	assert.equal(d.max_visibility_ratio, 0.9);
});

test('95% counts toward every nested threshold including v95', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_content', 'vision');
	r.setRatio(el, 0.97);
	r.advance(1000);
	r.engine.materialize();
	const d = r.emitted[0];
	assert.equal(d.v50_ms, 1000);
	assert.equal(d.v70_ms, 1000);
	assert.equal(d.v85_ms, 1000);
	assert.equal(d.v95_ms, 1000);
	assert.equal(d.max_visibility_ratio, 0.97);
});

test('max_visibility_ratio never decreases within an appearance even as the ratio drops back (while staying >=50%)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.95);
	r.advance(500);
	r.setRatio(el, 0.6); // drops, but still an appearance (>=50%)
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted[0].max_visibility_ratio, 0.95);
});

// ---- appearance lifecycle ---------------------------------------------------

test('appearance creation: reaching >=50% starts a new appearance with a fresh id', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_content', 'vision');
	r.setRatio(el, 0.5);
	r.advance(100);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	assert.ok(r.emitted[0].appearance_id);
});

test('a dip below 50% shorter than 300ms preserves the same appearance and contributes zero time', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.6);
	r.advance(1000);
	r.setRatio(el, 0.3); // dip begins; grace timer armed
	r.advance(GRACE_MS - 100); // recovers before the 300ms grace expires
	r.setRatio(el, 0.6);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	const first = r.emitted[0];
	assert.equal(first.v50_ms, 2000); // the 200ms dip contributes zero, not counted at all
	const appearanceId = first.appearance_id;

	r.advance(500); // still visible, nothing due
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	assert.equal(r.emitted[1].appearance_id, appearanceId); // same appearance throughout
	assert.equal(r.emitted[1].v50_ms, 500); // only the new time, not the cumulative total
});

test('more than 300ms below 50% ends the appearance; returning to 50% creates a new one', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.6);
	r.advance(1000);
	r.setRatio(el, 0.2); // drop below 50%
	r.advance(GRACE_MS); // the grace timer expires exactly here and ends the appearance
	assert.equal(r.emitted.length, 1); // grace expiry materializes the ending appearance itself
	const ended = r.emitted[0];
	assert.equal(ended.v50_ms, 1000);

	r.setRatio(el, 0.6); // a fresh encounter
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	assert.notEqual(r.emitted[1].appearance_id, ended.appearance_id);
	assert.equal(r.emitted[1].v50_ms, 500);
});

test('periodic materialization never ends an appearance (drains only)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.9);
	r.advance(1000);
	r.engine.materialize();
	const id1 = r.emitted[0].appearance_id;
	r.advance(1000);
	r.engine.materialize();
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 3);
	assert.ok(r.emitted.every((e) => e.appearance_id === id1));
});

test('subsequent materialization sends only the newly accumulated time, never the cumulative total (docs section 14)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.95);
	r.advance(8000);
	r.engine.materialize();
	assert.equal(r.emitted[0].v50_ms, 8000);
	assert.equal(r.emitted[0].v95_ms, 8000);
	r.advance(5000);
	r.engine.materialize();
	assert.equal(r.emitted[1].v50_ms, 5000); // NOT 13000
	assert.equal(r.emitted[1].v95_ms, 5000);
	assert.equal(r.emitted[1].appearance_id, r.emitted[0].appearance_id);
});

test('no zero-delta spam: materialize() emits nothing when no eligible time accumulated since the last drain', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_content', 'vision');
	r.engine.materialize(); // nothing observed yet
	assert.equal(r.emitted.length, 0);
	r.setRatio(el, 0.3); // never reaches 50%
	r.advance(5000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 0);
});

test('an unrecognized target type is ignored (scope guard for this increment)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_experience', 'x'); // a real future target type, out of scope today
	assert.equal(r.observed.has(el), false);
});

// ---- semantic suspension / restoration --------------------------------------

test('main suspended by Skills: accounting stops immediately (not waiting for geometry), appearance is preserved, and it resumes after Skills closes', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.8); // stays 80% visible for the whole test — geometry never changes
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	const appearanceId = r.emitted[0].appearance_id;
	assert.equal(r.emitted[0].v50_ms, 1000);

	r.setState(SKILLS('skills-1')); // Skills opens: main is suspended even though geometry is unchanged
	r.advance(5000); // time passes while suspended
	r.engine.materialize();
	assert.equal(r.emitted.length, 1); // suspended time contributed zero: nothing new to drain

	r.setState(MAIN); // Skills closes: main resumes
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	assert.equal(r.emitted[1].appearance_id, appearanceId); // same appearance throughout the suspension
	assert.equal(r.emitted[1].v50_ms, 1000); // only the post-resume time
});

test('Skills suspended by Project Detail: the skills_person appearance ends immediately at the instance boundary, not waiting for geometry', () => {
	const r = rig(SKILLS('skills-1'));
	const el = fakeEl();
	r.engine.observe(el, 'skills_person', 'mitko');
	r.setRatio(el, 0.9); // revealed while Skills is open
	r.advance(1000);
	r.setState(PROJECT('proj-instance-1')); // Project Detail opens over Skills
	assert.equal(r.emitted.length, 1); // ended right on the transition, no materialize() call needed
	assert.equal(r.emitted[0].v50_ms, 1000);
	assert.equal(r.emitted[0].view_instance_id, 'skills-1');

	r.advance(2000); // ratio is still (fictitiously) 0.9, but there is no active appearance anymore
	r.engine.materialize();
	assert.equal(r.emitted.length, 1); // nothing more: surface isn't 'skills' either way
});

test('Skills suspended by Skill Filtered View: same instance-boundary forced end', () => {
	const r = rig(SKILLS('skills-2'));
	const el = fakeEl();
	r.engine.observe(el, 'skills_person', 'adam');
	r.setRatio(el, 0.7);
	r.advance(500);
	r.setState(FILTERED('filter-instance-1'));
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].v50_ms, 500);
	assert.equal(r.emitted[0].view_instance_id, 'skills-2');
});

test('restoration: closing a blocking view over Skills resumes skills_person accounting under the NEW skills instance, as a new appearance', () => {
	// The real `.side-panel-stack` CSS collapses to height:0 (ratio 0) while a
	// project/filter modal is up and revives when Skills is restored (see
	// ScrollyRegion.astro) — geometry always backs up the instance-boundary
	// forced end, so the panel reappearing is what starts the new appearance.
	const r = rig(SKILLS('skills-1'));
	const el = fakeEl();
	r.engine.observe(el, 'skills_person', 'mitko');
	r.setRatio(el, 0.9);
	r.advance(1000);
	r.setState(PROJECT('proj-1')); // forces the skills-1 appearance to end immediately
	const endedId = r.emitted[0].appearance_id;
	r.setRatio(el, 0); // CSS collapses the panel while the project modal is up
	r.setState(SKILLS('skills-2')); // Project Detail closes, restoring Skills as a NEW instance
	r.setRatio(el, 0.9); // CSS reveals the panel again
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	assert.notEqual(r.emitted[1].appearance_id, endedId);
	assert.equal(r.emitted[1].view_instance_id, 'skills-2');
	assert.equal(r.emitted[1].v50_ms, 1000);
});

test('two people are measured independently by actual geometry, regardless of who triggered Skills', () => {
	const r = rig(SKILLS('skills-3'));
	const mitkoEl = fakeEl();
	const adamEl = fakeEl();
	r.engine.observe(mitkoEl, 'skills_person', 'mitko');
	r.engine.observe(adamEl, 'skills_person', 'adam');
	r.setRatio(mitkoEl, 0.9); // only Mitko's card is actually in view
	r.setRatio(adamEl, 0.2); // Ádám's card never reaches 50%
	r.advance(2000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].target_id, 'mitko');
	assert.equal(r.emitted[0].v50_ms, 2000);
});

test('two DOM rows sharing one canonical project id (a split project) accumulate and end independently', () => {
	const r = rig();
	const elA = fakeEl();
	const elB = fakeEl();
	r.engine.observe(elA, 'timeline_project', 'around');
	r.engine.observe(elB, 'timeline_project', 'around');
	r.setRatio(elA, 0.9);
	r.setRatio(elB, 0.2); // the other half isn't in view yet
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].target_id, 'around');
	const idA = r.emitted[0].appearance_id;

	r.setRatio(elB, 0.9); // the other half comes into view later
	r.advance(1000);
	r.engine.materialize();
	// elA's own appearance (still >=50%) keeps accruing every materialize, plus
	// elB now contributes its own fresh appearance — two independent targets.
	assert.equal(r.emitted.length, 3);
	const forA = r.emitted.filter((e) => e.appearance_id === idA);
	const forB = r.emitted.filter((e) => e.appearance_id !== idA);
	assert.equal(forA.length, 2); // elA drained twice, same appearance both times
	assert.equal(forB.length, 1); // elB's first (and only, so far) delta
	assert.ok(forA.every((e) => e.target_id === 'around'));
	assert.equal(forB[0].target_id, 'around');
	assert.notEqual(forB[0].appearance_id, idA); // independent DOM target instance, own appearance
});

// ---- document visibility ----------------------------------------------------

test('hidden-tab time contributes zero, and the appearance is preserved across hide/show', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_content', 'vision');
	r.setRatio(el, 0.8);
	r.advance(1000);
	r.engine.pause(); // document goes hidden
	r.advance(10_000); // long hidden stretch
	r.engine.materialize(); // e.g. a pagehide firing while hidden
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].v50_ms, 1000); // the hidden 10s contributed zero
	const appearanceId = r.emitted[0].appearance_id;

	r.engine.resume(); // document visible again
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	assert.equal(r.emitted[1].appearance_id, appearanceId); // same appearance, not a new encounter
	assert.equal(r.emitted[1].v50_ms, 500);
});

test('pause() itself accounts through the hide instant, so a materialize() called right after sees nothing extra', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.9);
	r.advance(2000);
	r.engine.pause();
	r.engine.materialize(); // steps 1+2 of the documented hide order, back to back
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].v50_ms, 2000);
});

// ---- integration: flush ordering + real Worker validation -------------------

test('materialize() queues the visibility_delta before transport.flush() sends it, and the event passes the real Worker validator', async () => {
	let clockT = 1000;
	const clk = { now: () => clockT, iso: () => '2026-09-25T10:00:00.000Z' };
	const queue = new EventQueue(clk, clk.now());
	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1200, innerHeight: 800, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: false }),
		},
		'sess-id-0099', clk.iso(),
	);
	const bodies: any[] = [];
	const send: Fetch = async (_u, init) => {
		bodies.push(JSON.parse(init.body));
		return { ok: true, status: 200 };
	};
	const transport = new Transport('https://w.test/v1/batch', session, queue, send, () => clk.now());
	queue.emit('session_start');

	let onRatio: ((ratio: number) => void) | undefined;
	const el = fakeEl();
	const engine = new VisibilityMatrixEngine({
		clock: clk,
		setTimer: () => 0,
		clearTimer: () => {},
		newId: randomId,
		emit: (type, opts) => queue.emit(type, opts),
		getState: () => MAIN,
		subscribe: () => () => {},
		observeElement: (_el, cb) => {
			onRatio = cb;
			return () => {};
		},
	});
	engine.observe(el, 'timeline_project', 'heroes6');
	onRatio!(0.9);
	clockT += 3000;

	// What client.ts's safeFlush(lifecycle) does: materialize() BEFORE transport.flush().
	engine.materialize();
	assert.equal(queue.length, 2); // session_start + visibility_delta, queued before any network call
	assert.equal(bodies.length, 0);

	await transport.flush({ lifecycle: true });
	assert.equal(bodies.length, 1);
	assert.deepEqual(bodies[0].events.map((e: any) => e.event_type), ['session_start', 'visibility_delta']);
	const ev = bodies[0].events[1];
	assert.equal(ev.target_type, 'timeline_project');
	assert.equal(ev.target_id, 'heroes6');
	assert.equal(ev.v50_ms, 3000);
	assert.equal(ev.v70_ms, 3000);
	assert.equal(ev.v85_ms, 3000);
	assert.equal(ev.v95_ms, 0);
	assert.equal(ev.max_visibility_ratio, 0.9);
	assert.ok(ev.appearance_id);
	assert.equal(queue.length, 0);

	for (const followUp of [false, true]) {
		const res = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, followUp, [ev]))));
		assert.equal(res.ok, true, res.ok ? '' : res.detail);
	}
});

// ---- max_visibility_ratio eligibility (goal 2) -------------------------------

test('max_visibility_ratio increases only while eligible', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.6);
	r.advance(500);
	r.setRatio(el, 0.9); // eligible (surface is main): raises the max
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted[0].max_visibility_ratio, 0.9);
});

test('suspended geometry cannot increase max_visibility_ratio, and it resumes increasing once eligibility returns', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.6); // starts the appearance, eligible: max = 0.6
	r.advance(500);

	// Opening a blocking surface drains the pre-transition span immediately
	// (see the "semantic state-boundary flush" tests) — that drain's own max
	// is the last ELIGIBLE one, 0.6.
	r.setState(SKILLS('skills-1'));
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].max_visibility_ratio, 0.6);

	r.setRatio(el, 0.97); // geometry changes while suspended — must NOT raise the max
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1); // suspended: no eligible time to drain either

	r.setState(MAIN); // eligibility resumes; ratio is still 0.97 from the suspended change
	assert.equal(r.emitted.length, 1); // nothing newly eligible at this exact instant yet

	r.advance(200);
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	// The 0.97 observed while suspended must not count: only ratio observed
	// while eligible ever raises the max. Since no NEW ratio arrives after
	// resuming, the max stays at the last ELIGIBLE observation (0.6) — this is
	// the direct proof the suspended 0.97 was correctly ignored.
	assert.equal(r.emitted[1].max_visibility_ratio, 0.6);

	r.setRatio(el, 0.97); // a genuine ratio observation now that main is active again
	r.advance(200);
	r.engine.materialize();
	assert.equal(r.emitted.length, 3);
	assert.equal(r.emitted[2].max_visibility_ratio, 0.97); // now it can increase again
});

test('max_visibility_ratio resets to 0 for a brand new appearance (not carried over from the previous one)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.95);
	r.advance(100);
	r.setRatio(el, 0.2); // dip below 50%: arms the 300ms grace timer
	r.advance(GRACE_MS); // grace expires: appearance ends (drains max_visibility_ratio: 0.95)
	r.setRatio(el, 0.6); // a fresh appearance
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted[r.emitted.length - 1].max_visibility_ratio, 0.6);
});

// ---- semantic state-boundary flush (goal 3) ----------------------------------

test('opening a blocking surface accounts the old surface through the transition, drains it, and requests a flush promptly', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.8);
	r.advance(1234); // well short of any periodic flush
	assert.equal(r.flushRequests(), 0);

	r.setState(SKILLS('skills-1')); // Skills opens: main is suspended
	// No materialize() call from the test — the transition itself must drain.
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].v50_ms, 1234); // exactly the pre-transition span, no more, no less
	assert.equal(r.flushRequests(), 1);
});

test('closing a blocking surface accounts and drains its own measurements through the transition, and requests a flush promptly', () => {
	const r = rig(SKILLS('skills-1'));
	const el = fakeEl();
	r.engine.observe(el, 'skills_person', 'mitko');
	r.setRatio(el, 0.9);
	r.advance(777);
	assert.equal(r.flushRequests(), 0);

	r.setState(MAIN); // Skills closes
	assert.equal(r.emitted.length, 1); // the instance-boundary end already drains this
	assert.equal(r.emitted[0].v50_ms, 777);
	assert.equal(r.flushRequests(), 1);
});

test('a surface change with nothing newly accumulated still requests a flush (so the semantic transition event itself is sent promptly) but drains no zero-delta noise', () => {
	const r = rig();
	r.setState(SKILLS('skills-1')); // no targets registered at all: nothing to drain, ever
	assert.equal(r.emitted.length, 0);
	assert.equal(r.flushRequests(), 1);
});

test('repeated state transitions do not duplicate deltas', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.8);
	r.advance(1000);
	r.setState(SKILLS('skills-1')); // drains 1000ms
	r.setState(PROJECT('proj-1')); // no elapsed time since — nothing new to drain
	r.setState(FILTERED('filter-1'));
	r.setState(MAIN);
	assert.equal(r.emitted.length, 1); // only the one real drain, not four
	assert.equal(r.flushRequests(), 4); // each surface change still requests its own flush
});

// ---- Vision tooltips (goal 5) -------------------------------------------------

test('vision_tooltip: appearance + nested thresholds work exactly like any other target', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_tooltip', 'in-sync');
	r.setRatio(el, 0.95);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	const d = r.emitted[0];
	assert.equal(d.target_type, 'vision_tooltip');
	assert.equal(d.target_id, 'in-sync');
	assert.equal(d.v50_ms, 1000);
	assert.equal(d.v95_ms, 1000);
	assert.equal(d.max_visibility_ratio, 0.95);
});

test('vision_tooltip: forced immediate end (tooltip closed) drains exactly the elapsed time without waiting on geometry or the 300ms grace', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_tooltip', 'true-ownership');
	r.setRatio(el, 0.8);
	r.advance(150); // well under the 300ms grace window
	r.engine.endAppearanceNow(el); // the UI just hid it — end now, don't wait
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].v50_ms, 150);

	// A later, unrelated ratio wobble (e.g. a stale/late IntersectionObserver
	// callback for the now-hidden element) must not resurrect the ended
	// appearance or double-count anything.
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);

	r.setRatio(el, 0.8); // a genuinely new showing gets a new appearance
	r.advance(300);
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	assert.notEqual(r.emitted[1].appearance_id, r.emitted[0].appearance_id);
});

test('vision_tooltip: endAppearanceNow on a target with no active appearance, or an unregistered element, is a harmless no-op', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_tooltip', 'built-to-scale');
	r.engine.endAppearanceNow(el); // never appeared
	assert.equal(r.emitted.length, 0);
	r.engine.endAppearanceNow(fakeEl()); // never observed at all
	assert.equal(r.emitted.length, 0);
});

test('vision_tooltip is owned by main: suspended by Skills, by Project Detail, and by Skill Filtered View, exactly like vision_content', () => {
	for (const blocking of [SKILLS('skills-1'), PROJECT('proj-1'), FILTERED('filter-1')]) {
		const r = rig();
		const el = fakeEl();
		r.engine.observe(el, 'vision_tooltip', 'shipped-experiences');
		r.setRatio(el, 0.9);
		r.advance(500);

		// Opening the blocking surface suspends (main has no instance concept,
		// so never a forced-end here) AND drains the pre-transition span right
		// away (semantic state-boundary flush).
		r.setState(blocking);
		assert.equal(r.emitted.length, 1);
		assert.equal(r.emitted[0].v50_ms, 500);

		r.advance(2000); // must not accumulate while suspended
		r.setState(MAIN);
		assert.equal(r.emitted.length, 1); // nothing new to drain at the close boundary either

		r.advance(500);
		r.engine.materialize();
		assert.equal(r.emitted.length, 2);
		assert.equal(r.emitted[1].v50_ms, 500); // only the post-resume span; the 2000ms suspended is zero
	}
});

test('vision_tooltip: objective trigger context is attached to every delta of the appearance it belongs to', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_tooltip', 'complete-development');
	r.engine.setTriggerContext(el, 'hover');
	r.setRatio(el, 0.9);
	r.advance(500);
	r.engine.materialize();
	assert.deepEqual(r.emitted[0].properties, { trigger_method: 'hover' });

	r.advance(500); // same appearance, later materialization
	r.engine.materialize();
	assert.deepEqual(r.emitted[1].properties, { trigger_method: 'hover' });

	r.engine.endAppearanceNow(el);
	r.engine.setTriggerContext(el, 'touch');
	r.setRatio(el, 0.9); // a new appearance picks up the newly set context
	r.advance(500);
	r.engine.materialize();
	assert.deepEqual(r.emitted[2].properties, { trigger_method: 'touch' });
});

test('vision_tooltip: no trigger context set means no properties field is invented', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'vision_tooltip', 'easy-integration');
	r.setRatio(el, 0.9);
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted[0].properties, undefined);
});

test('vision_tooltip: setTriggerContext on an unregistered element is a harmless no-op', () => {
	const r = rig();
	r.engine.setTriggerContext(fakeEl(), 'hover');
	// Nothing to assert beyond "did not throw" — there is no target to affect.
});

test('vision_tooltip visibility_delta (with trigger_method properties) passes the real Worker validator', () => {
	let clockT = 1000;
	const clk = { now: () => clockT, iso: () => '2026-09-28T10:00:05.000Z' };
	const queue = new EventQueue(clk, clk.now());
	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1200, innerHeight: 800, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: false }),
		},
		'sess-id-0100', clk.iso(),
	);
	let onRatio: ((ratio: number) => void) | undefined;
	const el = fakeEl();
	const engine = new VisibilityMatrixEngine({
		clock: clk,
		setTimer: () => 0,
		clearTimer: () => {},
		newId: randomId,
		emit: (type, opts) => queue.emit(type, opts),
		getState: () => MAIN,
		subscribe: () => () => {},
		observeElement: (_el, cb) => {
			onRatio = cb;
			return () => {};
		},
	});
	engine.observe(el, 'vision_tooltip', 'in-sync');
	engine.setTriggerContext(el, 'click');
	onRatio!(0.95);
	clockT += 500;
	engine.materialize();
	const ev = queue.peek(10, 1e6)[0];
	assert.equal(ev.target_type, 'vision_tooltip');
	assert.equal(ev.v50_ms, 500);
	assert.deepEqual(ev.properties, { trigger_method: 'click' });
	for (const followUp of [false, true]) {
		const res = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, followUp, [ev]))));
		assert.equal(res.ok, true, res.ok ? '' : res.detail);
	}
});

// ---- Telemetry Pass 1: project_intro / project_content / filtered_project
// (docs section 17.6) — project content visibility across Timeline, Project
// Modal and Skill Filtered View. ------------------------------------------

test('no properties field is invented for a fixed-owner target with no options.properties (unchanged from before this pass)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'timeline_project', 'p1');
	r.setRatio(el, 0.9);
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted[0].properties, undefined);
});

test('filtered_project: fixed owner (skill_filtered) from the OWNER map, no options needed — same pattern as timeline_project', () => {
	const r = rig(FILTERED('filter-1'));
	const el = fakeEl();
	r.engine.observe(el, 'filtered_project', 'heroes6');
	r.setRatio(el, 0.9);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].target_type, 'filtered_project');
	assert.equal(r.emitted[0].target_id, 'heroes6');
	assert.equal(r.emitted[0].view_instance_id, 'filter-1');
});

test('filtered_project: closing the filter force-ends its appearance immediately at the instance boundary (skill_filtered is instanced, unlike main)', () => {
	const r = rig(FILTERED('filter-1'));
	const el = fakeEl();
	r.engine.observe(el, 'filtered_project', 'heroes6');
	r.setRatio(el, 0.9);
	r.advance(500);
	r.setState(MAIN);
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].v50_ms, 500);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1); // nothing more: surface isn't skill_filtered anymore
});

test('project_intro / project_content: a context-dependent target type registered WITHOUT an explicit owner is ignored — the existing scope guard, now also covering the two new context-dependent types', () => {
	const r = rig();
	const introEl = fakeEl();
	r.engine.observe(introEl, 'project_intro', 'heroes6'); // no options.owner, and no fixed OWNER entry either
	assert.equal(r.observed.has(introEl), false);
	const contentEl = fakeEl();
	r.engine.observe(contentEl, 'project_content', 'heroes6:mitko-heroes6');
	assert.equal(r.observed.has(contentEl), false);
});

test('project_intro: owner supplied by the rendering context (main, for the Timeline preview) works exactly like a fixed-owner target', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_intro', 'heroes6', { owner: 'main' });
	r.setRatio(el, 0.8);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].target_type, 'project_intro');
	assert.equal(r.emitted[0].target_id, 'heroes6');
});

test('project_content inside Project Modal (owner: project_modal): the instance-boundary rule, generalized this pass beyond skills_person, force-ends the appearance the instant the modal closes — no waiting on geometry', () => {
	const r = rig(PROJECT('proj-1'));
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6:mitko-heroes6', {
		owner: 'project_modal',
		properties: { content_type: 'experience', person: 'mitko' },
	});
	r.setRatio(el, 0.9);
	r.advance(1000);
	r.setState(MAIN); // modal closes
	assert.equal(r.emitted.length, 1); // ended right on the transition
	assert.equal(r.emitted[0].v50_ms, 1000);
	assert.equal(r.emitted[0].view_instance_id, 'proj-1');
	assert.deepEqual(r.emitted[0].properties, { content_type: 'experience', person: 'mitko' });

	r.advance(2000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1); // surface isn't project_modal anymore: nothing more
});

test('project_content inside Skill Filtered View (owner: skill_filtered): same generalized instance-boundary forced end', () => {
	const r = rig(FILTERED('filter-1'));
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6:adam-heroes6', {
		owner: 'skill_filtered',
		properties: { content_type: 'experience', person: 'adam' },
	});
	r.setRatio(el, 0.7);
	r.advance(500);
	r.setState(PROJECT('proj-2')); // superseded by a Project Detail open — different instanced surface
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].v50_ms, 500);
	assert.equal(r.emitted[0].view_instance_id, 'filter-1');
});

test('project_content: static properties (content_type/person) are repeated on every delta of the appearance, not just the first', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6:mitko-heroes6', {
		owner: 'main',
		properties: { content_type: 'image', person: 'mitko' },
	});
	r.setRatio(el, 0.9);
	r.advance(500);
	r.engine.materialize();
	assert.deepEqual(r.emitted[0].properties, { content_type: 'image', person: 'mitko' });
	r.advance(500);
	r.engine.materialize();
	assert.deepEqual(r.emitted[1].properties, { content_type: 'image', person: 'mitko' });
});

test('project_content: a shared media item carries person: "both" as ordinary metadata — ownership is NOT encoded into the canonical content id itself', () => {
	// Media ids are pre-baked with their own project prefix and used as-is,
	// no colon-joining (see ProjectDetail.astro's mediaVisibilityAttrs) —
	// unlike an experience id, which is still joined at render time (colon).
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-combat-map', {
		owner: 'main',
		properties: { content_type: 'image', person: 'both' },
	});
	r.setRatio(el, 0.9);
	r.advance(200);
	r.engine.materialize();
	assert.equal(r.emitted[0].target_id, 'heroes6-combat-map');
	assert.deepEqual(r.emitted[0].properties, { content_type: 'image', person: 'both' });
});

test('cross-context canonical identity: the same project_intro target_id has two independent DOM instances under different owners (Timeline vs. Project Modal) — same id, different appearances, each eligible only under its own surface', () => {
	const r = rig();
	const timelineEl = fakeEl();
	const modalEl = fakeEl();
	r.engine.observe(timelineEl, 'project_intro', 'heroes6', { owner: 'main' });
	// The modal's own copy starts at ratio 0 — a real <dialog> without [open]
	// is not rendered, exactly like `.side-panel-stack`'s CSS collapse for
	// skills_person (docs section 17.3), so this mirrors how it actually
	// becomes visible only once the surface it belongs to is current.
	r.engine.observe(modalEl, 'project_intro', 'heroes6', { owner: 'project_modal' });
	r.setRatio(timelineEl, 0.9);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 1);
	assert.equal(r.emitted[0].target_id, 'heroes6');
	const timelineAppearance = r.emitted[0].appearance_id;

	r.setState(PROJECT('proj-1')); // dialog opens: main suspended, project_modal now current
	r.setRatio(modalEl, 0.9); // the modal's own copy becomes visible now that it's open
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.emitted.length, 2);
	const forModal = r.emitted[1];
	assert.equal(forModal.target_id, 'heroes6'); // same canonical id as the Timeline instance
	assert.notEqual(forModal.appearance_id, timelineAppearance); // independent DOM instance, own appearance
	assert.equal(forModal.view_instance_id, 'proj-1');
	assert.equal(forModal.v50_ms, 500);

	r.advance(500); // the Timeline copy stays suspended throughout: no new time for it
	r.engine.materialize();
	assert.equal(r.emitted.length, 3);
	assert.equal(r.emitted[2].target_id, 'heroes6');
	assert.equal(r.emitted[2].appearance_id, forModal.appearance_id); // still the modal's own appearance
});

test('project_content visibility_delta (with content_type/person properties) passes the real Worker validator', () => {
	let clockT = 1000;
	const clk = { now: () => clockT, iso: () => '2026-09-28T10:05:00.000Z' };
	const queue = new EventQueue(clk, clk.now());
	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1200, innerHeight: 800, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: false }),
		},
		'sess-id-0200', clk.iso(),
	);
	let onRatio: ((ratio: number) => void) | undefined;
	const el = fakeEl();
	const engine = new VisibilityMatrixEngine({
		clock: clk,
		setTimer: () => 0,
		clearTimer: () => {},
		newId: randomId,
		emit: (type, opts) => queue.emit(type, opts),
		getState: () => MAIN,
		subscribe: () => () => {},
		observeElement: (_el, cb) => {
			onRatio = cb;
			return () => {};
		},
	});
	engine.observe(el, 'project_content', 'heroes6:mitko-heroes6', {
		owner: 'main',
		properties: { content_type: 'experience', person: 'mitko' },
	});
	onRatio!(0.95);
	clockT += 500;
	engine.materialize();
	const ev = queue.peek(10, 1e6)[0];
	assert.equal(ev.target_type, 'project_content');
	assert.equal(ev.target_id, 'heroes6:mitko-heroes6');
	assert.deepEqual(ev.properties, { content_type: 'experience', person: 'mitko' });
	for (const followUp of [false, true]) {
		const res = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, followUp, [ev]))));
		assert.equal(res.ok, true, res.ok ? '' : res.detail);
	}
});

// ---- Telemetry Pass 2: playable/playing (docs section 9, 17.7) -------------
// Three parallel families sharing one accounting loop: general v* (Pass 1,
// unaffected — see the tests above), playable_v* (any `playableKind`
// target), and playing_v* (only `native-video`/`youtube`, the kinds with
// real observable playback state).

test('playable_v* begins only once the target reaches >=50% visible, exactly like v* (native-video, not yet playing)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.49);
	r.advance(2000);
	r.engine.materialize();
	assert.equal(r.deltas().length, 0); // never reached 50%: no appearance, nothing to measure at all

	r.setRatio(el, 0.6);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.deltas().length, 1);
	const d = r.deltas()[0];
	assert.equal(d.v50_ms, 1000);
	assert.equal(d.playable_v50_ms, 1000);
	assert.equal(d.playing_v50_ms, 0); // an observable kind, but playingActive was never set true
});

test('playable_v* nests exactly like v*; playing_v* is entirely absent (not sent as zero) for a kind with no observable playback state (gif)', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'placeholder-gif', { owner: 'main', playableKind: 'gif' });
	r.setRatio(el, 0.5);
	r.advance(2000);
	r.setRatio(el, 0.9); // now also >=70/>=85, still <95
	r.advance(2000);
	r.engine.materialize();
	const d = r.deltas()[0];
	assert.equal(d.v50_ms, 4000);
	assert.equal(d.v70_ms, 2000);
	assert.equal(d.v85_ms, 2000);
	assert.equal(d.v95_ms, 0);
	assert.equal(d.playable_v50_ms, 4000);
	assert.equal(d.playable_v70_ms, 2000);
	assert.equal(d.playable_v85_ms, 2000);
	assert.equal(d.playable_v95_ms, 0);
	assert.equal(d.playing_v50_ms, undefined);
	assert.equal(d.playing_v70_ms, undefined);
	assert.equal(d.playing_v85_ms, undefined);
	assert.equal(d.playing_v95_ms, undefined);
});

test('facebook (opaque provider): playableSuspended blocks playable_v* while general v* keeps accumulating; playing_v* is never sent at all', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'around-clip', { owner: 'main', playableKind: 'facebook' });
	r.engine.setPlayableSuspended(el, true); // the iframe is blanked, as at page load (initFacebook)
	r.setRatio(el, 0.9);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.deltas().length, 1);
	const d1 = r.deltas()[0];
	assert.equal(d1.v50_ms, 1000); // general visibility is unaffected by playable suspension
	assert.equal(d1.playable_v50_ms, 0); // suspended: no playable time
	assert.equal(d1.playing_v50_ms, undefined); // facebook never gets playing fields at all

	r.engine.setPlayableSuspended(el, false); // real src restored (activateFacebook)
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.deltas().length, 2);
	const d2 = r.deltas()[1];
	assert.equal(d2.v50_ms, 1000);
	assert.equal(d2.playable_v50_ms, 1000); // now live
	assert.equal(d2.playing_v50_ms, undefined);
	assert.equal(r.videoStarts().length, 0); // never, for an opaque provider
});

test('gif: playableSuspended until the image has loaded, then playable_v* accumulates; playing_v* is never sent', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'placeholder-gif', { owner: 'main', playableKind: 'gif' });
	r.engine.setPlayableSuspended(el, true); // not yet loaded
	r.setRatio(el, 0.9);
	r.advance(500);
	r.engine.setPlayableSuspended(el, false); // the <img> 'load' event fires
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.deltas().length, 1);
	const d = r.deltas()[0];
	assert.equal(d.v50_ms, 1000); // general visibility unaffected
	assert.equal(d.playable_v50_ms, 500); // only the post-load half
	assert.equal(d.playing_v50_ms, undefined);
});

test('native-video: visible but not yet playing accumulates playable_v* but not playing_v*, and emits no video_start', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.9);
	r.advance(1000); // visible, but the browser hasn't fired 'playing' yet
	r.engine.materialize();
	const d = r.deltas()[0];
	assert.equal(d.playable_v50_ms, 1000);
	assert.equal(d.playing_v50_ms, 0);
	assert.equal(r.videoStarts().length, 0);
});

test('native-video: playing_v* begins only once real playback is observed, video_start fires exactly once per appearance, and pause/resume within the same appearance never re-fires it', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.9);
	r.advance(500); // playable but not playing yet
	r.engine.setPlaying(el, true); // the video's real 'playing' event
	assert.equal(r.videoStarts().length, 1); // fires immediately, not waiting for materialize
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.deltas().length, 1);
	const d = r.deltas()[0];
	assert.equal(d.playable_v50_ms, 1500); // visible the whole 1500ms
	assert.equal(d.playing_v50_ms, 1000); // only the 1000ms actually playing
	assert.equal(r.videoStarts()[0].appearance_id, d.appearance_id);
	assert.equal(r.videoStarts()[0].target_id, 'heroes6-clip');

	// Pausing then resuming within the SAME appearance is a resume, not a new start.
	r.engine.setPlaying(el, false); // 'pause'
	r.advance(500);
	r.engine.setPlaying(el, true); // 'playing' again
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.videoStarts().length, 1); // still exactly one — no second video_start on resume
	const d2 = r.deltas()[1];
	assert.equal(d2.playing_v50_ms, 500); // only the resumed span; the paused 500ms contributed zero
	assert.equal(d2.playable_v50_ms, 1000); // playable keeps accumulating through the pause (still visible)
});

test('native-video: playing while below 50% visible contributes zero playing_v* — there is no appearance to attach it to at all', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.engine.setPlaying(el, true); // e.g. autoplay fired before scroll brought it into view
	r.setRatio(el, 0.3); // never reaches 50%
	r.advance(2000);
	r.engine.materialize();
	assert.equal(r.deltas().length, 0);
	assert.equal(r.videoStarts().length, 0);
});

test('native-video: ended stops playing_v* accumulation, same as pause', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'exigo-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.9);
	r.engine.setPlaying(el, true);
	r.advance(1000);
	r.engine.setPlaying(el, false); // the video's 'ended' event, handled identically to 'pause'
	r.advance(1000); // still visible, but playback has ended
	r.engine.materialize();
	const d = r.deltas()[0];
	assert.equal(d.playable_v50_ms, 2000); // stays visible/playable
	assert.equal(d.playing_v50_ms, 1000); // only the pre-ended span
});

test('youtube: playable_v*/playing_v* nest correctly across the not-ready-yet window, and video_start carries the same static properties as visibility_delta', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-teaser', {
		owner: 'main',
		playableKind: 'youtube',
		properties: { content_type: 'youtube', person: 'both' },
	});
	r.engine.setPlayableSuspended(el, true); // player not yet constructed (IFrame API still loading)
	r.setRatio(el, 0.95);
	r.advance(300); // visible while the API is still loading
	r.engine.setPlayableSuspended(el, false); // onReady fires
	r.engine.setPlaying(el, true); // onStateChange: PLAYING
	r.advance(2000);
	r.engine.materialize();
	const d = r.deltas()[0];
	assert.equal(d.v50_ms, 2300);
	assert.equal(d.v95_ms, 2300);
	assert.equal(d.playable_v50_ms, 2000); // only after onReady unsuspended it
	assert.equal(d.playable_v95_ms, 2000);
	assert.equal(d.playing_v50_ms, 2000);
	assert.equal(d.playing_v95_ms, 2000);
	assert.deepEqual(r.videoStarts()[0].properties, { content_type: 'youtube', person: 'both' });
});

test('video_start never invents an autoplay/user-started distinction — only static properties (if any) are attached, nothing about the trigger is guessed', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.9);
	r.engine.setPlaying(el, true);
	assert.equal(r.videoStarts().length, 1);
	assert.equal(r.videoStarts()[0].properties, undefined); // no staticProperties supplied, none invented
});

test('setPlaying is a no-op for facebook/gif (no observable playback state): playing_v* and video_start never happen for these kinds even if told to', () => {
	const r = rig();
	const fbEl = fakeEl();
	const gifEl = fakeEl();
	r.engine.observe(fbEl, 'project_content', 'around-clip', { owner: 'main', playableKind: 'facebook' });
	r.engine.observe(gifEl, 'project_content', 'placeholder-gif', { owner: 'main', playableKind: 'gif' });
	r.engine.setPlaying(fbEl, true);
	r.engine.setPlaying(gifEl, true);
	r.setRatio(fbEl, 0.9);
	r.setRatio(gifEl, 0.9);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.videoStarts().length, 0);
	for (const d of r.deltas()) assert.equal(d.playing_v50_ms, undefined);
});

test('document hidden contributes zero playable_v*/playing_v*, same as v*, and both resume correctly together', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.9);
	r.engine.setPlaying(el, true);
	r.advance(1000);
	r.engine.pause(); // document goes hidden
	r.advance(5000);
	r.engine.materialize();
	const d = r.deltas()[0];
	assert.equal(d.v50_ms, 1000);
	assert.equal(d.playable_v50_ms, 1000);
	assert.equal(d.playing_v50_ms, 1000); // the hidden 5s contributed zero to all three families

	r.engine.resume();
	r.advance(500);
	r.engine.materialize();
	const d2 = r.deltas()[1];
	assert.equal(d2.v50_ms, 500);
	assert.equal(d2.playable_v50_ms, 500);
	assert.equal(d2.playing_v50_ms, 500);
});

test('semantic suspension (Skills over main) contributes zero playable_v*/playing_v*, same as v*, resumes correctly, and stays the same appearance throughout', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.8);
	r.engine.setPlaying(el, true);
	r.advance(1000);
	r.setState(SKILLS('skills-1')); // main suspended
	const d = r.deltas()[0]; // drained right at the transition
	assert.equal(d.v50_ms, 1000);
	assert.equal(d.playable_v50_ms, 1000);
	assert.equal(d.playing_v50_ms, 1000);

	r.advance(3000); // still "playing" per playingActive, but suspended: must contribute zero
	r.engine.materialize();
	assert.equal(r.deltas().length, 1); // nothing new drained

	r.setState(MAIN); // resumes
	r.advance(500);
	r.engine.materialize();
	const d2 = r.deltas()[1];
	assert.equal(d2.v50_ms, 500);
	assert.equal(d2.playable_v50_ms, 500);
	assert.equal(d2.playing_v50_ms, 500);
	assert.equal(d2.appearance_id, d.appearance_id); // main never acquires an instance: same appearance throughout
});

test('project_content inside Project Modal: closing the modal force-ends the appearance and stops playable_v*/playing_v* immediately, the same instance-boundary rule as v*', () => {
	const r = rig(PROJECT('proj-1'));
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'project_modal', playableKind: 'native-video' });
	r.setRatio(el, 0.9);
	r.engine.setPlaying(el, true);
	r.advance(1000);
	r.setState(MAIN); // modal closes
	const d = r.deltas()[0];
	assert.equal(d.v50_ms, 1000);
	assert.equal(d.playable_v50_ms, 1000);
	assert.equal(d.playing_v50_ms, 1000);

	r.advance(2000); // fictitious continued "playback" after close must not leak
	r.engine.materialize();
	assert.equal(r.deltas().length, 1); // nothing more: surface isn't project_modal anymore
});

test('no zero-delta spam: toggling playableSuspended/playing while below 50% visible emits nothing at all', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.3); // never visible enough to start an appearance
	r.engine.setPlayableSuspended(el, true);
	r.engine.setPlayableSuspended(el, false);
	r.engine.setPlaying(el, true);
	r.advance(2000);
	r.engine.materialize();
	assert.equal(r.emitted.length, 0);
});

test('materialize() sends only newly accumulated playable_v*/playing_v* each time, never the cumulative total', () => {
	const r = rig();
	const el = fakeEl();
	r.engine.observe(el, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.setRatio(el, 0.95);
	r.engine.setPlaying(el, true);
	r.advance(8000);
	r.engine.materialize();
	const d1 = r.deltas()[0];
	assert.equal(d1.playable_v50_ms, 8000);
	assert.equal(d1.playing_v50_ms, 8000);
	r.advance(5000);
	r.engine.materialize();
	const d2 = r.deltas()[1];
	assert.equal(d2.playable_v50_ms, 5000); // NOT 13000
	assert.equal(d2.playing_v50_ms, 5000);
});

test('cross-context canonical identity: playable_v*/playing_v* accounting is independent per DOM instance even though target_id is shared (Timeline vs. Project Modal)', () => {
	const r = rig();
	const timelineEl = fakeEl();
	const modalEl = fakeEl();
	r.engine.observe(timelineEl, 'project_content', 'heroes6-clip', { owner: 'main', playableKind: 'native-video' });
	r.engine.observe(modalEl, 'project_content', 'heroes6-clip', { owner: 'project_modal', playableKind: 'native-video' });
	r.engine.setPlaying(timelineEl, true);
	r.setRatio(timelineEl, 0.9);
	r.advance(1000);
	r.engine.materialize();
	assert.equal(r.deltas().length, 1);
	const timelineDelta = r.deltas()[0];
	assert.equal(timelineDelta.target_id, 'heroes6-clip');
	assert.equal(timelineDelta.playing_v50_ms, 1000);

	r.setState(PROJECT('proj-1'));
	r.engine.setPlaying(modalEl, true);
	r.setRatio(modalEl, 0.9);
	r.advance(500);
	r.engine.materialize();
	assert.equal(r.deltas().length, 2);
	const modalDelta = r.deltas()[1];
	assert.equal(modalDelta.target_id, 'heroes6-clip'); // same canonical id
	assert.equal(modalDelta.playing_v50_ms, 500);
	assert.notEqual(modalDelta.appearance_id, timelineDelta.appearance_id); // independent DOM instance, own appearance
});

test('a project_content visibility_delta with playable_v*/playing_v* fields, and its video_start, both pass the real Worker validator', () => {
	let clockT = 1000;
	const clk = { now: () => clockT, iso: () => '2026-09-29T10:00:00.000Z' };
	const queue = new EventQueue(clk, clk.now());
	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1200, innerHeight: 800, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: false }),
		},
		'sess-id-0300', clk.iso(),
	);
	let onRatio: ((ratio: number) => void) | undefined;
	const el = fakeEl();
	const engine = new VisibilityMatrixEngine({
		clock: clk,
		setTimer: () => 0,
		clearTimer: () => {},
		newId: randomId,
		emit: (type, opts) => queue.emit(type, opts),
		getState: () => MAIN,
		subscribe: () => () => {},
		observeElement: (_el, cb) => {
			onRatio = cb;
			return () => {};
		},
	});
	engine.observe(el, 'project_content', 'heroes6-clip', {
		owner: 'main',
		playableKind: 'native-video',
		properties: { content_type: 'video', person: 'mitko' },
	});
	onRatio!(0.9);
	engine.setPlaying(el, true); // fires video_start synchronously
	clockT += 750;
	engine.materialize();
	const events = queue.peek(10, 1e6);
	assert.equal(events.length, 2); // video_start + visibility_delta, in that order
	assert.equal(events[0].event_type, 'video_start');
	assert.equal(events[1].event_type, 'visibility_delta');
	assert.deepEqual(events[0].properties, { content_type: 'video', person: 'mitko' });
	assert.equal(events[1].playable_v50_ms, 750);
	assert.equal(events[1].playing_v50_ms, 750);
	for (const ev of events) {
		for (const followUp of [false, true]) {
			const res = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, followUp, [ev]))));
			assert.equal(res.ok, true, res.ok ? '' : res.detail);
		}
	}
});
