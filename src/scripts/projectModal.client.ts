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

import { telemetry } from '../lib/telemetry';
import { announce, UI_EVENT } from '../lib/telemetry/uiEvents.ts';
import { attemptOpenProject } from '../lib/telemetry/actionFlows.ts';
import { buildActionFailed } from '../lib/telemetry/explicitEvents.ts';

/**
 * The `project_content` figure a playable media element sits inside (docs
 * section 17.7) — the element `visibility.client.ts` actually registered
 * with the engine, so every `telemetry.setVisibilityPlaying`/
 * `setVisibilityPlayableSuspended` call in this file targets it, not the
 * inner iframe/video/mount. Returns null for media that isn't instrumented
 * (no `projectId` was passed into ProjectDetail.astro) — every call site
 * already guards on this before touching telemetry.
 */
function playableFigure(el: Element): HTMLElement | null {
	return el.closest<HTMLElement>('[data-visibility-target-type="project_content"]');
}

/** Why the dialog is closing, set by the code path that closes it (telemetry
 *  only). The native `<dialog>` `cancel` event (Escape, or another platform
 *  cancellation such as a back gesture) has no click path, so it is recorded
 *  as `cancel` directly from that event — deliberately not "escape", since we
 *  only know the browser/platform cancelled the dialog, not which physical
 *  input triggered it. */
let pendingCloseReason: string | undefined;

function syncScrollLock(): void {
	const anyOpen = document.querySelector('dialog[data-project-modal][open]');
	document.body.style.overflow = anyOpen ? 'hidden' : '';
}

/**
 * A `<dialog>` opened via `showModal()` renders in the browser's top layer, so
 * nothing in normal flow — including our sticky person bar — can ever render
 * above its ::backdrop with plain z-index. The workaround: promote the person
 * bar into the top layer too, by showing it as a popover. Later-opened top-layer
 * entrants stack above earlier ones, so the bar ends up above the modal's
 * backdrop while its two cards remain their normal closed selves, on the sides.
 *
 * We also publish a `data-modal-people` attribute on the body naming whose
 * experience appears in the open modal — the Skills toggle on those cards is
 * disabled (see ScrollyRegion.astro), so the closed card reads as attribution.
 */
