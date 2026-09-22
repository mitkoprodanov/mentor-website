/**
 * Tap-flash for action buttons on touch devices.
 *
 * On touch tap, adds `is-tapping` to the button for 600 ms then removes it
 * and blurs the element. CSS transitions handle the smooth in/out — the button
 * reaches the active visual then returns to rest instead of staying stuck on
 * via a lingering :focus-visible.
 *
 * Only runs when the device has no fine-pointer hover (touch-only screens).
 */

const SELECTORS = [
	'.cv-download',
	'.linkedin-pill',
	'.email-mailto-link',
	'.email-copy-btn',
	'.contact-pill:not(.contact-email-pill)',
].join(', ');

const FLASH_MS = 600;

document.addEventListener('click', (event) => {
	if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
	const el = (event.target as HTMLElement).closest<HTMLElement>(SELECTORS);
	if (!el) return;

	// Add the flash class synchronously so the transition begins immediately.
	el.classList.add('is-tapping');
	// Blur on the next tick — after the browser has processed the tap — so
	// :focus-visible is cleared while is-tapping holds the active visual.
	setTimeout(() => el.blur(), 0);
	// Remove the flash class after the hold window; the CSS transition handles
	// the smooth return to rest.
	setTimeout(() => el.classList.remove('is-tapping'), FLASH_MS);
});

export {};
