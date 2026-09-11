/**
 * Presents an active skill filter as a modal (see ScrollyRegion.astro, which
 * holds the backdrop + the modal styling on `.timeline-area`, and
 * tagFilter.client.ts, which owns the filter state and toggles
 * `body.filter-active`).
 *
 * When a filter turns on, the rest of the site is hidden behind a backdrop and
 * the filtered Timeline jobs/projects are lifted into a centered panel. This
 * script's job is only the scroll lock (so the page behind can't move while
 * the modal is up) and dismissal: clicking the backdrop clears the filter,
 * like any modal. Escape and the in-panel chip's ✕ also clear it (handled in
 * tagFilter.client.ts).
 *
 * Approach: continuously save the pre-filter scroll position on every scroll
 * (unless the filter is up), and on close jump back to it. Body scroll is
 * blocked while the modal is up via `overflow: hidden` on <html> — the same
 * pattern projectModal uses. We deliberately avoid `body { position: fixed }`
 * here: it would collapse the page height, the browser would clamp
 * window.scrollY to 0, other scroll-driven scripts (personPhotos, contactSnap)
 * would fire against that 0, and — worst of all — the reflow on close makes
 * browser scroll anchoring nudge the restored position by 20–40px so scrollTo
 * silently loses the saved value.
 */

const backdrop = document.querySelector<HTMLElement>('.filter-backdrop');

function clearButton(): HTMLElement | null {
	return document.getElementById('timeline-filter-chip-clear');
}

// Continuously updated while the filter is off — this is the "somewhere" the
// pre-filter scroll position is saved to, and where we jump back to on close.
let savedScrollY = window.scrollY;
let filterOpen = false;

window.addEventListener(
	'scroll',
	() => {
		if (!filterOpen) savedScrollY = window.scrollY;
	},
	{ passive: true },
);

function lock(): void {
	if (filterOpen) return;
	filterOpen = true;
	// DO NOT snapshot window.scrollY here — reading it can force layout, and
	// by the time this runs the CSS change (#timeline display:none,
	// .timeline-area position:fixed) has queued a reflow that will collapse
	// page height and clamp window.scrollY. The pre-open Y is already saved
	// in savedScrollY (updated on every scroll while the filter is off, and
	// re-set from the willopen event detail just before this).
	// Block page scroll while the modal is up.
	document.documentElement.style.overflow = 'hidden';
	// Reset the filter panel to the top so reopening never inherits old scroll.
	const area = document.getElementById('timeline-area');
	if (area) area.scrollTop = 0;
}

function unlock(): void {
	if (!filterOpen) return;
	filterOpen = false;
	document.documentElement.style.overflow = '';
	const html = document.documentElement;
	const body = document.body;
	// Restore instantly (scroll-behavior:smooth on <html> would otherwise
	// animate this and read as an unwanted scroll on exit).
	const prevBehavior = html.style.scrollBehavior;
	// Disable browser scroll anchoring during the restore + a couple frames
	// after. Even without body{position:fixed}, the filter cycle reflows the
	// page — the person-bar's .reveal collapses, personPhotos recomputes
	// splits, .filter-results appears and disappears — and scroll anchoring
	// nudges scrollY by 20–40 px to keep some element visually stable,
	// silently defeating scrollTo. Apply to both html and body so no
	// ancestor scroller anchors, then release once late reflows have
	// settled.
	const prevAnchorHtml = html.style.overflowAnchor;
	const prevAnchorBody = body.style.overflowAnchor;
	html.style.overflowAnchor = 'none';
	body.style.overflowAnchor = 'none';
	html.style.scrollBehavior = 'auto';
	window.scrollTo(0, savedScrollY);
	html.style.scrollBehavior = prevBehavior;
	// The close reflow keeps trickling out for many hundreds of ms — the
	// person-bar collapses, filter-results goes display:none,
	// syncApartHeights runs its iterative settle passes on the newly-visible
	// timeline .tracks — and each late layout tick can nudge scrollY. Pin the
	// restored position across that whole quiet-settle window by re-scrolling
	// on every scroll event, and release as soon as the reader actually
	// touches the page (wheel, touch, or keyboard scroll) OR after a long
	// upper bound.
	let userInteracted = false;
	const yieldToUser = () => { userInteracted = true; };
	const pin = () => {
		if (userInteracted) return;
		if (window.scrollY !== savedScrollY) window.scrollTo(0, savedScrollY);
	};
	window.addEventListener('scroll', pin, { passive: true });
	window.addEventListener('wheel', yieldToUser, { passive: true, once: true });
	window.addEventListener('touchstart', yieldToUser, { passive: true, once: true });
	window.addEventListener('keydown', yieldToUser, { once: true });
	window.setTimeout(() => {
		window.removeEventListener('scroll', pin);
		window.removeEventListener('wheel', yieldToUser);
		window.removeEventListener('touchstart', yieldToUser);
		window.removeEventListener('keydown', yieldToUser);
		html.style.overflowAnchor = prevAnchorHtml;
		body.style.overflowAnchor = prevAnchorBody;
	}, 1500);
}

// tagFilter dispatches these synchronously around its class toggle, so
// lock/unlock happen in the same tick as the CSS change and no microtask gap
// opens for other scroll listeners to slip into.
document.addEventListener('filter:willopen', (event) => {
	const detail = (event as CustomEvent<{ scrollY: number }>).detail;
	if (typeof detail?.scrollY === 'number') savedScrollY = detail.scrollY;
});

document.addEventListener('filter:opened', () => {
	lock();
});

document.addEventListener('filter:closed', () => {
	unlock();
});

// Click the dimmed backdrop to dismiss — the modal's "click outside".
backdrop?.addEventListener('click', () => clearButton()?.click());

export {};
