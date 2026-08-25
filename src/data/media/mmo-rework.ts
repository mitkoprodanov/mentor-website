import type { ProjectMedia } from './types';

/** Showcase gallery for the MMO Microservices Rework (see data/timeline.ts). */
export const mmoReworkMedia: ProjectMedia[] = [
	{
		src: '/projects/mmo-rework/architecture.jpg',
		kind: 'image',
		caption: 'The reworked microservices architecture.',
	},
	{
		src: '/projects/mmo-rework/scaling.gif',
		kind: 'gif',
		caption: 'Services scaling out under load.',
	},
];
