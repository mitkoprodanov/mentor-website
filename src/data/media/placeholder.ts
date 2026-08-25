import type { ProjectMedia } from './types';

/**
 * Default gallery shown in a project's detail modal until real media is
 * supplied — one image + one gif. Timeline projects (see data/timeline.ts)
 * fall back to this when their ProjectDef has no `media` of its own; give a
 * project its own media file (see the per-project files in this folder) to
 * override it.
 */
export const PLACEHOLDER_MEDIA: ProjectMedia[] = [
	{
		src: '/projects/_placeholder/image.jpg',
		kind: 'image',
		caption: 'Placeholder image — add a screenshot and caption in the data.',
	},
	{
		src: '/projects/_placeholder/motion.gif',
		kind: 'gif',
		caption: 'Placeholder gif — add a short clip and caption in the data.',
	},
];
