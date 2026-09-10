import type { ProjectMedia } from './types';

/** Showcase gallery for Supernova (see data/timeline.ts). */
export const supernovaMedia: ProjectMedia[] = [
	{
	src: '',
		kind: 'text',
		caption: 'Together, we designed dynamic crowd simulation and navigation systems for heterogeneous unit archetypes, combining pathfinding with flocking-based local movement and reactive commander avoidance to enable coordinated, fluid crowds at low computational cost.',
		tagIds: ['gameplay', 'systems-design', 'navigation', 'ai', 'ui', 'progression'],
	},
	{
		src: 'https://www.youtube.com/watch?v=agAYZj01BJc',
		kind: 'youtube',
		start: 54,
		end: 88,
		caption: 'Wave army movement across the field.',
		tagIds: ['gameplay', 'systems-design', 'navigation', 'ai', 'ui', 'progression'],
	},
	{
	src: '',
		kind: 'text',
		person: 'mitko',
		caption: "Implemented several commanders from initial concept through to polished, shipped content, with complete ability kits and distinctive behaviours and visuals. Brought the designer and artist vision to life through iterative refinement by playtesting and feedback.",
		tagIds: ['gameplay', 'ability'],
	},
	{
		src: 'https://www.youtube.com/watch?v=MStfmBkkXMo',
		kind: 'youtube',
		start: 43,
		end: 84,
		caption: 'B.R.O. Commander spotlight',
		tagIds: ['gameplay', 'systems-design', 'progression', 'ability'],
	},
	{
		src: '',
		kind: 'text',
		person: 'mitko',
		caption: "Shaped the ability architecture and co-developed the status-effect system, a core component for a MOBA requiring a high degree of robustness and responsiveness.",
		tagIds: ['gameplay', 'ability'],
	},
	{
		src: 'https://www.youtube.com/watch?v=MStfmBkkXMo',
		kind: 'youtube',
		start: 85,
		end: 107,
		caption: 'Status effect system with feedback VFX.',
		tagIds: ['systems-design', 'ui', 'ability', 'gameplay'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Worked on the in-game tech-three, a progression system that allowed players to customize army wave composition, upgrade units and the economic and defensive capabilities of the main base. Also contributed to the metagame progression system.',
		tagIds: ['systems-design', 'ui', 'progression', 'metagame'],
	},
	{
		src: 'https://www.youtube.com/watch?v=agAYZj01BJc',
		kind: 'youtube',
		start: 549,
		end: 642,
		person: 'adam',
		caption: 'Showcasing the metagame progression system where players can unlock active and passive abilities for the matches.',
		tagIds: ['systems-design', 'ui', 'progression', 'metagame'],
	},
];
