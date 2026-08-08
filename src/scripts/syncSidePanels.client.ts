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
 *    this just copies that rect's left/width onto the fixed panel.
 * 2. Visibility — the panel becomes active (fixed, visible) once the
 *    Timeline's first entry has scrolled into view (not just the section
 *    starting to appear — its title/filter chip coming into view isn't
 *    enough) and stays active for the rest of the page, only deactivating
 *    again if scrolled back above that point, near the top.
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
}

function getPanelPair(columnSelector: string): PanelPair | null {
	const column = document.querySelector<HTMLElement>(columnSelector);
	const panel = column?.querySelector<HTMLElement>('.side-panel') ?? null;
	if (!column || !panel) return null;
	return { column, panel };
}

const left = getPanelPair('.scrolly-col--left');
const right = getPanelPair('.scrolly-col--right');
const pairs = [left, right].filter((p): p is PanelPair => p !== null);

// The Timeline's very first entry (currently Black Hole Entertainment for
// Ádám / Ericsson Hungary for Mitko) — the panels' visibility trigger, kept
// separate from `column` (still just used for left/width positioning
// below), since the column itself starts well above this (behind the
// section title and filter chip).
const firstTimelineEntry = document.querySelector<HTMLElement>('#timeline .timeline > :first-child');

function updatePanel({ column, panel }: PanelPair): void {
	if (!DESKTOP.matches) return;

	const rect = column.getBoundingClientRect();
	panel.style.left = `${rect.left}px`;
	panel.style.width = `${rect.width}px`;

	// Active from the moment the first entry has scrolled into view onward —
	// not just while it's still on screen — so the panels stay up for the
	// rest of the Timeline/Projects/contact scroll and only disappear again
	// if scrolled back above it, near the top.
	const triggerRect = firstTimelineEntry?.getBoundingClientRect() ?? rect;
	const active = triggerRect.top < window.innerHeight;
	panel.classList.toggle('is-active', active);
}

let queued = false;

function scheduleUpdate(): void {
	if (queued) return;
	queued = true;
	requestAnimationFrame(() => {
		queued = false;
		pairs.forEach(updatePanel);
	});
}

if (pairs.length > 0) {
	scheduleUpdate();
	window.addEventListener('scroll', scheduleUpdate, { passive: true });
	window.addEventListener('resize', scheduleUpdate);
	DESKTOP.addEventListener('change', scheduleUpdate);
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
