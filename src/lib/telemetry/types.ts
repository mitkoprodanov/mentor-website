// Wire types for POST /v1/batch. See docs/telemetry.md sections 13-16.
// Field names/shapes mirror workers/telemetry/src/validate.ts exactly.

export const TELEMETRY_VERSION = 1;

/** Full session-creation fields. Capability fields are real booleans on the wire. */
export interface SessionContext {
	session_id: string;
	started_at: string;
	telemetry_version: typeof TELEMETRY_VERSION;
	referrer?: string;
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_content?: string;
	viewport_width?: number;
	viewport_height?: number;
	screen_width?: number;
	screen_height?: number;
	primary_pointer_coarse: boolean;
	primary_pointer_fine: boolean;
	any_pointer_coarse: boolean;
	any_pointer_fine: boolean;
	hover_capable: boolean;
	touch_capable: boolean;
	site_version?: string;
}

/** Follow-up batches identify the session only. */
export interface SessionRef {
	session_id: string;
	telemetry_version: typeof TELEMETRY_VERSION;
}

export type PropertyValue = string | number | boolean | null;

/** Only the fields the client foundation uses today; the Worker accepts more. */
export interface TelemetryEvent {
	event_id: string;
	occurred_at: string;
	elapsed_ms: number;
	event_type: string;
	target_type?: string;
	target_id?: string;
	appearance_id?: string;
	view_instance_id?: string;
	v50_ms?: number;
	v70_ms?: number;
	v85_ms?: number;
	v95_ms?: number;
	max_visibility_ratio?: number;
	/** Playable-media exposure; present only for a `playableKind` target (docs section 17.7). */
	playable_v50_ms?: number;
	playable_v70_ms?: number;
	playable_v85_ms?: number;
	playable_v95_ms?: number;
	/** Known actual playback; present only for a target with observable playback state (docs section 17.7). */
	playing_v50_ms?: number;
	playing_v70_ms?: number;
	playing_v85_ms?: number;
	playing_v95_ms?: number;
	properties?: Record<string, PropertyValue>;
}

export interface Batch {
	session: SessionContext | SessionRef;
	events: TelemetryEvent[];
}

export interface EmitOptions {
	target_type?: string;
	target_id?: string;
	/** Groups the events of one blocking-view instance (Skills/Project Detail/Skill Filtered View). */
	view_instance_id?: string;
	/** Identifies one continuous visibility appearance (`visibility_delta` only). See visibility.ts. */
	appearance_id?: string;
	v50_ms?: number;
	v70_ms?: number;
	v85_ms?: number;
	v95_ms?: number;
	max_visibility_ratio?: number;
	playable_v50_ms?: number;
	playable_v70_ms?: number;
	playable_v85_ms?: number;
	playable_v95_ms?: number;
	playing_v50_ms?: number;
	playing_v70_ms?: number;
	playing_v85_ms?: number;
	playing_v95_ms?: number;
	properties?: Record<string, PropertyValue>;
}
