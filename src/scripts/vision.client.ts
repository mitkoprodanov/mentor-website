/**
 * Vision interactivity (see components/common/Vision.astro).
 *
 * Hovering (or focusing) a [data-thought-part] reveals its detail panel;
 * clicking toggles for touch devices. State is scoped PER `.vision` root so
 * multiple Vision instances on the same page (hero + a project preview) work
 * independently — closing a detail in one never touches another.
 */

document.querySelectorAll<HTMLElement>('.vision').forEach((root) => {
	const parts = Array.from(root.querySelectorAll<HTMLElement>('[data-thought-part]'));
	if (!parts.length) return;

	const detailFor = (part: HTMLElement): HTMLElement | null => {
		const id = part.getAttribute('aria-controls');
		return id ? document.getElementById(id) : null;
	};

	const closeAll = (except?: HTMLElement): void => {
		for (const part of parts) {
			if (part === except) continue;
			part.classList.remove('is-active');
			part.setAttribute('aria-expanded', 'false');
			detailFor(part)?.setAttribute('hidden', '');
		}
	};

	const openDetail = (part: HTMLElement): void => {
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
	};

	for (const part of parts) {
		part.addEventListener('mouseenter', () => openDetail(part));
		part.addEventListener('focus', () => openDetail(part));
		part.addEventListener('click', (e) => {
			// Don't let a click inside a Vision embedded in a project-row also
			// open the row's detail modal.
			e.stopPropagation();
			if (part.classList.contains('is-active')) closeAll();
			else openDetail(part);
		});
	}

	root.addEventListener('mouseleave', () => closeAll());
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeAll();
	});
	document.addEventListener('click', (e) => {
		if (!root.contains(e.target as Node)) closeAll();
	});
});

export {};
