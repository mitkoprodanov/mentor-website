import type { ProjectMedia } from './types';

/** Showcase gallery for the Imagic Labs image-gallery product (see data/timeline.ts). */
export const imagicLabsMedia: ProjectMedia[] = [
	{
		src: '',
		kind: 'image-row',
		images: [
			'/projects/imagic-labs/imagic_create_story.jpg',
			'/projects/imagic-labs/imagic_download.jpg',
			'/projects/imagic-labs/imagic_enjoy.jpg', 
		],
		person: 'mitko',
		caption: 'The image gallery app on mobile.',
		tagIds: ['mobile-development', 'clean-code', 'co-dev-teams'],
	}
];
