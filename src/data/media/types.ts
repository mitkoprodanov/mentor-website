/** A single showcase item (image, gif, or embedded reel) shown in a Project's detail modal. */
export interface ProjectMedia {
	/**
	 * For 'image'/'gif': a path under /public (e.g. '/projects/hypha/board.jpg'),
	 * or any absolute URL. Placeholder assets live in public/projects/<id>/ —
	 * swap them for real screenshots or gifs without touching anything else.
	 * Static shots use .jpg (or .png); motion clips use .gif.
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
	 */
	src: string;
	/**
	 * 'image' — static shot. 'gif' — motion clip (badged "GIF"). 'facebook-reel'
	 * / 'facebook-video' — an embedded, playable Facebook reel/video (badged
	 * "REEL"/"VIDEO"). 'youtube' — an embedded YouTube video (badged "YOUTUBE").
	 * All videos show in a full-width 16:9 frame.
	 */
	kind: 'image' | 'gif' | 'facebook-reel' | 'facebook-video' | 'youtube';
	/** Short description of what the item shows. */
	caption: string;
	/** Alt text / accessible title — falls back to `caption` when omitted. */
	alt?: string;
	/**
	 * 'youtube' only — play a segment: start at `start` seconds and loop back to
	 * it once `end` seconds is reached. Both optional; omit for the full video.
	 */
	start?: number;
	end?: number;
}
