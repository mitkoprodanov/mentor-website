/**
 * The two people behind the studio. Edit names, roles, tags, and links here —
 * everything on the Personal section is generated from this file.
 */

export type PersonId = 'mitko' | 'adam';

export interface SkillGroup {
	/** A well-known category, e.g. "AI", "Unreal", "UI", "Gameplay". */
	category: string;
	skills: string[];
}

export interface Person {
	id: PersonId;
	name: string;
	role: string;
	/** Year they entered the games industry. */
	since: number;
	education: string;
	linkedin: string;
	email?: string;
	skillGroups: SkillGroup[];
}

export const people: Person[] = [
	{
		id: 'mitko',
		name: 'Mitko Prodanov',
		role: 'Senior Gameplay & AI Programmer',
		since: 2009,
		education: 'MSc Computer Engineering, BUTE',
		linkedin: 'https://www.linkedin.com/in/mitko-prodanov-920b55b7/',
		skillGroups: [
			{ category: 'Languages', skills: ['C', 'C++', 'C#'] },
			{ category: 'Unreal', skills: ['Gameplay Ability System (GAS)'] },
			{ category: 'Engines', skills: ['Unity', 'Lumberyard'] },
			{ category: 'AI', skills: ['Gameplay AI', 'Crowd Simulation & Pathfinding', 'TensorFlow / Deep Learning'] },
			{ category: 'Gameplay', skills: ['Abilities & Status Effects', 'Tech Trees & Progression'] },
			{ category: 'Graphics', skills: ['Shader Programming (HLSL/GLSL/Cg)', 'OpenGL', 'DirectX'] },
		],
	},
	{
		id: 'adam',
		name: 'Ádám Nemesházi',
		role: 'Senior Game Designer',
		since: 2004,
		education: 'BSc Business Informatics, Corvinus',
		linkedin: 'https://linkedin.com/in/adam-nemeshazi',
		skillGroups: [
			{ category: 'Design', skills: ['Systems & Level Design', 'Encounter Design'] },
			{ category: 'UI', skills: ['UI/UX Design'] },
			{ category: 'Unreal', skills: ['UE Blueprint'] },
			{ category: 'Process', skills: ['Agile/Scrum'] },
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
