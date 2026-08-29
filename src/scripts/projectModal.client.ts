/**
 * Project detail modals. Each ProjectCard renders a trigger button
 * (`[data-project-open="<id>"]`) next to a native `<dialog>`
 * (`[data-project-modal="<id>"]`). Clicking the card opens the dialog with
 * `showModal()` — which gives us the top-layer overlay, `::backdrop`, focus
 * trapping, and Escape-to-close for free. On top of that we add:
 *   - click on the backdrop (i.e. outside the padded panel) closes it,
 *   - the explicit close button (`[data-project-close]`) closes it, and
 *   - the page behind is locked from scrolling while any dialog is open.
 *
 * The scroll lock is driven off a MutationObserver watching each dialog's
 * `open` attribute rather than the `close` event — so it stays correct no
 * matter how the dialog was dismissed (button, backdrop, or native Escape),
 * which the click/keyboard paths alone wouldn't all cover.
 */

function syncScrollLock(): void {
	const anyOpen = document.querySelector('dialog[data-project-modal][open]');
	document.body.style.overflow = anyOpen ? 'hidden' : '';
}

/**
 * A Facebook video/reel embeds as a fixed-size cross-origin iframe (640×360, see
 * ProjectModal.astro) whose content can't be reflowed from here. To make it
 * fill the card's full width at any size without letterboxing, scale the whole
 * iframe by (container width ÷ 640); its 16:9 height then matches the frame's
 * own 16:9 box exactly. Re-run whenever a frame changes size — which includes
 * the moment its modal opens (0 → width) and any viewport resize.
 */
const VIDEO_BASE_W = 640;

function scaleVideo(frame: Element): void {
	const iframe = frame.querySelector<HTMLIFrameElement>('.shot-video');
	if (!iframe) return;
	const width = (frame as HTMLElement).clientWidth;
	if (width > 0) iframe.style.transform = `scale(${width / VIDEO_BASE_W})`;
}

function initVideos(): void {
	const frames = document.querySelectorAll<HTMLElement>('.shot-frame--video');
	if (frames.length === 0) return;
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) scaleVideo(entry.target);
	});
	frames.forEach((frame) => {
		observer.observe(frame);
		scaleVideo(frame);
	});
}

/* ---- YouTube embeds -------------------------------------------------------
 * A `.shot-youtube` mount (data-yt-id / optional data-start / data-end) becomes
 * a YouTube IFrame Player API player the first time its modal opens — the API
 * lets us loop an arbitrary [start, end] segment, which the plain iframe embed
 * params can't do reliably. Players are created lazily (the API script only
 * loads once a modal with a YouTube mount is actually opened), reused on
 * reopen, and paused when their modal closes so nothing plays in the
 * background. Playing is muted so browsers allow it to start on its own. */
interface YtEntry {
	player: any;
	start: number;
	end: number | null;
	timer: number | null;
}

const ytPlayers = new WeakMap<HTMLElement, YtEntry>();
let ytApiPromise: Promise<any> | null = null;

function loadYouTubeApi(): Promise<any> {
	const w = window as any;
	if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
	if (ytApiPromise) return ytApiPromise;
	ytApiPromise = new Promise((resolve) => {
		const prev = w.onYouTubeIframeAPIReady;
		w.onYouTubeIframeAPIReady = () => {
			if (typeof prev === 'function') prev();
			resolve(w.YT);
		};
		const tag = document.createElement('script');
		tag.src = 'https://www.youtube.com/iframe_api';
		document.head.appendChild(tag);
	});
	return ytApiPromise;
}

/**
 * A YouTube frame is "live" only when it's actually on screen. In a modal every
 * frame is; in the filter-results panel, though, a frame sits inside a Project
 * card that the active tag may have hidden, or is itself a `.shot` the tag
 * filtered out (`.fr-hidden`) — those must not spin up a (muted-)playing
 * background player. In the modal there's no `.fr-hidden`/hidden card ancestor,
 * so this always passes there.
 */
function isFrameLive(frame: HTMLElement): boolean {
	if (frame.closest('.shot')?.classList.contains('fr-hidden')) return false;
	const card = frame.closest<HTMLElement>('[data-fr-card]');
	if (card && card.hidden) return false;
	return true;
}

