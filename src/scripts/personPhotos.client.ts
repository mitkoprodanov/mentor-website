/**
 * Drives the two headshot photos (and their cards) on the hand-off from the
 * About hero into the Timeline (see the `.person-slot` / `.person-photo` rules
 * in ScrollyRegion.astro).
 *
 * The whole slot — card + the photo locked above it — is the moving unit: the
 * pair starts stacked at the screen centre as the sticky bar leaves About and
 * splits out to each edge as the Timeline is reached, so the photo never
 * detaches from its card. The photos are absolutely positioned above the cards
 * (out of flow), so they never add height to the sticky bar, and they fade as
 * they tuck up behind the fixed navbar ("doesn't take the space afterwards").
 *
 * One raw scroll-progress value is derived from how close the sticky bar is to
 * its docked top; the horizontal split is an eased version of it, so the cards
 * ease out to the sides rather than sliding linearly. Published as CSS vars:
 *   --reveal        raw 0→1  (drives the tuck-away fade)
 *   --split         eased 0→1 (drives the centre→sides travel + lift/zoom)
 *   --photo-opacity the fade, held at 1 until the pair nearly docks
 *   --photo-motion  0 under reduced motion (zeroes all travel), else 1
 *   --cx            per slot: card-centre → viewport-centre distance
 */

const bar = document.querySelector<HTMLElement>('.person-bar');
const barInner = document.querySelector<HTMLElement>('.person-bar-inner');
const slots = Array.from(document.querySelectorAll<HTMLElement>('.person-slot'));

if (bar && barInner && slots.length) {
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	// reveal opens once the bar's top has risen to this fraction of the viewport
	// and completes when it docks at its sticky top.
	const START_FRACTION = 0.62;
	// Fade the photos out over the final stretch, so they're gone by the time
	// they tuck behind the navbar (no ghosting through its blur).
	const FADE_FROM = 0.86;
	// Gap left between the two cards' inner edges when fully converged at centre
	// — they slide in as close to the middle (and each other) as they can get
	// without ever overlapping.
	const CENTRE_GAP = 30;

	let dockTop = 48; // sticky docked top of the bar (its CSS `top`).

	// Eased travel — slow at the centre, quick through the middle, settling at
	// the sides (easeInOutCubic).
	function ease(t: number): number {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	function measure(): void {
		dockTop = parseFloat(getComputedStyle(bar!).top) || 48;
		// Measure each slot's RESTING centre with the split collapsed (transform
		// at identity), so the slot's own live transform can't feed back in.
		barInner!.style.setProperty('--split', '1');
		const viewportCentre = document.documentElement.clientWidth / 2;
		for (const slot of slots) {
			const rect = slot.getBoundingClientRect();
			const centre = rect.left + rect.width / 2;
			const half = rect.width / 2;
			// Signed distance from this card's centre to the viewport centre.
			const offset = viewportCentre - centre;
			// Move inward only until the inner edge is CENTRE_GAP/2 short of the
			// middle — so the pair converges as far as it can without overlapping.
			const cx = offset > 0
				? Math.max(0, offset - half - CENTRE_GAP / 2)
				: Math.min(0, offset + half + CENTRE_GAP / 2);
			slot.style.setProperty('--cx', `${cx}px`);
		}
	}

	function update(): void {
		const start = window.innerHeight * START_FRACTION;
		const top = bar!.getBoundingClientRect().top;
		const reveal = Math.min(1, Math.max(0, (start - top) / (start - dockTop)));
		const opacity = reveal <= FADE_FROM ? 1 : Math.max(0, (1 - reveal) / (1 - FADE_FROM));
		barInner!.style.setProperty('--reveal', reveal.toFixed(4));
		barInner!.style.setProperty('--split', ease(reveal).toFixed(4));
		barInner!.style.setProperty('--photo-opacity', opacity.toFixed(4));
		barInner!.style.setProperty('--photo-motion', reduceMotion.matches ? '0' : '1');
		// The cards only become "real" (Skills button, hover/open, glow) once
		// they've finished sliding out to the sides — until then they're a
		// non-interactive moving intro. reveal hits exactly 1 only when docked.
		document.body.classList.toggle('cards-arrived', reveal >= 1);
	}

	let ticking = false;
	function onScroll(): void {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			update();
			ticking = false;
		});
	}

	measure();
	update();
	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', () => {
		measure();
		update();
	});
	reduceMotion.addEventListener('change', update);
}

export {};
