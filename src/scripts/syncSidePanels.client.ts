/**
 * Drives the two side panels in ScrollyRegion.astro (.side-panel, one
 * inside each of .scrolly-col--left/--right):
 *
 * 1. Position — each panel is `position: fixed` (fully decoupled from the
 *    page's scroll, so it can never be nudged by scrolling the center
 *    column) but still needs to visually sit over its reserved grid
 *    column, which varies with viewport width. Its column (left empty on
 *    purpose — see the .astro file) still participates in the grid
 *    normally, so its rect is exactly the slot the panel should occupy;
 *    this copies that rect's left/width onto the fixed panel — only on
 *    load/resize, since it never changes mid-scroll and re-measuring it on
 *    every scroll tick was pure wasted work (see updateHeights below).
 * 2. Visibility — the panel becomes active (fixed, visible, fading in) once
 *    the Timeline's first entry has scrolled into view (not just the
 *    section starting to appear — its title/filter chip coming into view
 *    isn't enough). Deactivates again near the top if scrolled back above
 *    that point. At the *bottom*, instead of a hard cutoff, its max-height
 *    is continuously shrunk to keep its own bottom edge just above that
 *    side's actual PersonContactCard (in the separate Contact section) as
 *    it scrolls up from below — clipping from the bottom as that specific
 *    card approaches, rather than a generic Timeline/Projects boundary
 *    (which could shrink it before or after the card the overlap is
 *    actually with) or letting it float on top of that card. This is the
 *    scroll-driven part, so it runs directly on the scroll event with no
 *    requestAnimationFrame throttle — modern browsers already coalesce
 *    scroll dispatch to frame timing, so an extra rAF hop here only adds a
 *    frame of lag for work this cheap; all rects are read up front before
 *    any style is written, so there's no read/write layout thrashing
 *    either.
 * 3. Scroll mirroring — the browser already routes wheel/trackpad
 *    scrolling to whichever scrollable element (.side-panel-scroll) the
 *    cursor is over natively; this just replays the same scrollTop on the
 *    other side's scroll area, so both panels always move together
 *    regardless of which one was actually scrolled. overscroll-behavior:
 *    contain (in CSS) stops either one from handing scroll off to the page
 *    once it hits its own top/bottom.
 */

const DESKTOP = window.matchMedia('(min-width: 901px)');

interface PanelPair {
	column: HTMLElement;
	panel: HTMLElement;
	/** That side's own PersonContactCard in the Contact section — the panel
	 * shrinks to keep clear of this specific element as it rises into view. */
	endTrigger: HTMLElement | null;
}

function getPanelPair(columnSelector: string, endTriggerSelector: string): PanelPair | null {
	const column = document.querySelector<HTMLElement>(columnSelector);
	const panel = column?.querySelector<HTMLElement>('.side-panel') ?? null;
	if (!column || !panel) return null;
	const endTrigger = document.querySelector<HTMLElement>(endTriggerSelector);
	return { column, panel, endTrigger };
}

// Mitko's contact card is the first child of #contact's grid, Ádám's the
// last — see Contact.astro.
const left = getPanelPair('.scrolly-col--left', '#contact .contact-grid > :first-child');
const right = getPanelPair('.scrolly-col--right', '#contact .contact-grid > :last-child');
const pairs = [left, right].filter((p): p is PanelPair => p !== null);

// The Timeline's very first entry (currently Black Hole Entertainment for
// Ádám / Ericsson Hungary for Mitko) — the panels' visibility trigger.
const firstTimelineEntry = document.querySelector<HTMLElement>('#timeline .timeline > :first-child');

function remToPx(rem: number): number {
	return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// Matches .side-panel's own `top: 6rem` in the .astro file.
const PANEL_TOP = remToPx(6);
const GAP = 5;

function updatePositions(): void {
	if (!DESKTOP.matches) return;
	// Read every rect before writing any style, so a write never forces a
	// synchronous layout recalculation the next read has to pay for.
	const rects = pairs.map(({ column }) => column.getBoundingClientRect());
	pairs.forEach(({ panel }, i) => {
		panel.style.left = `${rects[i].left}px`;
		panel.style.width = `${rects[i].width}px`;
	});
}

function updateHeights(): void {
	if (!DESKTOP.matches) return;

	const startRect = firstTimelineEntry?.getBoundingClientRect();
	const reachedStart = startRect ? startRect.top < window.innerHeight : true;

	if (!reachedStart) {
		pairs.forEach(({ panel }) => {
			panel.classList.remove('is-active');
			panel.style.maxHeight = '';
		});
		return;
	}

	const fullHeight = window.innerHeight - remToPx(8);
	// Read first...
	const endRects = pairs.map(({ endTrigger }) => endTrigger?.getBoundingClientRect());
	// ...then write.
	pairs.forEach(({ panel }, i) => {
		const endRect = endRects[i];
		const available = endRect ? endRect.top - PANEL_TOP - GAP : fullHeight;
		const height = Math.max(0, Math.min(fullHeight, available));
		panel.classList.add('is-active');
		panel.style.maxHeight = `${height}px`;
	});
}

if (pairs.length > 0) {
	updatePositions();
	updateHeights();

	window.addEventListener('scroll', updateHeights, { passive: true });

	let resizeQueued = false;
	window.addEventListener('resize', () => {
		if (resizeQueued) return;
		resizeQueued = true;
		requestAnimationFrame(() => {
			resizeQueued = false;
			updatePositions();
			updateHeights();
		});
	});

	DESKTOP.addEventListener('change', () => {
		updatePositions();
		updateHeights();
	});
}

if (left && right) {
	const leftScroll = left.panel.querySelector<HTMLElement>('.side-panel-scroll');
	const rightScroll = right.panel.querySelector<HTMLElement>('.side-panel-scroll');

	if (leftScroll && rightScroll) {
		let syncing = false;

		function mirror(source: HTMLElement, target: HTMLElement) {
			return () => {
				if (syncing) return;
				syncing = true;
				target.scrollTop = source.scrollTop;
				syncing = false;
			};
		}

		leftScroll.addEventListener('scroll', mirror(leftScroll, rightScroll));
		rightScroll.addEventListener('scroll', mirror(rightScroll, leftScroll));
	}
}

export {};
