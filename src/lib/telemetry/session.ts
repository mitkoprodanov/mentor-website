// Anonymous per-visit session context. Held in memory only: nothing here (or
// anywhere in the telemetry client) touches cookies, localStorage or
// sessionStorage, so a new visit is always a new session.

import { TELEMETRY_VERSION } from './types.ts';
import type { SessionContext } from './types.ts';

const MAX_REFERRER = 512;
/** Keep in sync with LIMITS.maxUtm / UTM_RE in workers/telemetry/src/validate.ts. */
const MAX_UTM = 40;
const UTM_RE = /^[a-z0-9_-]+$/;
const MAX_DIMENSION = 20000;

/** Browser facts the session needs; injectable so this stays unit-testable. */
export interface SessionEnv {
	search: string;
	referrer: string;
	innerWidth: number;
	innerHeight: number;
	screenWidth: number;
	screenHeight: number;
	maxTouchPoints: number;
	hasTouchStart: boolean;
	matchMedia(query: string): { matches: boolean };
}

export function browserSessionEnv(): SessionEnv {
	return {
		search: location.search,
		referrer: document.referrer,
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight,
		screenWidth: screen.width,
		screenHeight: screen.height,
		maxTouchPoints: navigator.maxTouchPoints || 0,
		hasTouchStart: 'ontouchstart' in window,
		matchMedia: (q) => window.matchMedia(q),
	};
}

/** Random ID, valid for the Worker's `[A-Za-z0-9_-]{8,64}`. Null if no CSPRNG. */
export function randomId(c: Crypto | undefined = globalThis.crypto): string | null {
	if (!c) return null;
	if (typeof c.randomUUID === 'function') return c.randomUUID();
	if (typeof c.getRandomValues === 'function') {
		const bytes = c.getRandomValues(new Uint8Array(16));
		return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}
	return null;
}

const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
type UtmField = (typeof UTM_FIELDS)[number];

/** Trim + lowercase; null (omit) if empty, too long, or outside `[a-z0-9_-]`. Never truncates. */
export function normalizeUtm(raw: string | null | undefined): string | null {
	const v = raw?.trim().toLowerCase();
	return v && v.length <= MAX_UTM && UTM_RE.test(v) ? v : null;
}

/** Only the four documented UTM fields, normalized; invalid/blank values are dropped. */
export function parseUtm(search: string): Partial<Record<UtmField, string>> {
	const params = new URLSearchParams(search);
	const out: Partial<Record<UtmField, string>> = {};
	for (const key of UTM_FIELDS) {
		const v = normalizeUtm(params.get(key));
		if (v) out[key] = v;
	}
	return out;
}

/** Scheme + host + path only. The query string, fragment and credentials can carry tokens,
 *  recipient info or our own campaign URL, so they never enter telemetry (docs/privacy.md).
 *  Unparseable / non-http(s) referrers are dropped. Keep in sync with the Worker's `sanitizeReferrer`. */
export function sanitizeReferrer(raw: string): string | null {
	try {
		const u = new URL(raw.trim());
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		return `${u.origin}${u.pathname}`.slice(0, MAX_REFERRER);
	} catch {
		return null;
	}
}

function dimension(n: number): number | undefined {
	if (!Number.isFinite(n)) return undefined;
	const r = Math.round(n);
	return r >= 0 && r <= MAX_DIMENSION ? r : undefined;
}

type DimensionKey = 'viewport_width' | 'viewport_height' | 'screen_width' | 'screen_height';

export function buildSessionContext(
	env: SessionEnv,
	id: string,
	startedAt: string,
	siteVersion?: string,
): SessionContext {
	const mq = (q: string) => env.matchMedia(q).matches;
	const ctx: SessionContext = {
		session_id: id,
		started_at: startedAt,
		telemetry_version: TELEMETRY_VERSION,
		...parseUtm(env.search),
		primary_pointer_coarse: mq('(pointer: coarse)'),
		primary_pointer_fine: mq('(pointer: fine)'),
		any_pointer_coarse: mq('(any-pointer: coarse)'),
		any_pointer_fine: mq('(any-pointer: fine)'),
		hover_capable: mq('(hover: hover)'),
		touch_capable: env.maxTouchPoints > 0 || env.hasTouchStart,
	};
	const referrer = sanitizeReferrer(env.referrer);
	if (referrer) ctx.referrer = referrer;
	const set = (k: DimensionKey, v: number) => {
		const d = dimension(v);
		if (d !== undefined) ctx[k] = d;
	};
	set('viewport_width', env.innerWidth);
	set('viewport_height', env.innerHeight);
	set('screen_width', env.screenWidth);
	set('screen_height', env.screenHeight);
	if (siteVersion) ctx.site_version = siteVersion;
	return ctx;
}
