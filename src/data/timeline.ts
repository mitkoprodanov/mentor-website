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
 * actually changes. Mandragora (see the Primal Game Studio 2012 – 2021
 * entry, and Ádám's continuing Primal Game Studio in the apart entry after)
 * follows the exact same pattern, just for one project rather than a whole
 * company: it starts inside the shared box and is picked back up in Ádám's
 * own track afterward, bridged into one continuous card by the same
 * same-company-name TrackConnector logic in Timeline.astro.
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
	/**
	 * Grid-row span (see ProjectRow.astro), for a solo project whose card
	 * should visually run tall alongside more than one row on the other
	 * side. Used to make one person's card start alongside an earlier
	 * project on the other side and continue down past it — e.g. Mitko's
	 * "Around" starting level with Ádám's "Beasts of Brawlia" and running
	 * down through Ádám's own "Around" row below it. Relies on
	 * `.company-projects`' `grid-auto-flow: dense` to correctly backfill
	 * the other column around the span — see the project ordering comment
	 * on the Primal Game Studio (2012 – 2021) entry below.
	 */
	rowSpan?: number;
	/**
	 * Squares off this project's bottom-right corner so it sits flush where
	 * a `bridgeLeft` neighbor (see below) joins into it from the other
	 * column — e.g. Mitko's row-spanning "Around" card meeting Ádám's
	 * "Around" box below "Beasts of Brawlia". Only the bottom corner
	 * changes; the top corner stays rounded since it sits beside a
	 * different, unjoined neighbor higher up.
	 */
	squareBottomRight?: boolean;
	/**
	 * Visually joins this project's box to a taller `rowSpan` card sitting
	 * beside it in the other column, by filling the column gap between
	 * them and squaring off both corners on this side — the two read as
	 * one connected shape instead of two separate boxes. Relies on this
	 * project's own natural height already landing at the same bottom
	 * edge as its `squareBottomRight` partner (true today because Ádám's
	 * longer card text happens to need that much room — see ProjectRow.astro).
	 */
	bridgeLeft?: boolean;
}

