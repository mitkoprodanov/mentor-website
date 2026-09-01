/**
 * Orchestrates the About → Timeline hand-off as a differential-scroll (no
 * floating): three layers move up at different speeds as you scroll down.
 *
 *   • Logo + texts (.hero-content) — untouched: they scroll up at NORMAL speed.
 *   • Timeline + person cards (.scrolly) — lifted so they rise at HALF speed
 *     through the intro, then eased back to zero offset so the sticky person bar
 *     still docks at its normal top (the offset must be exactly gone by dock, or
 *     the docked bar would sit low). This keeps the cards/timeline just BELOW
 *     the thoughts the whole time.
 *   • Thoughts (.thought-cloud) — a dense, non-floating block that rides at the
 *     same HALF speed (so it sits just above the cards, densely between the logo
 *     and the timeline), then detaches and accelerates up + fades away.
 *
 * All three are pure functions of scrollY. The cloud moves and fades as one
 * block (its own translateY + opacity) — the pills inside never move relative to
 * each other. Clicking / hovering a pill still expands it (handled in CSS +
 * the click latch below).
 *
 * Phones (≤900px) render the pills as a static in-flow stack (CSS); reduced
 * motion parks the block (no parallax), hidden once scrolled past. Both skip the
 * loop and leave .scrolly untouched.
 */

const cloud = document.querySelector<HTMLElement>('.thought-cloud');
const pills = Array.from(document.querySelectorAll<HTMLElement>('.thought'));
const scrolly = document.querySelector<HTMLElement>('.scrolly');

if (cloud && pills.length) {
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const isPhone = window.matchMedia('(max-width: 900px)');

	// ---- Interaction: single-open click/tap latch --------------------------
	function setOpen(pill: HTMLElement, open: boolean): void {
		pill.classList.toggle('is-open', open);
		pill.querySelector<HTMLElement>('.thought-toggle')?.setAttribute('aria-expanded', String(open));
	}

	function closeAll(except?: HTMLElement): void {
		for (const pill of pills) {
			if (pill !== except) setOpen(pill, false);
		}
	}

	for (const pill of pills) {
		const toggle = pill.querySelector<HTMLElement>('.thought-toggle');
		toggle?.addEventListener('click', () => {
			const willOpen = !pill.classList.contains('is-open');
			closeAll(pill);
			setOpen(pill, willOpen);
		});
	}

	document.addEventListener('click', (e) => {
		if (!cloud.contains(e.target as Node)) closeAll();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeAll();
	});

	// ---- Parallax tuning (fractions of the viewport height) ----------------
	const HALF = 0.5; // the thoughts' speed through the intro (half normal)
	const SLOW_TL = 0.08; // the timeline/cards crawl — far slower, nearly frozen low
	const P1 = 0.45; // thoughts detach here and accelerate away
	const FADE_OUT = 0.15; // …and are fully gone by P1 + FADE_OUT
	const ACCEL = 6; // how hard the thoughts accelerate away after P1
	const FADE_IN_A = 0.05; // thoughts fade in over this window (as the logo clears them)
	const FADE_IN_B = 0.16;
	// The cards keep crawling until the thoughts have left (a clear gap), then —
	// as one rigid block WITH the timeline (the bar is un-stuck while lifted, see
	// body.tl-lifted) — rise into place, reaching a zero offset just before the
	// bar's natural dock so the sticky hand-off to normal scrolling is seamless.
	const CATCHUP_START = 0.62;
	const OFF_END = 0.95;
	const ZONE_MAX = 1.15; // hide the cloud once scrolled past this

	const smooth = (a: number, b: number, t: number): number => {
		const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
		return x * x * (3 - 2 * x);
	};

	let progress = 0; // scrollY in px (kept raw; converted with live vh)

	function apply(): void {
		const S = progress;
		const vh = window.innerHeight;
		const p1 = P1 * vh;

		// Timeline / person cards: crawl (nearly frozen, staying low) until the
		// thoughts have left, then rise, eased back to a zero offset so the sticky
		// bar still docks normally.
		const catchStart = CATCHUP_START * vh;
		const offEnd = OFF_END * vh;
		let off: number;
		if (S <= catchStart) off = (1 - SLOW_TL) * S;
		else if (S < offEnd) off = (1 - SLOW_TL) * catchStart * (1 - (S - catchStart) / (offEnd - catchStart));
		else off = 0;
		// Only apply a real transform while it's meaningfully non-zero — at ~0 we
		// clear it entirely so .scrolly never becomes a containing block for its
		// own fixed children (the modal backdrops) once past the intro.
		if (scrolly) scrolly.style.transform = off > 0.5 ? `translateY(${off.toFixed(1)}px)` : '';

		// Thoughts: ride the same half speed, then detach and accelerate up.
		let thY: number;
		if (S <= p1) thY = -HALF * S;
		else {
			const d = S - p1;
			thY = -HALF * p1 - (ACCEL * d * d) / vh;
		}

		const op = smooth(FADE_IN_A * vh, FADE_IN_B * vh, S) * (1 - smooth(p1, (P1 + FADE_OUT) * vh, S));
		const live = op > 0.7 && S < p1;

		cloud!.style.transform = `translateY(${thY.toFixed(1)}px)`;
		cloud!.style.opacity = op.toFixed(3);
		cloud!.style.display = S < ZONE_MAX * vh ? '' : 'none';
		cloud!.classList.toggle('is-live', live);
		if (!live) closeAll();
	}

	let ticking = false;
	function onScroll(): void {
		progress = window.scrollY;
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			apply();
			ticking = false;
		});
	}

	// ---- Reduced motion: no parallax; just show/hide the parked block ------
	function updateStaticZone(): void {
		cloud!.style.display = window.scrollY < window.innerHeight * ZONE_MAX ? '' : 'none';
		if (window.scrollY > window.innerHeight * P1) closeAll();
		else cloud!.classList.add('is-live');
	}

	function onStaticScroll(): void {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			updateStaticZone();
			ticking = false;
		});
	}

	function clearInline(): void {
		cloud!.style.transform = '';
		cloud!.style.opacity = '';
		cloud!.style.display = '';
		cloud!.classList.remove('is-live');
		if (scrolly) scrolly.style.transform = '';
	}

	function enableMotion(): void {
		if (scrolly) scrolly.style.willChange = 'transform';
		progress = window.scrollY;
		apply();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
	}

	function enableStatic(): void {
		clearInline();
		cloud!.classList.add('is-live');
		updateStaticZone();
		window.addEventListener('scroll', onStaticScroll, { passive: true });
	}

	function teardown(): void {
		window.removeEventListener('scroll', onScroll);
		window.removeEventListener('resize', onScroll);
		window.removeEventListener('scroll', onStaticScroll);
		if (scrolly) scrolly.style.willChange = '';
		clearInline();
	}

	// Full parallax only on a real desktop with motion allowed; reduced motion
	// parks the block; a phone renders it in-flow via CSS (no JS motion).
	function sync(): void {
		teardown();
		if (isPhone.matches) return;
		if (reduceMotion.matches) enableStatic();
		else enableMotion();
	}

	sync();
	isPhone.addEventListener('change', sync);
	reduceMotion.addEventListener('change', sync);
}

export {};