function syncPersonBarPopover(): void {
	const bar = document.getElementById('person-bar') as (HTMLElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
	if (!bar) return;
	const openDialog = document.querySelector<HTMLDialogElement>('dialog[data-project-modal][open]');
	if (openDialog) {
		const people = openDialog.getAttribute('data-project-people') ?? '';
		document.body.setAttribute('data-modal-people', people);
		try {
			bar.showPopover?.();
		} catch {
			/* already open, or popover API unavailable — fall through */
		}
	} else {
		document.body.removeAttribute('data-modal-people');
		try {
			bar.hidePopover?.();
		} catch {
			/* already closed */
		}
	}
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

/**
 * `image-row` composites (see ProjectDetail.astro) lay several images side by
 * side and want all of them at the same rendered height, with the row spanning
 * the full frame width. That's `flex-grow` proportional to each image's own
 * intrinsic aspect (width/height): width_i = W · a_i / Σa, so height_i =
 * width_i / a_i = W / Σa — the same for every image. We can only set that once
 * an image has loaded (naturalWidth/Height become known); until then, the CSS
 * default of `flex: 1 1 0` distributes width evenly.
 */
function initImageRows(): void {
	document.querySelectorAll<HTMLElement>('[data-image-row]').forEach((row) => {
		row.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
			const apply = () => {
				const w = img.naturalWidth;
				const h = img.naturalHeight;
				if (w > 0 && h > 0) img.style.flexGrow = String(w / h);
			};
			if (img.complete) apply();
			else img.addEventListener('load', apply, { once: true });
		});
	});
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

/**
 * Native `<video>` playback telemetry (docs section 17.7): real `playing`/
 * `pause`/`ended` events are the only source of `playing_v*`/`video_start` —
 * never inferred from the `autoplay` attribute, the scroll-driven
 * pause/resume below (pauseFrameMedia/resumeFrameMedia), or visibility. Those
 * functions call the video's own `.pause()`/`.play()`, which fire these same
 * real events, so both the visitor's own controls and the scroll-visibility
 * feature are captured identically through one listener set. `playing`
 * (not `play`) is used as the "started" signal — it fires once frames are
 * actually rendering, which is what "known actual playback" means here.
 */
function initNativeVideoPlayback(): void {
	document.querySelectorAll<HTMLVideoElement>('.shot-video-native').forEach((video) => {
		const figure = playableFigure(video);
		if (!figure) return;
		video.addEventListener('playing', () => telemetry.setVisibilityPlaying(figure, true));
		video.addEventListener('pause', () => telemetry.setVisibilityPlaying(figure, false));
		video.addEventListener('ended', () => telemetry.setVisibilityPlaying(figure, false));
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
	/** Set when the scroll-visibility observer (see initVisibilityPause below)
	 *  paused this player because it scrolled out of view — as opposed to the
	 *  user pausing it themselves via the player's own controls. Only a
	 *  visibility-driven pause is ever auto-resumed. */
	autoPaused: boolean;
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
			existing.autoPaused = false;
			existing.player.seekTo?.(existing.start, true);
			existing.player.playVideo?.();
			return;
		}
		const mount = frame.querySelector<HTMLElement>('.shot-youtube[data-yt-id]');
		if (!mount) return;

		const start = Number(mount.dataset.start ?? 0) || 0;
		const end = mount.dataset.end ? Number(mount.dataset.end) : null;
		const entry: YtEntry = { player: null, start, end, timer: null, autoPaused: false };

		entry.player = new YT.Player(mount, {
			width: '100%',
			height: '100%',
			videoId: mount.dataset.ytId,
			host: 'https://www.youtube-nocookie.com',
			playerVars: { start, autoplay: 1, mute: 1, controls: 1, rel: 0, modestbranding: 1, playsinline: 1 },
			events: {
				// `onReady` is the real, observable moment the IFrame API player
				// actually exists and can play — before this, `mount` was just a
				// placeholder div, not a live embed (docs section 17.7). Unsuspends
				// the shared engine target so playable_v* can start accounting.
				onReady: (e: any) => {
					e.target.seekTo(start, true);
					e.target.playVideo();
					const figure = playableFigure(frame);
					if (figure) telemetry.setVisibilityPlayableSuspended(figure, false);
				},
				// `onStateChange` is the YouTube IFrame API's real playback-state
				// signal (docs section 17.7) — the same event this loop logic
				// already relies on, so playing_v*/video_start ride on genuinely
				// observed state, never inferred from autoplay or the iframe's
				// existence.
				onStateChange: (e: any) => {
					const figure = playableFigure(frame);
					if (figure) {
						if (e.data === YT.PlayerState.PLAYING) telemetry.setVisibilityPlaying(figure, true);
						else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) telemetry.setVisibilityPlaying(figure, false);
					}
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
		const entry = ytPlayers.get(frame);
		entry?.player?.pauseVideo?.();
		if (entry) entry.autoPaused = false;
	});
}

/**
 * Facebook video/reel iframes have no JS API — blanking src is the only way to
 * fully stop them (a hidden dialog still plays audio otherwise). We save the
 * original src once in `data-fb-base` and restore it when a modal opens so the
 * user can click to play; blanking again on close stops any in-progress audio.
 *
 * `about:blank` (not empty string) is important — `src=""` resolves relative
 * to the document base and would load the entire page inside each iframe.
 *
 * `loading="eager"` is set in `initFacebook`: inside a <dialog> top-layer or
 * position:fixed panel the browser's IntersectionObserver can't determine
 * visibility, so `loading="lazy"` (the template default) would never trigger
 * and the iframes would stay blank.
 *
 * Deliberately NOT wired into the scroll-visibility feature below (unlike
 * native video and YouTube): several attempts at pausing/unloading Facebook
 * embeds purely on scroll position (blanking src with a CSS-hidden overlay,
 * then fully detaching/reattaching the iframe) all fell short of hiding and
 * reshowing them cleanly, given the plugin's total lack of a JS/postMessage
 * API. Facebook videos are left alone once their modal/panel is open — they
 * only start (on open) and stop (on close), same as before that feature
 * existed.
 */
function initFacebook(): void {
	document.querySelectorAll<HTMLIFrameElement>('.shot-frame--video .shot-video').forEach((iframe) => {
		const initial = iframe.getAttribute('src') ?? '';
		if (initial) iframe.dataset.fbBase = initial;
		iframe.loading = 'eager';
		iframe.src = 'about:blank';
	});
}

function stopFacebook(scope: HTMLElement): void {
	scope.querySelectorAll<HTMLIFrameElement>('.shot-frame--video .shot-video').forEach((iframe) => {
		iframe.src = 'about:blank';
		// Blanked = not live (docs section 17.7) — playable_v* stops accounting.
		// Also covered by the instance-boundary force-end when this is a real
		// modal/filter close, but explicit here too since a blanked iframe is
		// never playable regardless of the reason it got blanked.
		const figure = playableFigure(iframe);
		if (figure) telemetry.setVisibilityPlayableSuspended(figure, true);
	});
}

function activateFacebook(scope: HTMLElement): void {
	Array.from(scope.querySelectorAll<HTMLElement>('.shot-frame--video')).filter(isFrameLive).forEach((frame) => {
		const iframe = frame.querySelector<HTMLIFrameElement>('.shot-video');
		if (!iframe?.dataset.fbBase) return;
		iframe.src = iframe.dataset.fbBase;
		// The real src is live now (docs section 17.7) — this is the only
		// signal Facebook's opaque plugin iframe gives us; playing_v* is never
		// derived from it (no JS/postMessage API — see initFacebook above).
		const figure = playableFigure(frame);
		if (figure) telemetry.setVisibilityPlayableSuspended(figure, false);
	});
}

/* ---- Scroll-visibility pause/resume ---------------------------------------
 * Native video and the YouTube API players both auto-play as soon as their
 * modal/panel opens, regardless of which of the gallery's several media items
 * actually sits in view — a project with more than one video would otherwise
 * play all of them at once, off-screen ones included. This observer keeps
 * only the visible one(s) running: below 50% visible, pause whatever's
 * currently playing; back above 50%+hysteresis, resume only what *this*
 * observer paused — never a video the visitor paused themselves via its own
 * controls, and never one that was simply never started.
 *
 * The two thresholds (rather than one) are the hysteresis band: without it,
 * hovering right at the 50% edge while scrolling would rapidly pause/resume
 * on every tiny wobble. `50% hide / 65% show` matches the Visibility Matrix
 * v50 threshold planned for telemetry (see docs/telemetry.md) while keeping
 * enough of a gap that the two states don't flap.
 *
 * Facebook embeds are deliberately excluded — see the comment on
 * initFacebook above.
 *
 * IntersectionObserver's ratio already accounts for clipping by scrollable
 * ancestors — the modal's own internally-scrolled panel included — so `root:
 * null` (the page viewport) is correct for frames inside the <dialog> and
 * inside the fixed filter-results panel alike; no per-container root needed.
 * A closed dialog / inactive filter panel is `display: none`, which reports
 * ratio 0 unconditionally, so this naturally leaves already-inactive media
 * alone without any extra scope checks.
 */
const VISIBILITY_HIDE_THRESHOLD = 0.5;
const VISIBILITY_SHOW_THRESHOLD = 0.65;

function pauseFrameMedia(frame: HTMLElement): void {
	if (frame.classList.contains('shot-frame--native-video')) {
		const video = frame.querySelector<HTMLVideoElement>('.shot-video-native');
		if (video && !video.paused) {
			video.pause();
			video.dataset.autoPaused = '1';
		}
		return;
	}
	if (frame.classList.contains('shot-frame--youtube')) {
		const entry = ytPlayers.get(frame);
		const YT = (window as any).YT;
		if (entry?.player?.getPlayerState && YT && entry.player.getPlayerState() === YT.PlayerState.PLAYING) {
			entry.player.pauseVideo();
			entry.autoPaused = true;
		}
	}
}

function resumeFrameMedia(frame: HTMLElement): void {
	if (frame.classList.contains('shot-frame--native-video')) {
		const video = frame.querySelector<HTMLVideoElement>('.shot-video-native');
		if (video?.dataset.autoPaused === '1') {
			delete video.dataset.autoPaused;
			void video.play().catch(() => {
				/* autoplay may still be blocked by the browser — leave it paused */
			});
		}
		return;
	}
	if (frame.classList.contains('shot-frame--youtube')) {
		const entry = ytPlayers.get(frame);
		if (entry?.autoPaused) {
			entry.autoPaused = false;
			entry.player.playVideo?.();
		}
	}
}

// IntersectionObserver only *delivers* a callback when the ratio actually
// crosses one of the given thresholds (plus one guaranteed initial delivery
// per target). With only [0.5, 0.65] declared, a video that scrolls straight
// from 0% to, say, 39% — never landing exactly on either threshold — would
// get no callback at all and so never get evaluated/paused. A fine-grained
// threshold list (every 5%) just ensures frequent delivery; the actual
// hide/show decision still runs off VISIBILITY_HIDE/SHOW_THRESHOLD below,
// evaluated against whatever exact ratio each delivery reports.
const VISIBILITY_OBSERVER_THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);
const VISIBILITY_MEDIA_SELECTOR = '.shot-frame--native-video, .shot-frame--youtube';

let visibilityObserver: IntersectionObserver | null = null;

function initVisibilityPause(): void {
	const frames = document.querySelectorAll<HTMLElement>(VISIBILITY_MEDIA_SELECTOR);
	if (frames.length === 0) return;
	visibilityObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const frame = entry.target as HTMLElement;
				if (entry.intersectionRatio < VISIBILITY_HIDE_THRESHOLD) pauseFrameMedia(frame);
				else if (entry.intersectionRatio >= VISIBILITY_SHOW_THRESHOLD) resumeFrameMedia(frame);
			}
		},
		{ threshold: VISIBILITY_OBSERVER_THRESHOLDS },
	);
	frames.forEach((frame) => visibilityObserver!.observe(frame));
}

