// The Visibility Matrix engine: cumulative active-visibility time at nested
// thresholds (50/70/85/95%) plus a per-appearance max ratio, for a small set
// of instrumented DOM targets. See docs/telemetry.md sections 6-7 and 17.3.
//
// Two independent concerns, deliberately kept separate:
//
//   - APPEARANCE IDENTITY (startAppearance/endAppearance) is driven purely by
//     geometry (IntersectionObserver ratio) plus the 300ms grace period and
//     the Skills-instance boundary rule. An appearance is "one continuous
//     opportunity to encounter the target" — it does not end just because a
//     blocking surface suspends counting, the same way a hidden tab is lost
//     measurement opportunity rather than evidence the visitor scrolled away.
//
//   - ACTIVE-TIME ACCOUNTING (account()) decides whether elapsed time is
//     actually added to the nested counters: only while the document is
//     visible, the target is connected, and its owning surface is the
//     current semantic surface (semanticState.isActive(owner), reimplemented
//     here against a locally cached surface so a boundary always accounts
//     the OLD state before a transition is applied — see onStateChange).
//
// Every state-affecting event (ratio change, semantic transition, document
// visibility change, materialize, appearance end) accounts elapsed time under
// the conditions that held *before* the event, then applies the change and
// moves the accounting boundary to "now" — so time is never double-counted or
// misattributed across a boundary (docs section "Timing/accounting").
//
// No direct `fetch`, no retry/backoff: `deps.emit` routes into the existing
// queue exactly like any other telemetry event.

import type { SemanticState, Surface } from './state.ts';
import type { PropertyValue } from './types.ts';

/** A dip below 50% shorter than this does not end the appearance (docs section 7). */
export const GRACE_MS = 300;

const THRESHOLDS = [
	{ key: 'v50', ratio: 0.5 },
	{ key: 'v70', ratio: 0.7 },
	{ key: 'v85', ratio: 0.85 },
	{ key: 'v95', ratio: 0.95 },
] as const;

type ThresholdKey = (typeof THRESHOLDS)[number]['key'];

/** Which surface owns each *fixed-owner* target type's active-time accounting
 *  (docs section 6.1: "Surface ownership"). Instrumenting a targetType that's
 *  neither listed here nor given an explicit owner via `ObserveOptions.owner`
 *  is a no-op — a deliberate scope guard. `vision_tooltip` is owned by
 *  `main`, same as `vision_content` itself. `project_intro` and
 *  `project_content` are deliberately absent: the same canonical content
 *  renders under different surfaces depending on where it appears (Timeline
 *  preview vs. Project Modal vs. Skill Filtered View), so their owner is
 *  supplied per-registration by the rendering context, which already knows
 *  it statically — see `observe()` and docs section 17.6. */
export const OWNER: Readonly<Record<string, Surface>> = {
	vision_content: 'main',
	vision_tooltip: 'main',
	timeline_project: 'main',
	skills_person: 'skills',
	filtered_project: 'skill_filtered',
};

/** Surfaces that acquire their own `view_instance_id` (docs section 17.2).
 *  An appearance on a target owned by one of these must never survive that
 *  surface's instance changing, even before geometry reflects it (docs
 *  section 17.3's "instance-boundary rule", generalized beyond `skills_person`
 *  to `project_modal`/`skill_filtered`-owned targets in this pass — e.g.
 *  `project_intro`/`project_content` rendered inside a Project Modal or
 *  Skill Filtered View). `main` is deliberately absent: it never acquires an
 *  instance, so main-owned targets are only ever suspended, never forced to
 *  end, by a surface change (docs section 17.3). */
const INSTANCED_SURFACES = new Set<Surface>(['skills', 'project_modal', 'skill_filtered']);

/** Geometry thresholds requested from IntersectionObserver. 0 and 1 are
 *  included so a target that starts (or ends) fully offscreen, or reaches
 *  full coverage, still reliably delivers a callback at the edges. */
export const OBSERVER_THRESHOLDS = [0, 0.5, 0.7, 0.85, 0.95, 1];

