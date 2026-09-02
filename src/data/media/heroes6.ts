import type { ProjectMedia } from './types';

/** Showcase gallery for Might & Magic: Heroes VI (see data/timeline.ts). */
export const heroes6Media: ProjectMedia[] = [
	{
		src: 'https://www.youtube.com/watch?v=EnHEfd9MFr0',
		kind: 'youtube',
		start: 62,
		end: 120,
		caption: 'Azkaal boss fight in which the player controls the boss.',
		tagIds: ['ai', 'encounter', 'systems-design', 'ip-critical-design', 'ability'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed unique bosses for the campaign with their own set of abilities and behavior.',
		tagIds: ['ai', 'encounter', 'systems-design', 'ip-critical-design', 'ability'],
	},
	{
		src: '/projects/heroes6/campaign.jpg',
		kind: 'image',
		caption: 'The adventure map.',
		tagIds: ['ai', 'systems-design', 'ip-critical-design', 'proprietary-engine', 'devtools', 'level-design'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed and maintained a complex campaign AI system, which streamlined AI tuning for all level designers on the team.',
		tagIds: ['ai', 'systems-design', 'ip-critical-design', 'proprietary-engine', 'devtools', 'level-design'],
	},
	{
		src: '/projects/heroes6/abilitytree.jpg',
		kind: 'image',
		caption: 'Hero ability tree.',
		tagIds: ['progression', 'ability', 'systems-design', 'ip-critical-design', 'ui'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed Hero ability trees and their content.',
		tagIds: ['progression', 'ability', 'systems-design', 'ip-critical-design', 'ui'],
	},
	{
		src: '/projects/heroes6/combatmap.jpg',
		kind: 'image',
		caption: 'Combat map with randomized obstacles.',
		tagIds: ['ability', 'ui', 'systems-design', 'level-design', 'ip-critical-design'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed the UI and controls of combat maps, combat systems (like initiative and morale), unit abilities and combat map randomization.',
		tagIds: ['ability', 'ui', 'systems-design', 'level-design', 'ip-critical-design'],
	},
];