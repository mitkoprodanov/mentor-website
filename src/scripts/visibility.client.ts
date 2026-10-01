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
 * `data-visibility-playable-kind` (docs section 17.7) marks a `project_content`
 * item as playable media, driving `playable_v*`/`playing_v*` accounting. Two
 * playable kinds start life not-yet-live and this file marks that explicitly
 * at registration, before any geometry ever crosses 50% — mirroring exactly
 * what `projectModal.client.ts` does to the real DOM at the same moment
 * (blanking every Facebook iframe / not yet having constructed a YouTube
 * player):
 *   - `facebook`: opaque provider, only ever unsuspended by a real
 *     `activateFacebook()` call (projectModal.client.ts).
 *   - `youtube`: only ever unsuspended once the IFrame API player actually
 *     fires `onReady` (projectModal.client.ts).
 *   - `gif`: not a provider, just an `<img>` that may not have finished
 *     loading yet — unsuspended here directly once it has (`img.complete`,
 *     or its own `load` event), no projectModal.client.ts involvement needed.
 *   - `native-video`: no separate "not yet live" state is tracked (docs
 *     section 17.7's documented limitation) — playable is ordinary
 *     Visibility Matrix eligibility only.
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

import { telemetry, telemetryControl } from '../lib/telemetry';
import type { ObserveOptions, PlayableKind, PropertyValue, Surface } from '../lib/telemetry';
import { UI_EVENT } from '../lib/telemetry/uiEvents.ts';
import type { VisionTooltipHideDetail, VisionTooltipShowDetail } from '../lib/telemetry/uiEvents.ts';

const VALID_OWNERS = new Set<Surface>(['main', 'skills', 'project_modal', 'skill_filtered']);
const VALID_PLAYABLE_KINDS = new Set<PlayableKind>(['native-video', 'youtube', 'facebook', 'gif']);
/** Playable kinds that start suspended until a real activation (docs section
 *  17.7) — `projectModal.client.ts` unsuspends `facebook`/`youtube`; `gif` is
 *  unsuspended right here from the image's own `load` state. `native-video`
 *  is deliberately absent (no "not yet live" state tracked for it). */
const STARTS_SUSPENDED = new Set<PlayableKind>(['facebook', 'youtube', 'gif']);

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
	const rawPlayableKind = el.dataset.visibilityPlayableKind;
	const playableKind = rawPlayableKind && VALID_PLAYABLE_KINDS.has(rawPlayableKind as PlayableKind) ? (rawPlayableKind as PlayableKind) : undefined;
	if (!owner && !playableKind && Object.keys(properties).length === 0) return undefined;
	return { owner, playableKind, properties: Object.keys(properties).length ? properties : undefined };
}

/** GIF-only initial suspension (docs section 17.7): suspended until the
 *  `<img>` has actually loaded, since an unloaded image isn't presenting any
 *  animated pixels yet regardless of how visible its container is. Uses
 *  whichever `<img>` sits inside this `project_content` figure — always
 *  exactly one for a `gif` item (see ProjectDetail.astro's default/`gif` shot
 *  branch). A no-op if the figure has no `<img>` (shouldn't happen for a real
 *  `gif` item, but never throws either way). */
function wireGifLoadGate(el: HTMLElement): void {
	const img = el.querySelector('img');
	if (!img) return;
	if (img.complete) return; // already loaded (e.g. cached): stays unsuspended
	telemetry.setVisibilityPlayableSuspended(el, true);
	img.addEventListener('load', () => telemetry.setVisibilityPlayableSuspended(el, false), { once: true });
}

/** Runs once per analytics start (never before consent): registers every target with the
 *  fresh engine and relays tooltip announcements; the cleanup removes the relays on withdrawal. */
function register(): () => void {
	const abort = new AbortController();
	const { signal } = abort;
	document.querySelectorAll<HTMLElement>('[data-visibility-target-type]').forEach((el) => {
		const targetType = el.dataset.visibilityTargetType;
		const targetId = el.dataset.visibilityTargetId;
		if (!targetType || !targetId) return;
		const options = observeOptions(el);
		telemetry.observeVisibility(el, targetType, targetId, options);
		if (options?.playableKind === 'gif') {
			wireGifLoadGate(el);
		} else if (options?.playableKind && STARTS_SUSPENDED.has(options.playableKind) && el.dataset.embedLive !== '1') {
			// (An embed the visitor already loaded before analytics started is genuinely live: leave it unsuspended.)
			telemetry.setVisibilityPlayableSuspended(el, true);
		}
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
	}, { signal });
	document.addEventListener(UI_EVENT.visionTooltipHide, (e) => {
		const { tooltipId } = (e as CustomEvent<VisionTooltipHideDetail>).detail ?? {};
		const el = tooltipEl(tooltipId);
		if (el) telemetry.endVisibilityAppearance(el);
	}, { signal });
	return () => abort.abort();
}

function init(): void {
	telemetryControl.onStart(register);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
