// Start/stop lifecycle for custom telemetry, separated from the browser
// wiring (index.ts) so the consent rules are unit-testable.
//
// The mode comes from config.ts (resolveConfig), the one source of truth:
//   'off'      telemetry is not active for this build/host at all
//   'forced'   local development only (dev:telemetry): starts immediately, no consent UI gate
//   'consent'  production (and dev:production-like): OFF until the visitor chooses allow
//
// Until telemetry is started NOTHING telemetry-related exists: `startSession`
// (which creates the session ID, UI-state coordinator, queue, transport and all
// listeners/observers) is simply not called. Withdrawal tears all of it down.

import type { TelemetryConfig, TelemetryMode } from './config.ts';
import { readConsent, writeConsent } from './consent.ts';
import type { ConsentChoice, ConsentStorage } from './consent.ts';

export interface TelemetryStatus {
	mode: TelemetryMode;
	/** The remembered (or this-page-load) choice; null = unanswered. */
	consent: ConsentChoice | null;
	running: boolean;
	/** False when the choice could not be persisted (storage blocked). */
	remembered: boolean;
}

export interface StartedSession {
	stop(): void;
}

export interface LifecycleDeps {
	config: Pick<TelemetryConfig, 'mode'>;
	storage: ConsentStorage | null;
	/** Builds a brand-new anonymous session + every telemetry listener. Null = could not start. */
	startSession(): StartedSession | null;
}

/** Runs on every start; may return a cleanup that runs on stop. */
export type StartHook = () => void | (() => void);

export class TelemetryLifecycle {
	private session: StartedSession | null = null;
	private choice: ConsentChoice | null = null;
	private remembered = true;
	private readonly listeners = new Set<(s: TelemetryStatus) => void>();
	private readonly hooks = new Map<StartHook, (() => void) | null>();
	private readonly mode: TelemetryMode;
	private readonly deps: LifecycleDeps;

	constructor(deps: LifecycleDeps) {
		this.deps = deps;
		this.mode = deps.config.mode;
	}

	/** Call once on page load. Starts only for forced testing or a remembered `allow`. */
	init(): void {
		if (this.mode === 'off') return;
		if (this.mode === 'forced') {
			this.start();
			return;
		}
		this.choice = readConsent(this.deps.storage);
		if (this.choice === 'allow') this.start();
		this.emit();
	}

	status(): TelemetryStatus {
		return { mode: this.mode, consent: this.choice, running: this.session !== null, remembered: this.remembered };
	}

	subscribe(fn: (s: TelemetryStatus) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/** `Allow analytics`: starts now, with a fresh session; nothing earlier is reconstructed. */
	allow(): void {
		if (this.mode !== 'consent') return;
		this.choice = 'allow';
		this.remembered = writeConsent(this.deps.storage, 'allow');
		this.start();
		this.emit();
	}

	/** `No thanks` / withdrawal: stops cleanly and remembers the refusal. */
	refuse(): void {
		if (this.mode !== 'consent') return;
		this.choice = 'refuse';
		this.remembered = writeConsent(this.deps.storage, 'refuse');
		this.stop();
		this.emit();
	}

	/** Register telemetry-only wiring. Runs now if already running, again on every
	 *  later start; the returned cleanup runs on stop. Never runs while telemetry is off. */
	onStart(hook: StartHook): void {
		this.hooks.set(hook, null);
		if (this.session) this.runHook(hook);
	}

	private start(): void {
		if (this.session) return;
		try {
			this.session = this.deps.startSession();
		} catch {
			this.session = null;
		}
		if (!this.session) return;
		for (const hook of this.hooks.keys()) this.runHook(hook);
	}

	private stop(): void {
		const session = this.session;
		if (!session) return;
		this.session = null;
		for (const [hook, cleanup] of this.hooks) {
			try {
				cleanup?.();
			} catch {
				/* never affect the site */
			}
			this.hooks.set(hook, null);
		}
		try {
			session.stop();
		} catch {
			/* never affect the site */
		}
	}

	private runHook(hook: StartHook): void {
		try {
			const cleanup = hook();
			this.hooks.set(hook, typeof cleanup === 'function' ? cleanup : null);
		} catch {
			/* never affect the site */
		}
	}

	private emit(): void {
		const s = this.status();
		for (const fn of this.listeners) {
			try {
				fn(s);
			} catch {
				/* never affect the site */
			}
		}
	}
}
