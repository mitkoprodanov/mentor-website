/**
 * Single-select WorkTag filter shared by the Timeline and the Projects
 * section. Clicking any linked tag (on a PersonCard or a ProjectCard)
 * collapses whichever of those two sections contain a match down to just
 * the matching entries — everything else fades out first, then the
 * survivors slide smoothly into their new positions (the FLIP technique:
 * record rects before the DOM mutation, then invert-and-play the delta as
 * a transform).
 *
 * Timeline collapse cascades bottom-up: a `.card` hides if it doesn't match
 * the active tag → its row's `.node` (dot + label) hides if none of that
 * row's cards remain → a `.company`/`.track-company` hides if it has no
 * visible rows → a whole `.track` (one side of an ApartBlock) hides if all
 * its companies are gone (the other track just keeps its own column — the
 * `.apart` grid always stays two columns, whichever side is/isn't visible)
 * → a `.mentor-container` hides if it's left empty.
 *
 * Projects collapse is flat: a `.project-card` hides if it doesn't match.
 */

type Filter = string | null;

const TIMELINE_FLIP_SELECTOR = '.card, .node, .project-row, .track-row, .company, .track-company, .apart, .mentor-container';
const PROJECTS_SELECTOR = '.project-card';

const EXIT_MS = 200;
const EXIT_STAGGER_MS = 18;
const EXIT_STAGGER_CAP = 6;
const FLIP_MS = 380;

let currentFilter: Filter = null;

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

function flipStayersAndRevealEnterers(staying: HTMLElement[], beforeRects: Map<HTMLElement, DOMRect>, entering: HTMLElement[]) {
	requestAnimationFrame(() => {
		staying.forEach((el) => {
			const before = beforeRects.get(el);
			if (!before) return;
			const after = el.getBoundingClientRect();
			const dx = before.left - after.left;
			const dy = before.top - after.top;
			if (dx || dy) {
				el.style.transition = 'none';
				el.style.transform = `translate(${dx}px, ${dy}px)`;
				void el.offsetWidth;
			}
		});

		requestAnimationFrame(() => {
			staying.forEach((el) => {
				if (!beforeRects.has(el)) return;
				el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
				el.style.transform = '';
			});
			entering.forEach((el) => el.classList.remove('tf-enter-from'));

			window.setTimeout(() => {
				staying.forEach((el) => {
					el.style.transition = '';
				});
			}, FLIP_MS + 50);
		});
	});
}

function applyFilter(
	root: HTMLElement,
	filter: Filter,
	opts: {
		computeHidden: (root: HTMLElement, filter: Filter) => Set<Element>;
		flipSelector: string;
		animatedSelector: string;
		onApplied?: (toHide: Set<Element>) => void;
	},
) {
	const toHide = opts.computeHidden(root, filter);
	const animated = Array.from(root.querySelectorAll<HTMLElement>(opts.animatedSelector));

	if (prefersReducedMotion()) {
		animated.forEach((el) => el.classList.toggle('tf-hidden', toHide.has(el)));
		opts.onApplied?.(toHide);
		return;
	}

	const leaving: HTMLElement[] = [];
	const entering: HTMLElement[] = [];
	const staying: HTMLElement[] = [];

	for (const el of animated) {
		const wasHidden = el.classList.contains('tf-hidden');
		const willHide = toHide.has(el);
		if (!wasHidden && willHide) leaving.push(el);
		else if (wasHidden && !willHide) entering.push(el);
		else if (!wasHidden && !willHide) staying.push(el);
	}

	const beforeRects = new Map<HTMLElement, DOMRect>();
	staying.filter((el) => el.matches(opts.flipSelector)).forEach((el) => beforeRects.set(el, el.getBoundingClientRect()));

	if (leaving.length === 0) {
		entering.forEach((el) => {
			el.classList.remove('tf-hidden');
			el.classList.add('tf-enter-from');
		});
		opts.onApplied?.(toHide);
		flipStayersAndRevealEnterers(staying, beforeRects, entering);
		return;
	}

	leaving.forEach((el, i) => {
		const delay = Math.min(i, EXIT_STAGGER_CAP) * EXIT_STAGGER_MS;
		el.style.transitionDelay = `${delay}ms`;
		el.classList.add('tf-leaving');
	});
	const maxStagger = Math.min(leaving.length - 1, EXIT_STAGGER_CAP) * EXIT_STAGGER_MS;

	window.setTimeout(
		() => {
			leaving.forEach((el) => {
				el.classList.remove('tf-leaving');
				el.classList.add('tf-hidden');
				el.style.transitionDelay = '';
			});
			entering.forEach((el) => {
				el.classList.remove('tf-hidden');
				el.classList.add('tf-enter-from');
			});
			opts.onApplied?.(toHide);
			flipStayersAndRevealEnterers(staying, beforeRects, entering);
		},
		EXIT_MS + maxStagger,
	);
}

function applyTimelineFilter(root: HTMLElement, filter: Filter) {
	applyFilter(root, filter, {
		computeHidden: computeHiddenTimelineSet,
		flipSelector: TIMELINE_FLIP_SELECTOR,
		animatedSelector: TIMELINE_FLIP_SELECTOR,
	});
}

function applyProjectsFilter(root: HTMLElement, filter: Filter) {
	applyFilter(root, filter, {
		computeHidden: computeHiddenProjectsSet,
		flipSelector: PROJECTS_SELECTOR,
		animatedSelector: PROJECTS_SELECTOR,
	});
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

function setFilter(filter: Filter) {
	currentFilter = filter;

	const timelineRoot = document.getElementById('timeline');
	if (timelineRoot) applyTimelineFilter(timelineRoot, filter);

	const projectsRoot = document.getElementById('projects');
	if (projectsRoot) applyProjectsFilter(projectsRoot, filter);

	document.body.classList.toggle('filter-active', filter !== null);
	setTagPressedState(filter);

	updateChip('timeline-filter-chip', 'timeline-filter-chip-skill', filter);

	if (filter && projectsRoot) {
		const hasMatchingProject = Array.from(projectsRoot.querySelectorAll<HTMLElement>(`${PROJECTS_SELECTOR}[data-tags]`)).some((card) =>
			(card.dataset.tags ?? '').split(' ').includes(filter),
		);
		if (hasMatchingProject) {
			projectsRoot.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
		}
	}
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
