// DOM wiring for PrivacyConsent.astro (docs/privacy.md): a fixed lock button + a thin floating bar
// with three choices over TWO independent permissions. Pure view logic: analytics decisions live in
// lib/telemetry/lifecycle.ts (via `telemetryControl`), External media in lib/externalMedia.ts, the
// derive/select/open-pin-close rules in lib/privacyControl.ts. This file only reflects their status and
// forwards the visitor's input. There is no state of its own beyond open/pin (PrivacyBarState).
//
// Hosting: ONE root element. Normally a child of <body>. A native modal <dialog> (Project Details) makes
// everything outside it inert, so while one is open the SAME root is moved into it and moved back after.
// State is untouched by the move (it lives in JS), the dialog is never recreated or reset, and focus is
// restored. Skill Filtered View is not a <dialog>; the body-level root simply sits above it.

import { telemetryControl } from '../lib/telemetry';
import { EXTERNAL_MEDIA_REQUEST_EVENT, externalMedia } from '../lib/externalMedia.ts';
import { PrivacyBarState, isNone, isUnanswered, planConsentWrites, selectChoice } from '../lib/privacyControl.ts';
import type { ChoiceId, Permissions } from '../lib/privacyControl.ts';

const HOVER_LEAVE_MS = 180; // lets the pointer cross the gap between the lock and the bar

