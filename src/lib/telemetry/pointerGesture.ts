// Turns raw pointerdown/pointerup pairs into "activations" (docs/telemetry.md
// section 17.9). Pure and DOM-free: the wiring in interactions.ts feeds it
// plain event-like objects, so it is unit-testable directly.
//
// An activation is ONE trusted, primary-button (or primary touch/pen contact)
// press-and-release that did not move: it is not a keyboard-generated click, not
// a synthetic event, not a secondary button, and not a drag / text-selection /
// scroll gesture. Using pointer events (not `click`) is deliberate: `click` is
// never dispatched for keyboard-free taps on plain text in iOS Safari when
// delegated, and pointer events survive existing `stopPropagation()` calls when
// observed in the capture phase.

import { pointerTypeOf } from './explicitEvents.ts';

/** Max down→up travel (CSS px) for a press to still count as an activation. */
export const MOVE_THRESHOLD_PX = 10;

export interface RawPointerEvent {
	isTrusted: boolean;
	pointerId: number;
	pointerType?: string;
	isPrimary: boolean;
	button: number;
	clientX: number;
	clientY: number;
	timeStamp: number;
	ctrlKey?: boolean;
}

export interface Activation {
	/** Monotonic time of the pointerup, ms (event.timeStamp). */
	t: number;
	x: number;
	y: number;
	/** Only a real, known PointerEvent value; never guessed. */
	pointerType?: 'mouse' | 'touch' | 'pen';
}

/** Bound on tracked simultaneous pointers (defence against leaked entries). */
const MAX_TRACKED = 16;

function qualifiesAsPress(e: RawPointerEvent): boolean {
	if (!e.isTrusted) return false; // synthetic (e.g. chip.click() style dispatches)
	if (!e.isPrimary) return false; // second finger etc.
	if (e.button !== 0) return false; // secondary / auxiliary button
	// Ctrl+click on macOS is a context-menu gesture, not an activation.
	if (e.pointerType === 'mouse' && e.ctrlKey) return false;
	return Number.isFinite(e.clientX) && Number.isFinite(e.clientY);
}

export class ActivationFilter {
	private downs = new Map<number, { x: number; y: number }>();

	down(e: RawPointerEvent): void {
		if (!qualifiesAsPress(e)) return;
		if (this.downs.size >= MAX_TRACKED) this.downs.clear();
		this.downs.set(e.pointerId, { x: e.clientX, y: e.clientY });
	}

	/** Returns the activation this pointerup completes, or null if it was not one. */
	up(e: RawPointerEvent): Activation | null {
		const d = this.downs.get(e.pointerId);
		this.downs.delete(e.pointerId);
		if (!d) return null;
		if (!qualifiesAsPress(e)) return null;
		if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > MOVE_THRESHOLD_PX) return null;
		return { t: e.timeStamp, x: e.clientX, y: e.clientY, pointerType: pointerTypeOf(e) };
	}

	/** `pointercancel` — the browser took the gesture over (scroll, long-press, …). */
	cancel(e: { pointerId: number }): void {
		this.downs.delete(e.pointerId);
	}
}
