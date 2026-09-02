/**
 * A flat catalog of Projects, derived from the career timeline (data/timeline.ts)
 * but deliberately *stripped of the company/fork structure* — no companies,
 * tracks, or apart/together relations. It exists purely for the skill-tag
 * filter's detailed results view (components/projects/FilterResults.astro),
 * which shows matching Projects grouped only by *who worked on them* (both of us,
 * or one side), not by where they happened.
 *
 * Each catalog entry carries everything the detailed view needs: the resolved
 * date range and its parsed start year (for ordering), the union of tag ids from
 * both its experiences and its media, and the raw experience refs + media so the
 * view can render the same detail a project's modal shows.
 */

import type { ProjectMedia } from './media/types';
import { getPerson, COLUMN, type PersonId } from './people';
import { timeline, type CompanyDef, type ExperienceRef, type ProjectDef } from './timeline';

/** Which grouping column a project belongs to: worked on together, or one side only. */
export type ProjectSide = 'both' | 'left' | 'right';

export interface CatalogProject {
	/** Stable key — the project's `modalId` (for split projects) or its `id`. */
	key: string;
	title: string;
	info?: string;
	dateRange?: string;
	/** First year parsed from `dateRange`, for chronological ordering within a group. */
	startYear: number;
	side: ProjectSide;
	/** Experience refs shown in the detail — a split project's `modalExperiences` when set. */
	experiences: ExperienceRef[];
	media: ProjectMedia[];
	/** Union of every tag id on this project's experiences. */
	experienceTagIds: string[];
	/** Union of every tag id across this project's media items. */
	mediaTagIds: string[];
	/** Union of experience + media tag ids — a project matches a filter if this contains it. */
	allTagIds: string[];
}

/** Pull the first 4-digit year out of a date range like "2012 – 2021" or "2026". */
function parseStartYear(dateRange: string | undefined): number {
	const match = dateRange?.match(/\d{4}/);
	return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function sideForPeople(people: Set<PersonId>): ProjectSide {
	if (people.has('mitko') && people.has('adam')) return 'both';
	return people.has('mitko') ? 'left' : 'right';
}

function uniq(values: string[]): string[] {
	return [...new Set(values)];
}

function buildProject(project: ProjectDef, company: CompanyDef): CatalogProject {
	// The detail lists the same people a project's modal does: its
	// `modalExperiences` when a split project overrides them, else its own.
	const experiences = project.modalExperiences ?? project.experiences;
	const media = project.media ?? [];
	const dateRange = project.dateRange ?? company.dateRange;

	const experienceTagIds = uniq(experiences.flatMap((ref) => ref.tagIds ?? []));
	const mediaTagIds = uniq(media.flatMap((m) => m.tagIds ?? []));

	return {
		key: project.modalId ?? project.id,
		// Unnamed single-project companies fall back to the company name, the
		// same fallback the timeline node uses (see data/timeline.ts).
		title: project.name ?? company.name,
		info: project.info,
		dateRange,
		startYear: parseStartYear(dateRange),
		side: sideForPeople(new Set(experiences.map((ref) => ref.person))),
		experiences,
		media,
		experienceTagIds,
		mediaTagIds,
		allTagIds: uniq([...experienceTagIds, ...mediaTagIds]),
	};
}

/** Merge a second appearance of the same project (see the Mandragora split
 *  in data/timeline.ts) into an existing catalog entry: union the
 *  experiences, media, and tag sets so the filter view still surfaces every
 *  tag from either half. Later dates and side re-derived after merging. */
function mergeInto(target: CatalogProject, extra: CatalogProject): void {
	const experiences = [...target.experiences];
	for (const ref of extra.experiences) {
		if (!experiences.some((e) => e.slug === ref.slug)) experiences.push(ref);
	}
	const media = [...target.media];
	for (const m of extra.media) {
		if (!media.some((existing) => existing.src === m.src && existing.kind === m.kind)) media.push(m);
	}
	target.experiences = experiences;
	target.media = media;
	target.experienceTagIds = uniq([...target.experienceTagIds, ...extra.experienceTagIds]);
	target.mediaTagIds = uniq([...target.mediaTagIds, ...extra.mediaTagIds]);
	target.allTagIds = uniq([...target.allTagIds, ...extra.allTagIds]);
	target.side = sideForPeople(new Set(experiences.map((ref) => ref.person)));
	if (extra.startYear < target.startYear) target.startYear = extra.startYear;
}

/** Every project in the timeline, flattened. A project split across timeline
 *  boxes (same `modalId`) is merged into one catalog entry so the filter view
 *  only shows it once, with the union of both halves' experiences and tags. */
export function getCatalogProjects(): CatalogProject[] {
	const byKey = new Map<string, CatalogProject>();
	const order: string[] = [];

	const collect = (company: CompanyDef) => {
		for (const project of company.projects) {
			// The non-owning half of a split project (see ProjectDef.noModal)
			// renders no detail of its own — its owning half already carries the
			// full, merged experience/media set under the shared modalId.
			if (project.noModal) continue;
			const key = project.modalId ?? project.id;
			const built = buildProject(project, company);
			const existing = byKey.get(key);
			if (existing) {
				mergeInto(existing, built);
				continue;
			}
			byKey.set(key, built);
			order.push(key);
		}
	};

	for (const entry of timeline) {
		if (entry.kind === 'together') collect(entry.company);
		else {
			entry.mitko.forEach(collect);
			entry.adam.forEach(collect);
		}
	}

	return order.map((key) => byKey.get(key)!);
}

export interface CatalogGroups {
	/** Worked on together — shown first, full-width, oldest first. */
	both: CatalogProject[];
	/** Mitko's solo projects — the left column, oldest first. */
	left: CatalogProject[];
	/** Ádám's solo projects — the right column, oldest first. */
	right: CatalogProject[];
}

/** The catalog split into its three groups, each ordered by start date (oldest first). */
export function getCatalogGroups(): CatalogGroups {
	const byStartYear = (a: CatalogProject, b: CatalogProject) => a.startYear - b.startYear;
	const projects = getCatalogProjects();
	return {
		both: projects.filter((p) => p.side === 'both').sort(byStartYear),
		left: projects.filter((p) => p.side === 'left').sort(byStartYear),
		right: projects.filter((p) => p.side === 'right').sort(byStartYear),
	};
}

/** The person heading each solo column (used for its label / accent colour). */
export const COLUMN_PERSON: Record<'left' | 'right', PersonId> = {
	left: (Object.keys(COLUMN) as PersonId[]).find((id) => COLUMN[id] === 'left')!,
	right: (Object.keys(COLUMN) as PersonId[]).find((id) => COLUMN[id] === 'right')!,
};

export { getPerson };
