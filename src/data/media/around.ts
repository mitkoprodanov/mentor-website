import type { ProjectMedia } from './types';

/**
 * Showcase gallery for Around (see data/timeline.ts). Shared by both
 * ProjectDef entries of this project (`around-mitko` and `around-adam`).
 */
export const aroundMedia: ProjectMedia[] = [
	{
		src: 'https://www.facebook.com/watch/?v=297734748254498',
		kind: 'facebook-reel',
		caption: 'Around trailer',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'prototyping', 'playtesting'],
	},
	{
	src: '',
		kind: 'text',
		person: 'mitko',
		caption: 'Established and maintained much of the game’s technical foundation, including character movement, actions, interactions and inventory.',
		tagIds: ['gameplay', 'ui', 'prototyping', 'unreal-engine', 'blueprint-scripting', 'unreal-gamesync', 'navigation'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Led prototyping and playtesting sessions to validate narrative experiences and puzzle design.',
		tagIds: ['gameplay', 'prototyping', 'playtesting', 'narrative-design', 'puzzle-design', 'ui', 'unreal-engine', 'blueprint-scripting'],
	},
	{
		src: 'https://www.facebook.com/watch/?v=291274308860973',
		kind: 'facebook-reel',
		caption: 'Around gameplay showing narrative flow supported by inventory usage',
		tagIds: ['gameplay', 'ui', 'prototyping', 'playtesting', 'narrative-design', 'puzzle-design', 'unreal-engine', 'unreal-gamesync', 'blueprint-scripting', 'navigation'],
	},
	{
	src: '',
		kind: 'text',
		person: 'mitko',
		caption: 'Experiemented with creative visual techniques to bring a hand-drawn world to life.',
		tagIds: ['visuals', 'level-design', 'unreal-engine'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed narrative experiences, game systems, and puzzles that sensitively portray the emotional and psychological realities of living with dementia.',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'gameplay'],
	},
	{
		src: 'https://www.facebook.com/watch/?v=323920638727021',
		kind: 'facebook-reel',
		caption: 'Around - Some of our memories are unclear like a blurry painting',
		tagIds: ['visuals', 'systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'gameplay'],
	},
	{
		src: 'https://www.facebook.com/reel/651147125502357',
		kind: 'facebook-reel',
		caption: 'An immersive hand-drawn world',
		tagIds: ['visuals', 'systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'gameplay', 'navigation'],
	},
];