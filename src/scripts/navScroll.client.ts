/**
 * Consistent, direction-independent landing for the navbar's in-page links
 * (About / Timeline / Contact, plus the brand link).
 *
 * The sources of drift we have to neutralise:
 *
 *   1. #timeline / #contact both live below the sticky person-bar. In
 *      contact-mode the bar grows — Adam's CV row opens (`.side-panel-cv`) —
 *      which shifts everything below it down in document flow. A jump that
 *      measures the target in one state and lands in the other overshoots or
 *      undershoots.
 *   2. That CV row *animates* its height (0.4s ease). Even if the destination
 *      state is set before the scroll starts, the bar's flow height keeps
 *      changing while the smooth-scroll is in flight — so the pixel target
 *      moves out from under it. We suppress that transition for the duration
 *      of the jump so the layout is frozen at its resting height.
 *   3. #contact's snap rest (see contactSnap.client.ts) is with the section
 *      flush against the viewport top — the section's own `padding-top: 3.5rem`
 *      places the title just below the navbar. We must land on the same pixel
 *      contactSnap would settle on, otherwise the jump ends *inside*
 *      contactSnap's transition band and the next stray scroll tick corrects
 *      it out from under the reader (a "second click helps" feel).
 *   4. Smooth scrolls can end a few pixels shy of the target (the browser's
 *      easing tail rounds down). After the smooth scroll settles we do one
 *      exact `scrollTo` correction, still under the layout freeze, so the
 *      final resting position matches the computed target to the pixel.
 *
 * The three destinations land like this — all with the anchor at the same
 * viewport y, right below the navbar:
 *   - About    → y = 0 (site scroll top).
 *   - Timeline → the "Timeline" pill sits at ~56px from viewport top.
 *   - Contact  → the "Contact" title sits at the same ~56px (matches the snap
 *                rest that contactSnap.client.ts settles on).
 */

