import type { ProjectMedia } from './types';

/** Showcase gallery for Armies of Exigo (see data/timeline.ts). */
export const exigoMedia: ProjectMedia[] = [
	{
		src: '/projects/exigo/exigo.mp4',
		kind: 'video',
		person: 'adam',
		caption: 'Video showcasing the game’s two-level system.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Learned basic strategy game concepts like interconnected systems, micro-macro management, AI enemies, asymmetrical factions, game balancing.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
/*
	{
		src: 'https://youtu.be/6Ovup2D5ojo',
		kind: 'youtube',
		person: 'adam',
		start: 305,
		end: 355,
		caption: 'Learned basic strategy game concepts like interconnected systems, micro-macro management, AI enemies, asymmetrical factions, game balancing.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
*/
	{
		src: '/projects/exigo/multiplayer.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'Starting position of a player playing as the Fallen faction on a multiplayer map.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
	{
		src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Architected fair, highly-balanced multiplayer skirmish maps.',
		tagIds: ['level-design', 'balance', 'proprietary-engine'],
	},
	{
		src: '/projects/exigo/editor.png',
		kind: 'image',
		person: 'adam',
		caption: 'The Scenario Editor in action.',
		tagIds: ['devtools', 'proprietary-engine'],
	},
	{
		src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Contributed to the game’s proprietary level and script editor.',
		tagIds: ['devtools', 'proprietary-engine'],
	},
];
