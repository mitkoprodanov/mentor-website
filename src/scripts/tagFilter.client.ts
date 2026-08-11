/**
 * Single-select WorkTag filter shared by the Timeline and the Projects
 * section. Clicking any linked tag highlights every matching card and dims
 * everything else — nothing hides, nothing reflows. Previously this
 * collapsed non-matching content out of the layout entirely (FLIP-animated
 * back together on clear); that made a stronger filter but obscured how
 * a skill fits into the surrounding timeline, so a click now just draws
 * the eye instead of rearranging the page.
 *
 * Only `.card`/`.project-card` actually carry `data-tags` (the person-level
 * unit of "was this skill used here"). Two structural levels above that,
 * un-taggable in their own right, dim in step with their content instead
 * of staying bright over an all-dimmed section:
 *  - a project/track row's `.node` (dot + name + info) dims once every card
 *    in that row is dimmed;
 *  - a company's header dims once every card in that company is dimmed.
 * Both are siblings of the cards they key off, not ancestors of them, so
 * their own `opacity` never compounds with a card's.
 *
 * Also dispatches a `worktagfilter` CustomEvent (detail: the active filter
 * or null) on every change, for syncSidePanels.client.ts to key its "keep
 * both side panels open while a filter is active" behavior off of.
 *
 * If none of the matches for a newly-picked filter are already on screen,
 * scrolls to the first one — the Timeline's first matching card if there is
 * one, otherwise the Projects section if a project matches instead (see
 * revealMatch). Skipped whenever a match is already visible, so picking a
 * different tag while looking at a stretch of matches doesn't yank the page
 * around for no reason.
 */

type Filter = string | null;

const CARD_SELECTOR = '.card[data-tags], .project-card[data-tags]';

let currentFilter: Filter = null;

function matchesTags(el: HTMLElement, filter: Filter): boolean {
	return filter === null || (el.dataset.tags ?? '').split(' ').includes(filter);
}

function applyHighlight(filter: Filter) {
	const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
	for (const card of cards) {
		const match = matchesTags(card, filter);
		card.classList.toggle('tf-match', filter !== null && match);
		card.classList.toggle('tf-dim', filter !== null && !match);
	}

	function dimIfAllCardsDim(containers: HTMLElement[], headerSelector: string) {
		for (const container of containers) {
			const header = container.querySelector<HTMLElement>(headerSelector);
			if (!header) continue;
			const cardsIn = Array.from(container.querySelectorAll<HTMLElement>('.card[data-tags]'));
			const allDim = filter !== null && cardsIn.length > 0 && cardsIn.every((c) => !matchesTags(c, filter));
			header.classList.toggle('tf-dim', allDim);
		}
	}

	dimIfAllCardsDim(Array.from(document.querySelectorAll<HTMLElement>('.project-row, .track-row')), '.node');
	dimIfAllCardsDim(Array.from(document.querySelectorAll<HTMLElement>('.company, .track-company')), '.company-header, .track-header');
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

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Fully contained, not just some overlap with the viewport — a match
// that's cut off along any edge still triggers the scroll below, same as
// one that's not on screen at all. The fixed navbar covers the strip right
// at the top of the viewport (y: 0 to its own height), so a card whose top
// edge only clears y=0 can still be sitting *behind* it — the effective top
// edge for "visible" is the navbar's own bottom, not the viewport's.
function isFullyInViewport(el: HTMLElement): boolean {
	const rect = el.getBoundingClientRect();
	const navbar = document.querySelector<HTMLElement>('.navbar');
	const topInset = navbar ? navbar.getBoundingClientRect().bottom : 0;
	return rect.top >= topInset && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
}

function revealMatch(filter: string) {
	// A Timeline match takes priority when a tag matches both — it's the
	// primary content, and the more specific "first matching card" scroll
	// (below) also just reads better there than Projects' plainer "scroll
	// to the section" fallback.
	// Scope each branch of CARD_SELECTOR to #timeline individually —
	// `` `#timeline ${CARD_SELECTOR}` `` would silently only scope the
	// first one, since a comma inside an interpolated selector starts a
	// whole new, unscoped compound selector rather than joining onto the
	// prefix. Moot in practice today (only ExperienceCard's `.card` actually
	// lives inside #timeline; ProjectCard's are always elsewhere and just
	// happen to carry a `.card` class too), but relying on that coincidence
	// would leave a trap for whenever it stops being true.
	const timelineMatches = Array.from(document.querySelectorAll<HTMLElement>('#timeline .card[data-tags], #timeline .project-card[data-tags]')).filter((card) =>
		matchesTags(card, filter),
	);
	if (timelineMatches.length > 0) {
		if (!timelineMatches.some(isFullyInViewport)) {
			timelineMatches[0].scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
		}
		return;
	}

	const projectsRoot = document.getElementById('projects');
	if (!projectsRoot) return;
	const hasMatchingProject = Array.from(projectsRoot.querySelectorAll<HTMLElement>('.project-card[data-tags]')).some((card) => matchesTags(card, filter));
	if (hasMatchingProject) {
		projectsRoot.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
	}
}

function setFilter(filter: Filter) {
	currentFilter = filter;

	applyHighlight(filter);

	document.body.classList.toggle('filter-active', filter !== null);
	setTagPressedState(filter);

	// syncSidePanels.client.ts keeps both side panels open (not just
	// hover-revealed) for as long as a filter is active — see the listener
	// there for why.
	window.dispatchEvent(new CustomEvent<Filter>('worktagfilter', { detail: filter }));

	updateChip('timeline-filter-chip', 'timeline-filter-chip-skill', filter);

	if (filter) revealMatch(filter);
}

function init() {
	document.addEventListener('click', (event) => {
		const target = event.target as HTMLElement;

		const tagButton = target.closest<HTMLButtonElement>('button.tag--linked[data-tag-id]');
		if (tagButton) {
			const tagId = tagButton.dataset.tagId;
			if (!tagId) return;
			setFilter(currentFilter === tagId ? null : tagId);
			// Every linked tag lives inside a side panel (see PersonCard.astro),
			// which ScrollyRegion.astro keeps open via `.side-panel:focus-within`
			// as a fallback for keyboard users tabbing in — independent of, and
			// blind to, the mouse-hover/filter-driven `is-hovered` class syncSide
			// Panels.client.ts manages. A mouse click focuses the button same as
			// activating it by keyboard does, so without this, that fallback
			// alone kept this exact panel open after moving the mouse away and
			// clearing the filter, since focus just... stayed, for no reason
			// anymore. Blurring here doesn't undo the fallback's actual job —
			// tabbing *to* the button still reveals the panel *before* this ever
			// runs — it only lets go once the button's already been activated,
			// when is-hovered (via the worktagfilter dispatch just above) is
			// already covering the same job.
			tagButton.blur();
			return;
		}

		if (target.closest('#timeline-filter-chip-clear')) {
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
