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
 *    this copies that rect's left/width onto the fixed panel.
 * 2. Visibility — the panel becomes active (fixed, visible, fading in) once
 *    the Timeline's first entry has scrolled into view (not just the
 *    section starting to appear — its title/filter chip coming into view
 *    isn't enough). Deactivates again near the top if scrolled back above
 *    that point.
 * 3. The dock — a two-state flip, not a gradual scroll-linked slide,
 *    triggered exactly at the page's true scroll limit (not merely close
 *    to it) so that by the time it fires there's nowhere left to scroll —
 *    the scrollbar is already at the bottom, not just visually near it
 *    with room left to keep scrolling underneath the (now-covering)
 *    overlay without anything changing. At that point:
 *      - `.contact-overlay` (see Contact.astro) fades into view — a
 *        `position: fixed`, full-viewport, opaque panel holding the
 *        "Contact" title and both contact cards, completely immune to
 *        further scrolling since it isn't in document flow at all. No
 *        scroll clamping needed to hold it in place, and nothing is left
 *        showing behind it to separately animate away — its own opaque
 *        background covers that.
 *      - The fixed panel animates from its resting size/position down onto
 *        the position of the (permanently invisible — see Contact.astro)
 *        header sitting inside the overlay, directly above that side's
 *        contact card — landing exactly on it and simply staying there,
 *        tags/hobbies clipped away in the same motion. There's
 *        deliberately no second header ever shown inside the overlay
 *        itself, and so nothing to reveal or time: the fixed panel's own
 *        header is the only one that ever exists on screen, continuously
 *        visible for its entire slide from resting spot to landing spot.
 *    Scrolling back up even slightly undoes this — the panel's own CSS
 *    transition (`top`/`max-height`, see the .astro file) handles the
 *    reverse slide the same way.
 *
 *    Reading the header's position to land on (see updateDock below) is
 *    deliberately not a direct getBoundingClientRect() reading taken at
 *    face value. .contact-overlay animates its own reveal by transitioning
 *    `top` (from fully off-screen below to its resting position, see
 *    Contact.astro) — and a getBoundingClientRect() taken on it, or on
 *    anything inside it, immediately after toggling the class that starts
 *    that transition, isn't guaranteed to reflect the transition's target
 *    value in every browser; some report the pre-transition value until an
 *    actual render has happened, however synchronous the read looks in
 *    the code. Earlier versions here tried "solving" that by forcing the
 *    overlay's animated property to its resting value right before
 *    measuring, which turned out to silently not work at all — the fixed
 *    panel's header kept landing roughly a full viewport-height too far
 *    down (genuinely off-screen) no matter how the reveal *timing* got
 *    adjusted, because the timing was never the actual bug.
 *
 *    The fix that's actually robust to this: never trust the overlay's
 *    own absolute measured position. The header's position *relative to*
 *    the overlay it's inside is unaffected — that internal offset comes
 *    entirely from ordinary, non-animated layout — so this reads that
 *    relative offset and adds it to the overlay's target resting position,
 *    which is computed directly from its own CSS custom properties
 *    (`--contact-reveal-feather`) and the viewport height rather than
 *    measured off the (potentially not-yet-settled) element at all.
 * 4. Scroll mirroring — the browser already routes wheel/trackpad
 *    scrolling to whichever scrollable element (.side-panel-scroll) the
 *    cursor is over natively; this just replays the same scrollTop on the
 *    other side's scroll area, so both panels always move together
 *    regardless of which one was actually scrolled. overscroll-behavior:
 *    contain (in CSS) stops either one from handing scroll off to the page
 *    once it hits its own top/bottom.
 *
 * All rect reads happen before any style write within a given update, so
 * there's no read/write layout thrashing; the scroll-driven update runs
 * directly on the scroll event with no requestAnimationFrame throttle,
 * since modern browsers already coalesce scroll dispatch to frame timing
 * and this work is cheap enough not to need it.
 */

const DESKTOP = window.matchMedia('(min-width: 901px)');

const leftZone = document.querySelector<HTMLElement>('.hover-zone--left');
const rightZone = document.querySelector<HTMLElement>('.hover-zone--right');

interface PanelPair {
	column: HTMLElement;
	panel: HTMLElement;
	header: HTMLElement | null;
	/** That side's own permanently-invisible header inside .contact-overlay
	 * — purely a layout/measurement anchor (see the file-level comment
	 * above); the fixed panel's own header lands on its position and stays,
	 * this one is never itself shown. */
	dockTarget: HTMLElement | null;
	/** The LinkedIn/email card directly below dockTarget — parked out of
	 * sight (see PersonContactCard.astro) until the dock triggers, so it
	 * doesn't just quietly appear alongside the rest of the overlay. */
	contactCard: HTMLElement | null;
}

