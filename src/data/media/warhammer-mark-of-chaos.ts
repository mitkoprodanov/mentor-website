import type { ProjectMedia } from './types';

/** Showcase gallery for Warhammer: Mark of Chaos & Battle March (see data/timeline.ts). */
export const warhammerMarkOfChaosMedia: ProjectMedia[] = [
	{
		id: 'warhammer-devtools',
		src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Enthusiastic about improving developer tools, learned the tactical side of strategy games, large-scale combat, unit formations & morale, philosophies behind strategy games.',
		tagIds: ['level-design', 'devtools', 'proprietary-engine', 'ip-critical-design'],
	},
	{
		id: 'warhammer-orc-formations',
		src: '/projects/warhammer/warhammer.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'Orc units and their formations.',
		tagIds: ['level-design', 'devtools', 'proprietary-engine', 'ip-critical-design'],
	},
	{
		id: 'warhammer-siege-systems',
		src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed systems for the siege game mode like unit movement on walls, controlling armies to attack or scale walls, wall & tower hit point system, AI enemy attack and defense behaviors.',
		tagIds: ['level-design', 'devtools', 'proprietary-engine', 'ip-critical-design', 'systems-design', 'ai', 'navigation'],
	},
	{
		id: 'warhammer-skaven-siege',
		src: 'https://www.youtube.com/watch?v=udUVQXUsK9w',
		kind: 'youtube',
		person: 'adam',
		start: 538,
		end: 584,
		caption: 'Siege with the Skaven army.',
		tagIds: ['level-design', 'devtools', 'proprietary-engine', 'ip-critical-design', 'systems-design', 'ai', 'navigation'],
	},
];
