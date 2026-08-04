/**
 * Single-select tech/knowledge filter for the Timeline. Clicking a linked
 * tag on a PersonCard collapses the Timeline down to just the experiences
 * that used it — everything else fades out first, then the survivors slide
 * smoothly into their new positions (the FLIP technique: record rects
 * before the DOM mutation, then invert-and-play the delta as a transform).
 *
 * The collapse cascades bottom-up: a `.card` hides if it doesn't match →
 * its row's `.node` (dot + label) hides if none of that row's cards remain →
 * a `.company`/`.track-company` hides if it has no visible rows → a whole
 * `.track` (one side of an ApartBlock) hides if all its companies are gone,
 * collapsing the `.apart` grid to one column if only one side survives →
 * a `.mentor-container` hides if it's left empty → a `.fork-connector`
 * hides if either DOM-adjacent entry block is now empty.
 */

type Filter = { person: string; skill: string } | null;

const FLIP_SELECTOR = '.card, .node, .company, .track-company, .apart, .mentor-container';
const ANIMATED_SELECTOR = `${FLIP_SELECTOR}, .fork-connector`;

const EXIT_MS = 200;
const EXIT_STAGGER_MS = 18;
const EXIT_STAGGER_CAP = 6;
const FLIP_MS = 380;

let currentFilter: Filter = null;

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function findNeighbor(start: Element, prop: 'previousElementSibling' | 'nextElementSibling', root: Element): Element | null {
	let node: Element | null = start;
	while (node && node !== root) {
		const sibling = node[prop];
		if (sibling) return sibling;
		node = node.parentElement;
	}
	return null;
}

function computeHiddenSet(root: HTMLElement, filter: Filter): Set<Element> {
	const toHide = new Set<Element>();
	const emptyRows = new Set<Element>();

	const cards = Array.from(root.querySelectorAll<HTMLElement>('.card[data-person]'));
	for (const card of cards) {
		const matches = filter === null || (card.dataset.person === filter.person && (card.dataset.skills ?? '').split(' ').includes(filter.skill));
		if (!matches) toHide.add(card);
	}

	const rows = Array.from(root.querySelectorAll<HTMLElement>('.project-row, .track-row'));
	for (const row of rows) {
		const rowCards = Array.from(row.querySelectorAll<HTMLElement>('.card'));
		if (rowCards.length > 0 && rowCards.every((c) => toHide.has(c))) {
			emptyRows.add(row);
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

	const connectors = Array.from(root.querySelectorAll<HTMLElement>('.fork-connector'));
	for (const connector of connectors) {
		const prev = findNeighbor(connector, 'previousElementSibling', root);
		const next = findNeighbor(connector, 'nextElementSibling', root);
		const prevEmpty = prev ? toHide.has(prev) : false;
		const nextEmpty = next ? toHide.has(next) : false;
		if (prevEmpty || nextEmpty) toHide.add(connector);
	}

	return toHide;
}

function updateApartSingleModifier(root: HTMLElement, toHide: Set<Element>) {
	const aparts = Array.from(root.querySelectorAll<HTMLElement>('.apart'));
	for (const apart of aparts) {
		const tracksIn = Array.from(apart.querySelectorAll<HTMLElement>(':scope > .track'));
		const visible = tracksIn.filter((t) => !toHide.has(t));
		apart.classList.toggle('apart--single', visible.length === 1);
	}
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

function applyFilter(root: HTMLElement, filter: Filter) {
	const toHide = computeHiddenSet(root, filter);
	const animated = Array.from(root.querySelectorAll<HTMLElement>(ANIMATED_SELECTOR));

	if (prefersReducedMotion()) {
		animated.forEach((el) => el.classList.toggle('tf-hidden', toHide.has(el)));
		updateApartSingleModifier(root, toHide);
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
	staying.filter((el) => el.matches(FLIP_SELECTOR)).forEach((el) => beforeRects.set(el, el.getBoundingClientRect()));

	if (leaving.length === 0) {
		// Nothing to fade out first — reveal/reflow can start right away.
		entering.forEach((el) => {
			el.classList.remove('tf-hidden');
			el.classList.add('tf-enter-from');
		});
		updateApartSingleModifier(root, toHide);
		flipStayersAndRevealEnterers(staying, beforeRects, entering);
		return;
	}

	// Let departures fully fade out (with their stagger) before the layout
	// closes the gap they leave behind — avoids a visible "pop" mid-fade.
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
			updateApartSingleModifier(root, toHide);
			flipStayersAndRevealEnterers(staying, beforeRects, entering);
		},
		EXIT_MS + maxStagger,
	);
}

function setTagPressedState(skillSlug: string | null, personId: string | null) {
	document.querySelectorAll<HTMLButtonElement>('button.tag--linked').forEach((btn) => {
		const isSelected = skillSlug !== null && btn.dataset.skill === skillSlug && btn.dataset.person === personId;
		btn.setAttribute('aria-pressed', String(isSelected));
	});
}

function skillLabelFor(personId: string, skillSlug: string): string {
	const btn = document.querySelector<HTMLButtonElement>(`button.tag--linked[data-person="${personId}"][data-skill="${skillSlug}"]`);
	return btn?.textContent?.trim() ?? skillSlug;
}

function setFilter(filter: Filter) {
	currentFilter = filter;
	const root = document.getElementById('timeline');
	if (root) applyFilter(root, filter);

	document.body.classList.toggle('filter-active', filter !== null);
	setTagPressedState(filter?.skill ?? null, filter?.person ?? null);

	const chip = document.getElementById('timeline-filter-chip');
	const chipSkill = document.getElementById('timeline-filter-chip-skill');
	if (chip && chipSkill) {
		if (filter) {
			chipSkill.textContent = skillLabelFor(filter.person, filter.skill);
			chip.hidden = false;
		} else {
			chip.hidden = true;
		}
	}
}

function init() {
	document.addEventListener('click', (event) => {
		const target = event.target as HTMLElement;

		const tagButton = target.closest<HTMLButtonElement>('button.tag--linked');
		if (tagButton) {
			const { person, skill } = tagButton.dataset;
			if (!person || !skill) return;
			const isSame = currentFilter?.person === person && currentFilter?.skill === skill;
			setFilter(isSame ? null : { person, skill });
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
