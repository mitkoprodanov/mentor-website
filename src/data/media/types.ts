/** A single showcase image or gif shown in a Project's detail modal. */
export interface ProjectMedia {
	/**
	 * Path under /public (e.g. '/projects/hypha/board.jpg'), or any absolute
	 * URL. Placeholder assets live in public/projects/<id>/ — swap them for real
	 * screenshots or gifs without touching anything else. Static shots use .jpg
	 * (or .png); motion clips use .gif.
	 */
	src: string;
	/** 'gif' marks animated/video media so the UI can badge it; purely cosmetic. */
	kind: 'image' | 'gif';
	/** Short description of what the image/gif shows. */
	caption: string;
	/** Alt text for screen readers — falls back to `caption` when omitted. */
	alt?: string;
}