function getPanelPair(columnSelector: string, contactPersonSelector: string): PanelPair | null {
	const column = document.querySelector<HTMLElement>(columnSelector);
	const panel = column?.querySelector<HTMLElement>('.side-panel') ?? null;
	if (!column || !panel) return null;
	const header = panel.querySelector<HTMLElement>('.person-header');
	const contactPerson = document.querySelector<HTMLElement>(contactPersonSelector);
	const dockTarget = contactPerson?.querySelector<HTMLElement>('.person-header') ?? null;
	const contactCard = contactPerson?.querySelector<HTMLElement>('.contact-card') ?? null;
	return { column, panel, header, dockTarget, contactCard };
}

// Mitko's contact group is the first child of the overlay's grid, Ádám's
// the last — see Contact.astro.
const left = getPanelPair('.scrolly-col--left', '#contact-overlay .contact-grid > :first-child');
const right = getPanelPair('.scrolly-col--right', '#contact-overlay .contact-grid > :last-child');
const pairs = [left, right].filter((p): p is PanelPair => p !== null);

const contactOverlay = document.getElementById('contact-overlay');

// The Timeline's very first entry (currently Black Hole Entertainment for
// Ádám / Ericsson Hungary for Mitko) — the panels' visibility trigger.
const firstTimelineEntry = document.querySelector<HTMLElement>('#timeline .timeline > :first-child');

// Small tolerance for the fractional-pixel rounding some browsers produce
// right at the scroll limit — not a gradual approach zone.
const AT_BOTTOM_TOLERANCE = 1.5;

/**
 * .contact-overlay's own resting `top` once revealed, computed directly
 * from its --contact-reveal-feather custom property rather than measured
 * off the element — see the file-level comment above for why measuring it
 * mid-transition can't be trusted. Matches Contact.astro's
 * `.contact-overlay.is-revealed { top: calc(-1 * var(--contact-reveal-feather)); }`
 * exactly; if that formula ever changes there, it needs to change here too.
 */
function getOverlayRestingTop(): number {
	if (!contactOverlay) return 0;
	const feather = parseFloat(getComputedStyle(contactOverlay).getPropertyValue('--contact-reveal-feather')) || 0;
	return -feather;
}

function updatePositions(): void {
	if (!DESKTOP.matches) return;
	// Read every rect before writing any style, so a write never forces a
	// synchronous layout recalculation the next read has to pay for.
	const rects = pairs.map(({ column }) => column.getBoundingClientRect());
	pairs.forEach(({ panel }, i) => {
		panel.style.left = `${rects[i].left}px`;
		panel.style.width = `${rects[i].width}px`;
	});

	// Hover zones reach from the true viewport edge to the reserved
	// column's own inner edge, rather than stopping at the column itself —
	// see the file-level comment above and .hover-zone in the .astro file.
	// Looked up by index into `pairs`/`rects` (not `left`/`right` directly)
	// so this stays correct even if one side is ever missing.
	const leftIndex = left ? pairs.indexOf(left) : -1;
	const rightIndex = right ? pairs.indexOf(right) : -1;
	const leftRect = leftIndex >= 0 ? rects[leftIndex] : undefined;
	const rightRect = rightIndex >= 0 ? rects[rightIndex] : undefined;
	if (leftZone && leftRect) leftZone.style.width = `${Math.max(0, leftRect.left + leftRect.width)}px`;
	if (rightZone && rightRect) rightZone.style.width = `${Math.max(0, window.innerWidth - rightRect.left)}px`;
}

// Whether the previous call left things docked — see the `force` param on
// updateDock below for why this matters.
let wasAtBottom = false;

/**
 * `force`: recompute and re-apply everything regardless of whether the
 * docked/not-docked state actually changed. Scroll events (the common
 * case, firing many times a second while scrolling) omit this, since
 * nothing here is scroll-position-dependent once docked — .contact-overlay
 * is `position: fixed`, so its own layout never moves once settled.
 * Recomputing anyway, every single scroll tick, while already stably
 * docked, was a real bug in an earlier version: unnecessary repeated style
 * writes read as the panels/cards jittering while scrolling rather than
 * staying put. Resize and the desktop/mobile breakpoint flip do pass
 * `force`, since geometry can genuinely change there even without a
 * docked/undocked transition.
 */
