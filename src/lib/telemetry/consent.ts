// The visitor's generic privacy preferences — the ONLY thing the site keeps in browser
// storage for privacy. Two independent categories, each the literal string `allow` or
// `refuse` (absent = unanswered):
//
//   analytics       anonymous analytics   (key `mgs_analytics_consent`, unchanged since it shipped)
//   external_media  third-party embeds    (key `mgs_external_media_consent`)
//
// No visitor ID, no timestamp, no session reference; nothing here is ever sent to the Worker or
// used for correlation, and one category never implies the other. Every access is guarded:
// blocked/unavailable storage just means "no remembered choice", never an error.

export type ConsentCategory = 'analytics' | 'external_media';

export const CONSENT_KEYS: Readonly<Record<ConsentCategory, string>> = {
	analytics: 'mgs_analytics_consent',
	external_media: 'mgs_external_media_consent',
};

/** The analytics key (kept as its own export: it predates the second category). */
export const CONSENT_KEY = CONSENT_KEYS.analytics;

export type ConsentChoice = 'allow' | 'refuse';

export interface ConsentStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** First-party `localStorage`, or null when the browser blocks it. */
export function browserConsentStorage(): ConsentStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** Only the two exact values count; anything else (including older/unknown formats) is "no remembered choice". */
export function readConsent(storage: ConsentStorage | null, category: ConsentCategory = 'analytics'): ConsentChoice | null {
	try {
		const v = storage?.getItem(CONSENT_KEYS[category]);
		return v === 'allow' || v === 'refuse' ? v : null;
	} catch {
		return null;
	}
}

/** Returns false when it could not be remembered (the choice still applies to this page load). */
export function writeConsent(
	storage: ConsentStorage | null,
	choice: ConsentChoice,
	category: ConsentCategory = 'analytics',
): boolean {
	try {
		if (!storage) return false;
		storage.setItem(CONSENT_KEYS[category], choice);
		return true;
	} catch {
		return false;
	}
}
