// `click_burst` detector (docs/telemetry.md section 17.9). Pure and DOM-free,
// with injected timers and emit so it is deterministic under test.
//
// Ordinary activations are only remembered in memory and are NEVER sent. A
// burst is emitted only once it is confirmed (>= 3 qualifying activations), and
// exactly once, at its END, so the payload carries the full count/duration.
// Confirmed bursts are additionally finalised immediately on page lifecycle
// boundaries (`finalizeConfirmed`) instead of waiting for the idle timer.
//
// The event only reports objective facts (count, timing, position, what kind of
// DOM the activations hit). Interpretation ("rage click") happens later.

import type { Activation } from './pointerGesture.ts';
import type { EmitOptions, PropertyValue } from './types.ts';

export const BURST = {
	/** Confirmed at the 3rd qualifying activation. */
	MIN_COUNT: 3,
	/** Max gap between consecutive activations of one burst. */
	MAX_GAP_MS: 1000,
	/** Radius around the FIRST activation (anchored — no drift chaining). */
	FINE_RADIUS_PX: 40,
	COARSE_RADIUS_PX: 60,
	/** Hard safety caps. */
	MAX_DURATION_MS: 10_000,
	MAX_COUNT: 30,
	/** Fixed per-session cap on emitted bursts (bounds volume / stuck auto-clickers). */
	MAX_PER_SESSION: 25,
	/** Native triple-click text selection: exactly 3 within this spread/time on text. */
	TRIPLE_SPREAD_PX: 8,
	TRIPLE_DURATION_MS: 600,
} as const;

/** What the resolver (interactionResolver.ts) knows about one activation. */
export interface BurstActivation extends Activation {
	semantic: { type: string; id: string } | null;
	/** DOM control / known actionable surface was hit. */
	interactive: boolean;
	/** Noninteractive, non-affordance content where text selection is plausible. */
	textLike: boolean;
	region: string;
	viewInstanceId?: string | null;
}

export interface BurstDeps {
	/** Converts an activation's `t` to session-relative elapsed ms. */
	toElapsed(t: number): number;
	emit(type: string, opts: EmitOptions): void;
	setTimer(fn: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
	viewport(): { width: number; height: number };
}

interface Candidate {
	anchorX: number;
	anchorY: number;
	radius: number;
	first: BurstActivation;
	lastT: number;
	count: number;
	/** Every activation's position (<= MAX_COUNT), for the reporting centroid/spread. */
	xs: number[];
	ys: number[];
	/** Max distance from the FIRST activation — only the triple-click heuristic uses it. */
	maxDist: number;
	semantics: Map<string, { type: string; id: string }>;
	unresolved: number;
	interactive: number;
	noninteractive: number;
	allTextLike: boolean;
	confirmed: boolean;
	timer: unknown;
}

const q2 = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

export class BurstDetector {
	private cur: Candidate | null = null;
	private emitted = 0;

	private readonly deps: BurstDeps;

	constructor(deps: BurstDeps) {
		this.deps = deps;
	}

	/** Feed one qualifying activation. */
	onActivation(a: BurstActivation): void {
		const c = this.cur;
		if (c) {
			const gap = a.t - c.lastT;
			const dist = Math.hypot(a.x - c.anchorX, a.y - c.anchorY);
			if (gap > BURST.MAX_GAP_MS || dist > c.radius || a.t - c.first.t > BURST.MAX_DURATION_MS) {
				this.end(); // terminates (emitting if confirmed) and the activation seeds a new candidate
			}
		}
		if (!this.cur) {
			this.cur = this.seed(a);
			return;
		}
		const cand = this.cur;
		cand.lastT = a.t;
		cand.count += 1;
		cand.xs.push(a.x);
		cand.ys.push(a.y);
		cand.maxDist = Math.max(cand.maxDist, Math.hypot(a.x - cand.anchorX, a.y - cand.anchorY));
		this.tally(cand, a);
		if (cand.count >= BURST.MIN_COUNT) cand.confirmed = true;
		if (cand.count >= BURST.MAX_COUNT) {
			this.end();
			return;
		}
		if (cand.confirmed) this.armIdle(cand);
	}

