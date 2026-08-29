import type { ProjectMedia } from './types';

/** Showcase gallery for Might & Magic: Heroes VI (see data/timeline.ts). */
export const heroes6Media: ProjectMedia[] = [
	{
		src: 'https://www.youtube.com/watch?v=EnHEfd9MFr0',
		kind: 'youtube',
		start: 62,
		end: 120,
		caption: 'Might & Magic: Heroes VI — gameplay.',
		tagIds: ['gameplay-ai'],
	},
	{
		src: '/projects/heroes6/ai.gif',
		kind: 'gif',
		caption: 'Campaign AI planning a turn.',
		tagIds: ['gameplay-ai'],
	},
	{
		src: '/projects/heroes6/abilities.jpg',
		kind: 'image',
		caption: 'Hero abilities and the tutorial system.',
		tagIds: ['ui-ux-design', 'systems-level-design'],
	},
];
