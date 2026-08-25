import type { ProjectMedia } from './types';

/** Showcase gallery for the Hypha project (see data/projects.ts). */
export const hyphaMedia: ProjectMedia[] = [
	{
		src: '/projects/hypha/board.jpg',
		kind: 'image',
		caption: 'The starting board — neutral territory before any mycelium takes root.',
	},
	{
		src: '/projects/hypha/spread.gif',
		kind: 'gif',
		caption: 'Mycelium spreading node to node as rival networks race to claim ground.',
	},
	{
		src: '/projects/hypha/clash.jpg',
		kind: 'image',
		caption: 'A confrontation — two fungal networks meeting over a contested node.',
	},
];
