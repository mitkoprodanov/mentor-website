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
 *
 * Reveal semantics for telemetry (see docs/telemetry.md section 4.3/11):
 * Skills visibility is `hovered || focused || locked`. Keyboard focus landing
 * anywhere in the bar reveals it via CSS `:focus-within` (see ScrollyRegion.astro)
 * independently of the `.reveal`/`.is-open` classes below — so `focusReason` is
 * tracked here too, and `showReveal`/`hideReveal` are only actually invoked (and
 * `skills-open`/`skills-close` only actually announced) once ALL of hover,
 * focus and lock agree the panel should be open or closed. That keeps the
 * visible UI and the announced semantic state from disagreeing, without ever
 * removing the `:focus-within` CSS itself.
 */

import { announce, UI_EVENT } from '../lib/telemetry/uiEvents.ts';

const hoverMQ = window.matchMedia('(hover: hover) and (pointer: fine)');

function panels(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.side-panel'));
}

/** Which person a control belongs to, for telemetry (`.side-panel[data-person]`). */
function personOf(el: Element | null | undefined): string | undefined {
	return el?.closest<HTMLElement>('.side-panel')?.dataset.person;
}

/** How the visitor acted, as far as the click event can tell. */
function clickMethod(event: MouseEvent): string {
	const pt = (event as PointerEvent).pointerType;
	if (pt === 'mouse' || pt === 'touch' || pt === 'pen') return pt;
	return event.detail === 0 ? 'keyboard' : 'mouse';
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
	syncBodyScrollLock();
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

// Keyboard focus anywhere in the bar (see the focusin/focusout listeners
// below) is a reveal reason of its own, tracked independently of hover so a
// pointer leaving doesn't collapse a card that is still keyboard-focused, and
// vice versa. Only `hoverMQ`-matching (hover+fine-pointer) devices track it —
// touch has no keyboard-focus reveal path (see ScrollyRegion.astro's own
// `(hover: hover) and (pointer: fine)` gate on the `:focus-within` CSS).
let focusReason = false;

// A force-close path (outside click, Escape) is about to blur whatever is
// focused inside the bar itself, purely to defeat `:focus-within` — that is
// not a genuine "focus left the bar" transition, it is a side effect of a
// close this same code path is already announcing with its own real reason.
// Without this guard the resulting `focusout` would race that announce and
// steal the close reason (see the focusout handler below).
let suppressFocusClose = false;

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
	syncBodyScrollLock();
}

function blurInsideBar(): void {
	// The CSS keeps .side-panel-stack visible while any element inside the bar
	// has focus (`.person-bar-inner:focus-within .side-panel-stack`). That is
	// how keyboard users tab into the skills — but it also means a click on
	// any card button (Skills, Lock, a tag, CV, LinkedIn) leaves focus behind
	// and holds the panel open after the pointer has left. Drop the focus
	// whenever we intend to close so unhovering (or an outside close) actually
	// collapses the panel, "as if nothing were pressed."
	const active = document.activeElement as HTMLElement | null;
	if (active && bar?.contains(active)) active.blur();
}

function hideReveal(): void {
	if (!bar) return;
	bar.classList.remove('reveal');
	blurInsideBar();
	// After the class comes off and the bar collapses back, scroll anchoring
	// snaps scrollY back on its own — no need to restore it here.
	if (!preRevealActive()) clearSnapshot();
	syncBodyScrollLock();
}

