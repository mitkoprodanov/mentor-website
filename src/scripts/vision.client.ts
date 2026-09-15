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
 */

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
		// Per-part flag: when focus fires just before a click (the browser's touch
		// tap sequence), the click should not toggle the tooltip that focus just opened.
		let skipNextClick = false;

		part.addEventListener('focus', () => {
			if (!part.classList.contains('is-active')) {
				openDetail(part);
			}
			// Set flag regardless — covers the case where focus fires on a click
			// that would otherwise flash (hover device clicking an active part).
			skipNextClick = true;
			setTimeout(() => { skipNextClick = false; }, 0);
		});

		if (isHoverDevice) {
			part.addEventListener('mouseenter', () => openDetail(part));
		}

		part.addEventListener('click', (e) => {
			e.stopPropagation();

			if (skipNextClick) {
				skipNextClick = false;
				return;
			}

			if (isHoverDevice) {
				// Hover device: click just ensures shown, never toggles or flashes.
				if (!part.classList.contains('is-active')) openDetail(part);
			} else {
				// Touch: tap shows; tap the active part hides; tap any other part
				// shows it immediately (openDetail's closeAll handles the switch).
				if (part.classList.contains('is-active')) closeAll();
				else openDetail(part);
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