	/** Lifecycle boundary (visibility hidden / pagehide): emit an already-confirmed
	 *  burst NOW with what has accumulated; silently drop an unconfirmed candidate.
	 *  Idempotent — a second call (hidden then pagehide) finds nothing. */
	finalizeConfirmed(): void {
		this.end();
	}

	private seed(a: BurstActivation): Candidate {
		const c: Candidate = {
			anchorX: a.x,
			anchorY: a.y,
			radius: a.pointerType === 'touch' ? BURST.COARSE_RADIUS_PX : BURST.FINE_RADIUS_PX,
			first: a,
			lastT: a.t,
			count: 1,
			xs: [a.x],
			ys: [a.y],
			maxDist: 0,
			semantics: new Map(),
			unresolved: 0,
			interactive: 0,
			noninteractive: 0,
			allTextLike: true,
			confirmed: false,
			timer: null,
		};
		this.tally(c, a);
		return c;
	}

	private tally(c: Candidate, a: BurstActivation): void {
		if (a.semantic) c.semantics.set(`${a.semantic.type}\u0000${a.semantic.id}`, a.semantic);
		else c.unresolved += 1;
		if (a.interactive) c.interactive += 1;
		else c.noninteractive += 1;
		if (!a.textLike) c.allTextLike = false;
	}

	private armIdle(c: Candidate): void {
		if (c.timer !== null) this.deps.clearTimer(c.timer);
		c.timer = this.deps.setTimer(() => {
			if (this.cur === c) this.end();
		}, BURST.MAX_GAP_MS);
	}

	private end(): void {
		const c = this.cur;
		this.cur = null;
		if (!c) return;
		if (c.timer !== null) this.deps.clearTimer(c.timer);
		c.timer = null;
		if (!c.confirmed) return;
		const duration = Math.round(c.lastT - c.first.t);
		// Native triple-click text selection: exactly 3, pixel-tight, fast, on text.
		if (
			c.count === 3 &&
			c.maxDist <= BURST.TRIPLE_SPREAD_PX &&
			duration <= BURST.TRIPLE_DURATION_MS &&
			c.allTextLike
		) {
			return;
		}
		if (this.emitted >= BURST.MAX_PER_SESSION) return;
		this.emitted += 1;

		const vp = this.deps.viewport();
		const props: Record<string, PropertyValue> = {
			start_elapsed_ms: this.deps.toElapsed(c.first.t),
			duration_ms: duration,
			click_count: c.count,
			region: c.first.region,
			distinct_targets: c.semantics.size,
			unresolved_clicks: c.unresolved,
			target_class: c.noninteractive === 0 ? 'interactive' : c.interactive === 0 ? 'noninteractive' : 'mixed',
		};
		// Reporting (separate from detection, which is anchored to the first activation):
		// the arithmetic centroid of ALL the burst's activations, and the max Euclidean
		// distance from that centroid to any activation — a circle containing them all.
		const cx = c.xs.reduce((s, v) => s + v, 0) / c.xs.length;
		const cy = c.ys.reduce((s, v) => s + v, 0) / c.ys.length;
		props.spread_px = Math.round(Math.max(...c.xs.map((x, i) => Math.hypot(x - cx, c.ys[i] - cy))));
		if (vp.width > 0 && vp.height > 0) {
			props.center_x_ratio = q2(cx / vp.width);
			props.center_y_ratio = q2(cy / vp.height);
		}
		if (c.first.pointerType) props.pointer_type = c.first.pointerType;

		const opts: EmitOptions = { properties: props };
		if (c.semantics.size === 1) {
			const only = [...c.semantics.values()][0];
			opts.target_type = only.type;
			opts.target_id = only.id;
		}
		if (c.first.viewInstanceId) opts.view_instance_id = c.first.viewInstanceId;
		this.deps.emit('click_burst', opts);
	}
}
