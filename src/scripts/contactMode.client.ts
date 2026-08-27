/**
 * Flips the page into "contact mode" once the reader has scrolled down into
 * the contact zone near the end (see sections/Contact.astro + ScrollyRegion.astro).
 *
 * In contact mode the sticky top-bar cards change in place — each person's
 * Skills button crossfades to a LinkedIn link (the CV stays), and the studio's
 * contact card slides up into the centre between the two people — so the same
 * cards become the contact cards, smoothly, with no second set. All the actual
 * motion is CSS transitions keyed off `body.contact-mode`; this only toggles
 * the class based on scroll position.
 *
 * The trigger fires a little before the zone's top reaches the viewport
 * bottom (the negative bottom rootMargin), so the switch happens once the
 * reader has scrolled "under a certain amount", not only at the very end.
 */

const zone = document.getElementById('contact');

if (zone) {
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				document.body.classList.toggle('contact-mode', entry.isIntersecting);
			}
		},
		{ root: null, rootMargin: '0px 0px -35% 0px', threshold: 0 },
	);
	observer.observe(zone);
}

export {};
