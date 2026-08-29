import type { ProjectMedia } from './types';

/** Showcase gallery for Supernova (see data/timeline.ts). */
export const supernovaMedia: ProjectMedia[] = [
	{
		src: '/projects/supernova/waves.gif',
		kind: 'gif',
		caption: 'Wave army movement across the field.',
		tagIds: ['crowd-sim-pathfinding', 'gameplay-ai'],
	},
	{
		src: '/projects/supernova/tech-tree.jpg',
		kind: 'image',
		caption: 'The tech tree and hero ability kits.',
		tagIds: ['tech-trees-progression', 'abilities-status-effects'],
	},
];
