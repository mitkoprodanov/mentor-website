// Pass 4 pointer-interaction capture (docs/telemetry.md section 17.9): ONE shared
// capture-phase listener set feeding
//   - `noninteractive_click`  (allowlisted affordances, emitted immediately),
//   - `click_burst`           (global, in-memory, emitted only when confirmed),
//   - `context_menu`          (meaningful semantic targets only).
// Ordinary activations are never sent. Listeners are capture + passive, never
// call preventDefault/stopPropagation, and swallow every error.

import { BurstDetector } from './clickBurst.ts';
import type { BurstDeps } from './clickBurst.ts';
import { pointerTypeOf } from './explicitEvents.ts';
import { resolve, resolveContext } from './interactionResolver.ts';
import type { ContextHit, NoninteractiveHit } from './interactionResolver.ts';
import { ActivationFilter } from './pointerGesture.ts';
import type { RawPointerEvent } from './pointerGesture.ts';
import type { EmitOptions, PropertyValue } from './types.ts';

export interface WindowLike {
	addEventListener(type: string, listener: (e: any) => void, options?: unknown): void;
}

export interface InteractionDeps {
	target: WindowLike;
	emit(type: string, opts?: EmitOptions): void;
	getState(): { surface: string; viewInstanceId: string | null };
	toElapsed: BurstDeps['toElapsed'];
	setTimer: BurstDeps['setTimer'];
	clearTimer: BurstDeps['clearTimer'];
	viewport: BurstDeps['viewport'];
}

export interface InteractionCapture {
	/** Lifecycle boundary: finalise an already-confirmed burst now (idempotent). */
	finalizeConfirmed(): void;
}

// ---- pure payload builders --------------------------------------------------

export function buildNoninteractiveClick(
	hit: NoninteractiveHit,
	pointerType: string | undefined,
	viewInstanceId: string | null,
): EmitOptions {
	const properties: Record<string, PropertyValue> = { element: hit.element };
	if (hit.projectId) properties.project_id = hit.projectId;
	const pt = pointerTypeOf({ pointerType });
	if (pt) properties.pointer_type = pt;
	const opts: EmitOptions = { target_type: hit.type, target_id: hit.id, properties };
	if (viewInstanceId) opts.view_instance_id = viewInstanceId;
	return opts;
}

/** `pointerType` is passed only when the event actually exposes one; never guessed. */
export function buildContextMenu(
	hit: ContextHit,
	pointerType: string | undefined,
	viewInstanceId: string | null,
): EmitOptions {
	const properties: Record<string, PropertyValue> = { element: hit.element, ...(hit.properties ?? {}) };
	const pt = pointerTypeOf({ pointerType });
	if (pt) properties.pointer_type = pt;
	const opts: EmitOptions = { target_type: hit.type, target_id: hit.id, properties };
	if (viewInstanceId) opts.view_instance_id = viewInstanceId;
	return opts;
}

// ---- wiring -------------------------------------------------------------------

export function startInteractionCapture(deps: InteractionDeps): InteractionCapture {
	const filter = new ActivationFilter();
	const bursts = new BurstDetector({
		toElapsed: deps.toElapsed,
		emit: (type, opts) => deps.emit(type, opts),
		setTimer: deps.setTimer,
		clearTimer: deps.clearTimer,
		viewport: deps.viewport,
	});
	const opts = { capture: true, passive: true };

	deps.target.addEventListener(
		'pointerdown',
		(e: RawPointerEvent) => {
			try {
				filter.down(e);
			} catch {
				/* never affect the site */
			}
		},
		opts,
	);
	deps.target.addEventListener(
		'pointercancel',
		(e: { pointerId: number }) => {
			try {
				filter.cancel(e);
			} catch {
				/* never affect the site */
			}
		},
		opts,
	);
	deps.target.addEventListener(
		'pointerup',
		(e: RawPointerEvent & { target: unknown }) => {
			try {
				const activation = filter.up(e);
				if (!activation) return;
				const state = deps.getState();
				const r = resolve(e.target, state.surface, activation.pointerType);
				if (!r) return;
				if (r.noninteractive) {
					deps.emit('noninteractive_click', buildNoninteractiveClick(r.noninteractive, activation.pointerType, state.viewInstanceId));
				}
				bursts.onActivation({
					...activation,
					semantic: r.semantic,
					interactive: r.interactive,
					textLike: r.textLike,
					region: r.region,
					viewInstanceId: state.viewInstanceId,
				});
			} catch {
				/* never affect the site */
			}
		},
		opts,
	);
	deps.target.addEventListener(
		'contextmenu',
		(e: { target: unknown; pointerType?: string }) => {
			try {
				const hit = resolveContext(e.target);
				if (!hit) return;
				deps.emit('context_menu', buildContextMenu(hit, e.pointerType, deps.getState().viewInstanceId));
			} catch {
				/* never affect the site */
			}
		},
		opts,
	);

	return { finalizeConfirmed: () => bursts.finalizeConfirmed() };
}
