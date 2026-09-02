import type { ProjectMedia } from './types';

/** Showcase gallery for the Hypha project (see data/projects.ts). */
export const hyphaMedia: ProjectMedia[] = [
	{
		src: '/projects/hypha/board.jpg',
		kind: 'image',
		caption: 'The starting board - neutral territory before any mycelium takes root.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ui', 'ux-design'],
	},
	{
		src: '/projects/hypha/hypha.jpg',
		kind: 'image',
		caption: 'Hyphae tiles are transparent, allowing players to stack them on top of one another.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ui', 'ux-design'],
	},
	{
		src: '/projects/hypha/endgame.jpg',
		kind: 'image',
		caption: 'The final board state after a three-player game.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ui', 'ux-design'],
	},
];
