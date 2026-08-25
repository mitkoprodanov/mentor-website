import type { ProjectMedia } from './types';

/**
 * Showcase gallery for Around (see data/timeline.ts). Shared by both
 * ProjectDef entries of this project (`around-mitko` and `around-adam`).
 */
export const aroundMedia: ProjectMedia[] = [
	{
		src: '/projects/around/scene.jpg',
		kind: 'image',
		caption: 'A hand-painted point-and-click scene.',
	},
	{
		src: '/projects/around/dialogue.gif',
		kind: 'gif',
		caption: 'Branching dialogue in UE4 Blueprint.',
	},
];
