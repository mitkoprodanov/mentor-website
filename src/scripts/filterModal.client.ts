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
 */

const backdrop = document.querySelector<HTMLElement>('.filter-backdrop');

function clearButton(): HTMLElement | null {
	return document.getElementById('timeline-filter-chip-clear');
}

// Tracked continuously while unlocked, so at lock time we have the scroll
// position from *before* the filter lifted the timeline out of flow.
let scrollY = window.scrollY;
let locked = false;

window.addEventListener(
	'scroll',
	() => {
		if (!locked) scrollY = window.scrollY;
	},
	{ passive: true },
);

function lock(): void {
	if (locked) return;
	locked = true;
	document.body.style.position = 'fixed';
	document.body.style.top = `-${scrollY}px`;
	document.body.style.left = '0';
	document.body.style.right = '0';
	document.body.style.width = '100%';
}

function unlock(): void {
	if (!locked) return;
	locked = false;
	document.body.style.position = '';
	document.body.style.top = '';
	document.body.style.left = '';
	document.body.style.right = '';
	document.body.style.width = '';
	// The locked page was visually frozen in place (position:fixed at -scrollY),
	// so leaving the filtered view should just reveal it exactly where it was.
	// window.scrollTo would otherwise animate — the page has scroll-behavior:
	// smooth — reading as an unwanted scroll on exit; force it instant.
	const html = document.documentElement;
	const prevBehavior = html.style.scrollBehavior;
	html.style.scrollBehavior = 'auto';
	window.scrollTo(0, scrollY);
	html.style.scrollBehavior = prevBehavior;
}

const observer = new MutationObserver(() => {
	const active = document.body.classList.contains('filter-active');
	if (active) lock();
	else unlock();
});

observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

// Click the dimmed backdrop to dismiss — the modal's "click outside".
backdrop?.addEventListener('click', () => clearButton()?.click());

export {};
