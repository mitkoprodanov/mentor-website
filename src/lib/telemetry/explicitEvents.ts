// Pure payload construction for Telemetry Pass 3's explicit-action events
// (docs/telemetry.md sections 10-11): nav_click, cv_download, linkedin_click,
// contact_email_copy, contact_email_open, external_link_click.
//
// Kept dependency-free of the DOM so these can be unit-tested directly (see
// test/explicitEvents.test.ts) — the same split state.ts already established:
// decision logic lives here, DOM wiring (navScroll.client.ts, CompanyContactCard's
// own script, explicitActions.client.ts) just collects inputs and calls these.
// A function returns null when its required identity isn't a value we
// actually recognize, so a caller can skip emitting entirely rather than
// sending a malformed event — properties are additive facts, never guesses.

import type { EmitOptions, PropertyValue } from './types.ts';

const PEOPLE = new Set(['mitko', 'adam']);
const NAV_TARGETS = new Set(['about', 'timeline', 'contact']);
const NAV_SURFACES = new Set(['main', 'skills']);
const SKILLS_MODES = new Set(['hover', 'locked']);
const POINTER_TYPES = new Set(['mouse', 'touch', 'pen']);
const LINKEDIN_TARGET_TYPES = new Set(['person', 'company']);
const TARGET_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

const validId = (v: unknown): string | null =>
	typeof v === 'string' && TARGET_ID_RE.test(v) ? v : null;

/** Drops undefined/null so payloads only carry facts actually known. */
function props(o: Record<string, PropertyValue | undefined>): Record<string, PropertyValue> | undefined {
	const out: Record<string, PropertyValue> = {};
	for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
	return Object.keys(out).length ? out : undefined;
}

/** Only a value the DOM event actually exposes — never guessed (docs section 8).
 *  A keyboard-activated click reports `pointerType: ''` on real browsers, which
 *  is correctly `undefined` here rather than an invented `'keyboard'`. */
export function pointerTypeOf(event: { pointerType?: string } | null | undefined): 'mouse' | 'touch' | 'pen' | undefined {
	const t = event?.pointerType;
	return t && POINTER_TYPES.has(t) ? (t as 'mouse' | 'touch' | 'pen') : undefined;
}

// ---- nav_click ------------------------------------------------------------

export interface NavClickInput {
	/** about | timeline | contact */
	target: string;
	/** main | skills — read from semanticState.get().surface. */
	originSurface: string;
	/** Only meaningful (and only sent) when originSurface is 'main'. */
	originSection?: string | null;
	/** Only meaningful (and only sent) when originSurface is 'skills'. */
	skillsMode?: string | null;
	pointerType?: string;
}

export function buildNavClick(input: NavClickInput): EmitOptions | null {
	if (!NAV_TARGETS.has(input.target)) return null;
	if (!NAV_SURFACES.has(input.originSurface)) return null;
	const properties: Record<string, PropertyValue | undefined> = {
		target: input.target,
		origin_surface: input.originSurface,
	};
	if (input.originSurface === 'main' && input.originSection && NAV_TARGETS.has(input.originSection)) {
		properties.origin_section = input.originSection;
	}
	if (input.originSurface === 'skills' && input.skillsMode && SKILLS_MODES.has(input.skillsMode)) {
		properties.skills_mode = input.skillsMode;
	}
	const pt = pointerTypeOf({ pointerType: input.pointerType });
	if (pt) properties.pointer_type = pt;
	return { properties: props(properties) };
}

// ---- cv_download / linkedin_click -----------------------------------------

export function buildCvDownload(personId: string | null | undefined, pointerType?: string): EmitOptions | null {
	if (!personId || !PEOPLE.has(personId)) return null;
	return {
		target_type: 'person',
		target_id: personId,
		properties: props({ pointer_type: pointerTypeOf({ pointerType }) }),
	};
}

