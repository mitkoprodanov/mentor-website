// External media permission: ONE category covering every third-party embed (YouTube, LinkedIn,
// Facebook, any future provider). Independent of anonymous analytics in every way: separate
// storage key, separate state, no shared lifecycle, and it behaves the same in all telemetry
// modes. Self-hosted media never consults it (see requiresExternalMediaConsent in embeds.ts).

import { browserConsentStorage, readConsent, writeConsent } from './telemetry/consent.ts';
import type { ConsentChoice, ConsentStorage } from './telemetry/consent.ts';

export interface ExternalMediaStatus {
	/** The remembered (or this-page-load) choice; null = unanswered. */
	consent: ConsentChoice | null;
	/** True when third-party embeds may load right now. */
	allowed: boolean;
	/** False when the choice could not be persisted (storage blocked). */
	remembered: boolean;
}

/** Fired on `document` when the visitor activates a gated embed without permission: the privacy UI answers it. */
export const EXTERNAL_MEDIA_REQUEST_EVENT = 'privacy:request-external-media';

export class ExternalMediaPermission {
	private choice: ConsentChoice | null;
	private remembered = true;
	private readonly listeners = new Set<(s: ExternalMediaStatus) => void>();
	private readonly storage: ConsentStorage | null;

	constructor(storage: ConsentStorage | null) {
		this.storage = storage;
		this.choice = readConsent(storage, 'external_media');
	}

	status(): ExternalMediaStatus {
		return { consent: this.choice, allowed: this.choice === 'allow', remembered: this.remembered };
	}

	subscribe(fn: (s: ExternalMediaStatus) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	allow(): void {
		this.set('allow');
	}

	/** `Not now` / turning External media off. */
	refuse(): void {
		this.set('refuse');
	}

	private set(choice: ConsentChoice): void {
		this.choice = choice;
		this.remembered = writeConsent(this.storage, choice, 'external_media');
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

/** The page's single instance. Reading the stored choice touches nothing external. */
export const externalMedia = new ExternalMediaPermission(browserConsentStorage());
