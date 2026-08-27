import type { ProjectMedia } from './types';

/**
 * Showcase gallery for Around (see data/timeline.ts). Shared by both
 * ProjectDef entries of this project (`around-mitko` and `around-adam`).
 */
export const aroundMedia: ProjectMedia[] = [
	{
		src: 'https://www.facebook.com/reel/291274308860973',
		kind: 'facebook-reel',
		caption: 'Around — gameplay reel.',
	},
	{
		src: '/projects/around/dialogue.gif',
		kind: 'gif',
		caption: 'Branching dialogue in UE4 Blueprint.',
	},
];
