/**
 * Directional scroll-snap into / out of the closing Contact section.
 *
 * There are two resting states for the boundary between Projects (the tail of
 * the timeline area) and the Contact section:
 *
 *   - "Projects" — the Contact section sits just off the bottom edge, so all of
 *     the content above it is in view;
 *   - "Contact"  — the Contact section is flush with the top of the viewport,
 *     so the content above it (Projects) has scrolled out.
 *
 * Between those two lies exactly one viewport-height of travel. Rather than let
 * the reader stall halfway, once they scroll a little way into that band we
 * finish the move for them:
 *
 *   - scrolling DOWN, once Contact has peeked in past a small threshold at the
 *     bottom, auto-scroll forward so Contact lands on top (Projects scrolls out);
 *   - scrolling UP, once Contact has dropped a little way from the top, auto-
 *     scroll back the other way so it returns to the bottom edge — the mirror of
 *     the down move, so the two directions feel symmetric.
 *
 * A programmatic snap is guarded so the scroll events it emits don't re-trigger
 * it, and we stand down whenever a modal-ish overlay owns the page (the filter
 * modal, an open project dialog, or an expanded person card). Honours
 * prefers-reduced-motion by not hijacking the scroll at all.
 */

const contact = document.getElementById('contact');
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Touch devices drive this section with momentum scrolling; hijacking that
// mid-flick to smooth-scroll to a snap point fights the user's own gesture and
// reads as jank. The directional snap is a nicety for wheel/trackpad, so stand
// down entirely on coarse pointers and let native scrolling run.
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

if (contact && !prefersReduced && !coarsePointer) {
	// How far Contact must intrude past a resting state before the snap fires —
	// small enough to feel eager ("as soon as it's visible at the bottom"), large
	// enough not to fire on a stray nudge. Capped as a fraction of the viewport
	// on short screens. The same value is used at both ends, keeping the two
	// directions symmetric.
	const threshold = () => Math.min(96, window.innerHeight * 0.12);

	let lastY = window.scrollY;
	let snapping = false;
	let settleTimer = 0;
	// Once Contact has snapped flush to the top it becomes a hard detent: it's the
	// end of the page and the terminal rest, so the reader can't drift past it and
	// can't linger part-way back. While parked here we hold the position static
	// against any further downward scroll, and snap straight back to the bottom rest
	// the moment they scroll up — no in-between free play in either direction.
	let parkedAtTop = false;

	// A hash-link jump (the navbar's About/Timeline/Contact, the brand link)
	// smooth-scrolls through this transition band. Without this guard the snap
	// reads that programmatic upward travel as the reader scrolling up and yanks
	// them back down to the bottom rest — so a jump to About/Timeline from the
	// Contact section stalls around Projects. While a jump is in flight we stand
	// down; the flag is re-armed on every scroll tick and released once the
	// scroll settles at its target.
	let navJump = false;
	let navJumpTimer = 0;
	const armNavJump = () => {
		navJump = true;
		window.clearTimeout(navJumpTimer);
		navJumpTimer = window.setTimeout(() => {
			navJump = false;
			lastY = window.scrollY;
		}, 200);
	};

	document.addEventListener('click', (event) => {
		const target = event.target;
		if (target instanceof Element && target.closest('a[href^="#"]')) {
			armNavJump();
		}
	});

	// Don't fight another overlay that has taken over the page: the filter modal,
	// an open project dialog (which locks body scroll via overflow:hidden), or an
	// expanded person card in the sticky bar.
	const blocked = () =>
		document.body.classList.contains('filter-active') ||
		document.body.style.overflow === 'hidden' ||
		document.querySelector('.side-panel.is-open') !== null;

	const snapTo = (target: number) => {
		snapping = true;
		window.scrollTo({ top: target, behavior: 'smooth' });
		// The smooth scroll emits its own scroll events; ignore them until it
		// settles. Clear on a timeout so an interrupted snap (the browser lets a
		// user wheel override an in-flight smooth scroll) re-arms the trigger.
		window.clearTimeout(settleTimer);
		settleTimer = window.setTimeout(() => {
			snapping = false;
			lastY = window.scrollY;
		}, 900);
	};

	const onScroll = () => {
		const y = window.scrollY;

		// Keep the guard alive while a hash-link jump is still travelling, and
		// let it drive the scroll all the way to its target untouched.
		if (navJump) {
			armNavJump();
			lastY = y;
			return;
		}

		// While another overlay owns the page (the filter modal locks body to
		// position:fixed, dropping window.scrollY to 0), stand down AND don't
		// touch lastY — otherwise the restore-to-prev-position scroll on modal
		// close reads as a huge downward jump and can fire snapTo(atTop),
		// launching the reader all the way to the Contact section.
		if (blocked()) return;

		const dir = y - lastY;
		lastY = y;

		if (snapping || dir === 0) return;

		// Document-space offset of the Contact section's top edge, recomputed each
		// time so it stays correct as the layout settles (fonts, images, resize).
		const top = contact.getBoundingClientRect().top + y;
		const atTop = top; // Contact flush to the top of the viewport
		const atBottom = top - window.innerHeight; // Contact just peeking in at the bottom

		// Only act inside the one-viewport transition band between the two states.
		if (y <= atBottom || y >= atTop) return;

		const t = threshold();
		if (dir > 0 && y > atBottom + t) {
			snapTo(atTop);
		} else if (dir < 0 && y < atTop - t) {
			snapTo(atBottom);
		}
	};

	window.addEventListener('scroll', onScroll, { passive: true });
}

export {};