if (bar) {
	panels().forEach((card) => {
		card.addEventListener('pointerenter', () => {
			if (!hoverMQ.matches || suppressed) return;
			const wasRevealed = bar.classList.contains('reveal');
			showReveal();
			if (!wasRevealed) {
				announce(UI_EVENT.skillsOpen, { person: card.dataset.person, method: 'hover', locked: false });
			}
		});
		card.addEventListener('pointerleave', () => {
			// Locked open via the Skills button, or auto-locked by picking a
			// filter tag: stay revealed no matter where the pointer goes — only
			// an outside click (or the Skills button again) collapses it now.
			if (locked) return;
			// By the time pointerleave fires the pointer has already moved on, so
			// :hover reflects where it went: collapse only if it isn't over the
			// other card either (moving into the centre over the timeline hides;
			// moving between the two cards keeps both open).
			if (anyCardHovered()) return;
			// Keyboard focus is still in the bar: stays revealed (matches
			// :focus-within) — only the hover reveal reason went away.
			if (focusReason) return;
			hideReveal();
			suppressed = false;
			announce(UI_EVENT.skillsClose, { reason: 'hover_leave' });
		});
	});
}

/**
 * Keyboard focus reveal, mirroring hover: CSS already expands the skills
 * stack via `:focus-within` on `.person-bar-inner` (see ScrollyRegion.astro)
 * whenever anything in the bar has focus — Tab reaches the always-visible
 * Skills toggle/CV controls first, then (now visually revealed) the skill
 * tags themselves. `focusout`'s `relatedTarget` is the element about to
 * receive focus, so Tab between two elements that are both still inside the
 * bar is recognised as "focus stayed in the bar", not a leave/re-enter.
 */
