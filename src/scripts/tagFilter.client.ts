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
	});

	// Collapse away any column / group left with no visible cards.
	const cols = Array.from(root.querySelectorAll<HTMLElement>('[data-fr-col]'));
	cols.forEach((col) => {
		col.hidden = !col.querySelector('[data-fr-card]:not([hidden])');
	});
	const solo = root.querySelector<HTMLElement>('[data-fr-solo]');
	// Each solo column stays pinned to its own half (see .fr-col--left/right) so a
	// one-person project always reads on that person's side, the empty half making
	// the solo attribution unmistakable — even when only one column has matches.
	if (solo) solo.hidden = !solo.querySelector('[data-fr-card]:not([hidden])');
	const both = root.querySelector<HTMLElement>('[data-fr-group="both"]');
	if (both) both.hidden = !both.querySelector('[data-fr-card]:not([hidden])');

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
	const chip = document.getElementById('timeline-filter-chip');
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
	currentFilter = filter;

	// Apply results before the modal opens so the panel is already narrowed to
	// the matching set when it lifts in.
	applyResults(filter);

	document.body.classList.toggle('filter-active', filter !== null);
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
