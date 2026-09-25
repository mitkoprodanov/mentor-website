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
import type { EmitOptions } from './types.ts';

// Injected by astro.config.mjs (vite `define`).
declare const __SITE_VERSION__: string;

let client: TelemetryClient | null = null;
let started = false;

/** Call once from the page entry point. Later calls do nothing. */
export function initTelemetry(): void {
	if (started) return;
	started = true;
	try {
		const config = resolveConfig({
			isProductionBuild: import.meta.env.PROD,
			forceEnable: import.meta.env.PUBLIC_TELEMETRY === '1',
			endpointOverride: import.meta.env.PUBLIC_TELEMETRY_ENDPOINT,
			hostname: location.hostname,
			search: location.search,
			siteVersion: typeof __SITE_VERSION__ === 'string' ? __SITE_VERSION__ : undefined,
		});
		if (config.enabled) client = startClient(config);
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
};
