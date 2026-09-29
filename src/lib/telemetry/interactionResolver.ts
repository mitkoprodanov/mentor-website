// Shared semantic resolver for Pass 4 (docs/telemetry.md section 17.9): given the
// element a pointer activation / context menu landed on, work out
//   - its nearest stable semantic identity (existing data-* / known controls),
//   - the closed structural region,
//   - whether it hit a DOM control / known actionable surface,
//   - whether it is an allowlisted noninteractive affordance, and
//   - whether it is a meaningful context-menu target.
//
// It walks `parentElement` and reads only attribute/class/tag facts through the
// tiny `ElementLike` shape (a real DOM `Element` satisfies it), so it is unit
// testable without a DOM. It never reads text, innerHTML, hrefs, selectors or
// arbitrary class lists into telemetry: only closed enums and canonical ids.

import { STUDIO_CONTACT } from '../../data/contact.ts';

export interface ElementLike {
	tagName: string;
	id: string;
	parentElement: ElementLike | null;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	classList: { contains(name: string): boolean };
}

export type Region =
	| 'navbar'
	| 'about'
	| 'timeline'
	| 'contact'
	| 'person_bar'
	| 'project_modal'
	| 'skill_filtered'
	| 'rotate_overlay'
	| 'other';

export interface Semantic {
	type: string;
	id: string;
}

export interface NoninteractiveHit extends Semantic {
	/** Closed enum naming which allowlisted affordance was hit. */
	element:
		| 'tag_pill'
		| 'unlinked_skill_tag'
		| 'gallery_media'
		| 'filtered_card'
		| 'person_card'
		| 'section_title'
		| 'partner_logo'
		| 'static_project_card';
	projectId?: string;
}

export interface ContextHit extends Semantic {
	element: 'company_email' | 'cv' | 'linkedin' | 'project_link' | 'skill_tag' | 'media';
	properties?: Record<string, string>;
}

