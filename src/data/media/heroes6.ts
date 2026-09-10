import type { ProjectMedia } from './types';

/** Showcase gallery for Might & Magic: Heroes VI (see data/timeline.ts). */
export const heroes6Media: ProjectMedia[] = [
	{
		src: '',
		kind: 'text',
		caption: "Together, we designed and built the Campaign AI system, giving level designers a dev tool to shape enemy behaviour around narrative pacing and player progression.",
		tagIds: ['gameplay', 'AI', 'dev-tool'],
	},
	{
		src: 'https://www.youtube.com/watch?v=gQiKPPclIzc',
		start: 1084,
		end: 1196,
		kind: 'youtube',
		caption: 'The beginning of the campaign',
		tagIds: ['ai', 'narrative-design', 'systems-design', 'ip-critical-design', 'proprietary-engine', 'devtools', 'level-design'],
	},
	{
		src: '/projects/heroes6/campaign.jpg',
		kind: 'image',
		caption: 'The adventure map.',
		tagIds: ['ai', 'systems-design', 'ip-critical-design', 'proprietary-engine', 'devtools', 'level-design'],
	},
	{
		src: '',
		kind: 'text',
		caption: "We created and refined boss abilities and behaviours to create distinctive challenges based on each encounter’s narrative context.",
		tagIds: ['gameplay', 'ability', 'AI', 'encounter', 'ip-critical-design', 'narrative-design'],
	},
	{
		src: 'https://www.youtube.com/watch?v=EnHEfd9MFr0',
		kind: 'youtube',
		start: 64,
		end: 471,
		caption: 'Azkaal boss fight in which the player controls the boss.',
		tagIds: ['ai', 'encounter', 'systems-design', 'ip-critical-design', 'ability'],
	},
	{
		src: '/projects/heroes6/abilitytree.jpg',
		kind: 'image',
		caption: 'Hero ability tree.',
		tagIds: ['progression', 'ability', 'systems-design', 'ip-critical-design', 'ui'],
	},
	{
		src: '',
		kind: 'text',
		person: 'adam',
		caption: "Designed 5 campaign levels, several multiplayer maps, and 280 combat maps.",
		tagIds: ['level-design', 'narrative-design', 'ip-critical-design', 'AI', 'dev-tool', 'proprietary-engine'],
	},
	{
		src: '/projects/heroes6/combatmap.jpg',
		kind: 'image',
		caption: 'The Bridge combat map',
		tagIds: ['ability', 'ui', 'systems-design', 'level-design', 'ip-critical-design'],
	},
];