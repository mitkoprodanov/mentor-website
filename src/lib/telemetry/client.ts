// Wires session, queue, transport and page lifecycle together in the browser.
// Every entry point swallows errors: telemetry must never affect the site.

import type { TelemetryConfig } from './config.ts';
import { startInteractionCapture } from './interactions.ts';
import { browserClock, EventQueue } from './queue.ts';
import { browserSessionEnv, buildSessionContext, randomId } from './session.ts';
import type { SemanticState } from './state.ts';
import { Transport } from './transport.ts';
import type { EmitOptions } from './types.ts';
import { VisibilityMatrixEngine } from './visibility.ts';
import type { ObserveOptions } from './visibility.ts';
import { ViewportTracker } from './viewport.ts';

/** Periodic safety flush while the page is visible. */
const FLUSH_INTERVAL_MS = 20_000;
/** Get the session row + session_start out promptly for short visits. */
const INITIAL_FLUSH_DELAY_MS = 1_500;

export interface TelemetryClient {
	emit(eventType: string, opts?: EmitOptions): void;
	flush(): Promise<void>;
	/** Registers a DOM element for Visibility Matrix accounting. See visibility.ts. */
	observeVisibility(el: Element, targetType: string, targetId: string, options?: ObserveOptions): void;
	/** Objective trigger context for the next appearance on `el` (e.g. a Vision tooltip's hover/focus/click/touch). */
	setVisibilityTriggerContext(el: Element, method: string | undefined): void;
	/** Ends `el`'s active appearance immediately, without waiting on geometry. */
	endVisibilityAppearance(el: Element): void;
	/** Marks whether `el`'s playable embed/asset is genuinely live right now
	 *  (docs section 17.7) — e.g. a blanked Facebook iframe, a YouTube player
	 *  not yet ready, a GIF not yet loaded. */
	setVisibilityPlayableSuspended(el: Element, suspended: boolean): void;
	/** Records real, observed playback state for `el` (docs section 17.7) —
	 *  never inferred from visibility/iframe existence/autoplay. */
	setVisibilityPlaying(el: Element, playing: boolean): void;
}

/** Read-only semantic state access this client needs — exactly what `semanticState` (index.ts) exposes. */
export interface SemanticStateReader {
	get(): SemanticState;
	subscribe(listener: (s: SemanticState) => void): () => void;
}

