// Pure model + open/close logic for the compact Privacy control (docs/privacy.md sections 1 and 3).
// No DOM here, so every rule is unit-testable. The single source of truth for the two permissions
// stays in `telemetryControl` (analytics) and `externalMedia`; the visible "No optional services"
// state is DERIVED from them, never stored.

import type { ConsentChoice } from './telemetry/consent.ts';

export type ChoiceId = 'none' | 'media' | 'analytics';

export interface Permissions {
	media: boolean;
	analytics: boolean;
}

/** "No optional services" is selected exactly when neither optional permission is on. */
export const isNone = (p: Permissions): boolean => !p.media && !p.analytics;

/**
 * The permissions after the visitor activates one of the three choices.
 * `analyticsLocked`: analytics is not visitor-controllable in this build (dev modes) and is left alone.
 */
export function selectChoice(p: Permissions, id: ChoiceId, analyticsLocked = false): Permissions {
	const analytics = (v: boolean): boolean => (analyticsLocked ? p.analytics : v);
	switch (id) {
		case 'none':
			return { media: false, analytics: analytics(false) };
		case 'media':
			return { media: !p.media, analytics: p.analytics };
		case 'analytics':
			return { media: p.media, analytics: analytics(!p.analytics) };
	}
}

/** Before any explicit answer both permissions are effectively off but not refused. */
export function isUnanswered(media: ConsentChoice | null, analytics: ConsentChoice | null, analyticsChoosable: boolean): boolean {
	return media === null && (!analyticsChoosable || analytics === null);
}

export interface ConsentWrites {
	media?: ConsentChoice;
	analytics?: ConsentChoice;
}

/**
 * Which stored values must be written to reach `next`. A change, or a still-unset key, is written
 * so every explicit selection yields a complete allow/refuse pair (privacy.md section 5); an
 * unchanged, already-stored value is left alone.
 */
export function planConsentWrites(
	current: Permissions,
	next: Permissions,
	stored: { media: ConsentChoice | null; analytics: ConsentChoice | null },
	analyticsChoosable: boolean,
): ConsentWrites {
	const out: ConsentWrites = {};
	if (next.media !== current.media || stored.media === null) out.media = next.media ? 'allow' : 'refuse';
	if (analyticsChoosable && (next.analytics !== current.analytics || stored.analytics === null)) {
		out.analytics = next.analytics ? 'allow' : 'refuse';
	}
	return out;
}

/**
 * Open/pin/preview state of the Privacy bar. Hover or keyboard focus on the lock only PREVIEWS the
 * bar; a click/tap PINS it. Closing never touches consent. While unanswered, the bar is also kept up
 * as a reminder until the visitor closes it (memory only, never persisted).
 */
export class PrivacyBarState {
	private pinned = false;
	private hover = false;
	private focus = false;
	/** After an explicit close, the still-hovering/focused pointer must not instantly re-preview. */
	private previewSuppressed = false;
	private reminderDismissed = false;
	private detailsOpen = false;
	private unanswered = false;

	setUnanswered(v: boolean): void {
		this.unanswered = v;
	}

	get isPinned(): boolean {
		return this.pinned;
	}

	get details(): boolean {
		return this.detailsOpen && this.visible;
	}

	get visible(): boolean {
		return this.pinned || ((this.hover || this.focus) && !this.previewSuppressed) || (this.unanswered && !this.reminderDismissed);
	}

	pointerEnter(): void {
		this.hover = true;
	}

	pointerLeave(): void {
		this.hover = false;
		this.previewSuppressed = this.focus ? this.previewSuppressed : false;
	}

	focusIn(): void {
		this.focus = true;
	}

	focusOut(): void {
		this.focus = false;
		this.previewSuppressed = this.hover ? this.previewSuppressed : false;
	}

	/** Lock button click/tap: pins when not pinned, otherwise closes. */
	toggleClick(): void {
		if (this.pinned) this.close();
		else this.pin();
	}

	/** Opens pinned (lock click, touch tap, or a gated embed asking for External media). */
	pin(): void {
		this.pinned = true;
		this.previewSuppressed = false;
	}

	toggleDetails(): void {
		this.detailsOpen = !this.detailsOpen;
	}

	/** Pointer/tap outside the Privacy UI. Only a pinned bar reacts; a reminder or preview stays. */
	outsidePress(): boolean {
		if (!this.pinned) return false;
		this.close();
		return true;
	}

	/** Escape closes a pinned or previewed bar (not a passive reminder, so a modal can still be
	 *  escaped while one is up). Returns whether it consumed the key. */
	escape(): boolean {
		if (!(this.pinned || ((this.hover || this.focus) && !this.previewSuppressed))) return false;
		this.close();
		return true;
	}

	/** Explicit close affordance / lock toggle / outside / Escape. Never changes consent. */
	close(): void {
		this.pinned = false;
		this.detailsOpen = false;
		this.reminderDismissed = true;
		this.previewSuppressed = this.hover || this.focus;
	}
}
