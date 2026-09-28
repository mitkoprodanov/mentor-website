/**
 * Visibility Matrix DOM wiring: finds the instrumented targets and registers
 * each with the telemetry client's Visibility Matrix engine (see
 * lib/telemetry/visibility.ts). This file only discovers elements and relays
 * UI announcements — all accounting/appearance logic lives in the engine.
 *
 * Targets carry `data-visibility-target-type` / `data-visibility-target-id`
 * (see Vision.astro, ProjectRow.astro, ApartBlock.astro, ScrollyRegion.astro).
 * Owner (main vs skills) is derived from targetType inside the engine, not
 * read from the DOM.
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
import { UI_EVENT } from '../lib/telemetry/uiEvents.ts';
import type { VisionTooltipHideDetail, VisionTooltipShowDetail } from '../lib/telemetry/uiEvents.ts';

function init(): void {
	document.querySelectorAll<HTMLElement>('[data-visibility-target-type]').forEach((el) => {
		const targetType = el.dataset.visibilityTargetType;
		const targetId = el.dataset.visibilityTargetId;
		if (!targetType || !targetId) return;
		telemetry.observeVisibility(el, targetType, targetId);
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