/** Options for `observe()`. Both fields are supplied by the rendering
 *  context, never inferred from DOM state at runtime (docs section 17.6). */
export interface ObserveOptions {
	/** Explicit owner for a context-dependent target type (`project_intro`,
	 *  `project_content`) — the same canonical content can render under
	 *  `main`, `project_modal`, or `skill_filtered` depending on where this
	 *  particular DOM instance sits, and the caller already knows which one
	 *  statically at render time. Ignored (the fixed `OWNER` entry wins) for
	 *  a target type that isn't context-dependent; a target type with
	 *  neither an `OWNER` entry nor an explicit `owner` here is ignored. */
	owner?: Surface;
	/** Static per-target metadata repeated on every `visibility_delta` of
	 *  every appearance of this target — e.g. `content_type`/`person` for a
	 *  `project_content` unit. Distinct from the per-appearance
	 *  `triggerMethod` (`setTriggerContext`): this is a fixed fact about the
	 *  target itself, set once at registration. */
	properties?: Record<string, PropertyValue>;
}

export interface VisibilityEmitOptions {
	target_type: string;
	target_id: string;
	appearance_id: string;
	view_instance_id?: string;
	v50_ms: number;
	v70_ms: number;
	v85_ms: number;
	v95_ms: number;
	max_visibility_ratio: number;
	/** e.g. `trigger_method` for a `vision_tooltip` appearance (section 17.3/17.4). */
	properties?: Record<string, PropertyValue>;
}

export interface VisibilityDeps {
	/** Monotonic clock consistent with the rest of the telemetry client (`performance.now()` in the browser). */
	clock: { now(): number };
	setTimer(fn: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
	/** Random ID for a new appearance; null if no CSPRNG (that encounter is silently left untracked, like the rest of telemetry). */
	newId(): string | null;
	/** Routes a `visibility_delta` into the existing queue. Never calls fetch. */
	emit(eventType: 'visibility_delta', opts: VisibilityEmitOptions): void;
	/** Current semantic state; read once at construction. */
	getState(): SemanticState;
	/** Notified after a semantic transition; snapshot is the state AFTER the transition. */
	subscribe(fn: (state: SemanticState) => void): () => void;
	/** Creates the geometry source for one element; defaults to a real
	 *  IntersectionObserver. Tests inject a fake to drive ratios manually
	 *  without a DOM/layout engine. */
	observeElement?(el: Element, onRatio: (ratio: number) => void): () => void;
	/** Called right after a semantic surface transition has been accounted for
	 *  and drained (docs section "Semantic state-boundary flush"), so the
	 *  client can request the existing transport flush promptly instead of
	 *  waiting for the periodic safety flush. Optional so tests that don't
	 *  care about flush timing can omit it. */
	requestFlush?(): void;
}

interface Counters {
	v50: number;
	v70: number;
	v85: number;
	v95: number;
}

const zeroCounters = (): Counters => ({ v50: 0, v70: 0, v85: 0, v95: 0 });

interface Target {
	targetType: string;
	targetId: string;
	owner: Surface;
	unobserve: () => void;

	ratio: number;
	connected: boolean;

	appearanceId: string | null;
	/** The Skills view_instance_id captured when THIS appearance started; null
	 *  for main-owned targets (main never acquires a new view instance) and
	 *  for a skills_person appearance that started outside a Skills instance
	 *  (shouldn't happen in practice, since geometry is ~0 until Skills opens,
	 *  but guarded regardless). Reused for every delta of the appearance, even
	 *  after the live instance has since changed — see docs section 17.3. */
	appearanceInstanceId: string | null;
	appearanceMaxRatio: number;
	cumulative: Counters;
	sent: Counters;

	/** Objective trigger context (e.g. `hover`/`focus`/`click`/`touch` for a
	 *  `vision_tooltip`) captured for the CURRENT appearance, if the caller
	 *  supplied one via `setTriggerContext`. Repeated on every delta of that
	 *  appearance; null when the caller never determined one. */
	triggerMethod: string | null;
	/** Set via `setTriggerContext` before geometry confirms the appearance;
	 *  consumed (and cleared) by the next `startAppearance`. */
	pendingTriggerMethod: string | null;

