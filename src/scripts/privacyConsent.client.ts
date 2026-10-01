// DOM wiring for PrivacyConsent.astro: two INDEPENDENT choices, Anonymous analytics and
// External media. Pure view logic: analytics decisions live in lib/telemetry/lifecycle.ts
// (via `telemetryControl`), External media decisions in lib/externalMedia.ts; this only reflects
// their status and forwards the visitor's clicks. One choice never touches the other.
//
// Flow: persistent "Privacy" control -> small bar -> optional "Details".
//   * First visit, `consent` mode, analytics unanswered: the bar opens by itself (analytics row only).
//     Dismissing it decides nothing; the persistent control reopens it.
//   * A gated third-party embed activated without permission opens the bar on External media.
//
// Closing: outside pointer/tap, the x button and Escape ALL do the same thing — close the whole
// Privacy UI (bar and Details), never falling back from Details to the bar, never changing a choice.

import { telemetryControl } from '../lib/telemetry';
import type { TelemetryStatus } from '../lib/telemetry';
import { EXTERNAL_MEDIA_REQUEST_EVENT, externalMedia } from '../lib/externalMedia.ts';
import type { ExternalMediaStatus } from '../lib/externalMedia.ts';

type Scope = 'analytics' | 'external' | 'both';

function init(): void {
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const bar = $('#privacy-prompt');
	const toggle = $<HTMLButtonElement>('#privacy-toggle');
	const panel = $('#privacy-panel');
	const rowA = $('#privacy-row-analytics');
	const rowM = $('#privacy-row-media');
	const aState = $('#privacy-analytics-state');
	const mState = $('#privacy-media-state');
	const aNo = $<HTMLButtonElement>('#privacy-a-no');
	const aYes = $<HTMLButtonElement>('#privacy-a-yes');
	const mNo = $<HTMLButtonElement>('#privacy-m-no');
	const mYes = $<HTMLButtonElement>('#privacy-m-yes');
	const aStatus = $('#privacy-analytics-status');
	const mStatus = $('#privacy-media-status');
	const aSwitch = $<HTMLButtonElement>('#privacy-a-switch');
	const mSwitch = $<HTMLButtonElement>('#privacy-m-switch');
	if (!bar || !toggle || !panel || !rowA || !rowM || !aState || !mState || !aNo || !aYes || !mNo || !mYes) return;
	if (!aStatus || !mStatus || !aSwitch || !mSwitch) return;

	let barOpen = false; // the compact bar is up
	let scope: Scope = 'both';
	let panelOpen = false; // Details is up (the bar is hidden meanwhile)
	let returnFocusTo: HTMLElement | null = null; // the element that opened the UI (gate button), else the control
	let swallowBackdropClick = false; // see the capture click handler

	const isOpen = (): boolean => barOpen || panelOpen;

	/** A modal project <dialog> makes everything outside it inert, so while one is open the bar and
	 *  Details live inside it (a gated embed's External media prompt must be usable there); otherwise
	 *  they live in <body>. Containment checks below use composedPath(), so reparenting is harmless. */
	const place = (): void => {
		const host = document.querySelector<HTMLElement>('dialog[open]') ?? document.body;
		for (const el of [bar, panel]) if (el.parentElement !== host) host.appendChild(el);
	};

	const render = (): void => {
		place();
		const a: TelemetryStatus = telemetryControl.status();
		const m: ExternalMediaStatus = externalMedia.status();
		const aChoosable = a.mode === 'consent';
		const aUnanswered = aChoosable && a.consent === null;

		bar.hidden = !(barOpen && !panelOpen);
		panel.hidden = !panelOpen;
		toggle.setAttribute('aria-expanded', String(isOpen()));
		toggle.hidden = false;
		rowA.hidden = scope === 'external';
		rowM.hidden = scope === 'analytics';

		// Analytics row: adapts to the current state rather than pretending it is a first visit.
		if (!aChoosable) {
			aState.textContent = a.mode === 'forced' ? 'Currently on (local development build).' : 'Currently not active on this version of the site.';
			aNo.hidden = true;
			aYes.hidden = true;
		} else if (aUnanswered) {
			aState.textContent = '';
			aNo.hidden = false;
			aYes.hidden = false;
			aNo.textContent = 'No thanks';
		} else {
			aState.textContent = a.running ? 'Currently on.' : 'Currently off.';
			aNo.hidden = !a.running;
			aYes.hidden = a.running;
			aNo.textContent = 'Turn off';
		}

		// External media row.
		if (m.consent === null) {
			mState.textContent = '';
			mNo.hidden = false;
			mYes.hidden = false;
			mNo.textContent = 'Not now';
		} else {
			mState.textContent = m.allowed ? 'Currently on.' : 'Currently off.';
			mNo.hidden = !m.allowed;
			mYes.hidden = m.allowed;
			mNo.textContent = 'Turn off';
		}

		// Details: current setting + control for each area.
		if (!aChoosable) {
			aStatus.textContent = a.mode === 'forced' ? 'On (local development build).' : 'Not active on this version of the site.';
			aSwitch.hidden = true;
		} else {
			aStatus.textContent = a.running ? 'On.' : 'Off.';
			if (!a.remembered) aStatus.textContent += ' (Your browser blocked remembering this choice.)';
			aSwitch.hidden = false;
			aSwitch.textContent = a.running ? 'Turn off' : 'Allow analytics';
			aSwitch.dataset.next = a.running ? 'refuse' : 'allow';
		}
		mStatus.textContent = m.allowed ? 'On.' : 'Off.';
		if (!m.remembered) mStatus.textContent += ' (Your browser blocked remembering this choice.)';
		mSwitch.textContent = m.allowed ? 'Turn off' : 'Allow external media';
		mSwitch.dataset.next = m.allowed ? 'refuse' : 'allow';
	};

	const openBar = (s: Scope, opener: HTMLElement | null, focusId?: string): void => {
		barOpen = true;
		panelOpen = false;
		scope = s;
		returnFocusTo = opener;
		render();
		if (focusId) $<HTMLButtonElement>(focusId)?.focus();
	};

	/** Closes the WHOLE Privacy UI (bar and Details). Never decides or changes anything. */
	const closeAll = (restoreFocus: boolean): void => {
		if (!isOpen()) return;
		barOpen = false;
		panelOpen = false;
		render();
		if (restoreFocus) {
			const back = returnFocusTo && document.contains(returnFocusTo) && !returnFocusTo.hidden ? returnFocusTo : toggle;
			back.focus();
		}
		returnFocusTo = null;
	};

	const openDetails = (): void => {
		panelOpen = true;
		render();
		(!aSwitch.hidden ? aSwitch : mSwitch).focus();
	};

	/** A choice made from the bar has done its job; the manual "both" bar stays so the other row can be changed. */
	const afterDecision = (): void => {
		if (scope !== 'both') barOpen = false;
		render();
	};

	// ---- outside pointer / tap ---------------------------------------------------------------
	// Capture phase on the document, so nothing (dialog handlers, stopPropagation, reparenting)
	// can hide the event; containment uses composedPath(). pointerdown always precedes the click
	// that opens the UI, so the opening click can never count as an outside click.
	document.addEventListener(
		'pointerdown',
		(e) => {
			if (!isOpen()) return;
			const path = e.composedPath();
			if (path.includes(bar) || path.includes(panel) || path.includes(toggle)) return;
			closeAll(false); // the pointer is already going somewhere else: do not steal focus
			// The same gesture must not also close a project dialog it lands on (its backdrop).
			swallowBackdropClick = true;
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

	document.addEventListener('click', (e) => {
		const el = (e.target as Element | null)?.closest<HTMLElement>('[data-privacy-action]');
		if (!el) return;
		switch (el.dataset.privacyAction) {
			case 'analytics-allow':
				telemetryControl.allow();
				afterDecision();
				break;
			case 'analytics-refuse':
				telemetryControl.refuse();
				afterDecision();
				break;
			case 'media-allow':
				externalMedia.allow();
				afterDecision();
				break;
			case 'media-refuse':
				externalMedia.refuse();
				afterDecision();
				break;
			case 'analytics-switch':
				if (el.dataset.next === 'allow') telemetryControl.allow();
				else telemetryControl.refuse();
				render();
				break;
			case 'media-switch':
				if (el.dataset.next === 'allow') externalMedia.allow();
				else externalMedia.refuse();
				render();
				break;
			case 'details':
				openDetails();
				break;
			case 'close':
			case 'bar-close':
				closeAll(true);
				break;
		}
	});

	toggle.addEventListener('click', () => {
		if (isOpen()) closeAll(true);
		else openBar('both', null);
	});

	// A gated third-party embed was activated without permission: show the External media choice
	// (never loading just that one item). Focus returns to that embed's button when closed.
	document.addEventListener(EXTERNAL_MEDIA_REQUEST_EVENT, (e) => {
		const from = e.target instanceof HTMLElement ? e.target : null;
		openBar('external', from, '#privacy-m-yes');
	});

	document.addEventListener(
		'keydown',
		(e) => {
			if (e.key !== 'Escape' || !isOpen()) return;
			e.preventDefault(); // close Privacy only, never a project dialog beneath it
			e.stopPropagation();
			closeAll(true);
		},
		true,
	);
	// Fallback for browsers that deliver the dialog `cancel` before/without our keydown.
	document.addEventListener(
		'cancel',
		(e) => {
			if (isOpen()) e.preventDefault();
		},
		true,
	);
	// The dialog closing takes our (possibly hosted) bar with it: move it home and re-render.
	document.addEventListener(
		'close',
		(e) => {
			if ((e.target as Element | null)?.tagName === 'DIALOG') render();
		},
		true,
	);

	telemetryControl.subscribe(render);
	externalMedia.subscribe(render);

	// First visit: in consent mode with analytics still unanswered, open the compact analytics bar by
	// itself (never Details, never telemetry). forced/off modes never show this prompt.
	const a0 = telemetryControl.status();
	if (a0.mode === 'consent' && a0.consent === null) {
		barOpen = true;
		scope = 'analytics';
	}
	render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export {};
