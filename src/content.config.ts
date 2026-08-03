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
	}),
});

export const collections = { experiences };
