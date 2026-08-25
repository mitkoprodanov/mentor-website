import type { ProjectMedia } from './types';

/**
 * Showcase gallery for Mandragora: Whispers of the Witch Tree (see
 * data/timeline.ts). Shared by both ProjectDef entries of this project
 * (`mandragora-early` and `mandragora`).
 */
export const mandragoraMedia: ProjectMedia[] = [
	{
		src: '/projects/mandragora/boss.jpg',
		kind: 'image',
		caption: 'A boss encounter in the Action-RPG.',
	},
	{
		src: '/projects/mandragora/talents.gif',
		kind: 'gif',
		caption: 'Navigating the talent trees.',
	},
	{
		src: '/projects/mandragora/ui.jpg',
		kind: 'image',
		caption: 'The reworked UI/UX in action.',
	},
];
