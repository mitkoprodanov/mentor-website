import type { ProjectMedia } from './types';

/**
 * Showcase gallery for Mandragora: Whispers of the Witch Tree (see
 * data/timeline.ts). Shared by both ProjectDef entries of this project
 * (`mandragora-early` and `mandragora`).
 */
export const mandragoraMedia: ProjectMedia[] = [
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed and tuned dynamic boss and enemy behaviors, delivering a progressive challenge that continually tested player mastery throughout the campaign.',
		tagIds: ['systems-design', 'ux-design', 'unreal-engine', 'encounter', 'ability'],
	},
	{
		src: 'https://www.youtube.com/watch?v=TuVsA-hP_qg',
		kind: 'youtube',
		start: 140,
		end: 234,
		caption: 'Mandragora - Necromancer Boss Fight',
		person: 'adam',
		tagIds: ['systems-design', 'ux-design', 'unreal-engine', 'encounter', 'ability'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Translated core gamepad controls into intuitive Keyboard & Mouse schemes, preserving input responsiveness and game feel across PC platforms.',
		tagIds: ['systems-design', 'ui', 'ux-design', 'unreal-engine', 'blueprint-scripting'],
	},
	{
		src: 'https://www.youtube.com/watch?v=SbRSK-2cyc0',
		kind: 'youtube',
		start: 16,
		end: 141,
		caption: 'Mandragora - Crafting & Caravan NPC UIs',
		person: 'adam',
		tagIds: ['systems-design', 'ui', 'ux-design', 'unreal-engine', 'blueprint-scripting'],
	},
	{
	src: '',
		kind: 'text',
		person: 'adam',
		caption: 'Designed talent trees and player abilities, focusing on how to make complex character growth intuitive.',
		tagIds: ['systems-design', 'ui', 'ux-design', 'unreal-engine', 'blueprint-scripting', 'progression', 'ability'],
	},
	{
		src: '/projects/mandragora/skilltree.jpg',
		kind: 'image',
		person: 'adam',
		caption: 'Mandragora - The skill tree of the Wyldwarden',
		tagIds: ['systems-design', 'ui', 'ux-design', 'unreal-engine', 'blueprint-scripting', 'progression', 'ability'],
	},
];


