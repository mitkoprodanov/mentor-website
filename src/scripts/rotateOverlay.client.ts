/**
 * Portrait-phone overlay — nudges the visitor to rotate their phone to
 * landscape, where the side-by-side portfolio experience is designed to live.
 *
 * Shows when: phone in portrait (≤600px width AND portrait orientation).
 * Auto-hides on rotate to landscape, or when "Continue anyway" is clicked.
 * "Continue anyway" sets a sessionStorage flag so the overlay stays hidden
 * for the rest of the session even if the user rotates back to portrait.
 */

const overlay = document.getElementById('rotate-overlay') as HTMLElement | null;
const continueBtn = document.getElementById('rotate-continue') as HTMLButtonElement | null;

if (overlay) {
	const DISMISSED_KEY = 'rotate-overlay-dismissed';

	// Only show on narrow-viewport portrait — phones, not tablets or desktops.
	const portraitPhoneMQ = window.matchMedia(
		'(orientation: portrait) and (max-width: 600px)',
	);

	function show(): void {
		if (sessionStorage.getItem(DISMISSED_KEY)) return;
		overlay!.classList.remove('ro--hidden');
		// One rAF so the CSS transition fires after un-hiding.
		requestAnimationFrame(() => overlay!.classList.add('ro--visible'));
	}

	function hide(): void {
		overlay!.classList.remove('ro--visible');
		setTimeout(() => overlay!.classList.add('ro--hidden'), 420);
	}

	function sync(): void {
		if (portraitPhoneMQ.matches) show();
		else hide();
	}

	portraitPhoneMQ.addEventListener('change', sync);
	sync();

	continueBtn?.addEventListener('click', () => {
		sessionStorage.setItem(DISMISSED_KEY, '1');
		hide();
	});
}

export {};
