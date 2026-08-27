/**
 * Single-select WorkTag filter shared by the Timeline and the Projects
 * section. Clicking any linked tag collapses whichever of those two sections
 * contain a match down to just the matching entries (everything else is
 * `display:none`d via `.tf-hidden`).
 *
 * The filtered result is then presented as a modal — the timeline-area is
 * lifted over a backdrop (see filterModal.client.ts / ScrollyRegion.astro) —
 * so the switch to the filtered set is instant here (no in-place FLIP reflow,
 * which would fight that lift).
 *
 * Timeline collapse cascades bottom-up: a `.card` hides if it doesn't match
 * the active tag → its row's `.node` hides if none of that row's cards remain
 * → a `.company`/`.track-company` hides if it has no visible rows → a whole
 * `.track` hides if all its companies are gone → a `.mentor-container` hides
 * if it's left empty. Projects collapse is flat: a `.project-card` hides if it
 * doesn't match.
 */

type Filter = string | null;

const TIMELINE_FLIP_SELECTOR = '.card, .node, .project-row, .track-row, .company, .track-company, .apart, .mentor-container';
const PROJECTS_SELECTOR = '.project-card';

let currentFilter: Filter = null;

function matchesTags(el: HTMLElement, filter: Filter): boolean {
	return filter === null || (el.dataset.tags ?? '').split(' ').includes(filter);
}

function computeHiddenTimelineSet(root: HTMLElement, filter: Filter): Set<Element> {
	const toHide = new Set<Element>();
	const emptyRows = new Set<Element>();

	const cards = Array.from(root.querySelectorAll<HTMLElement>('.card[data-tags]'));
	for (const card of cards) {
		if (!matchesTags(card, filter)) toHide.add(card);
	}

	const rows = Array.from(root.querySelectorAll<HTMLElement>('.project-row, .track-row'));
	for (const row of rows) {
		const rowCards = Array.from(row.querySelectorAll<HTMLElement>('.card'));
		if (rowCards.length > 0 && rowCards.every((c) => toHide.has(c))) {
			emptyRows.add(row);
			toHide.add(row);
			const node = row.querySelector('.node');
			if (node) toHide.add(node);
		}
	}

	const companies = Array.from(root.querySelectorAll<HTMLElement>('.company, .track-company'));
	for (const company of companies) {
		const rowsIn = Array.from(company.querySelectorAll<HTMLElement>('.project-row, .track-row'));
		if (rowsIn.length > 0 && rowsIn.every((r) => emptyRows.has(r))) toHide.add(company);
	}

	const tracks = Array.from(root.querySelectorAll<HTMLElement>('.track'));
	for (const track of tracks) {
		const companiesIn = Array.from(track.querySelectorAll<HTMLElement>(':scope > .track-company'));
		if (companiesIn.length > 0 && companiesIn.every((c) => toHide.has(c))) toHide.add(track);
	}

	const aparts = Array.from(root.querySelectorAll<HTMLElement>('.apart'));
	for (const apart of aparts) {
		const tracksIn = Array.from(apart.querySelectorAll<HTMLElement>(':scope > .track'));
		const visible = tracksIn.filter((t) => !toHide.has(t));
		if (tracksIn.length > 0 && visible.length === 0) toHide.add(apart);
	}

	const mentors = Array.from(root.querySelectorAll<HTMLElement>('.mentor-container'));
	for (const mentor of mentors) {
		const content = mentor.querySelector<HTMLElement>('.mentor-content');
		const entries = content ? Array.from(content.children).filter((c) => c.classList.contains('company') || c.classList.contains('apart')) : [];
		const visible = entries.filter((e) => !toHide.has(e));
		if (entries.length > 0 && visible.length === 0) toHide.add(mentor);
	}

	return toHide;
}

function computeHiddenProjectsSet(root: HTMLElement, filter: Filter): Set<Element> {
	const toHide = new Set<Element>();
	const cards = Array.from(root.querySelectorAll<HTMLElement>(`${PROJECTS_SELECTOR}[data-tags]`));
	for (const card of cards) {
		if (!matchesTags(card, filter)) toHide.add(card);
	}
	return toHide;
}

function applyFilter(root: HTMLElement, filter: Filter, animatedSelector: string, computeHidden: (root: HTMLElement, filter: Filter) => Set<Element>) {
	const toHide = computeHidden(root, filter);
	root.querySelectorAll<HTMLElement>(animatedSelector).forEach((el) => el.classList.toggle('tf-hidden', toHide.has(el)));
}

function setTagPressedState(filter: Filter) {
	document.querySelectorAll<HTMLButtonElement>('button.tag--linked').forEach((btn) => {
		btn.setAttribute('aria-pressed', String(filter !== null && btn.dataset.tagId === filter));
	});
}

function tagLabelFor(tagId: string): string {
	const btn = document.querySelector<HTMLButtonElement>(`button.tag--linked[data-tag-id="${tagId}"]`);
	return btn?.textContent?.trim() ?? tagId;
}

function updateChip(chipId: string, labelId: string, filter: Filter) {
	const chip = document.getElementById(chipId) as HTMLElement | null;
	const label = document.getElementById(labelId);
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
function updateCardTags(filter: Filter) {
	const label = filter ? tagLabelFor(filter) : '';
	document.querySelectorAll<HTMLElement>('.card-filter').forEach((el) => {
		const span = el.querySelector<HTMLElement>('[data-card-filter-label]');
		if (span) span.textContent = label;
		el.hidden = filter === null;
	});
}

function setFilter(filter: Filter) {
	currentFilter = filter;

	const timelineRoot = document.getElementById('timeline');
	if (timelineRoot) applyFilter(timelineRoot, filter, TIMELINE_FLIP_SELECTOR, computeHiddenTimelineSet);

	const projectsRoot = document.getElementById('projects');
	if (projectsRoot) applyFilter(projectsRoot, filter, PROJECTS_SELECTOR, computeHiddenProjectsSet);

	document.body.classList.toggle('filter-active', filter !== null);
	setTagPressedState(filter);

	updateChip('timeline-filter-chip', 'timeline-filter-chip-skill', filter);
	updateCardTags(filter);
}

function init() {
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