	/** Static metadata from `ObserveOptions.properties` (e.g. `content_type`,
	 *  `person`) — fixed for the target's lifetime, merged into every drained
	 *  delta alongside `triggerMethod` (docs section 17.6). */
	staticProperties: Record<string, PropertyValue> | undefined;

	/** Monotonic time through which `cumulative` has already been accounted. */
	lastBoundary: number;
	graceTimer: unknown;
}

/** Real IntersectionObserver-backed geometry source (the default `observeElement`). */
function defaultObserveElement(el: Element, onRatio: (ratio: number) => void): () => void {
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.target === el) onRatio(entry.intersectionRatio);
			}
		},
		{ threshold: OBSERVER_THRESHOLDS },
	);
	observer.observe(el);
	return () => observer.disconnect();
}

export class VisibilityMatrixEngine {
	private readonly deps: VisibilityDeps;
	private readonly targets = new Map<Element, Target>();
	private documentVisible = true;
	private currentState: SemanticState;

	constructor(deps: VisibilityDeps) {
		this.deps = deps;
		this.currentState = deps.getState();
		deps.subscribe((state) => this.onStateChange(state));
	}

	/** Starts tracking `el` as `targetType`/`targetId`. Owner is `options.owner`
	 *  when given, else looked up from `targetType` in the fixed `OWNER` map
	 *  (docs section 6.1); a target type that resolves to neither is ignored
	 *  — a deliberate scope guard. Registering the same element twice is a
	 *  no-op. */
	observe(el: Element, targetType: string, targetId: string, options?: ObserveOptions): void {
		if (this.targets.has(el)) return;
		const owner = options?.owner ?? OWNER[targetType];
		if (!owner) return;
		const target: Target = {
			targetType,
			targetId,
			owner,
			unobserve: () => {},
			ratio: 0,
			connected: el.isConnected,
			appearanceId: null,
			appearanceInstanceId: null,
			appearanceMaxRatio: 0,
			cumulative: zeroCounters(),
			sent: zeroCounters(),
			triggerMethod: null,
			pendingTriggerMethod: null,
			staticProperties: options?.properties,
			lastBoundary: this.deps.clock.now(),
			graceTimer: null,
		};
		this.targets.set(el, target);
		const observeElement = this.deps.observeElement ?? defaultObserveElement;
		target.unobserve = observeElement(el, (ratio) => this.onRatio(el, target, ratio));
	}

	/** Records objective trigger context (e.g. `hover`/`focus`/`click`/`touch`)
	 *  for the appearance about to start on `el` — call right when the caller's
	 *  own UI shows the target, before geometry necessarily confirms it. Applies
	 *  to the next `startAppearance` (or replaces the pending value if one
	 *  hasn't been consumed yet); a no-op for an unregistered element. */
	setTriggerContext(el: Element, method: string | undefined): void {
		const target = this.targets.get(el);
		if (!target) return;
		target.pendingTriggerMethod = method ?? null;
	}

	/**
	 * Ends whatever appearance is active on `el` right now, immediately —
	 * for a target whose own UI can determine precisely when it stopped being
	 * presented (e.g. a Vision tooltip forced hidden) rather than waiting for
	 * IntersectionObserver to eventually report the resulting ratio drop plus
	 * the 300ms grace window. Accounts elapsed time up to now first, so the
	 * final delta is exact; a no-op if `el` has no active appearance.
	 */
	endAppearanceNow(el: Element): void {
		const target = this.targets.get(el);
		if (!target || !target.appearanceId) return;
		this.account(target, this.deps.clock.now());
		this.endAppearance(target);
	}

	/**
	 * The clean integration point: accounts elapsed time through NOW and
	 * drains every target's unsent deltas into the queue. The telemetry
	 * client calls this immediately before every transport flush — periodic,
	 * lifecycle hidden/pagehide, and any future state-boundary flush — so a
	 * delta produced between flushes is never left stranded past a flush that
	 * already captured its batch (docs section "Flush integration").
	 */
	materialize(): void {
		const now = this.deps.clock.now();
		for (const target of this.targets.values()) {
			this.account(target, now);
			this.drain(target);
		}
	}

