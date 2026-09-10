/**
 * Publishes each person slot's header-only (button-less) width as
 * `--panel-w-shrunk` on that slot, so ScrollyRegion.astro can transition the
 * slot's `flex-basis` between its resting 340px and this pixel value in the
 * two button-less states — the single-person project detail modal, and the
 * skill filter view. Two pixel endpoints animate cleanly, so the slot's
 * background, the .slot-decor frame/glow around it (both sized to the slot),
 * and the centred headshot above all shrink and grow back in sync.
 *
 * Measurement runs off-screen and non-destructively: the collapsible rows
 * and hidden stack are temporarily set to display:none inside the panel so
 * `max-content` on the panel reflects only the always-visible header, then
 * everything is restored. Repeated on window resize and after web fonts load
 * (both can shift the header's intrinsic width).
 */

function measureSlots() {
	const slots = document.querySelectorAll<HTMLElement>('.person-slot');
	slots.forEach((slot) => {
		const panel = slot.querySelector<HTMLElement>('.side-panel');
		if (!panel) return;
		const prevWidth = panel.style.width;
		const prevTransition = panel.style.transition;
		const rows = Array.from(
			panel.querySelectorAll<HTMLElement>('.collapse-row, .side-panel-stack, .card-filter')
		);
		const prevDisplays = rows.map((r) => r.style.display);
		rows.forEach((r) => (r.style.display = 'none'));
		panel.style.transition = 'none';
		panel.style.width = 'max-content';
		void panel.offsetWidth;
		const w = Math.ceil(panel.getBoundingClientRect().width);
		panel.style.width = prevWidth;
		rows.forEach((r, i) => (r.style.display = prevDisplays[i]));
		void panel.offsetWidth;
		panel.style.transition = prevTransition;
		if (w > 0) slot.style.setProperty('--panel-w-shrunk', w + 'px');
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', measureSlots, { once: true });
} else {
	measureSlots();
}

if ('fonts' in document) {
	(document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(measureSlots);
}

window.addEventListener('resize', measureSlots);
