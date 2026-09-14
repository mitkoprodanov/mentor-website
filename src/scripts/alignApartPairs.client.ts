/**
 * Aligns each of Ádám's three post-Primal projects horizontally with
 * Mitko's corresponding post-Primal project on the other track so the
 * two threads read as three side-by-side pairs:
 *
 *   Kreator Studios · Heart of Darkness   ↔   Personal Project · Biobot
 *   Imagic Labs · Imagic App              ↔   Personal Project · Hypha
 *   Flying Wild Hog · Space Punks         ↔   Primal Game Studio · Mandragora
 *
 * Each pair's two project boxes share the same top edge in viewport
 * coordinates. The natural chrome above the two tracks differs (Mitko's
 * `.track.under-mentor` adds its own inner padding on top of the Mentor
 * envelope; Ádám's plain track sits flush against the fork's top edge),
 * and the Adam-side Personal Project card carries two projects inside a
 * single card while Mitko's three projects each live in their own
 * cards — so the alignment can't fall out of layout alone.
 *
 * The script has six knobs it can add to (never subtracts, so every
 * pass is a monotonic settle):
 *
 *   • margin-top on Kreator, Imagic, Flying Wild Hog cards (pushes
 *     each Mitko project down)
 *   • margin-top on Ádám's Personal Project card (pushes Biobot down)
 *   • row-gap inside Personal Project's `.track-projects` (pushes
 *     Hypha down away from Biobot)
 *   • margin-top on Primal Continued (pushes Mandragora down)
 *
 * For each pair, whichever side is currently higher on the page
 * receives the shift to bring it down to match its partner; the loop
 * runs until every pair is aligned within half a pixel.
 *
 * `justify-content: flex-end` is set on Personal Project's inner
 * `.track-projects` too so Biobot packs against the card's visual top
 * (under the reversed timeline's `column-reverse`) — otherwise the
 * default `flex-start` sinks the pair to the visual bottom and the
 * card's own margin-top can't push Biobot up to Kreator's row.
 *
 * Skipped on the single-column mobile layout, where the fork collapses
 * into one column and pair alignment stops being meaningful.
 */

const MOBILE_QUERY = '(max-width: 480px)';
const MAX_ITERATIONS = 24;
const CONVERGENCE_EPSILON = 0.5;

type Pair = {
	mitkoProject: HTMLElement;
	mitkoCard: HTMLElement;
	adamProject: HTMLElement;
	// The DOM element whose `margin-top` moves Ádám's project down.
	// For Biobot that's the Personal Project card itself; for Hypha
	// that's the row-gap style on `.track-projects` (see `adamRowGap`);
	// for Mandragora that's the Primal Continued card.
	adamMover: HTMLElement;
	// True when the Adam-side lever is a rowGap adjustment on the
	// projects container rather than a marginTop on the mover element.
	adamViaRowGap?: HTMLElement;
};

function documentTop(el: HTMLElement): number {
	return el.getBoundingClientRect().top + window.scrollY;
}

function isVisible(el: HTMLElement): boolean {
	return getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
}

function px(v: string | null): number {
	return v ? parseFloat(v) || 0 : 0;
}

function findProject(card: HTMLElement, pattern: RegExp): HTMLElement | null {
	return [...card.querySelectorAll<HTMLElement>('.track-row--boxed')].find((r) => pattern.test(r.textContent ?? '')) ?? null;
}

type Nodes = {
	kreator: HTMLElement;
	kreatorProject: HTMLElement;
	imagic: HTMLElement;
	imagicProject: HTMLElement;
	fwh: HTMLElement;
	fwhProject: HTMLElement;
	personal: HTMLElement;
	personalProjects: HTMLElement;
	biobot: HTMLElement;
	hypha: HTMLElement;
	primalContinued: HTMLElement;
	mandragora: HTMLElement;
	adamTrack: HTMLElement;
};

