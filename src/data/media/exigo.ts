import type { ProjectMedia } from './types';

/** Showcase gallery for Armies of Exigo (see data/timeline.ts). */
export const exigoMedia: ProjectMedia[] = [
	{
		src: '/projects/exigo/exigo.mp4',
		kind: 'video',
		person: 'adam',
		caption: 'Gameplay excerpt captured from the project — highlighting the strategy loop and asymmetric factions.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
	{
		src: '/projects/exigo/exigo.mp4',
		kind: 'text',
		person: 'adam',
		caption: 'This is a text type media content. Gameplay excerpt captured from the project — highlighting the strategy loop and asymmetric factions.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
	{
		src: 'https://youtu.be/6Ovup2D5ojo',
		kind: 'youtube',
		start: 305,
		end: 355,
		caption: 'Learned basic strategy game concepts like interconnected systems, micro-macro management, AI enemies, asymmetrical factions, game balancing.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
	{
		src: '/projects/exigo/multiplayer.jpg',
		kind: 'image',
		caption: 'Architected fair, highly-balanced multiplayer skirmish maps.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
	{
		src: '/projects/exigo/editor.png',
		kind: 'image',
		caption: 'Contributed to the game’s proprietary level and script editor.',
		tagIds: ['devtools', 'proprietary-engine'],
	},
];
