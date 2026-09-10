import type { ProjectMedia } from './types';

/** Showcase gallery for the Biobot project (see data/projects.ts). */
export const biobotMedia: ProjectMedia[] = [
	{
		src: '/projects/biobot/cards.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'The two types of cards players can use: the 180°-rotatable robot card and the 180°-rotatable, flippable plant overlay cards, which can be stacked on top of each other multiple times.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ux-design', 'puzzle-design', 'board-game'],
	},
	{
		src: '/projects/biobot/place.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'A close-up demonstration of the core gameplay loop: a player is layering a transparent organic (plant) card over a mechanical (robot) base. This interaction provides immediate visual feedback for upgrades and highlights the intuitive logic behind the game’s systemic synergies.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ux-design', 'puzzle-design', 'board-game'],
	},
	{
		src: '/projects/biobot/tableau.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'A completed 3x3 end-game tableau, showcasing the player’s character and the unique stacking mechanic. It highlights how transparent plant (organic) cards are layered over robot (mechanical) base cards to create systemic synergies.',
		tagIds: ['board-game-design', 'prototyping', 'playtesting', 'balance', 'ux-design', 'puzzle-design', 'board-game'],
	},
];
