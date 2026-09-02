import type { PersonId } from './people';
import type { ProjectMedia } from './projects';
import { exigoMedia } from './media/exigo';
import { warhammerMarkOfChaosMedia } from './media/warhammer-mark-of-chaos';
import { heroes6Media } from './media/heroes6';
import { supernovaMedia } from './media/supernova';
import { lolUniverseMedia } from './media/lol-universe';
import { aroundMedia } from './media/around';
import { beastsOfBrawliaMedia } from './media/beasts-of-brawlia';
import { mmoReworkMedia } from './media/mmo-rework';
import { mandragoraMedia } from './media/mandragora';
import { hyphaMedia } from './media/hypha';
import { biobotMedia } from './media/biobot';
import { spacePunksMedia } from './media/space-punks';
import { imagicLabsMedia } from './media/imagic-labs';
import { kreatorMedia } from './media/kreator';
import { mentorMedia } from './media/mentor';

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
	/**
	 * Year (or year range) shown in this project's detail modal. Overrides the
	 * enclosing company's `dateRange` — used when a single project inside a
	 * longer-running company happened in a specific year (e.g. Biobot's 2026
	 * competition win inside Ádám's 2024 – Present personal-project box).
	 * Falls back to the company's `dateRange` when omitted.
	 */
	dateRange?: string;
	/** Short project-level blurb shown on the timeline's center node card, alongside `name`. */
	info?: string;
	experiences: ExperienceRef[];
	/**
	 * Showcase gallery for this project's detail modal — the one that opens
	 * when its node is clicked (see ProjectRow.astro / ProjectModal.astro).
	 * Each entry is `{ src, kind: 'image' | 'gif', caption, alt? }` (see
	 * ProjectMedia in data/projects.ts). Omit it and the project falls back to
	 * the shared PLACEHOLDER_MEDIA (one image + one gif); add your own here to
	 * override — e.g.
	 *   media: [
	 *     { src: '/projects/heroes6/battle.jpg', kind: 'image', caption: 'A boss encounter mid-fight.' },
	 *     { src: '/projects/heroes6/ai.gif',     kind: 'gif',   caption: 'Campaign AI planning a turn.' },
	 *   ]
	 * Only projects with a `name` render a clickable node, so only those show a modal.
	 */
	media?: ProjectMedia[];
	/**
	 * Overrides this row's detail-modal id (default: the project `id`,
	 * namespaced `tl-` at render time). Two layout rows sharing the same
	 * `modalId` open one and the same modal — used to fuse a project that's
	 * been split into separate rows purely for grid layout (see `around-mitko`
	 * / `around-adam`) back into a single clickable card. Exactly one of the
	 * rows renders that shared modal (carrying the full `modalExperiences` and
	 * `media`); the other sets `noModal`. Rows that share a `modalId` also
	 * highlight together on hover (see CompanyBlock.astro), so the split reads
	 * as one clickable area.
	 */
	modalId?: string;
	/**
	 * Experiences shown *inside the modal*, when they differ from this row's
	 * own inline `experiences` — e.g. the modal-owning half of a split project
	 * lists both people here, so its inline card still shows just one person
	 * while the shared modal shows both (exactly like a naturally-joint project
	 * such as Supernova). Defaults to `experiences`.
	 */
	modalExperiences?: ExperienceRef[];
	/**
	 * This row renders no modal of its own; its click target still opens the
	 * shared modal named by `modalId`. Set on the non-owning half of a split
	 * project (see `around-adam`).
	 */
	noModal?: boolean;
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
	/** Renders the reusable Vision sentence (see components/common/Vision.astro)
	 *  right inside this project's preview box — used on the Together Again
	 *  project so the studio's pitch reads as *part of* the reunion project
	 *  card, not just a hero-only element. */
	showVision?: boolean;
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
						experiences: [{ person: 'mitko', slug: 'mitko-ericsson' }],
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
						info: 'Real-time strategy game with asymmetric factions and two-level scenarios',
						media: exigoMedia,
						experiences: [{ person: 'adam', slug: 'adam-exigo', tagIds: ['level-design', 'balance', 'proprietary-engine', 'devtools'] }],
					},
					{
						id: 'warhammer-mark-of-chaos',
						name: 'Warhammer: Mark of Chaos & Battle March',
						info: 'Real-time tactics game set in the Warhammer universe',
						media: warhammerMarkOfChaosMedia,
						experiences: [{ person: 'adam', slug: 'adam-warhammer-mark-of-chaos', tagIds: ['systems-design', 'level-design', 'ip-critical-design', 'ai', 'navigation', 'proprietary-engine', 'devtools'] }],
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
					info: 'Turn-based fantasy strategy-RPG combining exploration, army management, hero progression, and tactical combat',
					media: heroes6Media,
					experiences: [
						{ person: 'mitko', slug: 'mitko-heroes6', tagIds: ['ai'] },
						{ person: 'adam', slug: 'adam-heroes6', tagIds: ['ux-design', 'ui', 'systems-design', 'level-design'] },
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
					info: 'Supernova takes an innovative approach to the multiplayer online battle arena (MOBA) genre by adding real-time strategy (RTS) elements and promises an exciting science fiction setting with vast potential',
					media: supernovaMedia,
					experiences: [
						{
							person: 'mitko',
							slug: 'mitko-supernova',
							tagIds: ['ai', 'navigation', 'ability', 'progression'],
						},
						{ person: 'adam', slug: 'adam-supernova', tagIds: ['systems-design', 'level-design', 'progression'] },
					],
				},
				{
					id: 'lol-universe',
					name: 'League of Legends Universe',
					info: 'Primal Game Studio partnered with Riot Games on the co-development of an unannounced project',
					media: lolUniverseMedia,
					experiences: [
						{ person: 'mitko', slug: 'mitko-lol-universe' },
						{ person: 'adam', slug: 'adam-lol-universe' },
					],
				},
				{
					id: 'around-mitko',
					name: 'Around',
					info: 'A beautiful journey into the realm of forgotten memories, Around is a hand-drawn point-and-click adventure game',
					rowSpan: 2,
					squareBottomRight: true,
					// The two "Around" rows are one project split for layout — this half
					// owns the shared modal and lists both people so it reads like any
					// other joint project (see ProjectDef.modalId / modalExperiences).
					modalId: 'around',
					media: aroundMedia,
					modalExperiences: [
						{ person: 'mitko', slug: 'mitko-around' },
						{ person: 'adam', slug: 'adam-around', tagIds: ['blueprint-scripting'] },
					],
					experiences: [{ person: 'mitko', slug: 'mitko-around' }],
				},
				{
					id: 'beasts-of-brawlia',
					name: 'Beasts of Brawlia',
					info: 'Fun-oriented local and online arena brawler, where competition will create and destroy friendships',
					media: beastsOfBrawliaMedia,
					experiences: [{ person: 'adam', slug: 'adam-beasts-of-brawlia' }],
				},
				{
					id: 'around-adam',
					name: 'Around',
					info: 'A beautiful journey into the realm of forgotten memories, Around is a hand-drawn point-and-click adventure game',
					bridgeLeft: true,
					// The other half of the same "Around" project — opens the shared
					// modal owned by `around-mitko` above; renders none of its own.
					modalId: 'around',
					noModal: true,
					experiences: [{ person: 'adam', slug: 'adam-around', tagIds: ['blueprint-scripting'] }],
				},
				{
					id: 'mmo-rework',
					name: 'MMO Microservices Rework',
					info: 'Reworked a monolithic MMO server into microservices, Agile-driven.',
					media: mmoReworkMedia,
					experiences: [{ person: 'mitko', slug: 'mitko-mmo-rework', tagIds: ['agile'] }],
				},
				{
					id: 'mandragora-early',
					// Shares its modal identity with the later `mandragora` entry
					// (see the file-level comment above on why Mandragora is
					// split across two timeline boxes) — the filter view merges
					// the pair back into one card by modalId so it only appears
					// once, with both experiences and the union of their tags.
					modalId: 'mandragora',
					name: 'Mandragora: Whispers of the Witch Tree',
					info: 'Challenging 2.5D side-scroller action-RPG with Soulslike depth',
					media: mandragoraMedia,
					experiences: [{ person: 'adam', slug: 'adam-mandragora-joins' }],
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
						name: 'Space Punks',
						info: 'Sci-fi co-op action RPG in Unreal Engine 4 — gameplay features and a deep dive into GAS.',
						media: spacePunksMedia,
						experiences: [{ person: 'mitko', slug: 'mitko-flying-wild-hog', tagIds: ['unreal-gas'] }],
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
						name: 'Image Gallery Product',
						info: 'A mobile image-gallery startup product — SOLID and Clean Code in daily practice.',
						media: imagicLabsMedia,
						experiences: [
							{
								person: 'mitko',
								slug: 'mitko-imagic-labs',
								tagIds: ['mobile-development', 'clean-code'],
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
						name: 'Original IP Prototype',
						info: 'An original pitch taken to a playable prototype — networking foundations and core gameplay.',
						media: kreatorMedia,
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
						// See `mandragora-early` above — same modalId collapses
						// the split pair into one card in the filter view.
						modalId: 'mandragora',
						name: 'Mandragora: Whispers of the Witch Tree',
						info: 'Challenging 2.5D side-scroller action-RPG with Soulslike depth',
						media: mandragoraMedia,
						experiences: [{ person: 'adam', slug: 'adam-mandragora', tagIds: ['ux-design', 'ui', 'encounter'] }],
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
						info: 'Network-building strategy board game, waging the underground territorial war of fungi',
						media: hyphaMedia,
						experiences: [{ person: 'adam', slug: 'adam-personal-project', tagIds: ['board-game', 'board-game-design', 'prototyping', 'playtesting', 'balance', 'ui', 'ux-design'] }],
					},
					{
						id: 'biobot',
						name: 'Biobot',
						info: 'Tableau-building strategic card game with innovative systemic mechanics',
						dateRange: '2026',
						media: biobotMedia,
						experiences: [{ person: 'adam', slug: 'adam-biobot', tagIds: ['board-game', 'board-game-design', 'prototyping', 'playtesting', 'balance', 'ui', 'ux-design', 'puzzle-design'] }],
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
					name: 'Original Game Project',
					info: 'Reunited at Mentor Game Studio in 2026 to build a new original game together.',
					showVision: true,
					media: mentorMedia,
					experiences: [
						{ person: 'mitko', slug: 'mitko-mentor' },
						{ person: 'adam', slug: 'adam-mentor' },
					],
				},
			],
		},
	},
];
