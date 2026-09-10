import type { ProjectMedia } from './types';

/** Showcase gallery for Might & Magic: Heroes VI (see data/timeline.ts). */
export const heroes6Media: ProjectMedia[] = [
	{
		src: '',
		kind: 'text',
		caption: "Together, we designed and built the Campaign AI system, giving level designers a dev tool to shape enemy behaviour around narrative pacing and player progression.",
		tagIds: ['gameplay', 'ai', 'narrative-design', 'systems-design', 'ip-critical-design', 'proprietary-engine', 'devtools', 'level-design'],
	},
	{
		src: 'https://www.youtube.com/watch?v=ipXY3c3wDZk',
		start: 841,
		end: 1012,
		kind: 'youtube',
		caption: 'A playthrough of the tutorial campaign.',
		tagIds: ['gameplay', 'ai', 'narrative-design', 'systems-design', 'ip-critical-design', 'proprietary-engine', 'devtools', 'level-design'],
	},
	{
		src: '',
		kind: 'text',
		caption: "We designed and refined boss abilities and behaviours to deliver distinctive challenges shaped by each encounter’s narrative context.",
		tagIds: ['gameplay', 'ai', 'encounter', 'systems-design', 'ip-critical-design', 'ability', 'narrative-design'],
	},
	{
		src: 'https://www.youtube.com/watch?v=EnHEfd9MFr0',
		kind: 'youtube',
		start: 64,
		end: 471,
		caption: 'Azkaal boss fight in which the player controls the boss.',
		tagIds: ['gameplay', 'ai', 'encounter', 'systems-design', 'ip-critical-design', 'ability', 'narrative-design'],
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