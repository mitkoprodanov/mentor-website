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
		emit: (_type, opts) => emitted.push(opts),
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
