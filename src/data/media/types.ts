import type { PersonId } from '../people';

/** A single showcase item (image, gif, video, embedded reel, or a text note) shown in a Project's detail modal. */
export interface ProjectMedia {
	/**
	 * For 'image'/'gif': a path under /public (e.g. '/projects/hypha/board.jpg'),
	 * or any absolute URL. Placeholder assets live in public/projects/<id>/ —
	 * swap them for real screenshots or gifs without touching anything else.
	 * Static shots use .jpg (or .png); motion clips use .gif.
	 *
	 * For 'video': a path under /public to a self-hosted video file
	 * (e.g. '/projects/exigo/exigo.mp4'). Rendered inline with a native
	 * <video> element (controls, no autoplay).
	 *
	 * For 'facebook-reel' / 'facebook-video': the public page URL of the reel
	 * (e.g. 'https://www.facebook.com/reel/291274308860973') or video (e.g.
	 * 'https://www.facebook.com/watch/?v=938966559787679'). Both embed via
	 * Facebook's video plugin iframe (no SDK/script needed) and must be public
	 * to render.
	 *
	 * For 'youtube': any YouTube URL (watch?v=…, youtu.be/…, /embed/…) or a bare
	 * video id. Embedded via the YouTube IFrame Player API (see
	 * projectModal.client.ts) so `start`/`end` can loop a segment.
	 *
	 * For 'linkedin-post': a LinkedIn post URL (e.g.
	 * 'https://www.linkedin.com/feed/update/urn:li:activity:7331711027287404545/'),
	 * a bare activity URN ('urn:li:activity:…'), or just the numeric activity id.
	 * Embedded via LinkedIn's public post-embed iframe — no SDK/script needed —
	 * and the post must be publicly visible to render.
	 *
	 * For 'image-row': unused — the composite's images live in `images`
	 * instead. Pass an empty string.
	 *
	 * For 'text': unused — the note's own text lives in `caption` (used as the
	 * body) instead of pointing at an asset. Pass an empty string.
	 */
	src: string;
	/**
	 * 'image' — static shot. 'gif' — motion clip (badged "GIF"). 'video' — a
	 * self-hosted mp4/webm file (badged "VIDEO"). 'facebook-reel' /
	 * 'facebook-video' — an embedded, playable Facebook reel/video (badged
	 * "REEL"/"VIDEO"). 'youtube' — an embedded YouTube video (badged
	 * "YOUTUBE"). 'linkedin-post' — an embedded LinkedIn post (badged
	 * "LINKEDIN"), shown in a full-width portrait-ish frame that scrolls
	 * internally if the post is taller. 'image-row' — a composite of several
	 * static shots (from `images`) laid out horizontally, widths distributed
	 * so every image ends up at the same height and the row spans the full
	 * gallery width. 'text' — a plain text note inline in the gallery, no
	 * asset. All videos show in a full-width 16:9 frame.
	 */
	kind: 'image' | 'gif' | 'video' | 'facebook-reel' | 'facebook-video' | 'youtube' | 'linkedin-post' | 'image-row' | 'text';
	/**
	 * Which person this item belongs to. Omit for shared media (the default
	 * — belongs to everyone on the project). When set, the item reads as
	 * attributed to just that person: the gallery card is tinted with their
	 * accent, slightly narrower, and offset toward their side of the layout
	 * (Mitko left, Ádám right — see data/people.ts).
	 */
	person?: PersonId;
	/** Short description of what the item shows. */
	caption: string;
	/** Alt text / accessible title — falls back to `caption` when omitted. */
	alt?: string;
	/**
	 * WorkTag ids (see data/tags.ts) this specific media item illustrates —
	 * edit them right here alongside the item's `src` (link) and `caption`
	 * (description). They drive the skill-tag filter's detailed results view
	 * (see components/projects/FilterResults.astro): while a tag is active,
	 * only media whose `tagIds` include it stay visible, and a Project shows in
	 * the results if *either* one of its experiences *or* one of its media
	 * carries the active tag — so a Project with no matching experience tag can
	 * still surface purely on a tagged media item. Omit for media that
	 * shouldn't appear under any filter.
	 */
	tagIds?: string[];
	/**
	 * 'youtube' only — play a segment: start at `start` seconds and loop back to
	 * it once `end` seconds is reached. Both optional; omit for the full video.
	 */
	start?: number;
	end?: number;
	/**
	 * 'image-row' only — the images that make up the composite, in the order
	 * they appear left-to-right. Each entry is a `/public` path or absolute
	 * URL, same as `src` on a plain 'image' item. Widths are distributed at
	 * render time so all images end up the same height and together span the
	 * full gallery width; add or reorder freely without touching layout.
	 */
	images?: string[];
}
