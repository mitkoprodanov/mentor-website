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
}

export const tags: WorkTag[] = [
	// Languages
	{ id: 'c', label: 'C', category: 'Languages' },
	{ id: 'cpp', label: 'C++', category: 'Languages' },
	{ id: 'csharp', label: 'C#', category: 'Languages' },

	// Unreal
	{ id: 'gas', label: 'Gameplay Ability System (GAS)', category: 'Unreal' },
	{ id: 'ue-blueprint', label: 'UE Blueprint', category: 'Unreal' },

	// Engines
	{ id: 'unity', label: 'Unity', category: 'Engines' },
	{ id: 'lumberyard', label: 'Lumberyard', category: 'Engines' },
	{ id: 'tabletop', label: 'Tabletop', category: 'Engines' },

	// AI
	{ id: 'gameplay-ai', label: 'Gameplay AI', category: 'AI' },
	{ id: 'crowd-sim-pathfinding', label: 'Crowd Simulation & Pathfinding', category: 'AI' },
	{ id: 'tensorflow-dl', label: 'TensorFlow / Deep Learning', category: 'AI' },

	// Gameplay
	{ id: 'abilities-status-effects', label: 'Abilities & Status Effects', category: 'Gameplay' },
	{ id: 'tech-trees-progression', label: 'Tech Trees & Progression', category: 'Gameplay' },

	// Graphics
	{ id: 'shader-programming', label: 'Shader Programming (HLSL/GLSL/Cg)', category: 'Graphics' },
	{ id: 'opengl', label: 'OpenGL', category: 'Graphics' },
	{ id: 'directx', label: 'DirectX', category: 'Graphics' },

	// Practices
	{ id: 'mobile-dev', label: 'Mobile Development', category: 'Practices' },
	{ id: 'solid-clean-code', label: 'SOLID / Clean Code', category: 'Practices' },
	{ id: 'agile', label: 'Agile', category: 'Practices' },

	// Design
	{ id: 'systems-level-design', label: 'Systems & Level Design', category: 'Design' },
	{ id: 'encounter-design', label: 'Encounter Design', category: 'Design' },

	// UI
	{ id: 'ui-ux-design', label: 'UI/UX Design', category: 'UI' },

	// Process
	{ id: 'agile-scrum', label: 'Agile/Scrum', category: 'Process' },

	// Genre (Projects)
	{ id: 'strategy', label: 'Strategy', category: 'Genre' },
	{ id: 'board-game', label: 'Board Game', category: 'Genre' },
	{ id: 'card-game', label: 'Card Game', category: 'Genre' },

	// Award
	{ id: 'qubit-spring-1st-place', label: '1st Place — Qubit Spring Card Game Design Competition', category: 'Award' },
];

const tagsById = new Map(tags.map((tag) => [tag.id, tag]));

export function getTag(id: string): WorkTag {
	const tag = tagsById.get(id);
	if (!tag) throw new Error(`Unknown tag id: ${id}`);
	return tag;
}

/** Groups tag ids by category, preserving first-occurrence order (so list order controls display order). */
export function groupTagsByCategory(tagIds: string[]): { category: string; tags: WorkTag[] }[] {
	const groups: { category: string; tags: WorkTag[] }[] = [];
	const groupByCategory = new Map<string, WorkTag[]>();

	for (const tagId of tagIds) {
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
