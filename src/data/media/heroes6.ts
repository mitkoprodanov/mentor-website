import type { ProjectMedia } from './types';

/** Showcase gallery for Might & Magic: Heroes VI (see data/timeline.ts). */
export const heroes6Media: ProjectMedia[] = [
	{
		src: 'https://www.youtube.com/watch?v=EnHEfd9MFr0',
		kind: 'youtube',
		start: 64,
		end: 471,
		caption: 'Azkaal boss fight in which the player controls the boss.',
		tagIds: ['ai', 'encounter', 'systems-design', 'ip-critical-design', 'ability'],
	},
	{
		src: '/projects/heroes6/campaign.jpg',
		kind: 'image',
		caption: 'The adventure map.',
		tagIds: ['ai', 'systems-design', 'ip-critical-design', 'proprietary-engine', 'devtools', 'level-design'],
	},
	{
		src: '/projects/heroes6/abilitytree.jpg',
		kind: 'image',
		caption: 'Hero ability tree.',
		tagIds: ['progression', 'ability', 'systems-design', 'ip-critical-design', 'ui'],
	},
	{
		src: '/projects/heroes6/combatmap.jpg',
		kind: 'image',
		caption: 'The Bridge combat map',
		tagIds: ['ability', 'ui', 'systems-design', 'level-design', 'ip-critical-design'],
	},
];