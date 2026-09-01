/**
 * Click behaviour for the hero sentence (see components/sections/ThoughtCloud.astro).
 *
 * Each value-prop phrase is a `[data-thought-part]` button whose `aria-controls`
 * names a `[data-detail]` panel below the sentence. Clicking a part reveals its
 * detail (single-open); clicking it again, clicking outside, or pressing Escape
 * closes it. That's all — the sentence is static hero copy, no scroll motion.
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

	for (const part of parts) {
		part.addEventListener('click', () => {
			const detail = detailFor(part);
			const willOpen = part.getAttribute('aria-expanded') !== 'true';
			closeAll(part);
			part.classList.toggle('is-active', willOpen);
			part.setAttribute('aria-expanded', String(willOpen));
			if (detail) {
				if (willOpen) {
					// Re-trigger the entrance animation each time it opens.
					detail.removeAttribute('hidden');
					detail.style.animation = 'none';
					void detail.offsetWidth;
					detail.style.animation = '';
				} else {
					detail.setAttribute('hidden', '');
				}
			}
		});
	}

	document.addEventListener('click', (e) => {
		if (!root!.contains(e.target as Node)) closeAll();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeAll();
	});
}

export {};
