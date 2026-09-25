// The single place that decides whether telemetry runs. Pure: everything it
// needs is passed in, so components never check environments themselves.

export const PRODUCTION_HOSTNAME = 'mentorgamestudio.com';
export const PRODUCTION_ENDPOINT =
	'https://mentor-telemetry.prodanov-mitko.workers.dev/v1/batch';

export interface ConfigInput {
	/** Build-time: `import.meta.env.PROD`. */
	isProductionBuild: boolean;
	/** Build-time: `PUBLIC_TELEMETRY=1`. Deliberate override for local testing. */
	forceEnable: boolean;
	/** Build-time: `PUBLIC_TELEMETRY_ENDPOINT`, e.g. a local `wrangler dev` URL. */
	endpointOverride?: string;
	hostname: string;
	search: string;
	siteVersion?: string;
}

export interface TelemetryConfig {
	enabled: boolean;
	endpoint: string;
	debug: boolean;
	siteVersion?: string;
}

export function resolveConfig(input: ConfigInput): TelemetryConfig {
	const debugParam = new URLSearchParams(input.search).has('telemetry_debug');
	// Production build AND the real hostname (so `astro preview` on localhost is
	// off too), or the explicit build-time override.
	const onProductionSite =
		input.isProductionBuild && input.hostname === PRODUCTION_HOSTNAME;
	const enabled = onProductionSite || input.forceEnable;
	return {
		enabled,
		endpoint: input.endpointOverride || PRODUCTION_ENDPOINT,
		debug: enabled && (input.forceEnable || debugParam),
		siteVersion: input.siteVersion,
	};
}
