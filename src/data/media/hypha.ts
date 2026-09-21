import type { ProjectMedia } from './types';

/** Showcase gallery for the Hypha project (see data/projects.ts). */
export const hyphaMedia: ProjectMedia[] = [
	{
		src: '',
		kind: 'text',
		person: 'mitko',
		caption: 'Co-designed and polished several core mechanics and variations iteratively, guided by playtesting and the broader game vision.',
		tagIds: ['board-game-design', 'gameplay', 'board-game', 'prototyping', 'playtesting'],
	},
	{
		src: '/projects/hypha/board.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'The starting board - neutral territory before any mycelium takes root.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ux-design', 'board-game'],
	},
	{
		src: '/projects/hypha/hypha.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'Hyphae tiles are transparent, allowing players to stack them on top of one another.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ux-design', 'board-game'],
	},
	{
		src: '/projects/hypha/endgame.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'The final board state after a three-player game.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ux-design', 'board-game'],
	},
];