const navbar = document.querySelector<HTMLElement>('.navbar');
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (navbar) {
	// Contact's snap rest = section flush against viewport top, so the section's
	// own `padding-top: 3.5rem` (56px) drops the title just below the navbar.
	// We use the same 56px offset for every anchor, so the Timeline pill lands
	// at exactly the same viewport y as the Contact title — the reader sees the
	// same silhouette regardless of which link they click.
	const ANCHOR_VIEWPORT_Y = 56;

	// Which element inside each section is the "anchor" — the thing we land at
	// the ANCHOR_VIEWPORT_Y offset. About lands at y=0 unconditionally, so it
	// doesn't need one.
	const anchorFor = (id: string): HTMLElement | null => {
		if (id === 'timeline') return document.querySelector<HTMLElement>('.timeline-header');
		if (id === 'contact') return document.querySelector<HTMLElement>('.contact-title');
		return null;
	};

	// While a nav jump is in flight the sticky bar's CV row must not animate its
	// height — that shifts everything below it, and our fixed pixel target moves
	// with it. Freezing the transition holds the layout at whatever resting
	// height matches the destination contact-mode. Also freezes the
	// Contact-title/company-card fade-in transform: their `translateY(24px)`
	// idle state slides the *rendered* title 24px down, so if the transition
	// is still in flight when we measure, the anchor's rect.top is 24px off.
	const style = document.createElement('style');
	style.textContent = `
		body.nav-jumping .side-panel-cv,
		body.nav-jumping .side-panel-action,
		body.nav-jumping .collapse-row,
		body.nav-jumping .contact-title,
		body.nav-jumping .contact-zone .company-card {
			transition: none !important;
		}
	`;
	document.head.appendChild(style);

	const MOBILE_NAV_QUERY = '(max-width: 900px)';

	const computeTargetY = (id: string): number => {
		if (id === 'about') return 0;
		const scrollingEl = document.scrollingElement || document.documentElement;
		const maxY = document.documentElement.scrollHeight - window.innerHeight;
		const isMobile = window.matchMedia(MOBILE_NAV_QUERY).matches;

		if (isMobile && id === 'timeline') {
			// Mobile: scroll so the sticky person-bar's natural top sits just below
			// the navbar. getBoundingClientRect().top is wrong for sticky elements
			// when they are currently "stuck" — it returns the stuck viewport position
			// instead of the natural document position. Use the timeline-area below it
			// (not sticky) to derive the correct document offset instead.
			const personBar = document.querySelector<HTMLElement>('.person-bar');
			const timelineArea = document.querySelector<HTMLElement>('.timeline-area');
			if (personBar && timelineArea) {
				const areaDocTop = timelineArea.getBoundingClientRect().top + scrollingEl.scrollTop;
				const y = areaDocTop - personBar.offsetHeight - navbar.offsetHeight;
				return Math.max(0, Math.min(maxY, Math.round(y)));
			}
		}

		if (isMobile && id === 'contact') {
			// Mobile: person bar becomes sticky (contact-mode CSS adds position:sticky).
			// Land the contact title just below the sticky bar (navbar + bar height + gap).
			const anchor = anchorFor(id);
			const personBar = document.querySelector<HTMLElement>('.person-bar');
			if (anchor && personBar) {
				const viewportOffset = navbar.offsetHeight + personBar.offsetHeight + 8;
				const y = anchor.getBoundingClientRect().top + scrollingEl.scrollTop - viewportOffset;
				return Math.max(0, Math.min(maxY, Math.round(y)));
			}
		}

		const el = anchorFor(id);
		if (!el) return 0;
		const y = el.getBoundingClientRect().top + scrollingEl.scrollTop - ANCHOR_VIEWPORT_Y;
		return Math.max(0, Math.min(maxY, Math.round(y)));
	};

	let jumpTimer = 0;
	let correctionTimer = 0;

	navbar.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
		if (!link) return;

		const id = (link.getAttribute('href') ?? '').slice(1);
		if (!id) return;

		// Only intercept our three known destinations; anything else falls through
		// to the browser's native jump.
		if (id !== 'about' && id !== 'timeline' && id !== 'contact') return;
		if (id !== 'about' && !anchorFor(id)) return;

		event.preventDefault();

		// Set the destination contact-mode BEFORE measuring, and freeze the
		// transitions that would otherwise animate the bar's height mid-scroll.
		// IntersectionObserver may re-affirm the same class based on where we
		// end up, which is fine — the class is already what we want.
		const wantContact = id === 'contact';
		document.body.classList.add('nav-jumping');
		document.body.classList.toggle('contact-mode', wantContact);

		// Force layout to settle at the frozen resting state before measuring.
		void navbar.offsetHeight;

		const y = computeTargetY(id);
		window.scrollTo({ top: y, behavior: prefersReduced ? 'auto' : 'smooth' });

		history.pushState(null, '', `#${id}`);

		// After the smooth scroll settles, snap to the exact target — Chrome's
		// easing tail can leave 1–3px on the table, and contactSnap treats any
		// short landing inside its band as fair game to correct out from under
		// the reader. A silent instant scroll to the same integer y removes both.
		window.clearTimeout(correctionTimer);
		window.clearTimeout(jumpTimer);
		correctionTimer = window.setTimeout(() => {
			const scrollingEl = document.scrollingElement || document.documentElement;
			// Recompute in case the layout settled fractionally different.
			const final = computeTargetY(id);
			if (Math.abs(scrollingEl.scrollTop - final) > 0) {
				window.scrollTo({ top: final, behavior: 'auto' });
			}
			// A short tail after the correction so contactSnap doesn't read the
			// correction's own scroll event as a user-initiated tick.
			jumpTimer = window.setTimeout(() => {
				document.body.classList.remove('nav-jumping');
			}, 250);
		}, prefersReduced ? 0 : 850);
	});
}

export {};