async function activateYouTube(scope: HTMLElement): Promise<void> {
	const frames = Array.from(scope.querySelectorAll<HTMLElement>('.shot-frame--youtube')).filter(isFrameLive);
	if (frames.length === 0) return;
	const YT = await loadYouTubeApi();
	frames.forEach((frame) => {
		const existing = ytPlayers.get(frame);
		if (existing) {
			existing.player.seekTo?.(existing.start, true);
			existing.player.playVideo?.();
			return;
		}
		const mount = frame.querySelector<HTMLElement>('.shot-youtube[data-yt-id]');
		if (!mount) return;

		const start = Number(mount.dataset.start ?? 0) || 0;
		const end = mount.dataset.end ? Number(mount.dataset.end) : null;
		const entry: YtEntry = { player: null, start, end, timer: null };

		entry.player = new YT.Player(mount, {
			width: '100%',
			height: '100%',
			videoId: mount.dataset.ytId,
			host: 'https://www.youtube-nocookie.com',
			playerVars: { start, autoplay: 1, mute: 1, controls: 1, rel: 0, modestbranding: 1, playsinline: 1 },
			events: {
				onReady: (e: any) => {
					e.target.seekTo(start, true);
					e.target.playVideo();
				},
				onStateChange: (e: any) => {
					// Loop the [start, end] segment: while playing, poll the time and
					// jump back to `start` once `end` is passed. (Also catches a video
					// that ends naturally before `end`.)
					if (e.data === YT.PlayerState.ENDED) {
						entry.player.seekTo(start, true);
						entry.player.playVideo();
						return;
					}
					if (!end) return;
					if (e.data === YT.PlayerState.PLAYING && entry.timer === null) {
						entry.timer = window.setInterval(() => {
							if ((entry.player.getCurrentTime?.() ?? 0) >= end) entry.player.seekTo(start, true);
						}, 200);
					} else if (e.data !== YT.PlayerState.PLAYING && entry.timer !== null) {
						clearInterval(entry.timer);
						entry.timer = null;
					}
				},
			},
		});
		ytPlayers.set(frame, entry);
	});
}

function pauseYouTube(scope: HTMLElement): void {
	scope.querySelectorAll<HTMLElement>('.shot-frame--youtube').forEach((frame) => {
		ytPlayers.get(frame)?.player?.pauseVideo?.();
	});
}

function openById(id: string | null): void {
	if (!id) return;
	const dialog = document.querySelector<HTMLDialogElement>(`dialog[data-project-modal="${id}"]`);
	if (dialog && !dialog.open) dialog.showModal();
}

function init(): void {
	const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[data-project-modal]');
	if (dialogs.length === 0) return;

	initVideos();

	document.addEventListener('click', (event) => {
		const el = event.target as HTMLElement;

		const opener = el.closest<HTMLElement>('[data-project-open]');
		if (opener) {
			openById(opener.getAttribute('data-project-open'));
			return;
		}

		if (el.closest('[data-project-close]')) {
			el.closest<HTMLDialogElement>('dialog[data-project-modal]')?.close();
		}
	});

	const observer = new MutationObserver((mutations) => {
		syncScrollLock();
		for (const mutation of mutations) {
			const dialog = mutation.target as HTMLElement;
			if (dialog.hasAttribute('open')) void activateYouTube(dialog);
			else pauseYouTube(dialog);
		}
	});

	dialogs.forEach((dialog) => {
		// The panel owns all the padding, so a click whose target is the
		// <dialog> element itself can only have landed on the backdrop.
		dialog.addEventListener('click', (event) => {
			if (event.target === dialog) dialog.close();
		});

		observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
	});

	// The filter-results panel isn't a <dialog>, so drive its YouTube embeds off
	// the filter state instead: on every change, pause every player in the panel,
	// then (re)activate just the ones the new filter leaves visible. Fired on each
	// tag switch — not only open/close — so swapping directly from one tag to
	// another retargets which clips play (see tagFilter.client.ts).
	document.addEventListener('filter:change', (event) => {
		const results = document.getElementById('filter-results');
		if (!results) return;
		pauseYouTube(results);
		if ((event as CustomEvent<{ active: boolean }>).detail?.active) void activateYouTube(results);
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
