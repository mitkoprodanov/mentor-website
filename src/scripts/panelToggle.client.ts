/**
 * Expand/collapse for the two person cards in the sticky top bar
 * (ScrollyRegion.astro).
 *
 * Touch: each card is collapsed to name + CV + a "Skills & filters" toggle;
 * tapping the toggle expands it (accordion — one open at a time).
 *
 * Pointer devices: hovering the bar reveals *both* people's details. The
 * reveal is a JS-managed `.reveal` class (not CSS `:hover`) so that selecting
 * a filter tag can dismiss it deterministically: on select the details hide
 * immediately — even with the pointer still over the bar — so the filtered
 * timeline shows through, and they stay hidden until the pointer actually
 * leaves and returns (a fresh hover), the way the user asked. To change the
 * filter you hover back in for the skills, click the active tag/pill, or clear
 * it (chip ✕, Escape, or an outside click — see filterModal.client.ts).
 */

const hoverMQ = window.matchMedia('(hover: hover) and (pointer: fine)');

function panels(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.side-panel'));
}

function setOpen(panel: HTMLElement, open: boolean): void {
	// Touch equivalent of the hover reveal: is-open expands .side-panel-stack
	// and grows the sticky bar. Snapshot pre-open scrollY the same way (see
	// showReveal for why) BEFORE the class flip, so tagFilter can capture the
	// reader's real Y when they click a skill tag inside the opened card.
	if (open) snapshotIfIdle();
	panel.classList.toggle('is-open', open);
	panel.querySelector<HTMLElement>('.panel-toggle')?.setAttribute('aria-expanded', String(open));
	if (!open && !preRevealActive()) clearSnapshot();
}

function closeAll(except?: HTMLElement): void {
	panels().forEach((panel) => {
		if (panel !== except) setOpen(panel, false);
	});
}

const bar = document.querySelector<HTMLElement>('.person-bar-inner');

// While true, hovering does not re-reveal the details — set the moment a tag
// is selected, cleared when the pointer next leaves both cards.
let suppressed = false;

// Pointer devices only: clicking a card's "Skills" button *locks* the paired
// reveal open, so moving the pointer off the cards no longer collapses them
// (see the pointerleave handler and the toggle click below). The two cards are
// one unit, so this locks/reveals both. Cleared by clicking Skills again, an
// outside click, selecting a filter tag, or Escape.
let locked = false;

function unlock(): void {
	locked = false;
	bar?.classList.remove('locked');
}

// "Lock Skills" checkbox beside each Skills button. When checked, an outside
// click does NOT dismiss the revealed skills panel — only pressing the Skills
// button again does. Unchecked leaves the original click-away-dismisses
// behaviour intact. Each card carries its own box in the markup, but the two
// Skills buttons behave as one paired unit, so the checkboxes mirror each
// other — flipping one flips the other, and the effective state is a single
// boolean the rest of the script reads via lockCheckActive().
const lockChecks = Array.from(document.querySelectorAll<HTMLInputElement>('.panel-lock-check'));
lockChecks.forEach((cb) => {
	cb.addEventListener('change', () => {
		lockChecks.forEach((other) => {
			if (other !== cb) other.checked = cb.checked;
		});
	});
});

function lockCheckActive(): boolean {
	return lockChecks.some((cb) => cb.checked);
}

/**
 * The hover reveal keys off the two cards themselves, NOT the full-width bar
 * container. The bar spans the whole width — including the open centre over
 * the timeline — so leaving a card for the centre never left the container and
 * the skills stayed stuck open. Tracking each card instead means moving off a
 * card into the centre collapses the skills, while moving between the two
 * cards keeps both revealed (they're one paired unit).
 */
function anyCardHovered(): boolean {
	return panels().some((card) => card.matches(':hover'));
}

// Pre-reveal scrollY snapshot — exposed to tagFilter so that when the reader
// clicks a skill tag WHILE hovering (or touch-opened) they end up back at the
// Y they saw *before* the hover, not at the browser's scroll-anchored Y that
// exists only because the sticky bar grew ~700px to fit the skills panel.
// See the note in showReveal() for the full mechanism.
let preRevealScrollY: number | null = null;
function preRevealActive(): boolean {
	return Boolean(bar?.classList.contains('reveal')) || panels().some((p) => p.classList.contains('is-open'));
}
function snapshotIfIdle(): void {
	if (!preRevealActive()) preRevealScrollY = window.scrollY;
}
function clearSnapshot(): void {
	preRevealScrollY = null;
}
// Expose to tagFilter (bundled together by Astro but no shared module here).
(window as unknown as { __preRevealScrollY?: () => number | null }).__preRevealScrollY = () =>
	preRevealActive() ? preRevealScrollY : null;

