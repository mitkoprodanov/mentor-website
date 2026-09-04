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
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'prototyping', 'playtesting'],
	},
	{
		src: 'https://www.facebook.com/watch/?v=291274308860973',
		kind: 'facebook-reel',
		caption: 'Around gameplay',
		tagIds: ['prototyping', 'playtesting', 'narrative-design', 'puzzle-design'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Led prototyping and playtesting sessions to validate narrative experiences and puzzle design.',
		tagIds: ['prototyping', 'playtesting', 'narrative-design', 'puzzle-design'],
	},
	{
		src: 'https://www.facebook.com/watch/?v=323920638727021',
		kind: 'facebook-reel',
		caption: 'Around - Some of our memories are unclear like a blurry painting',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed narrative experiences, game systems, and puzzles that sensitively portray the emotional and psychological realities of living with dementia.',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design'],
	},

];