export function buildLinkedinClick(
	targetType: 'person' | 'company',
	targetId: string | null | undefined,
	pointerType?: string,
): EmitOptions | null {
	if (!LINKEDIN_TARGET_TYPES.has(targetType)) return null;
	if (targetType === 'person' && (!targetId || !PEOPLE.has(targetId))) return null;
	const id = validId(targetId);
	if (!id) return null;
	return {
		target_type: targetType,
		target_id: id,
		properties: props({ pointer_type: pointerTypeOf({ pointerType }) }),
	};
}

// ---- Company email ----------------------------------------------------------

export function buildContactEmailCopy(companyId: string | null | undefined): EmitOptions | null {
	const id = validId(companyId);
	if (!id) return null;
	return { target_type: 'company', target_id: id };
}

export function buildContactEmailOpen(companyId: string | null | undefined, pointerType?: string): EmitOptions | null {
	const id = validId(companyId);
	if (!id) return null;
	return {
		target_type: 'company',
		target_id: id,
		properties: props({ pointer_type: pointerTypeOf({ pointerType }) }),
	};
}

// ---- external_link_click ----------------------------------------------------

/** Semantic destination identities actually wired (ProjectDetail.astro's
 *  `data-external-link-type`) — extend alongside a new instrumented link,
 *  never inferred from an arbitrary URL/label. */
const EXTERNAL_LINK_DESTINATIONS = new Set(['official_site', 'linkedin_post_fallback']);

export function buildExternalLinkClick(
	destinationType: string | null | undefined,
	projectId: string | null | undefined,
	pointerType?: string,
): EmitOptions | null {
	if (!destinationType || !EXTERNAL_LINK_DESTINATIONS.has(destinationType)) return null;
	const id = validId(projectId);
	return {
		target_type: id ? 'project' : undefined,
		target_id: id ?? undefined,
		properties: props({ destination_type: destinationType, pointer_type: pointerTypeOf({ pointerType }) }),
	};
}

// ---- auxclick / activation --------------------------------------------------

/** Does this DOM event represent a genuine activation of a native link?
 *  `click` is always the primary activation; `auxclick` counts ONLY for the
 *  middle button (button 1 — the browser's "open in new tab"), never for other
 *  auxiliary buttons. A physical middle-click fires `auxclick` and no `click`,
 *  and a left-click fires `click` and no `auxclick`, so one physical activation
 *  maps to exactly one handler call. */
export function isLinkActivation(type: string, button: number | undefined): boolean {
	if (type === 'click') return true;
	return type === 'auxclick' && button === 1;
}

export interface LinkTargetLike {
	addEventListener(type: string, listener: (e: any) => void): void;
}

/** Runs `handler` once per genuine activation (left click, keyboard-activated
 *  click, or middle-click) of a native link. Never interferes with the event. */
export function onLinkActivation(el: LinkTargetLike, handler: (event: { pointerType?: string }) => void): void {
	for (const type of ['click', 'auxclick']) {
		el.addEventListener(type, (event: { button?: number; pointerType?: string }) => {
			if (isLinkActivation(type, event.button)) handler(event);
		});
	}
}

// ---- action_failed ------------------------------------------------------------

/** Closed vocabulary: an action our own code attempted and objectively knows failed. */
export const ACTION_FAILURE_REASONS: Record<string, ReadonlySet<string>> = {
	contact_email_copy: new Set(['clipboard_denied', 'clipboard_unavailable', 'copy_failed']),
	project_open: new Set(['dialog_not_found', 'dialog_open_error']),
};

export function buildActionFailed(
	action: string,
	reason: string,
	targetType?: string | null,
	targetId?: string | null,
): EmitOptions | null {
	if (!ACTION_FAILURE_REASONS[action]?.has(reason)) return null;
	const id = validId(targetId);
	const opts: EmitOptions = { properties: { action, reason } };
	if (id && targetType) {
		opts.target_type = targetType;
		opts.target_id = id;
	}
	return opts;
}