export interface CompanyDef {
	id: string;
	name: string;
	dateRange: string;
	projects: ProjectDef[];
	/** Working under the Mentor Game Studio banner during this stint — rendered with the brighter accent. */
	underMentor?: boolean;
	/**
	 * Stretches this company's box down until its bottom edge reaches the
	 * vertical midpoint of the named company box on the *other* track of
	 * the same apart entry (matched by id) — e.g. Ádám's continuing
	 * "Primal Game Studio" reaching down to the middle of Mitko's "Imagic
	 * Labs", pushing whatever comes after it in Ádám's track (here,
	 * "Personal Project") down to make room. Computed at runtime (see
	 * syncApartHeights.client.ts) since it depends on the other box's
	 * actual rendered height — there's no way to know that from the data
	 * alone (text length, font, viewport width all affect it). Only
	 * applies to the two-column desktop/tablet layout; on the single-column
	 * mobile layout the two tracks aren't side by side anymore, so the
	 * script leaves this box at its natural height there.
	 */
	stretchToMiddleOf?: string;
	/**
	 * Stretches this company's box down until its bottom edge comes within
	 * `gap` pixels of the top of the named company box (matched by id,
	 * anywhere in the timeline — typically the `together` entry that
	 * follows this one) — close, but deliberately stopping short so the two
	 * clearly read as separate boxes rather than merging into one, unlike
	 * `stretchToMiddleOf` above. E.g. Ádám's "Personal Project" reaching
	 * down near "Together Again" without touching it. Also computed at
	 * runtime (see syncApartHeights.client.ts) and skipped on the
	 * single-column mobile layout, for the same reasons as
	 * `stretchToMiddleOf`.
	 */
	stretchNearTopOf?: { id: string; gap: number };
	/**
	 * Stretches this company's box down until its bottom edge lines up
	 * exactly with the bottom edge of the named company box (matched by
	 * id) — e.g. Ádám's "Personal Project" ending flush with Mitko's
	 * "Kreator Studios", the last company on his side of this same apart
	 * entry, so the two tracks visibly wrap up together. Same runtime
	 * computation and mobile behavior as `stretchToMiddleOf`; expects the
	 * target to sit on the *other* track of the same apart entry so
	 * growing this box never moves the target itself (unlike
	 * `stretchNearTopOf`, this one doesn't need to re-settle for that).
	 */
	alignBottomTo?: string;
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
						info: 'RTS campaign & multiplayer level design, contributions to the proprietary script editor.',
						experiences: [{ person: 'adam', slug: 'adam-exigo', tagIds: ['systems-level-design'] }],
					},
					{
						id: 'warhammer-mark-of-chaos',
						name: 'Warhammer: Mark of Chaos & Battle March',
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
			/**
			 * "Around" is split across two ProjectDef entries (`around-mitko`,
			 * `around-adam`) purely so the two people's cards can land in
			 * different grid rows — Mitko's starting alongside "Beasts of
			 * Brawlia" and running down through Ádám's own "Around" row below
			 * it, via `rowSpan` (see ProjectDef above) plus `.company-projects`'s
			 * `grid-auto-flow: dense`, which backfills Ádám's column around the
			 * span. Both repeat the same `name`/`info` since each is its own
			 * node in the vertical thread, and both still point at the same two
			 * experience files as before the split, unchanged.
			 *
			 * "Mandragora" similarly reappears here (`mandragora-early`) as a
			 * separate ProjectDef from its fuller telling in the later apart
			 * entry (Ádám's "Primal Game Studio" continuing 2022 – 2025) — same
			 * project starting here, not a different one (see the file-level
			 * comment above). Ordering it right after `mmo-rework` is what
			 * lands it in the same row as Mitko's card there (dense packing
			 * again — supernova and lol-universe are full-width so they consume
			 * whole rows first, `around-mitko`'s span-2 plus beasts-of-brawlia
			 * and around-adam consume the next two rows between them, leaving
			 * mmo-rework and mandragora-early to land side by side in the row
			 * after that).
			 */
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
						{ person: 'adam', slug: 'adam-supernova', tagIds: ['systems-level-design', 'tech-trees-progression'] },
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
					id: 'around-mitko',
					name: 'Around',
					info: 'Narrative-driven, point-and-click adventure built in UE4 Blueprint.',
					rowSpan: 2,
					squareBottomRight: true,
					experiences: [{ person: 'mitko', slug: 'mitko-around' }],
				},
				{
					id: 'beasts-of-brawlia',
					name: 'Beasts of Brawlia',
					info: 'Fun-oriented arena brawler born from an in-house pitch contest.',
					experiences: [{ person: 'adam', slug: 'adam-beasts-of-brawlia', tagIds: ['ue-blueprint'] }],
				},
				{
					id: 'around-adam',
					name: 'Around',
					info: 'Narrative-driven, point-and-click adventure built in UE4 Blueprint.',
					bridgeLeft: true,
					experiences: [{ person: 'adam', slug: 'adam-around', tagIds: ['ue-blueprint'] }],
				},
				{
					id: 'mmo-rework',
					name: 'MMO Microservices Rework',
					info: 'Reworked a monolithic MMO server into microservices, Agile-driven.',
					experiences: [{ person: 'mitko', slug: 'mitko-mmo-rework', tagIds: ['cpp', 'agile'] }],
				},
				{
					id: 'mandragora-early',
					name: 'Mandragora: Whispers of the Witch Tree',
					info: 'Action-RPG — joining the team as the project continued in production.',
					experiences: [{ person: 'adam', slug: 'adam-mandragora-joins', tagIds: ['ue-blueprint'] }],
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
				/* Starts the year after mandragora-early (above, inside the
				   shared 2012 – 2021 box) rather than repeating 2021, since
				   that year's already covered by the first appearance — see
				   the file-level comment above on why Mandragora is split. */
				dateRange: '2022 – 2025',
				stretchToMiddleOf: 'imagic-labs',
				projects: [
					{
						id: 'mandragora',
						name: 'Mandragora: Whispers of the Witch Tree',
						info: 'Action-RPG — final two years: UI/UX, boss encounters, abilities & talent trees.',
						experiences: [{ person: 'adam', slug: 'adam-mandragora', tagIds: ['ui-ux-design', 'encounter-design', 'ue-blueprint'] }],
					},
				],
			},
			{
				id: 'adam-personal-project',
				name: 'Personal Project',
				dateRange: '2024 – Present',
				alignBottomTo: 'kreator-studios',
				projects: [
					{
						id: 'hypha',
						name: 'Hypha: The Wood Wide Web',
						info: 'Network-building strategy board game — waging the underground territorial war of fungi.',
						experiences: [{ person: 'adam', slug: 'adam-personal-project', tagIds: ['tabletop'] }],
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
