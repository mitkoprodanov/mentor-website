/**
 * Consistent, direction-independent landing for the navbar's in-page links
 * (About / Timeline / Contact, plus the brand link).
 *
 * Two problems a plain anchor jump has here:
 *
 *   1. #timeline sits ~56px lower while the page is in contact-mode — the person
 *      cards show their CV row then, growing the sticky bar that pushes the
 *      timeline down (see ScrollyRegion.astro + contactMode.client.ts). So a
 *      native jump lands Timeline in a different spot depending on whether you
 *      arrived from About (mode off) or from Contact (mode on). We always land
 *      it at its resting, mode-off position — the "from above" landing.
 *
 *   2. #contact's native jump honours its scroll-margin-top and stops short of
 *      the flush-to-top rest the scroll-snap settles on (see
 *      contactSnap.client.ts). Clicking Contact should match that snap rest.
 *
 * We intercept the clicks and smooth-scroll to a fixed pixel target measured in
 * each section's resting contact-mode state. A fixed target (unlike an element
 * jump) is immune to the contact-mode layout shift that happens mid-scroll, so
 * both directions settle on the same pixel. contactSnap already stands down for
 * these clicks (its nav-jump guard keys off the same hash-link clicks).
 */

const navbar = document.querySelector('.navbar');
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (navbar) {
	// Document offset of an element as it rests, measured with contact-mode
	// forced to the state that section settles in. The toggle → read → restore
	// all happens inside one synchronous frame, so nothing repaints in between:
	// the reader never sees the momentarily-forced class.
	const restingOffset = (el: HTMLElement, contactMode: boolean): number => {
		const body = document.body;
		const had = body.classList.contains('contact-mode');
		if (contactMode !== had) body.classList.toggle('contact-mode', contactMode);
		const y = Math.round(el.getBoundingClientRect().top + window.scrollY);
		if (contactMode !== had) body.classList.toggle('contact-mode', had);
		return y;
	};

	navbar.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
		if (!link) return;

		const id = (link.getAttribute('href') ?? '').slice(1);
		const el = id ? document.getElementById(id) : null;
		if (!el) return; // unknown target — let the browser handle it

		event.preventDefault();

		// Contact rests in contact-mode; About/Timeline rest out of it.
		const y = restingOffset(el, id === 'contact');
		window.scrollTo({ top: y, behavior: prefersReduced ? 'auto' : 'smooth' });

		// Reflect the hash in the URL without re-triggering the native jump we
		// just replaced.
		history.pushState(null, '', `#${id}`);
	});
}

export {};
