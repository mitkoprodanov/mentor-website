import type { PersonId } from './people';

/**
 * The career timeline, read top to bottom in chronological/narrative order.
 *
 * A Company is the central, most-visible unit of the thread. Inside it sit
 * one or more Projects. Each Project carries one Experience per person who
 * worked on it — describing what *that person* did — so a project can be
 * solo (one experience), shared (two), or anything in between.
 *
 * The timeline itself is a sequence of entries, each either:
 *  - `together` — both of us at the same company. Renders as a single
 *    central thread, same as a solo project would (one side of a project
 *    row can still be blank if only one of us worked on that project).
 *  - `apart` — we were at two different companies at the same time. The
 *    thread visibly forks into two independent side-by-side threads, one
 *    per person, each with its own company name / dates / projects, until
 *    the next `together` entry merges them back into one.
 *
 * Companies with a single project (e.g. a short solo gig) omit the
 * project's `name` — the UI falls back to the company name, so it renders
 * as one node instead of a company banner + separate project node.
 *
 * Note: Black Hole Entertainment and Primal Game Studio each appear as two
 * separate CompanyDef objects (an early/continued half and a merged half)
 * because the fork/merge boundary falls in the middle of that employer's
 * timeframe, not at its edges — same real company, split where who-was-there
 * actually changes.
 *
 * Mentor Game Studio is *not* a company someone works "at" in the usual
 * sense — Mitko founded it in 2022 as a higher-level container for his
 * work, using it as the vehicle for collaborations with other studios (and
 * later solo/individual work), meanwhile actually working at Flying Wild
 * Hog and then Kreator Studios. So it doesn't get its own box alongside
 * them; instead, whichever entries fall inside that container are flagged
 * `underMentor: true`, and the Timeline renders them enclosed in a single
 * labeled envelope (see `MENTOR_ERA` below and `MentorContainer.astro`) —
 * a container that starts around the fork into solo work and keeps
 * enclosing everything through Ádám rejoining in 2026.
 */

/** The Mentor Game Studio "envelope" label wrapped around its underMentor entries. */
export const MENTOR_ERA = {
	label: 'Mentor Game Studio',
	dateRange: '2022 – Present',
};

export interface ExperienceRef {
	person: PersonId;
	/** Slug of the matching file in src/content/experiences/. */
	slug: string;
	/** WorkTag ids (see data/tags.ts) this experience used. */
	tagIds?: string[];
}

export interface ProjectDef {
	id: string;
	/** Omit for a single-project company — the company name is used instead. */
	name?: string;
	/** Short project-level blurb shown on the timeline's center node card, alongside `name`. */
	info?: string;
	experiences: ExperienceRef[];
}

export interface CompanyDef {
	id: string;
	name: string;
	dateRange: string;
	projects: ProjectDef[];
	/** Working under the Mentor Game Studio banner during this stint — rendered with the brighter accent. */
	underMentor?: boolean;
}

export type TimelineEntry =
	| { kind: 'together'; company: CompanyDef }
	| { kind: 'apart'; mitko: CompanyDef[]; adam: CompanyDef[] };