export function startClient(config: TelemetryConfig, semantic: SemanticStateReader): TelemetryClient | null {
	try {
		const sessionId = randomId();
		if (!sessionId) return null; // no secure randomness: stay off

		const log = config.debug
			? (...args: unknown[]) => console.debug('[telemetry]', ...args)
			: () => {};

		const origin = browserClock.now();
		const session = buildSessionContext(
			browserSessionEnv(),
			sessionId,
			browserClock.iso(),
			config.siteVersion,
		);
		const queue = new EventQueue(browserClock, origin, randomId, () =>
			log('queue full: new events are being dropped'),
		);
		const transport = new Transport(
			config.endpoint,
			session,
			queue,
			(url, init) => fetch(url, init),
			() => browserClock.now(),
			log,
		);

		queue.emit('session_start');
		log('session started', session);

		// Forward-declared: the engine's requestFlush closes over this and only
		// calls it later (in response to a real semantic transition), by which
		// point it is assigned below — see the "Semantic state-boundary flush"
		// integration point.
		let safeFlush: (lifecycle: boolean) => Promise<void>;

		const visibility = new VisibilityMatrixEngine({
			clock: browserClock,
			setTimer: (fn, ms) => setTimeout(fn, ms),
			clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
			newId: randomId,
			emit: (type, opts) => queue.emit(type, opts),
			getState: () => semantic.get(),
			subscribe: (fn) => semantic.subscribe(fn),
			requestFlush: () => {
				void safeFlush(false);
			},
		});

		const viewport = new ViewportTracker(
			session.viewport_width !== undefined && session.viewport_height !== undefined
				? { width: session.viewport_width, height: session.viewport_height }
				: null,
			{
				read: () => ({ width: window.innerWidth, height: window.innerHeight }),
				emit: ({ width, height }) => {
					queue.emit('viewport_changed', {
						properties: { viewport_width: width, viewport_height: height },
					});
					log('viewport_changed', width, height);
				},
				setTimer: (fn, ms) => setTimeout(fn, ms),
				clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
				coarsePointer: session.primary_pointer_coarse,
			},
		);
		window.addEventListener('resize', () => {
			try {
				viewport.onResize();
			} catch {
				/* never affect the site */
			}
		});

		// Pass 4 (docs section 17.9): one shared capture-phase pointer/contextmenu
		// listener set. Ordinary activations stay in memory; only allowlisted
		// noninteractive clicks, meaningful context menus and CONFIRMED bursts are queued.
		const interactions = startInteractionCapture({
			target: window,
			emit: (type, opts) => queue.emit(type, opts),
			getState: () => {
				const s = semantic.get();
				return { surface: s.surface, viewInstanceId: s.viewInstanceId };
			},
			// event.timeStamp and performance.now() share the same time origin.
			toElapsed: (t) => Math.max(0, Math.round(t - origin)),
			setTimer: (fn, ms) => setTimeout(fn, ms),
			clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
			viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
		});

		safeFlush = (lifecycle: boolean): Promise<void> => {
			// Integration point (docs section "Flush integration"): account
			// visibility through now and materialize unsent deltas into the queue
			// BEFORE the transport captures its batch, for every flush path
			// (periodic, lifecycle hidden/pagehide) — otherwise a delta produced
			// after the batch was captured would wait for a later flush and could
			// be lost on page exit.
			try {
				visibility.materialize();
			} catch {
				/* never affect the site */
			}
			if (lifecycle) {
				// Order on hide/pagehide: (1) visibility accounted above, (2) finalise an
				// already-CONFIRMED click burst now (an unconfirmed candidate is dropped,
				// never promoted), (3) everything is queued, (4) the transport flush
				// below sends it. Idempotent, so hidden + pagehide never double-emit.
				try {
					interactions.finalizeConfirmed();
				} catch {
					/* never affect the site */
				}
				// Finalize any pending resize so it is queued before the flush.
				try {
					viewport.finalize();
				} catch {
					/* never affect the site */
				}
			}
			return transport.flush({ lifecycle }).catch(() => {});
		};

		let timer: ReturnType<typeof setInterval> | undefined;
		const startTimer = () => {
			if (timer === undefined) timer = setInterval(() => void safeFlush(false), FLUSH_INTERVAL_MS);
		};
		const stopTimer = () => {
			clearInterval(timer);
			timer = undefined;
		};

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				stopTimer(); // no periodic work while hidden
				// Account through the hide instant and stop counting (docs section
				// "Document visibility"); safeFlush's own materialize() call just
				// after this drains whatever that accounted, so nothing is lost.
				try {
					visibility.pause();
				} catch {
					/* never affect the site */
				}
				void safeFlush(true);
			} else {
				try {
					visibility.resume();
				} catch {
					/* never affect the site */
				}
				startTimer();
			}
		});
		// pagehide covers navigation/close where visibilitychange may not fire.
		window.addEventListener('pagehide', () => void safeFlush(true));

		if (document.visibilityState !== 'hidden') {
			startTimer();
			setTimeout(() => void safeFlush(false), INITIAL_FLUSH_DELAY_MS);
		} else {
			void safeFlush(true);
		}

		return {
			emit(eventType, opts) {
				try {
					queue.emit(eventType, opts);
				} catch {
					/* never affect the site */
				}
			},
			flush: () => safeFlush(false),
			observeVisibility(el, targetType, targetId, options) {
				try {
					visibility.observe(el, targetType, targetId, options);
				} catch {
					/* never affect the site */
				}
			},
			setVisibilityTriggerContext(el, method) {
				try {
					visibility.setTriggerContext(el, method);
				} catch {
					/* never affect the site */
				}
			},
			endVisibilityAppearance(el) {
				try {
					visibility.endAppearanceNow(el);
				} catch {
					/* never affect the site */
				}
			},
			setVisibilityPlayableSuspended(el, suspended) {
				try {
					visibility.setPlayableSuspended(el, suspended);
				} catch {
					/* never affect the site */
				}
			},
			setVisibilityPlaying(el, playing) {
				try {
					visibility.setPlaying(el, playing);
				} catch {
					/* never affect the site */
				}
			},
		};
	} catch {
		return null;
	}
}
