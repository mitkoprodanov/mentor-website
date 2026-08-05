import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Long-form prose lives here as Markdown, one file per person-per-project.
// The connective structure (who worked where, project ordering, dates) lives
// in src/data/timeline.ts and points at these files by slug.
const experiences = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/experiences' }),
	schema: z.object({
		person: z.enum(['mitko', 'adam']),
		project: z.string(),
		/** What kind of work this entry describes — shown as a small badge on the card. */
		category: z.enum(['content', 'system-feature']).optional(),
		/** Optional showcase link (e.g. a YouTube video) — reveals an inline embed when the card is expanded. */
		link: z.string().url().optional(),
		/** Optional fallback thumbnail for non-video showcase links. */
		previewImage: z.string().optional(),
	}),
});

export const collections = { experiences };
