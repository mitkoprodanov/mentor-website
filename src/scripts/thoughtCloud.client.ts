/**
 * Thought-cloud interactivity (see components/sections/ThoughtCloud.astro).
 *
 * Hovering a [data-thought-part] reveals its detail panel (single-open).
 * Moving into the detail keeps it visible; leaving the .thought-sentence
 * container closes it. Click/tap toggles for touch devices.
 * Escape or clicking outside also closes.
 */

const root = document.querySelector<HTMLElement>('.thought-sentence');
const parts = Array.from(document.querySelectorAll<HTMLElement>('[data-thought-part]'));

if (root && parts.length) {
	function detailFor(part: HTMLElement): HTMLElement | null {
		const id = part.getAttribute('aria-controls');
		return id ? document.getElementById(id) : null;
	}

	function closeAll(except?: HTMLElement): void {
		for (const part of parts) {
			if (part === except) continue;
			part.classList.remove('is-active');
			part.setAttribute('aria-expanded', 'false');
			detailFor(part)?.setAttribute('hidden', '');
		}
	}

	function openDetail(part: HTMLElement): void {
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
	}

	for (const part of parts) {
		// Hover — primary interaction on pointer devices.
		part.addEventListener('mouseenter', () => openDetail(part));
		// Focus — keyboard / accessibility.
		part.addEventListener('focus', () => openDetail(part));
		// Click — toggle for touch devices (no hover event on touch).
		part.addEventListener('click', () => {
			if (part.classList.contains('is-active')) {
				closeAll();
			} else {
				openDetail(part);
			}
		});
	}

	// Leaving the sentence container closes the open detail.
	root.addEventListener('mouseleave', () => closeAll());
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeAll();
	});
	document.addEventListener('click', (e) => {
		if (!root!.contains(e.target as Node)) closeAll();
	});
}

export {};