function init(): void {
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const root = $('#mgs-options-root');
	const toggle = $<HTMLButtonElement>('#mgs-options-toggle');
	const bar = $('#mgs-options-tray');
	const note = $('#mgs-options-note');
	const details = $('#mgs-options-details');
	const detailsBtn = $<HTMLButtonElement>('[data-privacy-action="details"]');
	const closeBtn = $<HTMLButtonElement>('[data-privacy-action="close"]');
	if (!root || !toggle || !bar || !note || !details || !detailsBtn || !closeBtn) return;
	const choiceBtn = (id: ChoiceId): HTMLButtonElement | null => bar.querySelector<HTMLButtonElement>(`[data-privacy-choice="${id}"]`);
	const ids: ChoiceId[] = ['none', 'media', 'analytics'];

	const state = new PrivacyBarState();
	let moving = false; // true while the root is being re-hosted (the move blurs focus; ignore that)
	let swallowBackdropClick = false; // see the capture click handler
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;

	const analyticsChoosable = (): boolean => telemetryControl.status().mode === 'consent';

	/** The two permissions, read straight from their owners. "No optional services" is derived. */
	const permissions = (): Permissions => ({
		media: externalMedia.status().allowed,
		analytics: telemetryControl.status().running,
	});

	// ---- hosting -----------------------------------------------------------------------------
	const activeModal = (): HTMLDialogElement | null => {
		for (const d of document.querySelectorAll<HTMLDialogElement>('dialog')) {
			try {
				if (d.open && d.matches(':modal')) return d;
			} catch {
				if (d.open) return d;
			}
		}
		return null;
	};

	const syncHost = (): void => {
		const host: HTMLElement = activeModal() ?? document.body;
		if (root.parentElement === host) return;
		const active = document.activeElement;
		const refocus = active instanceof HTMLElement && root.contains(active) ? active : null;
		moving = true;
		host.appendChild(root);
		refocus?.focus({ preventScroll: true });
		moving = false;
	};

	// ---- rendering ---------------------------------------------------------------------------
	const render = (): void => {
		syncHost();
		const a = telemetryControl.status();
		const m = externalMedia.status();
		const locked = !analyticsChoosable();
		const perms = permissions();
		state.setUnanswered(isUnanswered(m.consent, a.consent, !locked));

		toggle.hidden = false;
		bar.dataset.open = String(state.visible);
		// Minimize exists only while pinned. While closing it is left as-is so the bar keeps its
		// width for the close transition; every open re-evaluates it here.
		if (state.visible) closeBtn.hidden = !state.isPinned;
		toggle.setAttribute('aria-expanded', String(state.visible));
		toggle.dataset.pinned = String(state.isPinned);

		const pressed: Record<ChoiceId, boolean> = { none: isNone(perms), media: perms.media, analytics: perms.analytics };
		for (const id of ids) choiceBtn(id)?.setAttribute('aria-pressed', String(pressed[id]));
		const analyticsBtn = choiceBtn('analytics');
		if (analyticsBtn) analyticsBtn.disabled = locked;

		details.hidden = !state.details;
		detailsBtn.setAttribute('aria-expanded', String(state.details));

		const notes: string[] = [];
		if (a.mode === 'forced') notes.push('Analytics is on in this local development build.');
		else if (a.mode === 'off') notes.push('Analytics is not active on this version of the site.');
		if (!m.remembered || (!locked && !a.remembered)) notes.push('Your browser blocked remembering this choice; it applies until you leave the page.');
		note.textContent = notes.join(' ');
		note.hidden = notes.length === 0;
	};

	// ---- choices -----------------------------------------------------------------------------
	const choose = (id: ChoiceId): void => {
		const locked = !analyticsChoosable();
		const current = permissions();
		const next = selectChoice(current, id, locked);
		const writes = planConsentWrites(
			current,
			next,
			{ media: externalMedia.status().consent, analytics: telemetryControl.status().consent },
			!locked,
		);
		// Media first (cheap, local), then analytics; each owner persists, starts/stops and notifies.
		if (writes.media === 'allow') externalMedia.allow();
		else if (writes.media === 'refuse') externalMedia.refuse();
		if (writes.analytics === 'allow') telemetryControl.allow();
		else if (writes.analytics === 'refuse') telemetryControl.refuse();
		state.pin(); // choosing is deliberate engagement: stays open so the other permission can change too
		render();
	};

	// ---- open / close ------------------------------------------------------------------------
	const closeFocusFix = (): void => {
		const active = document.activeElement;
		if (active instanceof HTMLElement && bar.contains(active)) toggle.focus({ preventScroll: true });
	};

	const enter = (e: PointerEvent): void => {
		if (e.pointerType === 'touch') return; // touch has no hover: a tap pins directly
		clearTimeout(hoverTimer);
		state.pointerEnter();
		render();
	};
	const leave = (e: PointerEvent): void => {
		if (e.pointerType === 'touch') return;
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			state.pointerLeave();
			render();
		}, HOVER_LEAVE_MS);
	};
	for (const el of [toggle, bar]) {
		el.addEventListener('pointerenter', enter as EventListener);
		el.addEventListener('pointerleave', leave as EventListener);
	}

	root.addEventListener('focusin', (e) => {
		if ((e.target as Element).matches(':focus-visible')) {
			state.focusIn();
			render();
		}
	});
	root.addEventListener('focusout', (e) => {
		if (moving) return;
		const to = (e as FocusEvent).relatedTarget;
		if (to instanceof Node && root.contains(to)) return;
		state.focusOut();
		render();
	});

	toggle.addEventListener('click', () => {
		clearTimeout(hoverTimer);
		const wasPinned = state.isPinned;
		state.toggleClick();
		render();
		if (wasPinned) closeFocusFix();
	});

	// Outside pointer/tap: capture phase so nothing (dialog handlers, stopPropagation) can hide it.
	// pointerdown precedes the click that opens the UI, so an opening click is never "outside".
	document.addEventListener(
		'pointerdown',
		(e) => {
			if (e.composedPath().includes(root)) return;
			if (state.outsidePress()) {
				render();
				// The same gesture must not also close a project dialog whose backdrop it lands on.
				swallowBackdropClick = true;
			}
		},
		true,
	);
	document.addEventListener(
		'click',
		(e) => {
			if (!swallowBackdropClick) return;
			swallowBackdropClick = false;
			if ((e.target as Element | null)?.tagName === 'DIALOG') {
				e.stopPropagation();
				e.preventDefault();
			}
		},
		true,
	);

	// Clicks inside the bar never dismiss it (outside detection above ignores them).
	bar.addEventListener('click', (e) => {
		const el = (e.target as Element | null)?.closest<HTMLElement>('[data-privacy-choice], [data-privacy-action]');
		if (!el) return;
		const choice = el.dataset.privacyChoice as ChoiceId | undefined;
		if (choice) {
			choose(choice);
			return;
		}
		if (el.dataset.privacyAction === 'details') {
			state.toggleDetails();
			render();
		} else if (el.dataset.privacyAction === 'close') {
			state.close();
			render();
			closeFocusFix();
			toggle.focus({ preventScroll: true });
		}
	});

	// A gated third-party embed was activated without permission: open the bar pinned on External media
	// (never loading just that one item).
	document.addEventListener(EXTERNAL_MEDIA_REQUEST_EVENT, () => {
		state.pin();
		render();
		choiceBtn('media')?.focus({ preventScroll: true });
	});

	const onEscape = (e: Event): void => {
		if (!state.escape()) return;
		e.preventDefault(); // close Privacy only, never a project dialog beneath it
		e.stopPropagation();
		render();
		toggle.focus({ preventScroll: true });
	};
	document.addEventListener('keydown', (e) => e.key === 'Escape' && onEscape(e), true);
	// Fallback for browsers that deliver the dialog `cancel` without our keydown.
	document.addEventListener('cancel', onEscape, true);

	// Re-host whenever a dialog opens/closes, however it was dismissed.
	new MutationObserver(syncHost).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
	document.addEventListener('close', (e) => (e.target as Element | null)?.tagName === 'DIALOG' && syncHost(), true);

	telemetryControl.subscribe(render);
	externalMedia.subscribe(render);
	render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export {};
