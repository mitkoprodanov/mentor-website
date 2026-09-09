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
	/** Public path to the downloadable PDF CV (served from public/cv/). */
	cv?: string;
	/** Ordered list of WorkTag ids (see data/tags.ts) — grouped by category for display, in first-occurrence order. */
	tagIds: string[];
	hobbies?: string[];
}

export const people: Person[] = [
	{
		id: 'mitko',
		name: 'Mitko Prodanov',
		role: 'Senior Gameplay Engineer',
		since: 2009,
		education: 'MSc Computer Engineering, BUTE',
		linkedin: 'https://www.linkedin.com/in/mitko-prodanov-920b55b7/',
		cv: '/cv/CV_Mitko_Prodanov_2026.pdf',
		tagIds: [
			'gameplay',
			'ai',
			'navigation',
			'ability',
			'encounter',
			'progression',
			'ui',
			'visuals',
			'devtools',
			'proprietary-engine',
			'unreal-engine',
			'unreal-gas',
			'unreal-gamesync',
			'unreal-eqs',
			'blueprint-scripting',
			'mobile-development',
			'clean-code',
			'agile',
			'prototyping',
			'co-dev-teams',

		],
		hobbies: [
			'Paragliding — both solo and as a tandem pilot',
			'Formerly speedcubing, held multiple national records for a while',
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
		cv: '/cv/CV_Adam_Nemeshazi_2026_GD.pdf',
		tagIds: ['systems-design', 'level-design', 'encounter', 'ux-design', 'ui', 'blueprint-scripting', 'progression', 'devtools', 'board-game-design', 'prototyping', 'playtesting', 'balance', 'puzzle-design', 'proprietary-engine', 'ip-critical-design', 'ai', 'navigation', 'co-dev-teams', 'ability', 'metagame', 'narrative-design', 'board-game', 'unreal-engine'],
		hobbies: [
			'Began creating custom maps at the age of 12 for popular titles of the era (Doom II, Duke Nukem 3D, Age of Empires II, Warcraft III)',
			'Designing, prototyping, and playtesting two original board games',
			'Gardening and growing edible plants',
			'Active player of video games and board games',
			'Science fiction book enthusiast (classic & modern)',
			'Interest in horror films and video games (atmosphere & narrative design)',
		],
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
