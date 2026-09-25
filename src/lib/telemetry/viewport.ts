// Coalesces browser `resize` callbacks into sparse `viewport_changed` events.
// Pure logic with injected timers/measurement so it is unit-testable; the
// browser wiring lives in client.ts. See docs/telemetry.md section 13.1.

/** A resize burst is settled after this much quiet; the final size is emitted. */
export const SETTLE_MS = 500;
/** During a continuous burst, at most one intermediate emission per interval. */
export const INTERMEDIATE_INTERVAL_MS = 5_000;
/** Minimum width/height change (CSS px) versus the last emitted size to count. */
export const MIN_CHANGE_PX = 10;
/** On a coarse-pointer device, a height-only change (mobile URL bar, keyboard)
 *  must be at least this large. Width changes and rotations use MIN_CHANGE_PX. */
export const COARSE_HEIGHT_ONLY_MIN_CHANGE_PX = 120;
/** Matches the Worker's dimension cap. */
const MAX_DIMENSION = 20_000;

export interface Size {
	width: number;
	height: number;
}

export interface ViewportDeps {
	/** Current viewport (window.innerWidth/innerHeight), or null if unavailable. */
	read(): Size | null;
	/** Queue a `viewport_changed` event. */
	emit(size: Size): void;
	setTimer(fn: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
	/** Primary pointer is coarse (phone/tablet): enables the height-only filter. */
	coarsePointer: boolean;
}

export function normalizeSize(s: Size | null): Size | null {
	if (!s) return null;
	const width = Math.round(s.width);
	const height = Math.round(s.height);
	if (!(width >= 1 && width <= MAX_DIMENSION && height >= 1 && height <= MAX_DIMENSION)) return null;
	return { width, height };
}

export class ViewportTracker {
	private baseline: Size | null;
	private settleTimer: unknown;
	private intermediateTimer: unknown;
	private readonly deps: ViewportDeps;

	/** `initial` is the size already recorded in the session row. */
	constructor(initial: Size | null, deps: ViewportDeps) {
		this.baseline = normalizeSize(initial);
		this.deps = deps;
	}

	/** Call from every browser `resize` callback. */
	onResize(): void {
		if (this.settleTimer !== undefined) this.deps.clearTimer(this.settleTimer);
		this.settleTimer = this.deps.setTimer(() => this.finalize(), SETTLE_MS);
		if (this.intermediateTimer === undefined) this.armIntermediate();
	}

	/** Measures now and emits if the change is meaningful; cancels pending timers.
	 *  Also called by the client before a lifecycle flush. */
	finalize(): void {
		this.clearTimers();
		this.emitIfChanged();
	}

	private armIntermediate(): void {
		this.intermediateTimer = this.deps.setTimer(() => {
			this.intermediateTimer = undefined;
			this.emitIfChanged();
			// Still resizing (a settle is pending): allow one more later.
			if (this.settleTimer !== undefined) this.armIntermediate();
		}, INTERMEDIATE_INTERVAL_MS);
	}

	private clearTimers(): void {
		if (this.settleTimer !== undefined) this.deps.clearTimer(this.settleTimer);
		if (this.intermediateTimer !== undefined) this.deps.clearTimer(this.intermediateTimer);
		this.settleTimer = undefined;
		this.intermediateTimer = undefined;
	}

	private emitIfChanged(): void {
		const now = normalizeSize(this.deps.read());
		if (!now) return;
		if (this.baseline && !this.isMeaningful(this.baseline, now)) return;
		this.baseline = now;
		this.deps.emit(now);
	}

	private isMeaningful(from: Size, to: Size): boolean {
		const dw = Math.abs(to.width - from.width);
		const dh = Math.abs(to.height - from.height);
		const heightMin =
			this.deps.coarsePointer && dw < MIN_CHANGE_PX ? COARSE_HEIGHT_ONLY_MIN_CHANGE_PX : MIN_CHANGE_PX;
		return dw >= MIN_CHANGE_PX || dh >= heightMin;
	}
}