export const timeline: TimelineEntry[] = [
	{
		kind: 'apart',
		mitko: [
			{
				id: 'ericsson',
				name: 'Ericsson Hungary',
				dateRange: '2007 – 2008',
				projects: [
					{
						id: 'ericsson-consulting',
						experiences: [{ person: 'mitko', slug: 'mitko-ericsson', tagIds: ['c'] }],
					},
				],
			},
		],
		adam: [
			{
				id: 'bhe-early',
				name: 'Black Hole Entertainment',
				dateRange: '2004 – 2009',
				projects: [
					{
						id: 'exigo',
						name: 'Armies of Exigo',
						info: 'RTS campaign & multiplayer level design, plus contributions to the proprietary script editor.',
						experiences: [{ person: 'adam', slug: 'adam-exigo', tagIds: ['systems-level-design'] }],
					},
					{
						id: 'warhammer-mark-of-chaos',
						name: 'Warhammer: Mark of Chaos',
						info: 'RTS campaign & multiplayer maps, including the siege game mode.',
						experiences: [{ person: 'adam', slug: 'adam-warhammer-mark-of-chaos', tagIds: ['systems-level-design'] }],
					},
				],
			},
		],
	},
	{
		kind: 'together',
		company: {
			id: 'black-hole-entertainment',
			name: 'Black Hole Entertainment',
			dateRange: '2009 – 2012',
			projects: [
				{
					id: 'heroes6',
					name: 'Might & Magic: Heroes VI',
					info: 'Turn-based fantasy strategy — campaign AI, tutorial system, hero abilities & boss encounters.',
					experiences: [
						{ person: 'mitko', slug: 'mitko-heroes6', tagIds: ['gameplay-ai'] },
						{ person: 'adam', slug: 'adam-heroes6', tagIds: ['ui-ux-design', 'systems-level-design'] },
					],
				},
			],
		},
	},
	{
		kind: 'together',
		company: {
			id: 'primal-game-studio',
			name: 'Primal Game Studio',
			dateRange: '2012 – 2021',
			projects: [
				{
					id: 'supernova',
					name: 'Supernova',
					info: 'Wave army movement, status-effect system, tech tree, and hero ability kits.',
					experiences: [
						{
							person: 'mitko',
							slug: 'mitko-supernova',
							tagIds: ['gameplay-ai', 'crowd-sim-pathfinding', 'abilities-status-effects', 'tech-trees-progression'],
						},
						{ person: 'adam', slug: 'adam-supernova', tagIds: ['systems-level-design'] },
					],
				},
				{
					id: 'lol-universe',
					name: 'League of Legends Universe',
					info: 'Products in the League of Legends universe, built alongside Riot Games designers.',
					experiences: [
						{ person: 'mitko', slug: 'mitko-lol-universe' },
						{ person: 'adam', slug: 'adam-lol-universe' },
					],
				},
				{
					id: 'around',
					name: 'Around',
					info: 'Narrative-driven, point-and-click adventure built in UE4 Blueprint.',
					experiences: [
						{ person: 'mitko', slug: 'mitko-around' },
						{ person: 'adam', slug: 'adam-around', tagIds: ['ue-blueprint'] },
					],
				},
				{
					id: 'beasts-of-brawlia',
					name: 'Beasts of Brawlia',
					info: 'Arena brawler born from an in-house pitch contest.',
					experiences: [{ person: 'adam', slug: 'adam-beasts-of-brawlia' }],
				},
				{
					id: 'mmo-rework',
					name: 'MMO Microservices Rework',
					info: 'Reworked a monolithic MMO server into microservices, Agile-driven.',
					experiences: [{ person: 'mitko', slug: 'mitko-mmo-rework', tagIds: ['cpp', 'agile'] }],
				},
			],
		},
	},
	{
		kind: 'apart',
		mitko: [
			{
				id: 'flying-wild-hog',
				name: 'Flying Wild Hog',
				dateRange: '2021 – 2023',
				underMentor: true,
				projects: [
					{
						id: 'space-punks',
						experiences: [{ person: 'mitko', slug: 'mitko-flying-wild-hog', tagIds: ['gas'] }],
					},
				],
			},
			{
				id: 'imagic-labs',
				name: 'Imagic Labs',
				dateRange: '2025',
				underMentor: true,
				projects: [
					{
						id: 'imagic-labs-project',
						experiences: [
							{
								person: 'mitko',
								slug: 'mitko-imagic-labs',
								tagIds: ['mobile-dev', 'solid-clean-code'],
							},
						],
					},
				],
			},
			{
				id: 'kreator-studios',
				name: 'Kreator Studios',
				dateRange: '2025 – 2026',
				underMentor: true,
				projects: [
					{
						id: 'kreator-project',
						experiences: [{ person: 'mitko', slug: 'mitko-kreator-studios' }],
					},
				],
			},
		],
		adam: [
			{
				id: 'primal-continued',
				name: 'Primal Game Studio',
				dateRange: '2021 – 2025',
				projects: [
					{
						id: 'mandragora',
						name: 'Mandragora: Whispers of the Witch Tree',
						info: 'Action-RPG — final two years: UI/UX, boss encounters, abilities & talent trees.',
						experiences: [{ person: 'adam', slug: 'adam-mandragora', tagIds: ['ui-ux-design', 'encounter-design'] }],
					},
				],
			},
		],
	},
	{
		kind: 'together',
		company: {
			id: 'together-again',
			name: 'Together Again',
			dateRange: '2026 – Present',
			underMentor: true,
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
	},
];
