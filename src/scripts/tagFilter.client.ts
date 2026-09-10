/**
 * Single-select WorkTag filter. Clicking any linked tag opens the detailed
 * results view (FilterResults.astro) — lifted into a modal over a dimmed
 * backdrop (see filterModal.client.ts / ScrollyRegion.astro) — showing just the
 * Projects that match, grouped by who worked on them rather than the timeline's
 * company/fork layout.
 *
 * A Project matches if its `data-project-tags` (the union of its experience and
 * media tags) includes the active tag. Inside a matching Project only the media
 * whose own `data-media-tags` includes the tag stays shown — so the gallery
 * narrows to just the relevant clips — and a Project whose gallery ends up empty
 * simply drops the empty gallery frame. Empty groups/columns collapse away.
 */

type Filter = string | null;

let currentFilter: Filter = null;

function hasTag(tags: string | undefined, filter: string): boolean {
	return (tags ?? '').split(' ').filter(Boolean).includes(filter);
}

/** Show only the matching Projects (and, within them, the matching media). */
function applyResults(filter: Filter): void {
	const root = document.getElementById('filter-results');
	if (!root || filter === null) return;

	let anyVisible = false;

	root.querySelectorAll<HTMLElement>('[data-fr-card]').forEach((card) => {
		const show = hasTag(card.dataset.projectTags, filter);
		card.hidden = !show;
		if (!show) return;
		anyVisible = true;

		// Narrow the gallery to media carrying this tag; drop the frame if none.
		const gallery = card.querySelector<HTMLElement>('[data-gallery]');
		let visibleShots = 0;
		card.querySelectorAll<HTMLElement>('.shot[data-media-tags]').forEach((shot) => {
			const shown = hasTag(shot.dataset.mediaTags, filter);
			shot.classList.toggle('fr-hidden', !shown);
			if (shown) visibleShots += 1;
		});
		if (gallery) gallery.classList.toggle('fr-gallery-empty', visibleShots === 0);

		// Hide each person's experience block unless that experience itself
		// carries the tag — the surrounding project may match through someone
		// else's experience or a media item, but only the relevant person's
		// contribution should read here.
		card.querySelectorAll<HTMLElement>('.modal-exp[data-exp-tags]').forEach((exp) => {
			exp.classList.toggle('fr-hidden', !hasTag(exp.dataset.expTags, filter));
		});
	});

	// All cards live in one flat stack now (see components/projects/FilterResults.astro),
	// so there are no column / group wrappers to collapse — an unmatched
	// card just hides itself and the surrounding stack reflows.

	const empty = root.querySelector<HTMLElement>('[data-fr-empty]');
	if (empty) empty.hidden = anyVisible;
}

function setTagPressedState(filter: Filter): void {
	document.querySelectorAll<HTMLButtonElement>('button.tag--linked').forEach((btn) => {
		btn.setAttribute('aria-pressed', String(filter !== null && btn.dataset.tagId === filter));
	});
}

function tagLabelFor(tagId: string): string {
	const btn = document.querySelector<HTMLButtonElement>(`button.tag--linked[data-tag-id="${tagId}"]`);
	return btn?.textContent?.trim() ?? tagId;
}

function updateChip(filter: Filter): void {
	// The whole "Filtered by … ✕" chip is a single button now (see
	// FilterResults.astro) — clicking anywhere on it clears the filter — so
	// there is only one element to toggle.
	const chip = document.getElementById('timeline-filter-chip-clear');
	const label = document.getElementById('timeline-filter-chip-skill');
	if (!chip || !label) return;
	if (filter) {
		label.textContent = tagLabelFor(filter);
		chip.hidden = false;
	} else {
		chip.hidden = true;
	}
}

/** Echo the active skill as a pill under each person card in the sticky bar
 *  (see ScrollyRegion.astro's .card-filter). */
function updateCardTags(filter: Filter): void {
	const label = filter ? tagLabelFor(filter) : '';
	document.querySelectorAll<HTMLElement>('.card-filter').forEach((el) => {
		const span = el.querySelector<HTMLElement>('[data-card-filter-label]');
		if (span) span.textContent = label;
		el.hidden = filter === null;
	});
}

function setFilter(filter: Filter): void {
	const wasActive = currentFilter !== null;
	const willBeActive = filter !== null;
	currentFilter = filter;

	// Apply results before the modal opens so the panel is already narrowed to
	// the matching set when it lifts in.
	applyResults(filter);

	// Snapshot scroll BEFORE anything about the filter changes. Once
	// filter-active is set, CSS synchronously hides #timeline and lifts
	// .timeline-area to position:fixed, collapsing page height — the browser
	// then clamps window.scrollY and queues a scroll event that would poison
	// any later reading. filterModal.client.ts owns the actual lock/unlock and
	// listens for these events so its work is synchronous with the class
	// toggle (no MutationObserver microtask gap for other scripts to slip
	// scroll updates into).
	if (!wasActive && willBeActive) {
		// If the click came from inside a hovered/opened person card, the sticky
		// bar has just grown by ~700px to show the skills panel, and the browser
		// has scroll-anchored window.scrollY DOWN to keep the visible anchor
		// stable. That anchored Y is a phantom — it exists only while the panel
		// is up, and restoring to it on close leaves the reader ~700px below
		// where they started. panelToggle exposes the pre-reveal Y for exactly
		// this case; fall back to window.scrollY for tag clicks that happen
		// without a reveal up (e.g. inside the filter results modal).
		const preReveal = (window as unknown as { __preRevealScrollY?: () => number | null }).__preRevealScrollY?.();
		const capturedY = typeof preReveal === 'number' ? preReveal : window.scrollY;
		document.dispatchEvent(new CustomEvent('filter:willopen', { detail: { scrollY: capturedY } }));
	}

	document.body.classList.toggle('filter-active', filter !== null);

	if (!wasActive && willBeActive) {
		document.dispatchEvent(new CustomEvent('filter:opened'));
	} else if (wasActive && !willBeActive) {
		document.dispatchEvent(new CustomEvent('filter:closed'));
	}
	setTagPressedState(filter);
	updateChip(filter);
	updateCardTags(filter);

	// Let the media embeds retarget to whatever's now visible (see
	// projectModal.client.ts — pauses/activates YouTube in the results panel).
	document.dispatchEvent(new CustomEvent('filter:change', { detail: { active: filter !== null } }));
}

function init(): void {
	document.addEventListener('click', (event) => {
		const target = event.target as HTMLElement;

		const tagButton = target.closest<HTMLButtonElement>('button.tag--linked[data-tag-id]');
		if (tagButton) {
			const tagId = tagButton.dataset.tagId;
			if (!tagId) return;
			setFilter(currentFilter === tagId ? null : tagId);
			return;
		}

		if (target.closest('#timeline-filter-chip-clear')) {
			setFilter(null);
			return;
		}

		// The active-skill pill echoed under each person card clears the filter.
		if (target.closest('.card-filter-tag')) {
			setFilter(null);
		}
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && currentFilter !== null) setFilter(null);
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