	/** Document went hidden: account through this instant, then stop counting
	 *  (hidden-tab time contributes zero) until resume(). Does not end any
	 *  appearance — a hidden tab is lost measurement opportunity, not evidence
	 *  the visitor left (docs section "Document visibility"). */
	pause(): void {
		const now = this.deps.clock.now();
		for (const target of this.targets.values()) this.account(target, now);
		this.documentVisible = false;
	}

	/** Document became visible again: resume counting from current geometry/state. */
	resume(): void {
		const now = this.deps.clock.now();
		// Accounted while still marked hidden, so the hidden span itself
		// contributes zero; this also moves every target's boundary to now so
		// nothing from the hidden interval leaks into what follows.
		for (const target of this.targets.values()) this.account(target, now);
		this.documentVisible = true;
	}

	/**
	 * Semantic state-boundary handling (docs section "Semantic state-boundary
	 * flush"): Skills/Project Detail/Skill Filtered View opening or closing all
	 * change `surface`. On any such change this:
	 *   1. accounts elapsed time under the OLD surface through the transition
	 *      instant (so no pre-transition time lands on the new surface and no
	 *      post-transition time lands on the old one — the existing per-target
	 *      `account()` boundary, run before anything else changes);
	 *   2. applies the instance-boundary forced end where it applies;
	 *   3. switches `currentState` so later accounting uses the new surface;
	 *   4. drains every target's newly-unsent deltas into the queue; and
	 *   5. asks the client (`requestFlush`) to flush promptly rather than
	 *      waiting for the ~20s periodic safety flush.
	 * The semantic transition event itself (e.g. `skills_open`) is already
	 * queued before this runs — `SemanticStateCoordinator` emits, then
	 * notifies subscribers (this method included) — so step 5's flush picks up
	 * both that event and these deltas in the same batch.
	 */
	private onStateChange(state: SemanticState): void {
		const now = this.deps.clock.now();
		// Account elapsed time under the OLD state/eligibility first.
		for (const target of this.targets.values()) this.account(target, now);

		// Instance-boundary rule (generalized beyond skills_person this pass —
		// docs section 17.6): an appearance on any instanced-owner target
		// never survives its owning surface's instance changing, even if
		// geometry hasn't yet dipped below 50% (e.g. a blocking view opening
		// on top collapses the panel via CSS, but the forced end here
		// doesn't wait for that transition). Main-owned targets have no
		// instance and are unaffected — they're only ever suspended.
		const newInstance = INSTANCED_SURFACES.has(state.surface) ? state.viewInstanceId : null;
		const oldInstance = INSTANCED_SURFACES.has(this.currentState.surface) ? this.currentState.viewInstanceId : null;
		if (newInstance !== oldInstance) {
			for (const target of this.targets.values()) {
				if (INSTANCED_SURFACES.has(target.owner) && target.appearanceId && target.appearanceInstanceId !== newInstance) {
					this.endAppearance(target);
				}
			}
		}

		const surfaceChanged = state.surface !== this.currentState.surface;
		this.currentState = state;

		if (surfaceChanged) {
			// Persists the just-suspended surface's measurements (opening a
			// blocking surface) or the just-closed blocking surface's
			// measurements (closing one) — the same drain either direction.
			for (const target of this.targets.values()) this.drain(target);
			this.deps.requestFlush?.();
		}
	}

	private onRatio(el: Element, target: Target, ratio: number): void {
		const now = this.deps.clock.now();
		this.account(target, now);
		target.connected = el.isConnected;
		target.ratio = ratio;
		if (ratio >= 0.5) {
			this.cancelGrace(target);
			if (!target.appearanceId) this.startAppearance(target);
			// max_visibility_ratio means the max ratio observed WHILE ELIGIBLE —
			// suspended/hidden/disconnected geometry must never raise it (docs
			// section "max_visibility_ratio eligibility").
			if (this.isEligible(target)) target.appearanceMaxRatio = Math.max(target.appearanceMaxRatio, ratio);
		} else if (target.appearanceId && target.graceTimer === null) {
			target.graceTimer = this.deps.setTimer(() => this.onGraceExpired(target), GRACE_MS);
		}
		target.lastBoundary = now;
	}

