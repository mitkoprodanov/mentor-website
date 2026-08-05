/**
 * The two people behind the studio. Edit names, roles, tags, and links here —
 * everything on the Personal section is generated from this file.
 */

export type PersonId = 'mitko' | 'adam';

export interface Person {
	id: PersonId;
	name: string;
	role: string;
	/** Year they entered the games industry. */
	since: number;
	education: string;
	linkedin: string;
	email?: string;
	/** Ordered list of WorkTag ids (see data/tags.ts) — grouped by category for display, in first-occurrence order. */
	tagIds: string[];
	hobbies?: string[];
}

export const people: Person[] = [
	{
		id: 'mitko',
		name: 'Mitko Prodanov',
		role: 'Senior Gameplay & AI Programmer',
		since: 2009,
		education: 'MSc Computer Engineering, BUTE',
		linkedin: 'https://www.linkedin.com/in/mitko-prodanov-920b55b7/',
		tagIds: [
			'c',
			'cpp',
			'csharp',
			'gas',
			'unity',
			'lumberyard',
			'gameplay-ai',
			'crowd-sim-pathfinding',
			'tensorflow-dl',
			'abilities-status-effects',
			'tech-trees-progression',
			'shader-programming',
			'opengl',
			'directx',
			'mobile-dev',
			'solid-clean-code',
			'agile',
			'qubit-spring-1st-place',
		],
		hobbies: [
			'Paragliding — both solo and as a tandem pilot',
			'Formerly speedcubing for a while',
			'Studied the game of go, up to 1 dan',
			'Board games and table football',
		],
	},
	{
		id: 'adam',
		name: 'Ádám Nemesházi',
		role: 'Senior Game Designer',
		since: 2004,
		education: 'BSc Business Informatics, Corvinus',
		linkedin: 'https://linkedin.com/in/adam-nemeshazi',
		tagIds: ['systems-level-design', 'encounter-design', 'ui-ux-design', 'ue-blueprint', 'agile-scrum'],
	},
];

export function getPerson(id: PersonId): Person {
	const person = people.find((p) => p.id === id);
	if (!person) throw new Error(`Unknown person id: ${id}`);
	return person;
}

/** Which side of the timeline/personal grid each person renders on. */
export const COLUMN: Record<PersonId, 'left' | 'right'> = {
	mitko: 'left',
	adam: 'right',
};
