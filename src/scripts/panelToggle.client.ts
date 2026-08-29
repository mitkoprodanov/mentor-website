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
	panel.classList.toggle('is-open', open);
	panel.querySelector<HTMLElement>('.panel-toggle')?.setAttribute('aria-expanded', String(open));
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

if (bar) {
	panels().forEach((card) => {
		card.addEventListener('pointerenter', () => {
			if (!hoverMQ.matches || suppressed) return;
			bar.classList.add('reveal');
		});
		card.addEventListener('pointerleave', () => {
			// Locked open via the Skills button: stay revealed no matter where the
			// pointer goes — only an outside click (or Escape / a filter tag)
			// collapses it now.
			if (locked) return;
			// By the time pointerleave fires the pointer has already moved on, so
			// :hover reflects where it went: collapse only if it isn't over the
			// other card either (moving into the centre over the timeline hides;
			// moving between the two cards keeps both open).
			if (!anyCardHovered()) {
				bar.classList.remove('reveal');
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
	// any touch-opened accordion card alike.
	if (!target.closest('.side-panel')) {
		unlock();
		closeAll();
		bar?.classList.remove('reveal');
		suppressed = false;
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') {
		unlock();
		closeAll();
		bar?.classList.remove('reveal');
		suppressed = false;
	}
});

export {};
