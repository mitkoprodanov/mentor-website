import type { ProjectMedia } from './types';

/**
 * Showcase gallery for Around (see data/timeline.ts). Shared by both
 * ProjectDef entries of this project (`around-mitko` and `around-adam`).
 */
export const aroundMedia: ProjectMedia[] = [
	{
		id: 'around-trailer',
		src: '/projects/around/around_trailer.mp4',
		kind: 'video',
		caption: 'Around trailer',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'prototyping', 'playtesting'],
	},
	{
	id: 'around-technical-foundation',
	src: '',
		kind: 'text',
		person: 'mitko',
		caption: 'Established and maintained much of the game’s technical foundation, including character movement, actions, interactions and inventory.',
		tagIds: ['gameplay', 'ui', 'prototyping', 'unreal-engine', 'blueprint-scripting', 'unreal-gamesync', 'navigation'],
	},
	{
	id: 'around-prototyping-playtesting',
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Led prototyping and playtesting sessions to validate narrative experiences and puzzle design.',
		tagIds: ['gameplay', 'prototyping', 'playtesting', 'narrative-design', 'puzzle-design', 'ui', 'unreal-engine', 'blueprint-scripting'],
	},
	{
		id: 'around-narrative-flow',
		src: '/projects/around/around_slide.mp4',
		kind: 'video',
		caption: 'Around gameplay showing narrative flow supported by inventory usage',
		tagIds: ['gameplay', 'ui', 'prototyping', 'playtesting', 'narrative-design', 'puzzle-design', 'unreal-engine', 'unreal-gamesync', 'blueprint-scripting', 'navigation'],
	},
	{
	id: 'around-visual-techniques',
	src: '',
		kind: 'text',
		person: 'mitko',
		caption: 'Experiemented with creative visual techniques to bring a hand-drawn world to life.',
		tagIds: ['visuals', 'level-design', 'unreal-engine'],
	},
	{
	id: 'around-narrative-design',
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed narrative experiences, game systems, and puzzles that sensitively portray the emotional and psychological realities of living with dementia.',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'gameplay'],
	},
	{
		id: 'around-blurry-memories',
		src: '/projects/around/around_memories.mp4',
		kind: 'video',
		caption: 'Some of our memories are unclear like a blurry painting',
		tagIds: ['visuals', 'systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'gameplay'],
	},
	{
		id: 'around-immersive-world',
		src: '/projects/around/around_carousel.mp4',
		kind: 'video',
		caption: 'An immersive hand-drawn world',
		tagIds: ['visuals', 'systems-design', 'level-design', 'ui', 'ux-design', 'narrative-design', 'puzzle-design', 'unreal-engine', 'gameplay', 'navigation'],
	},
];