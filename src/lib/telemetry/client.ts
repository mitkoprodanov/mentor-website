// Wires session, queue, transport and page lifecycle together in the browser.
// Every entry point swallows errors: telemetry must never affect the site.

import type { TelemetryConfig } from './config.ts';
import { browserClock, EventQueue } from './queue.ts';
import { browserSessionEnv, buildSessionContext, randomId } from './session.ts';
import { Transport } from './transport.ts';
import type { EmitOptions } from './types.ts';
import { ViewportTracker } from './viewport.ts';

/** Periodic safety flush while the page is visible. */
const FLUSH_INTERVAL_MS = 20_000;
/** Get the session row + session_start out promptly for short visits. */
const INITIAL_FLUSH_DELAY_MS = 1_500;

export interface TelemetryClient {
	emit(eventType: string, opts?: EmitOptions): void;
	flush(): Promise<void>;
}

export function startClient(config: TelemetryConfig): TelemetryClient | null {
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

		const safeFlush = (lifecycle: boolean): Promise<void> => {
			if (lifecycle) {
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
				void safeFlush(true);
			} else {
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
		};
	} catch {
		return null;
	}
}
