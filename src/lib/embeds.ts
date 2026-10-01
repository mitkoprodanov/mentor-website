// Third-party embed endpoints (YouTube / Facebook / LinkedIn). Pure URL builders: nothing in
// this file performs a request. A provider resource is only ever requested after the visitor
// presses that embed's own "Load" button (see ProjectDetail.astro's `.embed-gate` and
// projectModal.client.ts); the "Open on ..." links are ordinary anchors.

/** Privacy-enhanced mode host: EVERY YouTube player iframe is served from here, never from youtube.com. */
export const YOUTUBE_PLAYER_HOST = 'https://www.youtube-nocookie.com';
/** The IFrame API script; loaded lazily, only after the first YouTube video is allowed. */
export const YOUTUBE_API_SRC = 'https://www.youtube.com/iframe_api';

/** Is this a privacy-enhanced YouTube player URL? (Used by tests and as a runtime assertion.) */
export function isPrivacyEnhancedYouTubeEmbed(url: string): boolean {
	return url.startsWith(`${YOUTUBE_PLAYER_HOST}/embed/`);
}

/**
 * The player iframe URL, always on youtube-nocookie.com. `enablejsapi=1` + `origin` let the
 * IFrame API attach to this existing iframe (the API script is only used for playback-state
 * telemetry and segment looping; it never decides which host serves the player).
 * Autoplay is only a request: if the browser refuses it the loaded player simply waits for Play.
 */
export function youtubeEmbedUrl(id: string, opts: { start?: number; origin?: string } = {}): string {
	const params = new URLSearchParams({
		enablejsapi: '1',
		autoplay: '1',
		mute: '1',
		controls: '1',
		rel: '0',
		modestbranding: '1',
		playsinline: '1',
	});
	if (opts.start) params.set('start', String(Math.floor(opts.start)));
	if (opts.origin) params.set('origin', opts.origin);
	return `${YOUTUBE_PLAYER_HOST}/embed/${encodeURIComponent(id)}?${params.toString()}`;
}

export const FACEBOOK_VIDEO_BASE_W = 640;
export const FACEBOOK_VIDEO_BASE_H = 360;

/** Facebook video plugin iframe URL (no SDK/script needed). `pageUrl` = public video/reel page URL. */
export function facebookVideoEmbed(pageUrl: string): string {
	const params = new URLSearchParams({
		href: pageUrl,
		show_text: 'false',
		width: String(FACEBOOK_VIDEO_BASE_W),
		height: String(FACEBOOK_VIDEO_BASE_H),
	});
	return `https://www.facebook.com/plugins/video.php?${params.toString()}`;
}

/** Numeric activity id from a post URL / URN / bare id (as-is when nothing matches). */
function linkedInActivityId(src: string): string {
	const id = src.trim();
	const urn = id.match(/urn:li:(?:activity|share|ugcPost):(\d+)/);
	if (urn) return urn[1];
	if (/^\d+$/.test(id)) return id;
	try {
		const m = new URL(id).pathname.match(/urn:li:(?:activity|share|ugcPost):(\d+)/);
		if (m) return m[1];
	} catch {
		/* leave as-is; the iframe will show LinkedIn's own error */
	}
	return id;
}

/** LinkedIn public embed iframe URL. */
export function linkedInEmbed(src: string): string {
	return `https://www.linkedin.com/embed/feed/update/urn:li:activity:${linkedInActivityId(src)}`;
}

/** Ordinary page URL of a LinkedIn post, for "Open on LinkedIn". */
export function linkedInPostUrl(src: string): string {
	return /^https?:\/\//.test(src.trim())
		? src.trim()
		: `https://www.linkedin.com/feed/update/urn:li:activity:${linkedInActivityId(src)}/`;
}

/** Pull the video id out of any YouTube URL form (or pass through a bare id). */
export function youtubeId(src: string): string {
	try {
		const u = new URL(src);
		const host = u.hostname.replace(/^www\./, '');
		if (host === 'youtu.be') return u.pathname.slice(1);
		if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
			if (u.pathname === '/watch') return u.searchParams.get('v') ?? src;
			const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/);
			if (m) return m[1];
		}
	} catch {
		/* not a URL: assume it's already an id */
	}
	return src;
}

/** Ordinary watch URL for "Open on YouTube". */
export function youtubeWatchUrl(id: string, start?: number): string {
	return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${start ? `&t=${Math.floor(start)}s` : ''}`;
}

// ---- privacy classification of every media kind -------------------------------------------------

import type { ProjectMedia } from '../data/media/types.ts';

export type MediaKind = ProjectMedia['kind'];

/**
 * The consent boundary is "does this contact a third-party provider", never the media format.
 * `Record<MediaKind, ...>` makes the compiler force a decision for every new kind.
 *   local     served by this site: never needs External media permission, never shows a gate
 *   external  embeds/contacts a third party: stays unloaded until External media is allowed
 */
export const MEDIA_KIND_PRIVACY: Readonly<Record<MediaKind, 'local' | 'external'>> = {
	image: 'local',
	gif: 'local',
	'image-row': 'local',
	text: 'local',
	video: 'local', // self-hosted <video> file: our own origin
	youtube: 'external',
	'linkedin-post': 'external',
	'facebook-video': 'external',
	'facebook-reel': 'external',
};

export function requiresExternalMediaConsent(kind: MediaKind): boolean {
	return MEDIA_KIND_PRIVACY[kind] === 'external';
}
