import type { ProjectMedia } from './types';

/** Showcase gallery for Beasts of Brawlia (see data/timeline.ts). */
export const beastsOfBrawliaMedia: ProjectMedia[] = [
	{
		id: 'bob-pitch-to-playable',
		src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Drove the project from initial pitch to a playable build, leveraging rapid prototyping and tight iteration cycles to explore the design space and lock down the core fun factor with intensive prototyping and playtesting sessions.',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'ability', 'unreal-engine', 'blueprint-scripting', 'prototyping', 'playtesting', 'balance'],
	},
	{
		id: 'bob-gameplay',
		src: '/projects/bob/bob_brawl.mp4',
		kind: 'video',
		person: 'adam',
		caption: 'Beasts of Brawlia - gameplay video.',
		tagIds: ['systems-design', 'level-design', 'ui', 'ux-design', 'ability', 'unreal-engine', 'blueprint-scripting', 'prototyping', 'playtesting', 'balance'],
	},
];