function findNodes(): Nodes | null {
	const kreator = document.querySelector<HTMLElement>('[data-company-id="kreator-studios"]');
	const imagic = document.querySelector<HTMLElement>('[data-company-id="imagic-labs"]');
	const fwh = document.querySelector<HTMLElement>('[data-company-id="flying-wild-hog"]');
	const personal = document.querySelector<HTMLElement>('[data-company-id="adam-personal-project"]');
	const primalContinued = document.querySelector<HTMLElement>('[data-company-id="primal-continued"]');
	if (!kreator || !imagic || !fwh || !personal || !primalContinued) return null;

	const kreatorProject = kreator.querySelector<HTMLElement>('.track-row--boxed');
	const imagicProject = imagic.querySelector<HTMLElement>('.track-row--boxed');
	const fwhProject = fwh.querySelector<HTMLElement>('.track-row--boxed');
	const personalProjects = personal.querySelector<HTMLElement>('.track-projects');
	const biobot = findProject(personal, /biobot/i);
	const hypha = findProject(personal, /hypha/i);
	const mandragora = primalContinued.querySelector<HTMLElement>('.track-row--boxed');

	const adamTrack = personal.closest<HTMLElement>('.track');
	if (!kreatorProject || !imagicProject || !fwhProject || !personalProjects || !biobot || !hypha || !mandragora || !adamTrack) return null;
	return {
		kreator,
		kreatorProject,
		imagic,
		imagicProject,
		fwh,
		fwhProject,
		personal,
		personalProjects,
		biobot,
		hypha,
		primalContinued,
		mandragora,
		adamTrack,
	};
}

function reset(nodes: Nodes): void {
	nodes.kreator.style.marginTop = '';
	nodes.imagic.style.marginTop = '';
	nodes.fwh.style.marginTop = '';
	nodes.personal.style.marginTop = '';
	nodes.primalContinued.style.marginTop = '';
	nodes.primalContinued.style.minHeight = '';
	nodes.personalProjects.style.rowGap = '';
	nodes.personalProjects.style.justifyContent = '';
	nodes.personalProjects.style.paddingTop = '';
	nodes.personalProjects.style.paddingBottom = '';
	nodes.adamTrack.style.justifyContent = '';
	// The single-project inner container inside Primal Continued —
	// visited too since the seam-closing stretch below pins Mandragora
	// to the visual top of its own card.
	const primalProjects = nodes.primalContinued.querySelector<HTMLElement>('.track-projects');
	if (primalProjects) primalProjects.style.justifyContent = '';
	// Undo the flex-grow lock the seam-closing block applies to Mandragora
	// (see settle) — otherwise a re-run would keep Mandragora frozen at
	// its natural size even after the card is no longer stretched.
	nodes.mandragora.style.flex = '';
	const mandragoraCards = nodes.mandragora.querySelector<HTMLElement>('.cards');
	if (mandragoraCards) mandragoraCards.style.flex = '';
}

function bumpMarginTop(el: HTMLElement, delta: number): void {
	const current = px(el.style.marginTop);
	el.style.marginTop = `${Math.max(0, current + delta)}px`;
}

function bumpRowGap(el: HTMLElement, delta: number): void {
	const current = px(el.style.rowGap) || px(getComputedStyle(el).rowGap);
	el.style.rowGap = `${Math.max(0, current + delta)}px`;
}