	/** The same eligibility test `account()` applies to time, reused for the
	 *  max-ratio gate: document visible, target connected, owning surface active. */
	private isEligible(target: Target): boolean {
		return this.documentVisible && target.connected && this.currentState.surface === target.owner;
	}

	private onGraceExpired(target: Target): void {
		target.graceTimer = null;
		const now = this.deps.clock.now();
		this.account(target, now); // ratio has stayed < 50% throughout: zero-time no-op
		this.endAppearance(target);
	}

	private cancelGrace(target: Target): void {
		if (target.graceTimer !== null) {
			this.deps.clearTimer(target.graceTimer);
			target.graceTimer = null;
		}
	}

	private startAppearance(target: Target): void {
		const id = this.deps.newId();
		if (!id) return; // no CSPRNG: this encounter goes untracked, like the rest of telemetry
		target.appearanceId = id;
		target.appearanceInstanceId =
			INSTANCED_SURFACES.has(target.owner) && this.currentState.surface === target.owner ? this.currentState.viewInstanceId : null;
		// Eligibility-gated: onRatio (the only caller) applies the max-ratio
		// bump itself, right after this returns, using the same isEligible()
		// check it would use for any other ratio observation.
		target.appearanceMaxRatio = 0;
		target.cumulative = zeroCounters();
		target.sent = zeroCounters();
		target.triggerMethod = target.pendingTriggerMethod;
		target.pendingTriggerMethod = null;
	}

	private endAppearance(target: Target): void {
		this.cancelGrace(target);
		this.drain(target); // final unsent deltas, still under the ending appearance_id
		target.appearanceId = null;
		target.appearanceInstanceId = null;
		target.appearanceMaxRatio = 0;
		target.cumulative = zeroCounters();
		target.sent = zeroCounters();
		target.triggerMethod = null;
	}

	/** Adds elapsed time since `target.lastBoundary` to whichever nested
	 *  counters are eligible right now, then moves the boundary to `now`.
	 *  Ratio/eligibility are treated as constant across the elapsed span,
	 *  which holds because every place they can change calls this first. */
	private account(target: Target, now: number): void {
		const elapsed = now - target.lastBoundary;
		target.lastBoundary = now;
		if (elapsed <= 0 || !target.appearanceId) return;
		if (!this.isEligible(target)) return;
		for (const { key, ratio } of THRESHOLDS) {
			if (target.ratio >= ratio) target.cumulative[key as ThresholdKey] += elapsed;
		}
	}

	/** Emits one `visibility_delta` for whatever has accumulated since the
	 *  last drain, if anything meaningful has (no zero-time noise). */
	private drain(target: Target): void {
		if (!target.appearanceId) return;
		const d50 = target.cumulative.v50 - target.sent.v50;
		if (d50 <= 0) return; // nested thresholds: any real time implies v50 time too
		const d70 = target.cumulative.v70 - target.sent.v70;
		const d85 = target.cumulative.v85 - target.sent.v85;
		const d95 = target.cumulative.v95 - target.sent.v95;
		target.sent = { ...target.cumulative };
		// Static per-target facts (content_type/person, etc.) and the
		// per-appearance trigger method are independent sources, merged here
		// so callers of either mechanism never have to know about the other.
		const properties =
			target.staticProperties || target.triggerMethod
				? { ...target.staticProperties, ...(target.triggerMethod ? { trigger_method: target.triggerMethod } : {}) }
				: undefined;
		this.deps.emit('visibility_delta', {
			target_type: target.targetType,
			target_id: target.targetId,
			appearance_id: target.appearanceId,
			view_instance_id: target.appearanceInstanceId ?? undefined,
			v50_ms: Math.round(d50),
			v70_ms: Math.round(d70),
			v85_ms: Math.round(d85),
			v95_ms: Math.round(d95),
			max_visibility_ratio: target.appearanceMaxRatio,
			properties,
		});
	}
}