if (bar) {
	bar.addEventListener('focusin', () => {
		if (!hoverMQ.matches) return;
		focusReason = true;
		const wasRevealed = bar.classList.contains('reveal');
		showReveal();
		if (!wasRevealed) {
			announce(UI_EVENT.skillsOpen, { person: personOf(document.activeElement), method: 'focus', locked: false });
		}
	});
	bar.addEventListener('focusout', (event) => {
		if (!hoverMQ.matches) return;
		const related = (event as FocusEvent).relatedTarget as Node | null;
		if (related && bar.contains(related)) return; // focus moved to another element still inside the bar
		focusReason = false;
		if (suppressFocusClose) return; // a force-close path is already announcing its own close reason
		if (locked || anyCardHovered()) return; // another reason still holds it open
		hideReveal();
		suppressed = false;
		announce(UI_EVENT.skillsClose, { reason: 'focus_leave' });
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

/**
 * While the skills panel is up, freeze the page behind it — the wheel handler
 * below already blocks scroll while the pointer is over a card, but the reader
 * can move the pointer onto the timeline (or use keyboard/touch) and scroll the
 * page underneath. Lock the body scroll for the whole time the panel is open so
 * the timeline stays put no matter where the input lands.
 */
function syncBodyScrollLock(): void {
	const active = modalActive();
	const html = document.documentElement;
	if (active) {
		if (html.dataset.scrollLocked === '1') return;
		// `html { scrollbar-gutter: stable }` (Layout.astro) keeps the scrollbar
		// lane reserved under overflow:hidden, so no padding compensation needed.
		html.style.overflow = 'hidden';
		html.dataset.scrollLocked = '1';
	} else {
		if (html.dataset.scrollLocked !== '1') return;
		html.style.overflow = '';
		delete html.dataset.scrollLocked;
	}
}

if (bar) {
	panels().forEach((card) => {
		card.addEventListener(
			'wheel',
			(event) => {
				if (!modalActive()) return;
				// On mobile the panel is inline — let the page scroll normally.
				if (window.matchMedia('(max-width: 900px)').matches) return;
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
	syncBodyScrollLock();
}

// When filterModal clears its own overflow:hidden on filter close, re-check
// whether the scroll lock should still be active (panel may still be open).
document.addEventListener('filter:unlocked', syncBodyScrollLock);

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
			const who = personOf(toggle);
			if (locked) {
				suppressed = false;
				bar?.classList.add('reveal', 'locked');
				syncBodyScrollLock();
				// Already hovered open -> the coordinator treats this as a lock,
				// not a second open.
				announce(UI_EVENT.skillsOpen, { person: who, method: clickMethod(event), locked: true });
			} else {
				bar?.classList.remove('locked');
				announce(UI_EVENT.skillsUnlock, { person: who });
				// Unlocking removes the lock reveal reason, but hover or keyboard focus
				// may still be holding the panel open (e.g. the pointer is still over
				// the card, or focus never left it) — in that case it only stops being
				// locked, it does not collapse. The coordinator makes the same call
				// from the same skills-unlock, so the announced semantic state and
				// this visible behavior agree.
				if (anyCardHovered() || focusReason) {
					syncBodyScrollLock();
				} else {
					// Neither reason remains: an explicit close intent — force-collapse
					// and suppress hover re-open until the pointer leaves and comes back.
					bar?.classList.remove('reveal');
					blurInsideBar();
					suppressed = true;
					closeAll();
					syncBodyScrollLock();
				}
			}
			return;
		}
		// Touch: open/close all cards in sync — tapping one person's Skills
		// button opens both, tapping again closes both.
		const panel = toggle.closest<HTMLElement>('.side-panel');
		if (!panel) return;
		const willOpen = !panel.classList.contains('is-open');
		panels().forEach(p => setOpen(p, willOpen));
		// Touch has no hover: the accordion stays until toggled, so it opens locked.
		if (willOpen) {
			const method = clickMethod(event);
			announce(UI_EVENT.skillsOpen, { person: personOf(toggle), method: method === 'mouse' ? 'touch' : method, locked: true });
		} else {
			announce(UI_EVENT.skillsClose, { reason: 'explicit', person: personOf(toggle) });
		}
		return;
	}

	// A filter tag (in the skills) or the under-card pill was clicked: keep the
	// skills panel up so the reader can pick another tag without collapsing
	// them (auto-lock so pointerleave won't collapse it either). Closing the
	// filtered view then leaves the skills untouched (filterModal only clears
	// the filter — it does not touch .reveal / .is-open).
	if (target.closest('button.tag--linked') || target.closest('.card-filter-tag')) {
		if (hoverMQ.matches) {
			locked = true;
			suppressed = false;
			bar?.classList.add('reveal', 'locked');
			syncBodyScrollLock();
			announce(UI_EVENT.skillsLock, {
				cause: target.closest('.card-filter-tag') ? 'filter_pill' : 'skill_click',
				person: personOf(target),
			});
		}
		return;
	}

	// A click anywhere outside both cards collapses them. The two cards are one
	// unit, so this collapses *both* — clearing a locked-open desktop reveal and
	// any touch-opened accordion card alike.
	//
	// Filter-dismissing UI (the modal backdrop, the timeline filter chip) is
	// treated as "clear the filter only, leave the panel alone" — so the
	// reader's first click-away drops the filter and leaves the skills up
	// (tagFilter/filterModal handle the filter clear), and the *next*
	// click-away (which no longer lands on those controls) closes the skills.
	// The `.card-filter-tag` under each card is handled by the earlier
	// filter-tag branch above.
	if (target.closest('.filter-backdrop') || target.closest('#timeline-filter-chip-clear')) {
		return;
	}
	if (!target.closest('.side-panel')) {
		unlock();
		closeAll();
		bar?.classList.remove('reveal');
		suppressFocusClose = true;
		blurInsideBar();
		suppressFocusClose = false;
		focusReason = false;
		suppressed = false;
		syncBodyScrollLock();
		announce(UI_EVENT.skillsClose, { reason: target.closest('.navbar') ? 'navigation' : 'outside' });
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') {
		if (locked) return;
		unlock();
		closeAll();
		bar?.classList.remove('reveal');
		suppressFocusClose = true;
		blurInsideBar();
		suppressFocusClose = false;
		focusReason = false;
		suppressed = false;
		syncBodyScrollLock();
		announce(UI_EVENT.skillsClose, { reason: 'escape' });
	}
});

export {};