/**
 * A frame that's already off-screen (below the fold, or scrolled past) at the
 * moment its dialog opens / its filter activates has ratio 0 both before and
 * after — no *change*, so the IntersectionObserver above would never deliver
 * a callback for it, leaving it "playing" invisibly forever (native video and
 * YouTube both start themselves the instant they're activated, regardless of
 * scroll position — see activateYouTube/the native `autoplay` attribute).
 * Re-observing forces the same guaranteed first-delivery that
 * `initVisibilityPause` relies on at page load, this time against the frame's
 * current post-activation geometry, so anything born below 50% visible gets
 * paused immediately instead of only on the next scroll.
 */
function refreshVisibility(scope: HTMLElement): void {
	if (!visibilityObserver) return;
	scope.querySelectorAll<HTMLElement>(VISIBILITY_MEDIA_SELECTOR).forEach((frame) => {
		visibilityObserver!.unobserve(frame);
		visibilityObserver!.observe(frame);
	});
}

function init(): void {
	const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[data-project-modal]');
	if (dialogs.length === 0) return;

	initVideos();
	initImageRows();
	initFacebook();
	initNativeVideoPlayback();
	initVisibilityPause();

	document.addEventListener('click', (event) => {
		const el = event.target as HTMLElement;

		const opener = el.closest<HTMLElement>('[data-project-open]');
		if (opener) {
			const id = opener.getAttribute('data-project-open');
			if (!id) return;
			const dialog = document.querySelector<HTMLDialogElement>(`dialog[data-project-modal="${id}"]`);
			// action_failed only when OUR code objectively cannot open the expected
			// dialog (missing, or showModal() throws). An already-open dialog is fine.
			const result = attemptOpenProject(dialog);
			if (!result.ok) {
				// Canonical id from the enclosing Timeline row — never the tl-* modal id.
				const row = opener.closest<HTMLElement>('[data-visibility-target-type="timeline_project"]');
				const failed = buildActionFailed('project_open', result.reason, 'project', row?.dataset.visibilityTargetId);
				if (failed) telemetry.emit('action_failed', failed);
			}
			return;
		}

		if (el.closest('[data-project-close]')) {
			pendingCloseReason = 'explicit';
			el.closest<HTMLDialogElement>('dialog[data-project-modal]')?.close();
		}
	});

	const observer = new MutationObserver((mutations) => {
		syncScrollLock();
		syncPersonBarPopover();
		for (const mutation of mutations) {
			const dialog = mutation.target as HTMLElement;
			// The `open` attribute is the authoritative open/close signal; the
			// canonical project id is content data, not the presentation modal id.
			const projectId = dialog.dataset.projectId;
			if (dialog.hasAttribute('open')) {
				announce(UI_EVENT.projectOpen, { projectId });
				const panel = dialog.querySelector<HTMLElement>('.project-modal__panel');
				if (panel) {
					requestAnimationFrame(() => {
						// Scroll so the project title sits just below the person card frame.
						// Desktop reference: .decor-frame (extends 15px below card, hidden on mobile).
						// Mobile fallback: #person-bar bottom (promoted to top layer, overlaps modal).
						const titleId = dialog.getAttribute('aria-labelledby');
						const head = titleId
							? dialog.querySelector<HTMLElement>(`#${titleId}`)
							: dialog.querySelector<HTMLElement>('.project-modal__title');
						const decor = document.querySelector<HTMLElement>('.decor-frame');
						const bar = document.getElementById('person-bar');
						const ref = (decor && decor.offsetParent !== null) ? decor : bar;
						if (head && ref) {
							const refBottom = ref.getBoundingClientRect().bottom;
							const headTop = head.getBoundingClientRect().top;
							panel.scrollTop = Math.max(0, headTop - refBottom - 8);
						} else {
							panel.scrollTop = 0;
						}
					});
				}
				void activateYouTube(dialog);
				activateFacebook(dialog);
				// Queued after the scroll-position fix above (same animation frame,
				// registration order), so it measures frames against their final
				// opening scroll position rather than scrollTop 0.
				requestAnimationFrame(() => refreshVisibility(dialog));
			} else {
				pauseYouTube(dialog);
				stopFacebook(dialog);
				announce(UI_EVENT.projectClose, { projectId, reason: pendingCloseReason });
				pendingCloseReason = undefined;
			}
		}
	});

	dialogs.forEach((dialog) => {
		// The panel owns all the padding, so a click whose target is the
		// <dialog> element itself can only have landed on the backdrop.
		dialog.addEventListener('click', (event) => {
			if (event.target === dialog) {
				pendingCloseReason = 'backdrop';
				dialog.close();
			}
		});
		dialog.addEventListener('cancel', () => {
			pendingCloseReason = 'cancel';
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
		stopFacebook(results);
		if ((event as CustomEvent<{ active: boolean }>).detail?.active) {
			void activateYouTube(results);
			activateFacebook(results);
			requestAnimationFrame(() => refreshVisibility(results));
		}
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
