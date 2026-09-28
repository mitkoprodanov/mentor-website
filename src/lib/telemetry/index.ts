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
import { randomId } from './session.ts';
import { bindUiEvents, SemanticStateCoordinator } from './state.ts';
import type { SemanticState, Surface } from './state.ts';
import type { EmitOptions } from './types.ts';
import type { ObserveOptions } from './visibility.ts';

export type { SemanticState, Surface } from './state.ts';
export type { ObserveOptions, PlayableKind } from './visibility.ts';
export type { PropertyValue } from './types.ts';

// Injected by astro.config.mjs (vite `define`).
declare const __SITE_VERSION__: string;

let client: TelemetryClient | null = null;
let started = false;

// Semantic UI state (main / skills / project_modal / skill_filtered). Always
// tracked once initTelemetry() has run, even with telemetry disabled: emit is a
// silent no-op then, and the coordinator only listens to UI announcements.
let coordinator: SemanticStateCoordinator | null = null;

/** Call once from the page entry point. Later calls do nothing. */
export function initTelemetry(): void {
	if (started) return;
	started = true;
	try {
		coordinator = new SemanticStateCoordinator({
			emit: (type, opts) => telemetry.emit(type, opts),
			newId: () => randomId(),
		});
		bindUiEvents(coordinator, document);
	} catch {
		coordinator = null;
	}
	try {
		const config = resolveConfig({
			isProductionBuild: import.meta.env.PROD,
			forceEnable: import.meta.env.PUBLIC_TELEMETRY === '1',
			endpointOverride: import.meta.env.PUBLIC_TELEMETRY_ENDPOINT,
			hostname: location.hostname,
			search: location.search,
			siteVersion: typeof __SITE_VERSION__ === 'string' ? __SITE_VERSION__ : undefined,
		});
		if (config.enabled) client = startClient(config, semanticState);
	} catch {
		client = null;
	}
}

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
