/**
 * Visibility Matrix DOM wiring: finds the instrumented targets and registers
 * each with the telemetry client's Visibility Matrix engine (see
 * lib/telemetry/visibility.ts). This file only discovers elements and relays
 * UI announcements — all accounting/appearance logic lives in the engine.
 *
 * Targets carry `data-visibility-target-type` / `data-visibility-target-id`
 * (see Vision.astro, ProjectRow.astro, ApartBlock.astro, ScrollyRegion.astro,
 * ProjectDetail.astro, ExperienceCard.astro, FilterResults.astro). Owner for
 * a *fixed*-owner target type (`vision_content`, `timeline_project`, etc.) is
 * derived from targetType inside the engine, not read from the DOM.
 *
 * `project_intro` and `project_content` are *context-dependent*: the same
 * canonical content renders under `main` (Timeline), `project_modal`, or
 * `skill_filtered` depending on where a given DOM instance sits, and the
 * Astro component that rendered it already knows which one, statically, at
 * render time — so it's carried as `data-visibility-owner` rather than
 * re-derived here from arbitrary DOM state (docs section 17.6). Likewise
 * `data-visibility-content-type` / `data-visibility-person` carry static
 * per-target metadata (e.g. `content_type: 'image'`, `person: 'adam'`) that
 * the rendering context already knows, forwarded as-is into
 * `ObserveOptions.properties`.
 *
 * Vision tooltips additionally need two things geometry alone can't give the
 * engine (docs section 17.4): objective trigger context, and an immediate
 * appearance end the moment a tooltip is forced hidden rather than waiting on
 * IntersectionObserver. `vision.client.ts` announces `ui:vision-tooltip-show`/
 * `-hide` (see uiEvents.ts) with the tooltip's own canonical id; this file is
 * the only place that resolves that id back to its DOM element and calls the
 * engine — `vision.client.ts` itself stays dependency-free of telemetry, the
 * same as every other UI script.
 */

import { telemetry } from '../lib/telemetry';
import type { ObserveOptions, PropertyValue, Surface } from '../lib/telemetry';
import { UI_EVENT } from '../lib/telemetry/uiEvents.ts';
import type { VisionTooltipHideDetail, VisionTooltipShowDetail } from '../lib/telemetry/uiEvents.ts';

const VALID_OWNERS = new Set<Surface>(['main', 'skills', 'project_modal', 'skill_filtered']);

/** Builds `ObserveOptions` from a target's own data attributes — an explicit
 *  owner override for a context-dependent target type, plus any static
 *  content metadata the rendering context supplied. Never inferred from
 *  surrounding DOM state; a malformed/unknown owner value is dropped rather
 *  than guessed (so the target falls back to the fixed `OWNER` map, or is
 *  ignored if it has none — the existing scope-guard behavior). */
function observeOptions(el: HTMLElement): ObserveOptions | undefined {
	const rawOwner = el.dataset.visibilityOwner;
	const owner = rawOwner && VALID_OWNERS.has(rawOwner as Surface) ? (rawOwner as Surface) : undefined;
	const properties: Record<string, PropertyValue> = {};
	if (el.dataset.visibilityContentType) properties.content_type = el.dataset.visibilityContentType;
	if (el.dataset.visibilityPerson) properties.person = el.dataset.visibilityPerson;
	if (!owner && Object.keys(properties).length === 0) return undefined;
	return { owner, properties: Object.keys(properties).length ? properties : undefined };
}

function init(): void {
	document.querySelectorAll<HTMLElement>('[data-visibility-target-type]').forEach((el) => {
		const targetType = el.dataset.visibilityTargetType;
		const targetId = el.dataset.visibilityTargetId;
		if (!targetType || !targetId) return;
		telemetry.observeVisibility(el, targetType, targetId, observeOptions(el));
	});

	const tooltipEl = (tooltipId: string | undefined): HTMLElement | null =>
		tooltipId
			? document.querySelector<HTMLElement>(
					`[data-visibility-target-type="vision_tooltip"][data-visibility-target-id="${CSS.escape(tooltipId)}"]`,
				)
			: null;

	document.addEventListener(UI_EVENT.visionTooltipShow, (e) => {
		const { tooltipId, method } = (e as CustomEvent<VisionTooltipShowDetail>).detail ?? {};
		const el = tooltipEl(tooltipId);
		if (el) telemetry.setVisibilityTriggerContext(el, method);
	});
	document.addEventListener(UI_EVENT.visionTooltipHide, (e) => {
		const { tooltipId } = (e as CustomEvent<VisionTooltipHideDetail>).detail ?? {};
		const el = tooltipEl(tooltipId);
		if (el) telemetry.endVisibilityAppearance(el);
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