function showReveal(): void {
	if (!bar) return;
	// SNAPSHOT ORDER MATTERS: read scrollY BEFORE adding .reveal. Once the
	// class is on, .side-panel-stack switches from display:none to display:
	// block, the sticky person-bar grows by ~700px, and the browser's scroll
	// anchoring silently pushes window.scrollY down by that same amount to
	// keep the visible anchor stable. The pre-reveal value is the reader's
	// real position; the post-reveal value is a phantom that only exists
	// while the panel is up.
	snapshotIfIdle();
	bar.classList.add('reveal');
}

function hideReveal(): void {
	if (!bar) return;
	bar.classList.remove('reveal');
	// After the class comes off and the bar collapses back, scroll anchoring
	// snaps scrollY back on its own — no need to restore it here.
	if (!preRevealActive()) clearSnapshot();
}

if (bar) {
	panels().forEach((card) => {
		card.addEventListener('pointerenter', () => {
			if (!hoverMQ.matches || suppressed) return;
			showReveal();
		});
		card.addEventListener('pointerleave', () => {
			// Locked open via the Skills button: stay revealed no matter where the
			// pointer goes — only an outside click (or Escape / a filter tag)
			// collapses it now. The Lock checkbox does NOT influence this on its
			// own: without a Skills-button click there is nothing to hold open, so
			// unhovering closes as normal.
			if (locked) return;
			// By the time pointerleave fires the pointer has already moved on, so
			// :hover reflects where it went: collapse only if it isn't over the
			// other card either (moving into the centre over the timeline hides;
			// moving between the two cards keeps both open).
			if (!anyCardHovered()) {
				hideReveal();
				suppressed = false;
			}
		});
	});
}

/**
 * A revealed card behaves like a modal: while the pointer is over it, the wheel
 * scrolls the card's own skills (if they overflow) and never the page behind —
 * the same "background doesn't move" feel as the project detail modal. Keyed
 * off the reveal/open state, so a collapsed card scrolls the page as normal.
 */
function modalActive(): boolean {
	return Boolean(bar?.classList.contains('reveal')) || panels().some((p) => p.classList.contains('is-open'));
}

if (bar) {
	panels().forEach((card) => {
		card.addEventListener(
			'wheel',
			(event) => {
				if (!modalActive()) return;
				const stack = card.querySelector<HTMLElement>('.side-panel-stack');
				if (stack && stack.scrollHeight > stack.clientHeight) {
					stack.scrollTop += event.deltaY;
				}
				// Block the page from scrolling underneath the open card.
				event.preventDefault();
			},
			{ passive: false },
		);
	});
}

function dismissDetails(): void {
	unlock();
	bar?.classList.remove('reveal');
	// Blur the just-clicked tag so `:focus-within` doesn't keep the panel open.
	const active = document.activeElement as HTMLElement | null;
	if (active && bar?.contains(active)) active.blur();
	// Block hover re-reveal until the pointer leaves and comes back.
	suppressed = true;
}

document.addEventListener('click', (event) => {
	const target = event.target as HTMLElement;

	const toggle = target.closest<HTMLElement>('.panel-toggle');
	if (toggle) {
		if (hoverMQ.matches) {
			// Pointer device: the reveal is already up (the pointer is over the
			// card), so the button's job is just to *lock* it — both cards stay
			// open when the pointer leaves. Click again to unlock; if the pointer
			// has since moved off the cards, unlocking collapses them right away,
			// otherwise normal hover takes over and they collapse on pointer-out.
			locked = !locked;
			if (locked) {
				suppressed = false;
				bar?.classList.add('reveal', 'locked');
			} else {
				bar?.classList.remove('locked');
				if (!anyCardHovered()) bar?.classList.remove('reveal');
			}
			return;
		}
		// Touch: no hover reveal, so the button is an accordion — expand one card
		// at a time.
		const panel = toggle.closest<HTMLElement>('.side-panel');
		if (!panel) return;
		const willOpen = !panel.classList.contains('is-open');
		closeAll(panel); // accordion — only one card open at once
		setOpen(panel, willOpen);
		return;
	}

	// A filter tag (in the skills) or the under-card pill was clicked: the
	// details drop away so the filtered timeline is visible.
	if (target.closest('button.tag--linked') || target.closest('.card-filter-tag')) {
		closeAll();
		dismissDetails();
		return;
	}

	// A click anywhere outside both cards collapses them. The two cards are one
	// unit, so this collapses *both* — clearing a locked-open desktop reveal and
	// any touch-opened accordion card alike. Skipped only when the panel is
	// currently locked open via the Skills button AND the Lock checkbox is on:
	// the checkbox rewires the Skills-button lock so only pressing Skills again
	// can release it. A merely-hovered (not-yet-locked) panel is untouched by
	// the checkbox and still dismisses on outside click.
	if (!target.closest('.side-panel')) {
		if (locked && lockCheckActive()) return;
		unlock();
		closeAll();
		bar?.classList.remove('reveal');
		suppressed = false;
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') {
		if (locked && lockCheckActive()) return;
		unlock();
		closeAll();
		bar?.classList.remove('reveal');
		suppressed = false;
	}
});

export {};
