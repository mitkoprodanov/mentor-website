import type { ProjectMedia } from './types';

/** Showcase gallery for Warhammer: Mark of Chaos & Battle March (see data/timeline.ts). */
export const warhammerMarkOfChaosMedia: ProjectMedia[] = [
	{
		src: '/projects/warhammer-mark-of-chaos/warhammer.jpg',
		kind: 'image',
		caption: 'Enthusiastic about improving developer tools, learned the tactical side of strategy games, large-scale combat, unit formations & morale, philosophies behind strategy games.',
		tagIds: ['level-design', 'devtools', 'proprietary-engine', 'ip-critical-design'],
	},
	{
		src: 'https://www.youtube.com/watch?v=udUVQXUsK9w',
		kind: 'youtube',
		start: 538,
		end: 584,
		caption: 'Designed systems for the siege game mode like unit movement on walls, controlling armies to attack or scale walls, wall & tower hit point system, AI enemy attack and defense behaviors.',
		tagIds: ['level-design', 'devtools', 'proprietary-engine', 'ip-critical-design', 'systems-design', 'ai', 'navigation'],
	},
];