function updateDock(force = false): void {
	if (!DESKTOP.matches) return;

	const startRect = firstTimelineEntry?.getBoundingClientRect();
	const reachedStart = startRect ? startRect.top < window.innerHeight : true;

	// Basic visibility always reflects reachedStart immediately, every
	// call — cheap, idempotent, and not part of the "skip if nothing
	// changed" optimization below. That optimization is specifically about
	// the docking logic further down (panel top/max-height) being
	// expensive and jitter-prone to redo every scroll tick; gating this
	// too would mean scrolling back up without ever having reached the
	// dock (wasAtBottom already false) skips hiding the panel entirely,
	// since "false → false" looks like no change even though
	// reachedStart itself just flipped.
	pairs.forEach(({ panel }) => panel.classList.toggle('is-active', reachedStart));
	leftZone?.classList.toggle('is-enabled', reachedStart);
	rightZone?.classList.toggle('is-enabled', reachedStart);

	if (!reachedStart) {
		if (force || wasAtBottom) {
			pairs.forEach(({ panel, contactCard }) => {
				panel.classList.remove('is-docked');
				panel.style.top = '';
				panel.style.maxHeight = '';
				contactCard?.classList.remove('is-revealed');
			});
			contactOverlay?.classList.remove('is-revealed');
		}
		wasAtBottom = false;
		return;
	}

	const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
	const atBottom = window.scrollY >= maxScroll - AT_BOTTOM_TOLERANCE;

	if (!force && atBottom === wasAtBottom) return;
	wasAtBottom = atBottom;

	contactOverlay?.classList.toggle('is-revealed', atBottom);

	// Read first — dockTarget's position AND the overlay's own, so the
	// relative offset between them (immune to the overlay's own position
	// not being trustworthy mid-transition — see the file-level comment
	// above) can be computed below.
	const overlayRect = contactOverlay?.getBoundingClientRect();
	const dockRects = pairs.map(({ dockTarget }) => dockTarget?.getBoundingClientRect());
	const overlayRestingTop = getOverlayRestingTop();
	// ...then write.
	pairs.forEach(({ panel, header, contactCard }, i) => {
		const dockRect = dockRects[i];
		if (atBottom && dockRect && overlayRect) {
			// Land exactly on the (permanently invisible) header's position
			// waiting in the overlay, and just stay there — see the
			// file-level comment above for why nothing else needs revealing.
			const relativeOffset = dockRect.top - overlayRect.top;
			const headerHeight = header?.getBoundingClientRect().height ?? dockRect.height;
			panel.classList.add('is-docked');
			panel.style.top = `${overlayRestingTop + relativeOffset}px`;
			panel.style.maxHeight = `${headerHeight}px`;
			contactCard?.classList.add('is-revealed');
		} else {
			panel.classList.remove('is-docked');
			panel.style.top = '';
			panel.style.maxHeight = '';
			contactCard?.classList.remove('is-revealed');
		}
	});
}

if (pairs.length > 0) {
	updatePositions();
	updateDock(true);

	// Plain `updateDock` (not wrapped) would receive the scroll Event as
	// its `force` argument — truthy, so `force` would always evaluate to
	// true and defeat the whole point of that parameter. Force is only
	// ever meant to come from resize/breakpoint handlers below.
	window.addEventListener('scroll', () => updateDock(), { passive: true });

	let resizeQueued = false;
	window.addEventListener('resize', () => {
		if (resizeQueued) return;
		resizeQueued = true;
		requestAnimationFrame(() => {
			resizeQueued = false;
			updatePositions();
			updateDock(true);
		});
	});

	DESKTOP.addEventListener('change', () => {
		updatePositions();
		updateDock(true);
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

/**
 * Immersive hover reveal: resting state shows just the timeline, each side
 * reduced to its header plus a small peek line (see ScrollyRegion.astro's
 * .side-panel-peek/.side-panel-scroll crossfade). Hovering *either* side —
 * .hover-zone included, so the true screen edge counts too, not just the
 * reserved column itself — reveals *both* panels together via `.is-hovered`
 * on both, since the pair reads as one unit and popping in just whichever
 * side was actually hovered looked lopsided in practice.
 *
 * Driven by JS rather than a pure-CSS `:hover`/`:has()` combinator so that
 * hovering any of the four tracked elements (both zones, both panels) can
 * consistently drive the *same* two panels, and so a short grace delay can
 * be added on leaving — without it, the cursor crossing from a hover zone
 * onto the (higher z-index, same-position) panel sitting on top of it would
 * register as a leave-then-immediately-re-enter and could flicker.
 */
const hoverTargets = [leftZone, rightZone, left?.panel, right?.panel].filter((el): el is HTMLElement => el instanceof HTMLElement);

if (hoverTargets.length > 0) {
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	function isAnyHovered(): boolean {
		return hoverTargets.some((el) => el.matches(':hover'));
	}

	function setHovered(hovered: boolean): void {
		pairs.forEach(({ panel }) => panel.classList.toggle('is-hovered', hovered));
	}

	function scheduleHoverUpdate(): void {
		if (hideTimer !== null) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
		if (isAnyHovered()) {
			setHovered(true);
			return;
		}
		// Grace delay before actually collapsing, re-checked when it fires
		// (not just blindly hiding) in case a later mouseenter already
		// canceled and rescheduled this by then.
		hideTimer = setTimeout(() => {
			hideTimer = null;
			setHovered(isAnyHovered());
		}, 150);
	}

	hoverTargets.forEach((el) => {
		el.addEventListener('mouseenter', scheduleHoverUpdate);
		el.addEventListener('mouseleave', scheduleHoverUpdate);
	});
}

export {};
