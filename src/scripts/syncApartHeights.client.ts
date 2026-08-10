/**
 * Stretches a `.track-company` box down past its own natural height, toward
 * another company box named on it (see CompanyDef.stretchToMiddleOf /
 * stretchNearTopOf / alignBottomTo in data/timeline.ts), in one of three
 * ways:
 *
 *  - "middle" — reach exactly the vertical midpoint of a same-row sibling
 *    on the *other* track of the same ApartBlock, e.g. Ádám's continuing
 *    "Primal Game Studio" reaching down to the middle of Mitko's "Imagic
 *    Labs" — pushing whatever comes after it in Ádám's own track ("Personal
 *    Project") down to make room.
 *  - "bottom" — line up exactly with the bottom edge of a same-row sibling
 *    on the other track, e.g. Ádám's "Personal Project" ending flush with
 *    Mitko's "Kreator Studios", the last company on his side.
 *  - "near-top" — reach within a fixed gap of the *top* of another company
 *    box (anywhere in the timeline, typically the `together` entry that
 *    follows), close but deliberately stopping short so the two clearly
 *    read as separate boxes instead of merging.
 *
 * All three are only computable at runtime: the target box's height depends
 * on its actual rendered text, font, and viewport width, none of which the
 * data file knows. So this stays a min-height nudge on top of ApartBlock's
 * normal flex layout, not a replacement for it — if the target is shorter
 * than expected, hidden (e.g. by the tag filter), or the layout has
 * collapsed to the single-column mobile view where tracks aren't side by
 * side anymore, the source box just falls back to its own natural height.
 */

type Pair = { source: HTMLElement; target: HTMLElement } & ({ mode: 'middle' | 'bottom' } | { mode: 'near-top'; gap: number });

const MOBILE_QUERY = '(max-width: 900px)';

function findTarget(id: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-company-id="${CSS.escape(id)}"]`);
}

function findPairs(): Pair[] {
	const pairs: Pair[] = [];

	for (const source of document.querySelectorAll<HTMLElement>('[data-stretch-to-middle-of]')) {
		const targetId = source.dataset.stretchToMiddleOf;
		const target = targetId ? findTarget(targetId) : null;
		if (target) pairs.push({ source, target, mode: 'middle' });
	}

	for (const source of document.querySelectorAll<HTMLElement>('[data-align-bottom-to]')) {
		const targetId = source.dataset.alignBottomTo;
		const target = targetId ? findTarget(targetId) : null;
		if (target) pairs.push({ source, target, mode: 'bottom' });
	}

	for (const source of document.querySelectorAll<HTMLElement>('[data-stretch-near-top-of]')) {
		const targetId = source.dataset.stretchNearTopOf;
		const gap = Number(source.dataset.stretchGap ?? '0');
		const target = targetId ? findTarget(targetId) : null;
		if (target) pairs.push({ source, target, mode: 'near-top', gap });
	}

	return pairs;
}

function isVisible(el: HTMLElement): boolean {
	return getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
}

function neededHeight(pair: Pair, sourceTop: number): number | null {
	if (!isVisible(pair.source) || !isVisible(pair.target)) return null;
	const targetRect = pair.target.getBoundingClientRect();
	if (pair.mode === 'middle') return targetRect.top + targetRect.height / 2 - sourceTop;
	if (pair.mode === 'bottom') return targetRect.bottom - sourceTop;
	return targetRect.top - pair.gap - sourceTop;
}

/**
 * Every mode is potentially self-referencing: growing the source can move
 * the target too, not just for a `near-top` target in the following
 * document flow, but even for a `middle`/`bottom` target on the *other*
 * track of the same ApartBlock — if that track's own content is
 * bottom-aligned (`justify-content: flex-end`, ApartBlock's default for a
 * track that doesn't continue from the entry above) and the source's own
 * track grows tall enough to become the row's height-determining side, the
 * grid's `align-items: stretch` stretches the target's track to match,
 * which shifts its bottom-aligned content — including the target — further
 * down. So every pair settles the same way: re-measure after every write
 * until the needed height stops changing (bounded so a layout that somehow
 * never settles can't loop forever).
 */
function settle(pair: Pair): void {
	let previous: number | null = null;
	for (let i = 0; i < 12; i++) {
		const sourceRect = pair.source.getBoundingClientRect();
		const extra = neededHeight(pair, sourceRect.top);
		if (extra === null) {
			pair.source.style.minHeight = '';
			return;
		}
		// Only the very first read reflects the *natural* height (nothing's
		// been applied yet) — that's the one comparison that means "already
		// leaves enough of a gap on its own." On later iterations sourceRect
		// reflects a min-height this same loop just set, so `extra` settling
		// down to match it means convergence, not "no stretch needed" —
		// checking that here too would wipe out the very value just applied.
		if (i === 0 && extra <= sourceRect.height) {
			pair.source.style.minHeight = '';
			return;
		}
		pair.source.style.minHeight = `${extra}px`;
		if (previous !== null && Math.abs(extra - previous) < 0.5) return;
		previous = extra;
	}
}

function sync(pairs: Pair[]): void {
	for (const { source } of pairs) source.style.minHeight = '';
	if (window.matchMedia(MOBILE_QUERY).matches) return;
	for (const pair of pairs) settle(pair);
}

function init(): void {
	const pairs = findPairs();
	if (pairs.length === 0) return;

	// A plain macrotask debounce rather than requestAnimationFrame — this
	// only needs to run after the current burst of layout-affecting changes
	// settles, not synced to a paint.
	let scheduled = false;
	function scheduleSync() {
		if (scheduled) return;
		scheduled = true;
		setTimeout(() => {
			scheduled = false;
			sync(pairs);
		}, 0);
	}

	scheduleSync();

	// A target's own size, or its position, can change for reasons that
	// have nothing to do with viewport width — the tag filter hiding a
	// sibling company/card, fonts finishing their swap, etc. — so watch
	// each target's whole track (not just the target box itself) for any
	// of that. A target outside an ApartBlock track (e.g. the `together`
	// entry a stretchNearTopOf points at) has no `.track` ancestor; fall
	// back to observing the target itself.
	const toWatch = new Set(pairs.map(({ target }) => target.closest<HTMLElement>('.track') ?? target));
	const observer = new ResizeObserver(() => scheduleSync());
	for (const el of toWatch) observer.observe(el);

	window.addEventListener('resize', scheduleSync);
	document.fonts?.ready?.then(scheduleSync).catch(() => {});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
