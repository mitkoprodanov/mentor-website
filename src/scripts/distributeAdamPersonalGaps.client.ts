/**
 * Positions Ádám's two personal-project rows (Biobot and Hypha) inside
 * his `Personal Project` card so the three visible gaps around them —
 * above Biobot (up to the bottom of `Together Again` above the fork),
 * between Biobot and Hypha, and below Hypha (down to Mandragora inside
 * `Primal Continued` beside them) — end up the same size, while keeping
 * the Personal Project card itself sized to hug its content flush at
 * Biobot's top and Hypha's bottom (no dead card interior above Biobot
 * or below Hypha).
 *
 * How it works: measure the total distance from Together Again's bottom
 * down to Mandragora's top, subtract the two boxed rows' heights, and
 * divide by three to get G. Then:
 *
 *   • row-gap on `.track-projects` = G          → gap between Biobot & Hypha
 *   • margin-top on the Personal Project card   → gap above Biobot
 *   • margin-top on the Primal Continued card   → gap below Hypha
 *
 * The card holds its own natural height (Biobot + G + Hypha + card
 * chrome), so its top edge sits flush with Biobot's top and its bottom
 * edge sits flush with Hypha's bottom — the empty vertical space lives
 * *between* the cards in the fork, not inside them. Iterates because
 * setting row-gap and the margins can shift Mandragora down (or up,
 * depending on the track's own grid-stretched height); the loop
 * re-derives G and the margins until nothing moves.
 *
 * Skipped on the single-column mobile layout, where the two tracks
 * aren't side by side anymore and this geometry stops being meaningful.
 */

const MOBILE_QUERY = '(max-width: 900px)';
const MAX_ITERATIONS = 12;
const CONVERGENCE_EPSILON = 0.5;

type Nodes = {
	card: HTMLElement;
	projects: HTMLElement;
	biobot: HTMLElement;
	hypha: HTMLElement;
	togetherAgain: HTMLElement;
	mandragora: HTMLElement;
	primalContinued: HTMLElement;
};

function documentTop(el: HTMLElement): number {
	return el.getBoundingClientRect().top + window.scrollY;
}

function documentBottom(el: HTMLElement): number {
	return el.getBoundingClientRect().bottom + window.scrollY;
}

function isVisible(el: HTMLElement): boolean {
	return getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
}

function findRow(card: HTMLElement, pattern: RegExp): HTMLElement | null {
	return (
		[...card.querySelectorAll<HTMLElement>('.track-row--boxed')].find((r) => pattern.test(r.textContent ?? '')) ?? null
	);
}

function findNodes(): Nodes | null {
	const card = document.querySelector<HTMLElement>('[data-company-id="adam-personal-project"]');
	const primalContinued = document.querySelector<HTMLElement>('[data-company-id="primal-continued"]');
	const togetherAgain = document.querySelector<HTMLElement>('[data-company-id="together-again"]');
	if (!card || !primalContinued || !togetherAgain) return null;

	const projects = card.querySelector<HTMLElement>('.track-projects');
	const biobot = findRow(card, /biobot/i);
	const hypha = findRow(card, /hypha/i);
	const mandragora = primalContinued.querySelector<HTMLElement>('.track-row--boxed');

	if (!projects || !biobot || !hypha || !mandragora) return null;
	return { card, projects, biobot, hypha, togetherAgain, mandragora, primalContinued };
}

function reset(nodes: Nodes): void {
	nodes.projects.style.rowGap = '';
	nodes.projects.style.paddingTop = '';
	nodes.projects.style.paddingBottom = '';
	nodes.projects.style.justifyContent = '';
	nodes.card.style.marginTop = '';
	nodes.primalContinued.style.marginTop = '';
}

function settle(nodes: Nodes): void {
	reset(nodes);
	// Pack the two rows at the visual top of the card's inner container
	// (which is `flex-end` under the reversed timeline's `column-reverse`
	// on `.track-projects`) so the card's top edge sits flush against
	// Biobot rather than sinking the pair to the bottom and leaving dead
	// space above Biobot inside the card. See ApartBlock's
	// `.track-row--fill-stretch` rules for the sibling `flex: 0 0 auto`
	// that stops the rows themselves from inflating in this stretched
	// case.
	nodes.projects.style.justifyContent = 'flex-end';
	void nodes.projects.offsetHeight;

	let previousSignature = Number.NaN;
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const taBot = documentBottom(nodes.togetherAgain);
		const mandTop = documentTop(nodes.mandragora);
		const bh = nodes.biobot.getBoundingClientRect().height;
		const hh = nodes.hypha.getBoundingClientRect().height;

		const runHeight = mandTop - taBot;
		const gap = (runHeight - bh - hh) / 3;
		if (!Number.isFinite(gap) || gap <= 0) {
			reset(nodes);
			return;
		}

		// Apply the between-rows gap first so the card resizes before we
		// measure biobot / hypha positions against the targets.
		nodes.projects.style.rowGap = `${gap}px`;
		void nodes.projects.offsetHeight;

		const biobotTop = documentTop(nodes.biobot);
		const hyphaBot = documentBottom(nodes.hypha);

		const biobotTarget = taBot + gap;
		const mandTargetFromHypha = mandTop; // Mandragora's own position after this pass
		// (Mand.top may still be moving — we handle that via iteration.)

		// Shift the whole Personal Project card down/up so Biobot lands at
		// its target Y. Add the shift onto whatever margin is already there.
		const currentCardMarginTop = parseFloat(getComputedStyle(nodes.card).marginTop) || 0;
		const newCardMarginTop = Math.max(0, currentCardMarginTop + (biobotTarget - biobotTop));
		nodes.card.style.marginTop = `${newCardMarginTop}px`;

		// Shift Primal Continued down so Mandragora ends up G below Hypha's
		// bottom. Uses the same "adjust from current" pattern so the loop
		// can settle even as Mandragora's own position drifts with these
		// writes.
		const currentPrimalMarginTop = parseFloat(getComputedStyle(nodes.primalContinued).marginTop) || 0;
		const mandTargetY = hyphaBot + gap;
		const primalShift = mandTargetY - mandTargetFromHypha;
		const newPrimalMarginTop = Math.max(0, currentPrimalMarginTop + primalShift);
		nodes.primalContinued.style.marginTop = `${newPrimalMarginTop}px`;

		void nodes.projects.offsetHeight;

		// Convergence check: nothing moved this pass.
		const signature =
			Math.round(gap * 100) +
			Math.round(newCardMarginTop * 100) * 1e5 +
			Math.round(newPrimalMarginTop * 100) * 1e10;
		if (Math.abs(signature - previousSignature) < CONVERGENCE_EPSILON) return;
		previousSignature = signature;
	}
}

function sync(nodes: Nodes): void {
	if (!isVisible(nodes.card) || !isVisible(nodes.mandragora) || !isVisible(nodes.togetherAgain)) {
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

	// Anything that could change the run height (fonts loading, card
	// stretch settling on other tracks, Primal Continued's own content
	// sizing, the tag filter hiding a sibling) needs to re-trigger.
	const observer = new ResizeObserver(schedule);
	observer.observe(nodes.card);
	observer.observe(nodes.togetherAgain);
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
