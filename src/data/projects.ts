import type { ProjectMedia } from './media/types';

/**
 * Shared project-media plumbing.
 *
 * Projects themselves now live entirely on the career timeline (see
 * data/timeline.ts) — there's no longer a separate standalone Projects
 * section. This module just re-exports the media types and the shared
 * placeholder gallery, so the timeline components that import them from here
 * keep working. Per-project media (image/gif links, captions, and kind) lives
 * per-project under data/media/.
 */
export type { ProjectMedia };
export { PLACEHOLDER_MEDIA } from './media/placeholder';