function settle(nodes: Nodes): void {
	reset(nodes);
	// Pack Ádám's *whole track* at the fork's visual top (under
	// `column-reverse`, `flex-end` = visual-top pack) — this apart
	// entry's Ádám side normally packs at the visual bottom via the
	// `.track.align-top` rule (so its Primal Continued card can meet
	// the seam into the shared Primal card below in the reversed
	// timeline). But bottom-packing couples Ádám's project positions
	// to the grid row's height, which itself follows whichever track
	// is taller — so any margin-top the loop below adds to Mitko's
	// cards enlarges the row, drags Ádám's whole column down by the
	// same amount, and the pair diffs never close. Top-packing
	// anchors Ádám's Personal Project card to the fork's top edge so
	// each Mitko shift moves only Mitko, and the pairs converge.
	nodes.adamTrack.style.justifyContent = 'flex-end';
	// Pack Biobot at Personal Project's visual top so the card's
	// margin-top can push Biobot down (under the reversed timeline's
	// `column-reverse`, `flex-end` = visual-top pack; the default
	// `flex-start` would sink the pair to the bottom and no shift on
	// the card would ever raise Biobot up to Kreator's row).
	nodes.personalProjects.style.justifyContent = 'flex-end';
	void nodes.personal.offsetHeight;

	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const K = documentTop(nodes.kreatorProject);
		const B = documentTop(nodes.biobot);
		const I = documentTop(nodes.imagicProject);
		const H = documentTop(nodes.hypha);
		const F = documentTop(nodes.fwhProject);
		const M = documentTop(nodes.mandragora);

		const dKB = Math.abs(K - B);
		const dIH = Math.abs(I - H);
		const dFM = Math.abs(F - M);

		if (dKB < CONVERGENCE_EPSILON && dIH < CONVERGENCE_EPSILON && dFM < CONVERGENCE_EPSILON) break;

		// Fix the topmost pair first — writes here shift everything
		// below on both tracks, so the lower pairs settle against a
		// stable reference.
		if (dKB >= CONVERGENCE_EPSILON) {
			if (K < B) bumpMarginTop(nodes.kreator, B - K);
			else bumpMarginTop(nodes.personal, K - B);
			continue;
		}

		if (dIH >= CONVERGENCE_EPSILON) {
			if (I < H) bumpMarginTop(nodes.imagic, H - I);
			else bumpRowGap(nodes.personalProjects, I - H);
			continue;
		}

		if (dFM >= CONVERGENCE_EPSILON) {
			if (F < M) bumpMarginTop(nodes.fwh, M - F);
			else bumpMarginTop(nodes.primalContinued, F - M);
			continue;
		}
	}

	// All three pairs are aligned. Now close the seam into the shared
	// Primal card below the fork: Ádám's track packs at visual top (so
	// pair alignment can converge — see above), which leaves slack at
	// the track's visual bottom between Primal Continued's own bottom
	// edge and the fork's bottom edge, where the TrackConnector into
	// the shared Primal card sits. Stretch Primal Continued's own
	// height with `min-height` so its bottom border meets that
	// connector, and pin Mandragora at the card's visual top (its
	// `.track-projects` flex-end pack) so the stretch adds empty space
	// *below* Mandragora instead of pushing it down out of pair-3
	// alignment. The target is the enclosing `.apart` element's own
	// bottom — the connector's `margin: -2rem 0` cancels the timeline
	// row-gap and pins its top edge to `.apart.bottom` exactly. Loops
	// because a stretch that makes Ádám's column taller than Mitko's
	// grows the grid row, moves `.apart.bottom` down, and needs one
	// more pass before the two agree.
	const primalProjects = nodes.primalContinued.querySelector<HTMLElement>('.track-projects');
	if (primalProjects) primalProjects.style.justifyContent = 'flex-end';
	// Hold Mandragora at its natural size inside the stretched card. The
	// base `.track-row { flex: 1 }` in ApartBlock's CSS would otherwise
	// let the single project row balloon to fill the full stretched
	// height — one small text card blown up into a huge empty box.
	// Keeping it natural puts the extra height *below* the box as
	// company-card background between the project and the "2022"
	// footer, which is what a reader expects to see when a role runs
	// on past a single documented project. The nested `.cards` (see
	// `.cards { flex: 1 }` in ApartBlock) needs the same lock — its
	// `flex: 1` would otherwise re-inflate the ExperienceCard inside.
	nodes.mandragora.style.flex = '0 0 auto';
	const mandragoraCards = nodes.mandragora.querySelector<HTMLElement>('.cards');
	if (mandragoraCards) mandragoraCards.style.flex = '0 0 auto';
	const apart = nodes.primalContinued.closest<HTMLElement>('.apart');
	if (apart) {
		for (let i = 0; i < 6; i++) {
			const apartBottom = apart.getBoundingClientRect().bottom + window.scrollY;
			const primalRect = nodes.primalContinued.getBoundingClientRect();
			const primalBottom = primalRect.bottom + window.scrollY;
			const shortfall = apartBottom - primalBottom;
			if (shortfall <= CONVERGENCE_EPSILON) break;
			nodes.primalContinued.style.minHeight = `${primalRect.height + shortfall}px`;
			void nodes.primalContinued.offsetHeight;
		}
	}
}

function sync(nodes: Nodes): void {
	if (!isVisible(nodes.kreator) || !isVisible(nodes.personal) || !isVisible(nodes.primalContinued)) {
		reset(nodes);
		return;
	}
	if (window.matchMedia(MOBILE_QUERY).matches) {
		reset(nodes);
		return;
	}
	settle(nodes);
}

function init(): void {
	const nodes = findNodes();
	if (!nodes) return;

	let scheduled = false;
	function schedule(): void {
		if (scheduled) return;
		scheduled = true;
		setTimeout(() => {
			scheduled = false;
			sync(nodes);
		}, 0);
	}

	schedule();

	const observer = new ResizeObserver(schedule);
	observer.observe(nodes.kreator);
	observer.observe(nodes.imagic);
	observer.observe(nodes.fwh);
	observer.observe(nodes.personal);
	observer.observe(nodes.primalContinued);

	window.addEventListener('resize', schedule);
	document.fonts?.ready?.then(schedule).catch(() => {});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
