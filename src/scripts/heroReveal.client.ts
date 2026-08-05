/**
 * Plays the hero "About" section's entrance animation (the logo fading
 * and scaling in, then a light shine sweeping once across it, followed by
 * the tagline and vision line fading up in turn — see the
 * `.hero-content.is-revealed` rules in About.astro).
 *
 * Driven entirely by scroll position via IntersectionObserver: whenever
 * the hero scrolls into view — on first load, on a manual scroll back up,
 * or because a #about link click scrolled it back into view — the
 * sequence (re)plays from the start. Whenever it scrolls out of view, the
 * hero is hidden again immediately, ready to replay.
 */

const VISIBLE_THRESHOLD = 0.15;

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playReveal(hero: HTMLElement): void {
	if (prefersReducedMotion()) {
		// The CSS itself forces the final visible state under this media query,
		// so there's nothing to animate — just make sure the class is set.
		hero.classList.add('is-revealed');
		return;
	}

	// Remove, force a reflow, then re-add so the CSS animations restart from
	// their 0% keyframe every time this runs, not just the first time.
	hero.classList.remove('is-revealed');
	void hero.offsetWidth;
	hero.classList.add('is-revealed');
}

function hideReveal(hero: HTMLElement): void {
	hero.classList.remove('is-revealed');
}

const hero = document.querySelector<HTMLElement>('.hero-content');

if (hero) {
	const observer = new IntersectionObserver(
		([entry]) => {
			if (entry.isIntersecting) {
				playReveal(hero);
			} else {
				hideReveal(hero);
			}
		},
		{ threshold: VISIBLE_THRESHOLD },
	);

	observer.observe(hero);
}
