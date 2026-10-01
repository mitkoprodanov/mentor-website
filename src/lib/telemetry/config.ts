// The single place that decides which telemetry mode is active. Pure: everything it
// needs is passed in, so components never check environments themselves.
//
//   off      custom telemetry completely disabled (normal site development, `npm run dev`)
//   forced   starts immediately, Mentor analytics consent bypassed — LOCAL DEVELOPMENT ONLY
//            (`npm run dev:telemetry`)
//   consent  the real production lifecycle: nothing starts until the visitor allows analytics
//            (production, and `npm run dev:production-like` against the local Worker)
//
// The build-time request (`PUBLIC_TELEMETRY_MODE`) is only a REQUEST. It is defensive by design:
//   * the real production site (production build on the production hostname) is ALWAYS `consent`,
//     always posts to the production endpoint, and ignores the request and any endpoint override;
//   * `forced` is honoured only for a development build (`import.meta.env.DEV`); a production
//     build asked for `forced` resolves to `off`;
//   * anywhere else the endpoint must be explicitly overridden AND local (localhost / loopback /
//     private-LAN address); otherwise the mode is `off`, so a mis-set variable can never make a
//     non-production host talk to the production Worker.
// Third-party media permission is a separate system and is never affected by this mode.

export const PRODUCTION_HOSTNAME = 'mentorgamestudio.com';
export const PRODUCTION_ENDPOINT =
	'https://mentor-telemetry.prodanov-mitko.workers.dev/v1/batch';

export type TelemetryMode = 'off' | 'forced' | 'consent';

const MODES: readonly TelemetryMode[] = ['off', 'forced', 'consent'];

/** Parses the raw build-time value; anything unrecognised is `off`. */
export function parseMode(raw: unknown): TelemetryMode {
	return typeof raw === 'string' && (MODES as readonly string[]).includes(raw.trim())
		? (raw.trim() as TelemetryMode)
		: 'off';
}

/** localhost, loopback or a private-LAN http(s) URL (so phones on the same Wi-Fi work). Never the internet. */
export function isLocalEndpoint(raw: string | undefined): boolean {
	if (!raw) return false;
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return false;
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
	const h = u.hostname;
	if (h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || h === '::1') return true;
	const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export interface ConfigInput {
	/** Build-time: `import.meta.env.PROD`. */
	isProductionBuild: boolean;
	/** Build-time: `PUBLIC_TELEMETRY_MODE` (`off | forced | consent`). Only a request; see above. */
	mode?: unknown;
	/** Build-time: `PUBLIC_TELEMETRY_ENDPOINT`, a LOCAL `wrangler dev` URL. Ignored on the production site. */
	endpointOverride?: string;
	hostname: string;
	search: string;
	siteVersion?: string;
}

export interface TelemetryConfig {
	/** The resolved mode: the one source of truth. */
	mode: TelemetryMode;
	endpoint: string;
	debug: boolean;
	siteVersion?: string;
}

export function resolveConfig(input: ConfigInput): TelemetryConfig {
	const debugParam = new URLSearchParams(input.search).has('telemetry_debug');
	const onProductionSite = input.isProductionBuild && input.hostname === PRODUCTION_HOSTNAME;

	let mode: TelemetryMode;
	let endpoint: string;
	if (onProductionSite) {
		mode = 'consent';
		endpoint = PRODUCTION_ENDPOINT;
	} else {
		mode = parseMode(input.mode);
		if (mode === 'forced' && input.isProductionBuild) mode = 'off';
		if (mode !== 'off' && !isLocalEndpoint(input.endpointOverride)) mode = 'off';
		endpoint = input.endpointOverride && mode !== 'off' ? input.endpointOverride : PRODUCTION_ENDPOINT;
	}
	return {
		mode,
		endpoint,
		debug: mode !== 'off' && (mode === 'forced' || debugParam),
		siteVersion: input.siteVersion,
	};
}
