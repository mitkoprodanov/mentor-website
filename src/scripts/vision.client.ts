/**
 * Vision interactivity (see components/common/Vision.astro).
 *
 * On hover devices: mouseenter/mouseleave drive visibility; click just ensures
 * the tooltip is shown without flashing (never toggles closed).
 *
 * On touch/no-hover: tap to show; tap the active part again to hide; tap any
 * other part to switch immediately with no clearing phase.
 *
 * The tricky bit: on touch, browsers fire `focus` before `click` when a button
 * is tapped for the first time. Without a guard, focus opens the detail and
 * click immediately sees it as active and closes it — a two-tap-to-show bug.
 * The `skipNextClick` flag per part absorbs that spurious click.
 *
 * State is scoped per `.vision` root so multiple instances on the same page
 * work independently.
 *
 * Telemetry (docs/telemetry.md section 17.4): each show/hide is announced via
 * `ui:vision-tooltip-show`/`-hide` (see uiEvents.ts) — this file stays
 * dependency-free of the telemetry client itself, same as every other UI
 * script; `visibility.client.ts` is what actually listens and drives the
 * Visibility Matrix engine. Announcing is guarded to fire only on a genuine
 * closed→open / open→closed transition, never on a redundant re-entry of an
 * already-active part, so telemetry never sees a spurious flicker.
 */

import { announce, UI_EVENT } from '../lib/telemetry/uiEvents.ts';

document.querySelectorAll<HTMLElement>('.vision').forEach((root) => {
	const parts = Array.from(root.querySelectorAll<HTMLElement>('[data-thought-part]'));
	if (!parts.length) return;

	const isHoverDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

	const detailFor = (part: HTMLElement): HTMLElement | null => {
		const id = part.getAttribute('aria-controls');
		return id ? document.getElementById(id) : null;
	};

	const closeAll = (except?: HTMLElement): void => {
		for (const part of parts) {
			if (part === except) continue;
			const wasActive = part.classList.contains('is-active');
			part.classList.remove('is-active');
			part.setAttribute('aria-expanded', 'false');
			detailFor(part)?.setAttribute('hidden', '');
			// Only a genuine open→closed transition is announced — closeAll()
			// runs unconditionally on every outside click/Escape/mouseleave
			// regardless of whether anything was actually open.
			if (wasActive) announce(UI_EVENT.visionTooltipHide, { tooltipId: part.dataset.thoughtId });
		}
	};

	/** `method` is whatever the caller's own DOM event actually tells us
	 *  (hover/focus/click/touch) — see clickMethod() below for click. */
	const openDetail = (part: HTMLElement, method: string): void => {
		const alreadyActive = part.classList.contains('is-active');
		const detail = detailFor(part);
		closeAll(part);
		part.classList.add('is-active');
		part.setAttribute('aria-expanded', 'true');
		if (detail) {
			detail.removeAttribute('hidden');
			// Re-trigger the entrance animation each time.
			detail.style.animation = 'none';
			void detail.offsetWidth;
			detail.style.animation = '';
		}
		// Only a genuine closed→open transition is announced — a redundant
		// re-entry of an already-active part (e.g. mouseenter firing again)
		// still runs the DOM/animation logic above unchanged, but isn't a new
		// tooltip encounter for telemetry.
		if (!alreadyActive) announce(UI_EVENT.visionTooltipShow, { tooltipId: part.dataset.thoughtId, method });
	};

	/** Click's PointerEvent exposes pointerType only when the browser actually
	 *  knows it (mouse/touch/pen); 'touch' is only ever reported when true —
	 *  everything else reads as the honest, generic 'click'. */
	const clickMethod = (event: MouseEvent): string =>
		(event as PointerEvent).pointerType === 'touch' ? 'touch' : 'click';

	for (const part of parts) {
		// Per-part flag: when focus fires just before a click (the browser's touch
		// tap sequence), the click should not toggle the tooltip that focus just opened.
		let skipNextClick = false;

		part.addEventListener('focus', () => {
			if (!part.classList.contains('is-active')) {
				// Genuinely ambiguous: a touch tap fires `focus` before `click` with
				// no pointer info, indistinguishable here from real keyboard Tab
				// focus — 'focus' is the honest label for either (never 'touch').
				openDetail(part, 'focus');
			}
			// Set flag regardless — covers the case where focus fires on a click
			// that would otherwise flash (hover device clicking an active part).
			skipNextClick = true;
			setTimeout(() => { skipNextClick = false; }, 0);
		});

		if (isHoverDevice) {
			part.addEventListener('mouseenter', () => openDetail(part, 'hover'));
		}

		part.addEventListener('click', (e) => {
			e.stopPropagation();

			if (skipNextClick) {
				skipNextClick = false;
				return;
			}

			if (isHoverDevice) {
				// Hover device: click just ensures shown, never toggles or flashes.
				if (!part.classList.contains('is-active')) openDetail(part, clickMethod(e));
			} else {
				// Touch: tap shows; tap the active part hides; tap any other part
				// shows it immediately (openDetail's closeAll handles the switch).
				if (part.classList.contains('is-active')) closeAll();
				else openDetail(part, clickMethod(e));
			}
		});
	}

	if (isHoverDevice) {
		root.addEventListener('mouseleave', () => closeAll());
	}

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeAll();
	});
	document.addEventListener('click', (e) => {
		if (!root.contains(e.target as Node)) closeAll();
	});
});

export {};