export interface Resolution {
	semantic: Semantic | null;
	region: Region;
	interactive: boolean;
	textLike: boolean;
	noninteractive: NoninteractiveHit | null;
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const TYPE_RE = /^[a-z][a-z0-9_]*$/;
const PEOPLE = new Set(['mitko', 'adam']);
const NAV_TARGETS = new Set(['about', 'timeline', 'contact']);
const MAX_DEPTH = 40;

const validId = (v: string | null | undefined): string | null => (v && ID_RE.test(v) ? v : null);

const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'IFRAME', 'EMBED', 'OBJECT']);
const INTERACTIVE_ROLES = new Set([
	'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
	'option', 'slider', 'spinbutton', 'textbox', 'combobox', 'searchbox', 'treeitem',
]);
/** Elements whose interior is not selectable text. */
const NON_TEXT_TAGS = new Set(['IMG', 'SVG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'HTML', 'BODY', 'PATH']);
const GALLERY_TYPES = new Set(['image', 'gif', 'image-row']);
const CONTEXT_MEDIA_TYPES = new Set(['image', 'gif', 'image-row', 'video', 'youtube', 'facebook-video', 'facebook-reel']);
const FILTER_CHROME_CONTAINERS = ['project-modal__link', 'project-modal__body', 'project-modal__gallery', 'project-modal__tags'];

function chainOf(el: ElementLike | null): ElementLike[] {
	const out: ElementLike[] = [];
	for (let e = el; e && out.length < MAX_DEPTH; e = e.parentElement) out.push(e);
	return out;
}

const has = (e: ElementLike, cls: string): boolean => e.classList.contains(cls);
const attr = (e: ElementLike, name: string): string | null => e.getAttribute(name);
const tag = (e: ElementLike): string => (e.tagName || '').toUpperCase();

/** Duck-type an `event.target` into an ElementLike, or null (text node, document, window). */
export function asElement(t: unknown): ElementLike | null {
	const e = t as Partial<ElementLike> | null;
	return e && typeof e.getAttribute === 'function' && typeof e.tagName === 'string' && e.classList ? (e as ElementLike) : null;
}

// ---- helpers over a chain ---------------------------------------------------

function personOf(chain: ElementLike[]): string | null {
	for (const e of chain) {
		if (has(e, 'side-panel')) {
			const p = attr(e, 'data-person');
			if (p && PEOPLE.has(p)) return p;
		}
	}
	return null;
}

/** The canonical project id of the surface the element sits in: the open dialog's
 *  `data-project-id`, or the filtered card's visibility id. Never a `tl-*` id. */
function projectContextOf(chain: ElementLike[]): string | undefined {
	for (const e of chain) {
		if (e.hasAttribute('data-project-modal')) return validId(attr(e, 'data-project-id')) ?? undefined;
		if (attr(e, 'data-visibility-target-type') === 'filtered_project') {
			return validId(attr(e, 'data-visibility-target-id')) ?? undefined;
		}
	}
	return undefined;
}

function visibilityOf(e: ElementLike): Semantic | null {
	const t = attr(e, 'data-visibility-target-type');
	const id = validId(attr(e, 'data-visibility-target-id'));
	return t && TYPE_RE.test(t) && id ? { type: t, id } : null;
}

// ---- semantic identity ------------------------------------------------------

/** Innermost meaningful semantic identity, from EXISTING stable attributes / known controls. */
export function semanticOf(chain: ElementLike[]): Semantic | null {
	for (const e of chain) {
		const tagId = validId(attr(e, 'data-tag-id'));
		if (tagId) return { type: 'skill', id: tagId };
		const thought = validId(attr(e, 'data-thought-id'));
		if (thought) return { type: 'vision_tooltip', id: thought };
		const vis = visibilityOf(e);
		if (vis) return vis;
		if (has(e, 'cv-download') || has(e, 'linkedin-pill')) {
			const p = personOf(chain);
			if (p) return { type: 'person', id: p };
		}
		if (has(e, 'company-linkedin-link') || has(e, 'email-copy-btn') || has(e, 'email-mailto-link')) {
			return { type: 'company', id: STUDIO_CONTACT.id };
		}
		if (attr(e, 'data-external-link-type')) {
			const pid = validId(attr(e, 'data-project-id'));
			if (pid) return { type: 'project', id: pid };
		}
		if (tag(e) === 'A' && chain.some((x) => has(x, 'navbar'))) {
			const href = attr(e, 'href') ?? '';
			const dest = href.startsWith('#') ? href.slice(1) : '';
			if (NAV_TARGETS.has(dest)) return { type: 'navbar', id: dest };
		}
		if (e.hasAttribute('data-project-modal')) {
			const pid = validId(attr(e, 'data-project-id'));
			if (pid) return { type: 'project', id: pid };
		}
		const person = attr(e, 'data-person');
		if (person && PEOPLE.has(person)) return { type: 'person', id: person };
		const company = validId(attr(e, 'data-company-id'));
		if (company) return { type: 'company', id: company };
	}
	return null;
}

// ---- region -----------------------------------------------------------------

export function regionOf(chain: ElementLike[], surface: string): Region {
	for (const e of chain) {
		if (has(e, 'navbar')) return 'navbar';
		if (e.id === 'rotate-overlay') return 'rotate_overlay';
		if (e.hasAttribute('data-project-modal')) return 'project_modal';
		if (e.id === 'person-bar') return 'person_bar';
		if (e.id === 'filter-results') return 'skill_filtered';
	}
	if (surface === 'project_modal') return 'project_modal';
	if (surface === 'skill_filtered') return 'skill_filtered';
	for (const e of chain) {
		if (e.id === 'contact') return 'contact';
		if (e.id === 'timeline' || e.id === 'timeline-area') return 'timeline';
		if (e.id === 'about') return 'about';
	}
	return 'other';
}

// ---- interactive classification ---------------------------------------------

/** Did the activation hit a DOM control or a known delegated/dismiss surface?
 *  This describes DOM semantics only — NOT that the user's intended action worked. */
export function isInteractive(chain: ElementLike[]): boolean {
	for (let i = 0; i < chain.length; i++) {
		const e = chain[i];
		const t = tag(e);
		if (t === 'A' && e.hasAttribute('href')) return true;
		if (INTERACTIVE_TAGS.has(t)) return true;
		if ((t === 'VIDEO' || t === 'AUDIO') && e.hasAttribute('controls')) return true;
		const role = attr(e, 'role');
		if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
		const ti = attr(e, 'tabindex');
		if (ti !== null && ti.trim() !== '' && ti.trim() !== '-1') return true;
		// Known dismiss surfaces (delegated click handlers on non-control elements).
		if (has(e, 'filter-backdrop') || has(e, 'person-backdrop')) return true;
		// The <dialog> element itself as target == its backdrop (closes the project).
		if (i === 0 && e.hasAttribute('data-project-modal')) return true;
	}
	return false;
}

// ---- allowlisted noninteractive affordances ---------------------------------

export function noninteractiveHit(chain: ElementLike[], pointerType?: string): NoninteractiveHit | null {
	if (chain.length === 0 || isInteractive(chain)) return null;
	const projectId = projectContextOf(chain);
	const first = chain[0];

	// Tag pills. In the Skills panel a non-button tag is an *unlinked* skill tag.
	for (const e of chain) {
		const id = validId(attr(e, 'data-tag-id'));
		if (id && tag(e) !== 'BUTTON') {
			return chain.some((x) => has(x, 'side-panel'))
				? { type: 'skill', id, element: 'unlinked_skill_tag' }
				: { type: 'skill', id, element: 'tag_pill', projectId };
		}
	}
	// Partner logo — reusable marker whose value is the canonical LOGO id (data/logos.ts),
	// independent of the project/company showing it; that context stays recoverable via
	// project_id / view_instance_id / chronology.
	for (const e of chain) {
		const id = validId(attr(e, 'data-partner-logo'));
		if (id) return { type: 'partner_logo', id, element: 'partner_logo', projectId };
	}
	// Section title pills.
	for (const e of chain) {
		const s = attr(e, 'data-section-title');
		if (s === 'timeline' || s === 'contact') return { type: 'section', id: s, element: 'section_title' };
	}
	// Noninteractive gallery media (image / gif / image-row frames only).
	if (chain.some((e) => has(e, 'shot-frame'))) {
		for (const e of chain) {
			const v = visibilityOf(e);
			if (v && v.type === 'project_content') {
				const ct = attr(e, 'data-visibility-content-type');
				if (ct && GALLERY_TYPES.has(ct)) return { type: 'project_content', id: v.id, element: 'gallery_media', projectId };
				break;
			}
		}
	}
	// The static (unnamed, non-clickable) project card — the card box / its content
	// wrapper only, never the prose inside.
	const staticCard = first.hasAttribute('data-static-card')
		? first
		: has(first, 'content') && chain[1]?.hasAttribute('data-static-card')
			? chain[1]
			: null;
	if (staticCard) {
		for (const e of chain.slice(chain.indexOf(staticCard))) {
			if (attr(e, 'data-visibility-target-type') === 'timeline_project') {
				const id = validId(attr(e, 'data-visibility-target-id'));
				if (id) return { type: 'timeline_project', id, element: 'static_project_card' };
			}
		}
	}
	// Skill Filtered View card chrome (card box, header, spacing containers) — not prose/media.
	const cardIdx = chain.findIndex((e) => e.hasAttribute('data-fr-card'));
	if (cardIdx >= 0) {
		const id = validId(attr(chain[cardIdx], 'data-visibility-target-id'));
		const isChrome =
			cardIdx === 0 ||
			chain.slice(0, cardIdx).some((e) => has(e, 'project-modal__head')) ||
			FILTER_CHROME_CONTAINERS.some((c) => has(first, c));
		if (id && isChrome) return { type: 'filtered_project', id, element: 'filtered_card' };
	}
	// Person card body on touch — never the Skills content, never a control.
	if (pointerType === 'touch') {
		const p = personOf(chain);
		if (p && !chain.some((e) => has(e, 'side-panel-stack'))) return { type: 'person', id: p, element: 'person_card' };
	}
	return null;
}

// ---- context-menu targets -----------------------------------------------------

export function contextHit(chain: ElementLike[]): ContextHit | null {
	for (const e of chain) {
		if (has(e, 'email-copy-btn') || has(e, 'email-mailto-link') || has(e, 'contact-email-pill')) {
			return { type: 'company', id: STUDIO_CONTACT.id, element: 'company_email' };
		}
		if (has(e, 'cv-download')) {
			const p = personOf(chain);
			if (p) return { type: 'person', id: p, element: 'cv' };
		}
		if (has(e, 'linkedin-pill')) {
			const p = personOf(chain);
			if (p) return { type: 'person', id: p, element: 'linkedin' };
		}
		if (has(e, 'company-linkedin-link')) return { type: 'company', id: STUDIO_CONTACT.id, element: 'linkedin' };
		const ext = attr(e, 'data-external-link-type');
		if (ext) {
			const pid = validId(attr(e, 'data-project-id'));
			if (pid) return { type: 'project', id: pid, element: 'project_link', properties: { destination_type: ext } };
		}
		const tagId = validId(attr(e, 'data-tag-id'));
		if (tagId) return { type: 'skill', id: tagId, element: 'skill_tag' };
	}
	if (chain.some((e) => has(e, 'shot-frame'))) {
		for (const e of chain) {
			const v = visibilityOf(e);
			if (v && v.type === 'project_content') {
				const ct = attr(e, 'data-visibility-content-type');
				if (ct && CONTEXT_MEDIA_TYPES.has(ct)) {
					return { type: 'project_content', id: v.id, element: 'media', properties: { content_type: ct } };
				}
				return null;
			}
		}
	}
	return null;
}

// ---- top-level ----------------------------------------------------------------

export function resolve(target: unknown, surface: string, pointerType?: string): Resolution | null {
	const el = asElement(target);
	if (!el) return null;
	const chain = chainOf(el);
	const interactive = isInteractive(chain);
	const noninteractive = interactive ? null : noninteractiveHit(chain, pointerType);
	const textLike = !interactive && !noninteractive && !NON_TEXT_TAGS.has(tag(el));
	return { semantic: semanticOf(chain), region: regionOf(chain, surface), interactive, textLike, noninteractive };
}

export function resolveContext(target: unknown): ContextHit | null {
	const el = asElement(target);
	return el ? contextHit(chainOf(el)) : null;
}
