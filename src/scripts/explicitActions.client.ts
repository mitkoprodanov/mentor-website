/**
 * Explicit-action telemetry wiring (docs/telemetry.md sections 10-11) for the
 * few authoritative controls that have no dedicated feature script of their
 * own to instrument directly:
 *   - CV download and person LinkedIn — plain, always-in-DOM anchors in each
 *     sticky Person card (ScrollyRegion.astro's `.side-panel`); no other
 *     script currently attaches to them at all.
 *   - Generic outbound content links marked `data-external-link-type`
 *     (ProjectDetail.astro's project-site chip and LinkedIn-post-embed
 *     fallback) — a data-attribute contract, the same pattern
 *     `data-visibility-target-type` already uses, so a future instrumented
 *     link needs no JS change here.
 *
 * Company email/mailto/LinkedIn are instrumented in CompanyContactCard.astro's
 * own script (it already owns the copy-button click handler). The navbar is
 * instrumented in navScroll.client.ts (the existing authoritative handler).
 * This file is not a generic document click listener: each selector below
 * names one specific, enumerated action point, exactly like every other
 * telemetry-wiring script in this codebase (visibility.client.ts).
 *
 * All targets here are static at page load (Astro renders every Project
 * Modal / Skill Filtered View card up front; nothing is created dynamically —
 * see projectModal.client.ts), so a one-time querySelectorAll is enough, the
 * same assumption visibility.client.ts already makes for its own targets.
 */

import { telemetry } from '../lib/telemetry';
import { buildCvDownload, buildExternalLinkClick, buildLinkedinClick, onLinkActivation } from '../lib/telemetry/explicitEvents.ts';

/** Which person a control belongs to — same `.side-panel[data-person]`
 *  ancestor convention panelToggle.client.ts's `personOf()` already uses. */
function personOf(el: Element | null): string | undefined {
	return el?.closest<HTMLElement>('.side-panel')?.dataset.person;
}

document.querySelectorAll<HTMLAnchorElement>('.cv-download').forEach((link) => {
	onLinkActivation(link, (event) => {
		const opts = buildCvDownload(personOf(link), event.pointerType);
		if (opts) telemetry.emit('cv_download', opts);
	});
});

document.querySelectorAll<HTMLAnchorElement>('.side-panel-linkedin .linkedin-pill').forEach((link) => {
	onLinkActivation(link, (event) => {
		const opts = buildLinkedinClick('person', personOf(link), event.pointerType);
		if (opts) {
			telemetry.emit('linkedin_click', opts);
			void telemetry.flush(); // before external navigation, where practical (docs section 14)
		}
	});
});

document.querySelectorAll<HTMLAnchorElement>('[data-external-link-type]').forEach((link) => {
	onLinkActivation(link, (event) => {
		const opts = buildExternalLinkClick(
			link.dataset.externalLinkType,
			link.dataset.projectId,
			event.pointerType,
		);
		if (opts) {
			telemetry.emit('external_link_click', opts);
			void telemetry.flush();
		}
	});
});

export {};
