// Public telemetry API. Feature code imports `telemetry` and emits semantic
// events; it never sees fetch, batching, the Worker or D1.
//
//   import { telemetry } from '../lib/telemetry';
//   telemetry.emit('project_open', { target_type: 'project', target_id: 'heroes6' });
//
// Until initTelemetry() has run (and whenever telemetry is disabled) every
// call is a silent no-op.

import { startClient } from './client.ts';
import type { TelemetryClient } from './client.ts';
import { resolveConfig } from './config.ts';
import { browserConsentStorage } from './consent.ts';
import { TelemetryLifecycle } from './lifecycle.ts';
import type { StartHook, TelemetryStatus } from './lifecycle.ts';
import { randomId } from './session.ts';
import { bindUiEvents, SemanticStateCoordinator } from './state.ts';
import type { SemanticState, Surface } from './state.ts';
import type { EmitOptions } from './types.ts';
import type { ObserveOptions } from './visibility.ts';

export type { SemanticState, Surface } from './state.ts';
export type { ObserveOptions, PlayableKind } from './visibility.ts';
export type { PropertyValue } from './types.ts';
export type { TelemetryStatus } from './lifecycle.ts';
export type { TelemetryMode } from './config.ts';

// Injected by astro.config.mjs (vite `define`).
declare const __SITE_VERSION__: string;

let client: TelemetryClient | null = null;

// Semantic UI state (main / skills / project_modal / skill_filtered). Exists
// ONLY while telemetry is running: it is created with the session and torn
// down on withdrawal, so nothing is listening before consent.
let coordinator: SemanticStateCoordinator | null = null;

let lifecycle: TelemetryLifecycle | null = null;
let started = false;

/** Builds a brand-new anonymous session plus every telemetry listener; the returned
 *  handle tears all of it down again. Called by the lifecycle, never on page load
 *  in production before consent. */
function startSession(config: ReturnType<typeof resolveConfig>) {
	const coord = new SemanticStateCoordinator({
		emit: (type, opts) => telemetry.emit(type, opts),
		newId: () => randomId(),
	});
	const unbind = bindUiEvents(coord, document);
	coordinator = coord;
	const c = startClient(config, semanticState);
	if (!c) {
		unbind();
		coordinator = null;
		return null;
	}
	client = c;
	return {
		stop() {
			c.stop();
			unbind();
			client = null;
			coordinator = null;
		},
	};
}

/** Call once from the page entry point. Later calls do nothing. In production this only
 *  decides whether telemetry may start (remembered `allow`); it never starts otherwise. */
export function initTelemetry(): void {
	if (started) return;
	started = true;
	try {
		const config = resolveConfig({
			isProductionBuild: import.meta.env.PROD,
			mode: import.meta.env.PUBLIC_TELEMETRY_MODE,
			endpointOverride: import.meta.env.PUBLIC_TELEMETRY_ENDPOINT,
			hostname: location.hostname,
			search: location.search,
			siteVersion: typeof __SITE_VERSION__ === 'string' ? __SITE_VERSION__ : undefined,
		});
		const lc = new TelemetryLifecycle({
			config,
			storage: browserConsentStorage(),
			startSession: () => startSession(config),
		});
		lifecycle = lc;
		lc.init();
	} catch {
		lifecycle = null;
		client = null;
		coordinator = null;
	}
}

/** Consent + lifecycle control for the privacy UI and for telemetry-only wiring. */
export const telemetryControl = {
	status(): TelemetryStatus {
		return lifecycle?.status() ?? { mode: 'off', consent: null, running: false, remembered: true };
	},
	subscribe(fn: (s: TelemetryStatus) => void): () => void {
		return lifecycle ? lifecycle.subscribe(fn) : () => {};
	},
	/** `Allow analytics`. */
	allow(): void {
		lifecycle?.allow();
	},
	/** `No thanks` / withdrawal. */
	refuse(): void {
		lifecycle?.refuse();
	},
	/** Install telemetry-only listeners/registrations: runs only while telemetry runs
	 *  (now if already running, again on every later start); cleanup runs on stop. */
	onStart(hook: StartHook): void {
		lifecycle?.onStart(hook);
	},
};

export const telemetry = {
	emit(eventType: string, opts?: EmitOptions): void {
		client?.emit(eventType, opts);
	},
	/** Best-effort immediate send of anything queued. Never rejects. */
	flush(): Promise<void> {
		return client ? client.flush() : Promise.resolve();
	},
	/** Registers a DOM element for Visibility Matrix accounting (`visibility_delta`).
	 *  A silent no-op until initTelemetry() has run, or whenever telemetry is disabled. */
	observeVisibility(el: Element, targetType: string, targetId: string, options?: ObserveOptions): void {
		client?.observeVisibility(el, targetType, targetId, options);
	},
	/** Objective trigger context (e.g. hover/focus/click/touch) for the next
	 *  appearance on `el` — call right when the caller's own UI shows it. */
	setVisibilityTriggerContext(el: Element, method: string | undefined): void {
		client?.setVisibilityTriggerContext(el, method);
	},
	/** Ends `el`'s active Visibility Matrix appearance immediately, for a
	 *  target whose own UI knows precisely when it stopped being presented. */
	endVisibilityAppearance(el: Element): void {
		client?.endVisibilityAppearance(el);
	},
	/** Marks whether `el`'s playable embed/asset is genuinely live right now
	 *  (docs section 17.7) — e.g. a blanked Facebook iframe, a YouTube player
	 *  not yet ready, a GIF not yet loaded. A silent no-op until initTelemetry()
	 *  has run, or whenever telemetry is disabled. */
	setVisibilityPlayableSuspended(el: Element, suspended: boolean): void {
		client?.setVisibilityPlayableSuspended(el, suspended);
	},
	/** Records real, observed playback state for `el` (docs section 17.7) —
	 *  call only from an actual provider/media event, never inferred from
	 *  visibility, iframe existence, or an autoplay request. */
	setVisibilityPlaying(el: Element, playing: boolean): void {
		client?.setVisibilityPlaying(el, playing);
	},
};

const MAIN_STATE: SemanticState = {
	surface: 'main',
	projectId: null,
	skillId: null,
	skillsMode: null,
	viewInstanceId: null,
	underlying: 'main',
	navbarAvailable: true,
};

/** Which blocking surface owns attention right now. For future telemetry code
 *  (visibility engine, nav_click); read-only. */
export const semanticState = {
	get(): SemanticState {
		return coordinator ? coordinator.state : MAIN_STATE;
	},
	/** Is `owner` the current surface? Anything else is suspended. */
	isActive(owner: Surface): boolean {
		return this.get().surface === owner;
	},
	subscribe(listener: (s: SemanticState) => void): () => void {
		return coordinator ? coordinator.subscribe(listener) : () => {};
	},
};
