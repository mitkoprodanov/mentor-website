/**
 * Central registry of "WorkTags" — a single categorized, filterable concept
 * shared by Person tag groups (formerly `skillGroups`), Timeline Experiences,
 * and Projects. A tag renders as a clickable filter button wherever it's used
 * if it's referenced by at least one Experience or Project (see
 * `getLinkedTagIds`); otherwise it renders as a plain, non-interactive label.
 */

import { timeline, type CompanyDef } from './timeline';

export interface WorkTag {
	id: string;
	label: string;
	/** e.g. "Languages", "Engines", "AI", "Genre", "Award" — grouping is derived from this at render time. */
	category: string;
	/**
	 * Position in the canonical order — auto-assigned from this file's list
	 * below. Any surface that renders a list of tags (a project's detail pills,
	 * the media filter's tag summary, a person card's skills) sorts by this
	 * index, so tag order always mirrors the way they're written here,
	 * regardless of the order they happened to be attached to a project,
	 * experience, or media item.
	 */
	index: number;
}

// Written without indexes; the index of each tag is its position in this list.
// A single source of truth so re-ordering just means dragging a line up or
// down — the numeric index falls out below and everything downstream re-sorts.
const rawTags: Omit<WorkTag, 'index'>[] = [
	// Design
	{ id: 'systems-design', label: 'Systems Design', category: 'Design' },
	{ id: 'level-design', label: 'Level Design', category: 'Design' },
	{ id: 'ip-critical-design', label: 'IP-Critical Design', category: 'Design' },
	{ id: 'ux-design', label: 'UX Design', category: 'Design' },
	{ id: 'narrative-design', label: 'Narrative Design', category: 'Design' },
	{ id: 'puzzle-design', label: 'Puzzle Design', category: 'Design' },
	{ id: 'board-game-design', label: 'Board Game Design', category: 'Design' },
	{ id: 'balance', label: 'Balance', category: 'Design' },

	// Game Systems
	{ id: 'gameplay', label: 'Gameplay', category: 'Game Systems' },
	{ id: 'ability', label: 'Ability', category: 'Game Systems' },
	{ id: 'encounter', label: 'Encounter', category: 'Game Systems' },
	{ id: 'navigation', label: 'Navigation', category: 'Game Systems' },
	{ id: 'ai', label: 'AI', category: 'Game Systems' },
	{ id: 'progression', label: 'Progression', category: 'Game Systems' },
	{ id: 'metagame', label: 'Metagame', category: 'Game Systems' },
	{ id: 'ui', label: 'UI', category: 'Game Systems' },
	{ id: 'network', label: 'Network', category: 'Game Systems' },
	{ id: 'devtools', label: 'DevTools', category: 'Game Systems' },

	// Platform
	{ id: 'proprietary-engine', label: 'Proprietary Engine', category: 'Platform' },
	{ id: 'unreal-engine', label: 'Unreal Engine', category: 'Platform' },
	{ id: 'board-game', label: 'Board Game', category: 'Platform' },

	// Process
	{ id: 'co-dev-teams', label: 'Co-dev Teams', category: 'Process' },
	{ id: 'prototyping', label: 'Prototyping', category: 'Process' },
	{ id: 'playtesting', label: 'Playtesting', category: 'Process' },
	{ id: 'agile', label: 'Agile', category: 'Process' },

	// Tech
	{ id: 'unreal-gas', label: 'Unreal GAS', category: 'Tech' },
	{ id: 'unreal-eqs', label: 'Unreal EQS', category: 'Tech' },
	{ id: 'eos', label: 'EOS', category: 'Tech' },
	{ id: 'unreal-gamesync', label: 'Unreal GameSync', category: 'Tech' },
	{ id: 'blueprint-scripting', label: 'Blueprint Scripting', category: 'Tech' },
	{ id: 'microservices', label: 'Microservices', category: 'Tech' },
	{ id: 'mobile-development', label: 'Mobile Development', category: 'Tech' },
	{ id: 'clean-code', label: 'Clean Code', category: 'Tech' },
];

export const tags: WorkTag[] = rawTags.map((tag, index) => ({ ...tag, index }));

const tagsById = new Map(tags.map((tag) => [tag.id, tag]));

export function getTag(id: string): WorkTag {
	const tag = tagsById.get(id);
	if (!tag) throw new Error(`Unknown tag id: ${id}`);
	return tag;
}

/**
 * Sort a list of tag ids by each tag's canonical `index` (its position in the
 * `rawTags` list above). Use this anywhere a set of tags renders as a visible
 * list — a project's detail pills, the media filter's tag summary, a person
 * card's skills — so tag order always mirrors the way they're written in this
 * file, regardless of the order they were attached to a project/experience/
 * media item. Unknown ids are dropped rather than throwing (they'd never reach
 * a render surface anyway; `getTag` guards call sites that expect one).
 */
export function sortTagIdsByIndex(tagIds: readonly string[]): string[] {
	return [...tagIds]
		.filter((id) => tagsById.has(id))
		.sort((a, b) => getTag(a).index - getTag(b).index);
}

/**
 * Groups tag ids by category, with tags inside each category sorted by their
 * canonical `index`. Categories appear in the order they're first mentioned in
 * the input — which, when the input has already been sorted by `index`, is the
 * category order in `rawTags`.
 */
export function groupTagsByCategory(tagIds: string[]): { category: string; tags: WorkTag[] }[] {
	const groups: { category: string; tags: WorkTag[] }[] = [];
	const groupByCategory = new Map<string, WorkTag[]>();

	for (const tagId of sortTagIdsByIndex(tagIds)) {
		const tag = getTag(tagId);
		let group = groupByCategory.get(tag.category);
		if (!group) {
			group = [];
			groupByCategory.set(tag.category, group);
			groups.push({ category: tag.category, tags: group });
		}
		group.push(tag);
	}

	return groups;
}

/** Tag ids referenced by at least one Timeline Experience or Project — these render as clickable filter buttons. */
export function getLinkedTagIds(): Set<string> {
	const ids = new Set<string>();

	const collectCompany = (company: CompanyDef) => {
		for (const project of company.projects) {
			for (const ref of project.experiences) {
				for (const tagId of ref.tagIds ?? []) ids.add(tagId);
			}
			// Media items carry their own tags too (see ProjectMedia.tagIds) — a
			// tag used only by a project's media still counts as linked, so it
			// renders as a clickable filter and can surface that project in the
			// results view (see FilterResults.astro).
			for (const media of project.media ?? []) {
				for (const tagId of media.tagIds ?? []) ids.add(tagId);
			}
		}
	};

	for (const entry of timeline) {
		if (entry.kind === 'together') {
			collectCompany(entry.company);
		} else {
			entry.mitko.forEach(collectCompany);
			entry.adam.forEach(collectCompany);
		}
	}

	return ids;
}
