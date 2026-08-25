import type { ProjectMedia } from './types';

/** Showcase gallery for the Biobot project (see data/projects.ts). */
export const biobotMedia: ProjectMedia[] = [
	{
		src: '/projects/biobot/cards.gif',
		kind: 'gif',
		caption: 'Transparent, stackable cards layering up to build a biorobot.',
	},
	{
		src: '/projects/biobot/tableau.jpg',
		kind: 'image',
		caption: 'A mid-game tableau where organic tissue and robotics interlock.',
	},
	{
		src: '/projects/biobot/award.jpg',
		kind: 'image',
		caption: 'Grand Prize among 33 entries at the 2026 Qubit Spring competition.',
	},
];
