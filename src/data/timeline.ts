import type { PersonId } from './people';

/**
 * The career timeline, read top to bottom in chronological/narrative order.
 *
 * A Company is the central, most-visible unit of the thread. Inside it sit
 * one or more Projects. Each Project carries one Experience per person who
 * worked on it — describing what *that person* did — so a project can be
 * solo (one experience), shared (two), or anything in between.
 *
 * Who is "on the thread" for a company is derived (see `getTenure` below)
 * from the union of people who have an experience on any of its projects —
 * there's nothing else to keep in sync when you add or move a project.
 *
 * Companies with a single project (e.g. a short solo gig) omit the
 * project's `name` — the UI falls back to the company name, so it renders
 * as one node instead of a company banner + separate project node.
 */

export interface ExperienceRef {
	person: PersonId;
	/** Slug of the matching file in src/content/experiences/. */
	slug: string;
}

export interface ProjectDef {
	id: string;
	/** Omit for a single-project company — the company name is used instead. */
	name?: string;
	experiences: ExperienceRef[];
}

export interface CompanyDef {
	id: string;
	name: string;
	dateRange: string;
	projects: ProjectDef[];
}

export const timeline: CompanyDef[] = [
	{
		id: 'black-hole-entertainment',
		name: 'Black Hole Entertainment',
		dateRange: '2004 – 2012',
		projects: [
			{
				id: 'exigo',
				name: 'Armies of Exigo',
				experiences: [{ person: 'adam', slug: 'adam-exigo' }],
			},
			{
				id: 'warhammer-mark-of-chaos',
				name: 'Warhammer: Mark of Chaos',
				experiences: [{ person: 'adam', slug: 'adam-warhammer-mark-of-chaos' }],
			},
			{
				id: 'heroes6',
				name: 'Might & Magic: Heroes VI',
				experiences: [
					{ person: 'mitko', slug: 'mitko-heroes6' },
					{ person: 'adam', slug: 'adam-heroes6' },
				],
			},
		],
	},
	{
		id: 'ericsson',
		name: 'Ericsson Hungary',
		dateRange: '2007 – 2008',
		projects: [
			{
				id: 'ericsson-consulting',
				experiences: [{ person: 'mitko', slug: 'mitko-ericsson' }],
			},
		],
	},
	{
		id: 'primal-game-studio',
		name: 'Primal Game Studio',
		dateRange: '2012 – 2025',
		projects: [
			{
				id: 'supernova',
				name: 'Supernova',
				experiences: [
					{ person: 'mitko', slug: 'mitko-supernova' },
					{ person: 'adam', slug: 'adam-supernova' },
				],
			},
			{
				id: 'around',
				name: 'Around',
				experiences: [
					{ person: 'mitko', slug: 'mitko-around' },
					{ person: 'adam', slug: 'adam-around' },
				],
			},
			{
				id: 'lol-universe',
				name: 'League of Legends Universe',
				experiences: [
					{ person: 'mitko', slug: 'mitko-lol-universe' },
					{ person: 'adam', slug: 'adam-lol-universe' },
				],
			},
			{
				id: 'mmo-rework',
				name: 'MMO Microservices Rework',
				experiences: [{ person: 'mitko', slug: 'mitko-mmo-rework' }],
			},
			{
				id: 'beasts-of-brawlia',
				name: 'Beasts of Brawlia',
				experiences: [{ person: 'adam', slug: 'adam-beasts-of-brawlia' }],
			},
			{
				id: 'mandragora',
				name: 'Mandragora: Whispers of the Witch Tree',
				experiences: [{ person: 'adam', slug: 'adam-mandragora' }],
			},
		],
	},
	{
		id: 'flying-wild-hog',
		name: 'Flying Wild Hog',
		dateRange: '2021 – 2023',
		projects: [
			{
				id: 'space-punks',
				experiences: [{ person: 'mitko', slug: 'mitko-flying-wild-hog' }],
			},
		],
	},
	{
		id: 'mentor-game-studio',
		name: 'Mentor Game Studio',
		dateRange: '2022 – Present',
		projects: [
			{
				id: 'mentor',
				experiences: [
					{ person: 'mitko', slug: 'mitko-mentor' },
					{ person: 'adam', slug: 'adam-mentor' },
				],
			},
		],
	},
];

/** Everyone who has at least one experience on at least one project here. */
export function getTenure(company: CompanyDef): PersonId[] {
	const people = new Set<PersonId>();
	for (const project of company.projects) {
		for (const experience of project.experiences) {
			people.add(experience.person);
		}
	}
	return [...people];
}
