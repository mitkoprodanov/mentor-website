import type { ProjectMedia } from './types';

/** Showcase gallery for Supernova (see data/timeline.ts). */
export const supernovaMedia: ProjectMedia[] = [
	{
		src: 'https://www.youtube.com/watch?v=agAYZj01BJc',
		kind: 'youtube',
		start: 61,
		end: 125,
		caption: 'Wave army movement across the field.',
		tagIds: ['systems-design', 'navigation', 'ai', 'ui', 'progression'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed dynamic crowd simulation and navigation systems across heterogeneous unit archetypes, implementing pathfinding and reactive commander-avoidance behaviors.',
		tagIds: ['systems-design', 'navigation', 'ai'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Worked on the in-game tech-three, a progression system that allowed players to customize army wave composition, upgrade units and the economic and defensive capabilities of the main base.',
		tagIds: ['systems-design', 'ui', 'progression'],
	},
	{
		src: 'https://www.youtube.com/watch?v=MStfmBkkXMo',
		kind: 'youtube',
		start: 43,
		end: 84,
		caption: 'B.R.O. Commander spotlight',
		tagIds: ['systems-design', 'progression', 'ability'],
	},
	{
		src: 'https://www.youtube.com/watch?v=MStfmBkkXMo',
		kind: 'youtube',
		start: 85,
		end: 107,
		caption: 'Status effect system with feedback VFX.',
		tagIds: ['systems-design', 'ui'],
	},
	{
		src: 'https://www.youtube.com/watch?v=agAYZj01BJc',
		kind: 'youtube',
		start: 549,
		end: 642,
		caption: 'Showcasing the metagame progression system where players can unlock active and passive abilities for the matches.',
		tagIds: ['systems-design', 'ui', 'progression', 'metagame'],
	},
];
