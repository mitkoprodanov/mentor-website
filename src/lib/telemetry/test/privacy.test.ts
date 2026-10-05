// Consent, lifecycle, withdrawal, referrer sanitizing, embed endpoints and payload audit
// (docs/privacy.md). Uses the real coordinator / queue / transport / validator with a fake
// fetch and a fake storage, so the "nothing exists before consent" guarantees are tested on
// the same code production runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isLocalEndpoint, parseMode, resolveConfig } from '../config.ts';
import { CONSENT_KEY, CONSENT_KEYS, readConsent, writeConsent } from '../consent.ts';
import { ExternalMediaPermission } from '../../externalMedia.ts';
import type { ConsentStorage } from '../consent.ts';
import { TelemetryLifecycle } from '../lifecycle.ts';
import type { StartedSession } from '../lifecycle.ts';
import { buildSessionContext, randomId, sanitizeReferrer } from '../session.ts';
import type { SessionEnv } from '../session.ts';
import { EventQueue } from '../queue.ts';
import { Transport } from '../transport.ts';
import type { Fetch } from '../transport.ts';
import { SemanticStateCoordinator, bindUiEvents } from '../state.ts';
import { UI_EVENT } from '../uiEvents.ts';
import {
	buildActionFailed,
	buildContactEmailCopy,
	buildContactEmailOpen,
	buildCvDownload,
	buildExternalLinkClick,
	buildLinkedinClick,
	buildNavClick,
} from '../explicitEvents.ts';
import { buildContextMenu, buildNoninteractiveClick } from '../interactions.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';
import {
	YOUTUBE_API_SRC,
	YOUTUBE_PLAYER_HOST,
	facebookVideoEmbed,
	linkedInEmbed,
	linkedInPostUrl,
	youtubeId,
	youtubeWatchUrl,
	isPrivacyEnhancedYouTubeEmbed,
	youtubeEmbedUrl,
	MEDIA_KIND_PRIVACY,
	requiresExternalMediaConsent,
} from '../../embeds.ts';

// ---- helpers ------------------------------------------------------------------

class MemStorage implements ConsentStorage {
	data = new Map<string, string>();
	getItem = (k: string) => this.data.get(k) ?? null;
	setItem = (k: string, v: string) => void this.data.set(k, v);
}

const PROD = { mode: 'consent' } as const;
const FORCED = { mode: 'forced' } as const;
const OFF = { mode: 'off' } as const;

const env = (search = '', referrer = ''): SessionEnv => ({
	search,
	referrer,
	innerWidth: 1280,
	innerHeight: 720,
	screenWidth: 1920,
	screenHeight: 1080,
	maxTouchPoints: 0,
	hasTouchStart: false,
	matchMedia: () => ({ matches: false }),
});

/** A faithful stand-in for index.ts's startSession: real coordinator + bindUiEvents + queue + transport. */
function harness(storage: ConsentStorage | null, config: { mode: 'off' | 'forced' | 'consent' } = PROD) {
	const ui = new EventTarget();
	const requests: Array<{ url: string; body: any }> = [];
	const sessions: string[] = [];
	let starts = 0;
	let clockMs = 1000;
	let iso = '2026-10-01T10:00:00.000Z';
	const clock = { now: () => clockMs, iso: () => iso };
	let current: { queue: EventQueue; transport: Transport } | null = null;
	const fetchFn: Fetch = async (url, init) => {
		requests.push({ url, body: JSON.parse(init.body) });
		return { ok: true, status: 200 };
	};

	const startSession = (): StartedSession | null => {
		starts++;
		const id = randomId()!;
		sessions.push(id);
		const queue = new EventQueue(clock, clock.now(), randomId);
		const session = buildSessionContext(env('?utm_source=linkedin'), id, clock.iso());
		const transport = new Transport('https://w.test/v1/batch', session, queue, fetchFn, () => clockMs);
		const coord = new SemanticStateCoordinator({ emit: (t, o) => void queue.emit(t, o), newId: () => randomId() });
		const unbind = bindUiEvents(coord, ui);
		queue.emit('session_start');
		current = { queue, transport };
		return {
			stop() {
				transport.stop();
				unbind();
				current = null;
			},
		};
	};

	const lifecycle = new TelemetryLifecycle({ config, storage, startSession });
	const announce = (name: string, detail: object) => ui.dispatchEvent(new CustomEvent(name, { detail }));
	return {
		lifecycle, announce, requests, sessions,
		get starts() { return starts; },
		get queued() { return current?.queue.length ?? 0; },
		flush: () => current?.transport.flush({ lifecycle: true }) ?? Promise.resolve(),
		advance: (ms: number, nextIso: string) => { clockMs += ms; iso = nextIso; },
	};
}

// ---- config -------------------------------------------------------------------

test('mode safety: a production build can never be forced, and non-production never reaches the production Worker', () => {
	const ep = 'http://localhost:8787/v1/batch';
	// forced is a development-build capability: a production build asked for it resolves to off
	assert.equal(resolveConfig({ isProductionBuild: true, mode: 'forced', hostname: 'localhost', search: '', endpointOverride: ep }).mode, 'off');
	// a requested mode with no endpoint (or a non-local one) is off, not a silent fallback to the production endpoint
	for (const endpointOverride of [undefined, '', 'not a url', 'https://mentor-telemetry.prodanov-mitko.workers.dev/v1/batch', 'https://example.com/v1/batch', 'http://8.8.8.8:8787/v1/batch', 'ftp://localhost/x']) {
		for (const mode of ['forced', 'consent']) {
			const c = resolveConfig({ isProductionBuild: false, mode, hostname: 'localhost', search: '', endpointOverride });
			assert.equal(c.mode, 'off', `${mode} ${endpointOverride}`);
		}
	}
	// local endpoints: localhost, loopback, private LAN (phone testing)
	for (const ok of ['http://localhost:8787/v1/batch', 'http://127.0.0.1:8787/v1/batch', 'http://192.168.0.148:8787/v1/batch', 'http://10.1.2.3:8787/x', 'http://172.20.0.5:8787/x', 'http://[::1]:8787/x']) {
		assert.equal(isLocalEndpoint(ok), true, ok);
	}
	assert.equal(isLocalEndpoint('http://172.32.0.1/x'), false);
	assert.equal(isLocalEndpoint('http://localhost.evil.com/x'), false);
	// the old flags are gone: unknown values never turn anything on
	assert.equal(parseMode('1'), 'off');
	assert.equal(parseMode(true), 'off');
	assert.equal(parseMode(undefined), 'off');
});

test('third-party media is independent of the telemetry mode (no mode reference in the gate code)', () => {
	const gate = readFileSync(new URL('../../../scripts/projectModal.client.ts', import.meta.url), 'utf8');
	assert.ok(!/telemetryControl|PUBLIC_TELEMETRY|TelemetryMode|mode ===/.test(gate));
	const embeds = readFileSync(new URL('../../embeds.ts', import.meta.url), 'utf8');
	assert.ok(!/PUBLIC_TELEMETRY|TelemetryMode/.test(embeds));
});

// ---- remembered preference ------------------------------------------------------

test('consent storage: only exact allow/refuse are honoured; broken storage never throws', () => {
	const s = new MemStorage();
	assert.equal(readConsent(s), null);
	for (const junk of ['yes', 'ALLOW', 'true', '1', '', '{"a":1}']) {
		s.data.set(CONSENT_KEY, junk);
		assert.equal(readConsent(s), null, junk);
	}
	assert.equal(writeConsent(s, 'allow'), true);
	assert.equal(readConsent(s), 'allow');
	assert.equal(writeConsent(s, 'refuse'), true);
	assert.equal(readConsent(s), 'refuse');
	const throwing: ConsentStorage = {
		getItem() { throw new Error('blocked'); },
		setItem() { throw new Error('blocked'); },
	};
	assert.equal(readConsent(throwing), null);
	assert.equal(writeConsent(throwing, 'allow'), false);
	assert.equal(readConsent(null), null);
	assert.equal(writeConsent(null, 'allow'), false);
});

test('remembered preference is just the literal choice: no visitor ID, and sessions never reference it', async () => {
	const storage = new MemStorage();
	const h = harness(storage);
	h.lifecycle.init();
	h.lifecycle.allow();
	assert.deepEqual([...storage.data.entries()], [[CONSENT_KEY, 'allow']]);
	h.announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	await h.flush();
	const sent = JSON.stringify(h.requests);
	assert.ok(!sent.includes(CONSENT_KEY) && !sent.includes('mgs_analytics'));
	assert.ok(!sent.includes(`"allow"`));
	// a second visit gets a NEW random session id; the stored value did not change or carry one
	const h2 = harness(storage);
	h2.lifecycle.init(); // remembered allow -> starts
	assert.equal(h2.starts, 1);
	assert.notEqual(h2.sessions[0], h.sessions[0]);
	assert.deepEqual([...storage.data.entries()], [[CONSENT_KEY, 'allow']]);
});

// ---- before consent: completely inactive ---------------------------------------

test('before consent: nothing starts, no session id, no listeners, no queue, no request', async () => {
	const h = harness(new MemStorage());
	h.lifecycle.init();
	assert.equal(h.starts, 0);
	assert.equal(h.sessions.length, 0);
	assert.equal(h.lifecycle.status().running, false);
	assert.equal(h.lifecycle.status().consent, null);
	// UI activity with no telemetry running produces nothing, anywhere
	h.announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	h.announce(UI_EVENT.skillsOpen, { person: 'mitko', method: 'hover' });
	assert.equal(h.queued, 0);
	await h.flush();
	assert.equal(h.requests.length, 0);
});

test('refused / remembered refusal / unreadable storage: stays off across init', () => {
	const storage = new MemStorage();
	storage.data.set(CONSENT_KEY, 'refuse');
	const h = harness(storage);
	h.lifecycle.init();
	assert.equal(h.starts, 0);
	assert.equal(h.lifecycle.status().consent, 'refuse');
	const blocked = harness(null);
	blocked.lifecycle.init();
	assert.equal(blocked.starts, 0);
});

test('telemetry-only hooks never run before consent', () => {
	const h = harness(new MemStorage());
	let ran = 0;
	h.lifecycle.onStart(() => void ran++);
	h.lifecycle.init();
	assert.equal(ran, 0);
	h.lifecycle.allow();
	assert.equal(ran, 1);
});

// ---- Allow: fresh session, nothing backfilled ------------------------------------

test('Allow starts telemetry then, with a fresh session; pre-consent activity is not backfilled', async () => {
	const storage = new MemStorage();
	const h = harness(storage);
	h.lifecycle.init();
	// the visitor browses before answering
	h.announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	h.announce(UI_EVENT.projectClose, { projectId: 'heroes6', reason: 'explicit' });
	h.advance(60_000, '2026-10-01T10:01:00.000Z');

	h.lifecycle.allow();
	assert.equal(h.starts, 1);
	assert.equal(h.lifecycle.status().running, true);
	assert.equal(readConsent(storage), 'allow');
	h.announce(UI_EVENT.projectOpen, { projectId: 'space-punks' });
	await h.flush();

	assert.equal(h.requests.length, 1);
	const body = h.requests[0].body;
	assert.equal(body.session.session_id, h.sessions[0]);
	assert.equal(body.session.started_at, '2026-10-01T10:01:00.000Z'); // the moment of consent, not page load
	assert.equal(body.session.utm_source, 'linkedin'); // campaign attribution intact
	const types = body.events.map((e: any) => `${e.event_type}:${e.target_id ?? ''}`);
	assert.deepEqual(types, ['session_start:', 'project_open:space-punks']); // nothing about heroes6
	assert.equal(body.events[0].elapsed_ms, 0); // elapsed counts from consent
});

test('every (re-)enable creates a brand-new anonymous session', () => {
	const h = harness(new MemStorage());
	h.lifecycle.init();
	h.lifecycle.allow();
	h.lifecycle.refuse();
	h.lifecycle.allow();
	h.lifecycle.refuse();
	h.lifecycle.allow();
	assert.equal(h.starts, 3);
	assert.equal(new Set(h.sessions).size, 3);
});

// ---- withdrawal ----------------------------------------------------------------

test('withdrawal stops future telemetry cleanly: listeners removed, unsent data dropped, no request', async () => {
	const storage = new MemStorage();
	const h = harness(storage);
	h.lifecycle.init();
	h.lifecycle.allow();
	h.announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	assert.equal(h.queued, 2); // session_start + project_open, not yet sent
	const cleanups: string[] = [];
	h.lifecycle.onStart(() => () => void cleanups.push('hook cleanup'));
	h.lifecycle.refuse();

	assert.equal(h.lifecycle.status().running, false);
	assert.equal(readConsent(storage), 'refuse');
	assert.deepEqual(cleanups, ['hook cleanup']);
	await h.flush();
	assert.equal(h.requests.length, 0); // nothing unsent was delivered after withdrawal
	h.announce(UI_EVENT.projectOpen, { projectId: 'space-punks' }); // coordinator is unbound
	assert.equal(h.queued, 0);
	assert.equal(h.requests.length, 0);

	// and a later visit does not resume
	const again = harness(storage);
	again.lifecycle.init();
	assert.equal(again.starts, 0);
});

test('transport.stop(): no further request even with queued events or an in-flight retry', async () => {
	const clock = { now: () => 1, iso: () => '2026-10-01T10:00:00.000Z' };
	const q = new EventQueue(clock, 0, randomId);
	let sent = 0;
	const t = new Transport('https://w.test', buildSessionContext(env(), 'sess-id-9999', clock.iso()), q, async () => {
		sent++;
		return { ok: true, status: 200 };
	}, () => 1);
	q.emit('session_start');
	t.stop();
	await t.flush();
	await t.flush({ lifecycle: true });
	assert.equal(sent, 0);
});

test('forced local testing starts immediately and ignores consent calls; off never starts', () => {
	const forced = harness(new MemStorage(), FORCED);
	forced.lifecycle.init();
	assert.equal(forced.starts, 1);
	forced.lifecycle.refuse(); // the consent UI does not govern forced dev telemetry
	assert.equal(forced.lifecycle.status().running, true);
	const off = harness(new MemStorage(), OFF);
	off.lifecycle.init();
	off.lifecycle.allow();
	assert.equal(off.starts, 0);
	assert.equal(off.lifecycle.status().mode, 'off');
});

test('blocked storage: the choice still applies to this page load and reports it was not remembered', () => {
	const h = harness(null);
	h.lifecycle.init();
	h.lifecycle.allow();
	assert.equal(h.lifecycle.status().running, true);
	assert.equal(h.lifecycle.status().remembered, false);
});

test('listeners are told about every change', () => {
	const h = harness(new MemStorage());
	const seen: string[] = [];
	h.lifecycle.subscribe((s) => seen.push(`${s.consent}/${s.running}`));
	h.lifecycle.init();
	h.lifecycle.allow();
	h.lifecycle.refuse();
	assert.deepEqual(seen, ['null/false', 'allow/true', 'refuse/false']);
});

// ---- referrer ------------------------------------------------------------------

test('referrer: scheme/host/path kept; query, fragment and credentials stripped; junk fails safely', () => {
	const cases: Array<[string, string | null]> = [
		['https://www.linkedin.com/feed/update/urn:li:activity:1/?trk=abc#x', 'https://www.linkedin.com/feed/update/urn:li:activity:1/'],
		['https://t.co/AbC?amp=1', 'https://t.co/AbC'],
		['https://user:pw@example.com/a/b?x=1', 'https://example.com/a/b'],
		['http://localhost:4321/?utm_source=x&fbclid=SECRET', 'http://localhost:4321/'],
		['https://example.com', 'https://example.com/'],
		['', null],
		['   ', null],
		['not a url', null],
		['javascript:alert(1)', null],
		['data:text/html,hi', null],
		['about:blank', null],
	];
	for (const [raw, want] of cases) assert.equal(sanitizeReferrer(raw), want, raw);
	const ctx = buildSessionContext(env('', 'https://l.example/p?secret=1#f'), 'sess-id-0030', '2026-10-01T10:00:00.000Z');
	assert.equal(ctx.referrer, 'https://l.example/p');
	assert.ok(!JSON.stringify(ctx).includes('secret'));
	assert.ok(sanitizeReferrer(`https://a.example/${'x'.repeat(2000)}`)!.length <= 512);
});

// ---- audit: real producers vs the Worker's per-event allowlist ------------------------

test('every payload the shipped builders/coordinator produce passes the Worker allowlist', () => {
	const clock = { now: () => 1, iso: () => '2026-10-01T10:00:00.000Z' };
	const events: Array<{ type: string; opts: any }> = [];
	const push = (type: string, opts: any) => {
		if (opts) events.push({ type, opts });
	};

	push('nav_click', buildNavClick({ target: 'timeline', originSurface: 'main', originSection: 'about', pointerType: 'mouse' }));
	push('nav_click', buildNavClick({ target: 'contact', originSurface: 'skills', skillsMode: 'locked', pointerType: 'touch' }));
	push('cv_download', buildCvDownload('mitko', 'mouse'));
	push('linkedin_click', buildLinkedinClick('person', 'adam', 'pen'));
	push('linkedin_click', buildLinkedinClick('company', 'mentor-game-studio'));
	push('contact_email_copy', buildContactEmailCopy('mentor-game-studio'));
	push('contact_email_open', buildContactEmailOpen('mentor-game-studio', 'mouse'));
	push('external_link_click', buildExternalLinkClick('official_site', 'heroes6', 'mouse'));
	push('external_link_click', buildExternalLinkClick('linkedin_post_fallback', 'heroes6'));
	push('action_failed', buildActionFailed('contact_email_copy', 'clipboard_denied', 'company', 'mentor-game-studio'));
	push('action_failed', buildActionFailed('project_open', 'dialog_not_found'));
	push('noninteractive_click', buildNoninteractiveClick({ type: 'skill', id: 'gameplay', element: 'tag_pill', projectId: 'heroes6' } as any, 'touch', 'view_0000001'));
	push('context_menu', buildContextMenu({ type: 'project', id: 'heroes6', element: 'project_link', properties: { destination_type: 'official_site' } } as any, 'mouse', null));
	push('context_menu', buildContextMenu({ type: 'project_content', id: 'heroes6-clip', element: 'media', properties: { content_type: 'youtube' } } as any, undefined, null));
	push('viewport_changed', { properties: { viewport_width: 1280, viewport_height: 720 } });
	push('click_burst', {
		properties: {
			start_elapsed_ms: 900, duration_ms: 400, click_count: 4, region: 'timeline', distinct_targets: 1,
			unresolved_clicks: 0, target_class: 'mixed', spread_px: 12, center_x_ratio: 0.47, center_y_ratio: 0.33, pointer_type: 'mouse',
		},
	});
	push('visibility_delta', {
		target_type: 'project_content', target_id: 'heroes6-clip', appearance_id: 'app_00000001', v50_ms: 10,
		properties: { content_type: 'youtube', person: 'both', trigger_method: 'hover' },
	});
	push('video_start', { target_type: 'project_content', target_id: 'heroes6-clip', appearance_id: 'app_00000001', properties: { content_type: 'youtube', person: 'both' } });

	// the UI-state coordinator's own events
	const coord = new SemanticStateCoordinator({ emit: (t, o) => push(t, o ?? {}), newId: () => randomId() });
	coord.skillsOpen({ person: 'mitko', method: 'hover' });
	coord.skillsLock({ person: 'mitko', cause: 'click' });
	coord.skillsUnlock({ person: 'mitko' });
	coord.skillsOpen({ person: 'adam', method: 'focus' });
	coord.skillsClose({ reason: 'escape', person: 'adam' });
	coord.skillClick({ skillId: 'gameplay', person: 'mitko' });
	coord.filterOpen({ skillId: 'gameplay' });
	coord.filterClose({ skillId: 'gameplay', reason: 'chip' });
	coord.projectOpen({ projectId: 'heroes6' });
	coord.projectClose({ projectId: 'heroes6', reason: 'backdrop' });

	assert.ok(events.length >= 24, String(events.length));
	const queue = new EventQueue(clock, 0, randomId);
	queue.emit('session_start');
	for (const e of events) queue.emit(e.type, e.opts);
	const batch = {
		session: buildSessionContext(env(), 'sess-id-0040', clock.iso()),
		events: queue.peek(100, 1e6),
	};
	const r = validateBatch(JSON.parse(JSON.stringify(batch)));
	assert.equal(r.ok, true, r.ok ? '' : r.detail);
});

// ---- third-party embeds: endpoints and "nothing before permission" ---------------------

test('embed endpoints: each provider uses its intended endpoint (YouTube privacy-enhanced)', () => {
	assert.equal(YOUTUBE_PLAYER_HOST, 'https://www.youtube-nocookie.com');
	assert.equal(YOUTUBE_API_SRC, 'https://www.youtube.com/iframe_api');
	const fb = new URL(facebookVideoEmbed('https://www.facebook.com/reel/291274308860973'));
	assert.equal(`${fb.origin}${fb.pathname}`, 'https://www.facebook.com/plugins/video.php');
	assert.equal(fb.searchParams.get('href'), 'https://www.facebook.com/reel/291274308860973');
	assert.equal(linkedInEmbed('https://www.linkedin.com/feed/update/urn:li:activity:7331711027287404545/'), 'https://www.linkedin.com/embed/feed/update/urn:li:activity:7331711027287404545');
	assert.equal(linkedInEmbed('urn:li:activity:123'), 'https://www.linkedin.com/embed/feed/update/urn:li:activity:123');
	assert.equal(linkedInEmbed('456'), 'https://www.linkedin.com/embed/feed/update/urn:li:activity:456');
	// external links are ordinary page URLs, not embed endpoints
	assert.equal(linkedInPostUrl('https://www.linkedin.com/feed/update/urn:li:activity:1/'), 'https://www.linkedin.com/feed/update/urn:li:activity:1/');
	assert.equal(linkedInPostUrl('789'), 'https://www.linkedin.com/feed/update/urn:li:activity:789/');
	assert.equal(youtubeId('https://youtu.be/abc123XYZ_-'), 'abc123XYZ_-');
	assert.equal(youtubeId('https://www.youtube.com/watch?v=abc123XYZ_-'), 'abc123XYZ_-');
	assert.equal(youtubeId('abc123XYZ_-'), 'abc123XYZ_-');
	assert.equal(youtubeWatchUrl('abc', 35.9), 'https://www.youtube.com/watch?v=abc&t=35s');
	assert.equal(youtubeWatchUrl('abc'), 'https://www.youtube.com/watch?v=abc');
});

const read = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8').split('\r\n').join('\n');



// ---- YouTube players are privacy-enhanced ------------------------------------------------

test('youtube: every player URL is youtube-nocookie.com/embed/..., never youtube.com/embed/...', () => {
	for (const id of ['ipXY3c3wDZk', 'abc123XYZ_-']) {
		for (const opts of [{}, { start: 35.9 }, { start: 0, origin: 'https://mentorgamestudio.com' }]) {
			const url = youtubeEmbedUrl(id, opts);
			assert.ok(url.startsWith('https://www.youtube-nocookie.com/embed/'), url);
			assert.ok(isPrivacyEnhancedYouTubeEmbed(url));
			assert.ok(!url.includes('youtube.com/embed'), url);
			const u = new URL(url);
			assert.equal(u.hostname, 'www.youtube-nocookie.com');
			assert.equal(u.searchParams.get('enablejsapi'), '1'); // the IFrame API can attach to this iframe
		}
	}
	assert.equal(new URL(youtubeEmbedUrl('x', { origin: 'https://mentorgamestudio.com' })).searchParams.get('origin'), 'https://mentorgamestudio.com');
	assert.equal(new URL(youtubeEmbedUrl('x', { start: 35.9 })).searchParams.get('start'), '35');
	// the check itself rejects the non-private host and lookalikes
	for (const bad of ['https://www.youtube.com/embed/x', 'https://youtube.com/embed/x', 'http://www.youtube-nocookie.com/embed/x', 'https://www.youtube-nocookie.com.evil.test/embed/x', 'https://evil.test/https://www.youtube-nocookie.com/embed/x']) {
		assert.equal(isPrivacyEnhancedYouTubeEmbed(bad), false, bad);
	}
	// the IFrame API loader is a different thing: youtube.com/iframe_api is the official script
	assert.equal(YOUTUBE_API_SRC, 'https://www.youtube.com/iframe_api');
});

test('youtube: source builds the player iframe itself (no YT.Player-built iframe) and hard-codes no youtube.com/embed', () => {
	const client = read('src/scripts/projectModal.client.ts');
	// we create the iframe from the nocookie builder and attach the API to that element
	assert.ok(client.includes('youtubeEmbedUrl(') && client.includes('isPrivacyEnhancedYouTubeEmbed(src)'));
	assert.match(client, /new YT\.Player\(iframe, \{\s*events:/);
	assert.ok(!/videoId:/.test(client), 'YT.Player must not be given a videoId (it would build its own iframe)');
	assert.ok(!/host:\s*YOUTUBE_PLAYER_HOST/.test(client));
	assert.equal((client.match(/new YT\.Player\(/g) ?? []).length, 1); // one creation path, used by every case
	// no source file anywhere hard-codes a youtube.com/embed player URL
	const dir = new URL('../../../', import.meta.url);
	const hits: string[] = [];
	const walk = (d: URL) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const u = new URL(e.name + (e.isDirectory() ? '/' : ''), d);
			if (e.isDirectory()) {
				if (e.name !== 'test') walk(u);
			} else if (/\.(ts|astro|mjs|md)$/.test(e.name) && readFileSync(u, 'utf8').includes('youtube.com/embed')) hits.push(u.pathname);
		}
	};
	walk(dir);
	assert.deepEqual(hits, []);
});

test('youtube: the dormant experience-card path also waits for External media and uses the same URL builder', () => {
	const card = read('src/scripts/experienceCard.client.ts');
	assert.ok(card.includes('externalMedia.status().allowed') && card.includes('youtubeEmbedUrl('));
	assert.ok(!card.includes('youtube.com/embed') && !/youtube-nocookie\.com\/embed\/\$\{/.test(card));
});

test('youtube: the built production output (when present) contains no youtube.com/embed player URL', () => {
	const dist = new URL('../../../../dist/', import.meta.url);
	if (!existsSync(dist)) return; // not built in this checkout
	const bad: string[] = [];
	const walk = (d: URL) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const u = new URL(e.name + (e.isDirectory() ? '/' : ''), d);
			if (e.isDirectory()) walk(u);
			else if (/\.(html|js|css)$/.test(e.name) && readFileSync(u, 'utf8').includes('youtube.com/embed')) bad.push(u.pathname);
		}
	};
	walk(dist);
	assert.deepEqual(bad, []);
});
test('embeds: the page template ships no provider iframe/script/thumbnail and gates every embed', () => {
	const detail = read('src/components/projects/ProjectDetail.astro');
	assert.ok(!/<iframe/i.test(detail), 'ProjectDetail must not render a provider <iframe> up front');
	assert.ok(!/<script/i.test(detail));
	assert.ok(!/ytimg|i\.ytimg|fbcdn|licdn/.test(detail), 'no provider thumbnails');
	assert.equal(/\ssrc=\{(facebookVideoEmbed|linkedInEmbed)/.test(detail), false, 'embed URLs must not be an element src');
	for (const provider of ['youtube', 'facebook', 'linkedin']) {
		assert.ok(detail.includes(`data-provider="${provider}"`), `${provider} gate missing`);
	}
	assert.ok(/Open on YouTube/.test(detail) && /Open on Facebook/.test(detail) && /Open on LinkedIn/.test(detail));
	// the load buttons are the only thing that grants anything
	assert.equal((detail.match(/data-embed-load/g) ?? []).length, 3);
});

test('embeds: provider resources are requested only behind the External media permission', () => {
	const client = read('src/scripts/projectModal.client.ts');
	// frames only go live once External media is allowed (activateExternalMedia sets the flag)
	assert.match(client, /function isFrameLive[\s\S]{0,400}embedAllowed/);
	assert.match(client, /function activateExternalMedia[\s\S]{0,200}if \(!externalMedia\.status\(\)\.allowed\) return;/);
	// the API script and every iframe creation live in code reached only via that permission
	assert.equal((client.match(/await loadYouTubeApi\(\)/g) ?? []).length, 1); // single call site: activateYouTube
	assert.match(client, /const frames = Array\.from\(scope\.querySelectorAll<HTMLElement>\('\.shot-frame--youtube'\)\)\.filter\(isFrameLive\)/);
	assert.equal((client.match(/document\.createElement\('iframe'\)/g) ?? []).length, 3); // youtube + facebook + linkedin (each behind External media)
	// pressing a placeholder does NOT load that one item: it asks for the one permission
	assert.ok(client.includes('EXTERNAL_MEDIA_REQUEST_EVENT'));
	assert.ok(!/function allowEmbed/.test(client), 'per-item allowEmbed is gone');
	// revocation removes iframes/players and restores placeholders
	assert.match(client, /function revokeExternalMedia[\s\S]{0,1500}\.remove\(\)[\s\S]{0,400}restoreGate/);
	assert.match(client, /destroy\?\.\(\)/);
});

test('media kinds: every kind is classified; only third-party providers need External media permission', () => {
	const expectLocal = ['image', 'gif', 'image-row', 'text', 'video'] as const;
	const expectExternal = ['youtube', 'linkedin-post', 'facebook-video', 'facebook-reel'] as const;
	for (const k of expectLocal) assert.equal(requiresExternalMediaConsent(k), false, k);
	for (const k of expectExternal) assert.equal(requiresExternalMediaConsent(k), true, k);
	// exhaustive: nothing is classified that the data type does not have, and nothing is missing
	const types = read('src/data/media/types.ts');
	const union = types.match(/kind:\s*((?:'[a-z-]+'\s*\|?\s*)+);/)![1];
	const kinds = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
	assert.deepEqual(Object.keys(MEDIA_KIND_PRIVACY).sort(), kinds);
});

test('self-hosted video is first-party: native <video>, no gate, no provider, no consent check', () => {
	const detail = read('src/components/projects/ProjectDetail.astro');
	const videoBranch = detail.slice(detail.indexOf("m.kind === 'video' ?"), detail.indexOf("m.kind === 'image-row' ?"));
	assert.ok(videoBranch.includes('<video class="shot-video-native"'));
	assert.ok(videoBranch.includes('autoplay muted loop playsinline') && videoBranch.includes('controls'));
	assert.ok(!/embed-gate|data-embed|externalMedia|data-provider/.test(videoBranch));
	// only the three provider branches carry a gate
	assert.equal((detail.match(/class="embed-gate"/g) ?? []).length, 3);
	// the native-video code path never touches the permission
	const client = read('src/scripts/projectModal.client.ts');
	const nativeInit = client.slice(client.indexOf('function initNativeVideoPlayback'), client.indexOf('/* ---- YouTube embeds'));
	assert.ok(!/externalMedia|embedAllowed/.test(nativeInit));
});

// ---- External media permission ------------------------------------------------------

test('external media: independent unset/allow/refuse state, remembered under its own key', () => {
	const storage = new MemStorage();
	const m = new ExternalMediaPermission(storage);
	assert.deepEqual(m.status(), { consent: null, allowed: false, remembered: true });
	const seen: boolean[] = [];
	m.subscribe((x) => seen.push(x.allowed));
	m.allow();
	assert.equal(m.status().allowed, true);
	assert.equal(readConsent(storage, 'external_media'), 'allow');
	m.refuse();
	assert.equal(m.status().allowed, false);
	assert.equal(readConsent(storage, 'external_media'), 'refuse');
	assert.deepEqual(seen, [true, false]);
	assert.notEqual(CONSENT_KEYS.external_media, CONSENT_KEYS.analytics);
	// a new page load reads the remembered choice; nothing else is stored (no ID)
	m.allow();
	assert.equal(new ExternalMediaPermission(storage).status().allowed, true);
	assert.deepEqual([...storage.data.keys()], [CONSENT_KEYS.external_media]);
	assert.equal(storage.data.get(CONSENT_KEYS.external_media), 'allow');
});

test('external media and analytics are completely independent', () => {
	const storage = new MemStorage();
	const media = new ExternalMediaPermission(storage);
	const h = harness(storage);
	h.lifecycle.init();
	// granting / revoking External media never starts analytics or changes its choice
	media.allow();
	assert.equal(h.starts, 0);
	assert.equal(readConsent(storage, 'analytics'), null);
	media.refuse();
	assert.equal(h.starts, 0);
	// granting / withdrawing analytics never changes External media
	media.allow();
	h.lifecycle.allow();
	assert.equal(h.starts, 1);
	assert.equal(media.status().allowed, true);
	h.lifecycle.refuse();
	assert.equal(media.status().allowed, true);
	assert.equal(readConsent(storage, 'external_media'), 'allow');
	assert.equal(readConsent(storage, 'analytics'), 'refuse');
	// neither value is ever part of what telemetry sends
	const sent = JSON.stringify(h.requests);
	assert.ok(!sent.includes('external_media') && !sent.includes('mgs_'));
});

test('external media: old/unknown stored values are ignored safely (no migration needed)', () => {
	const storage = new MemStorage();
	storage.data.set(CONSENT_KEYS.analytics, 'allow'); // the pre-existing analytics value stays valid, untouched
	storage.data.set(CONSENT_KEYS.external_media, '{"legacy":true}');
	assert.equal(readConsent(storage, 'analytics'), 'allow');
	assert.equal(new ExternalMediaPermission(storage).status().consent, null);
	storage.data.set(CONSENT_KEYS.external_media, 'yes');
	assert.equal(new ExternalMediaPermission(storage).status().allowed, false);
	// blocked storage: the choice still applies to this page load and says it was not remembered
	const blocked = new ExternalMediaPermission({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
	blocked.allow();
	assert.deepEqual([blocked.status().allowed, blocked.status().remembered], [true, false]);
});

test('no telemetry-only listener is installed at module load (only via onStart)', () => {
	for (const f of ['src/scripts/explicitActions.client.ts', 'src/scripts/visibility.client.ts']) {
		const src = read(f);
		assert.match(src, /telemetryControl/, f);
		assert.match(src, /onStart/, f);
	}
	const index = read('src/lib/telemetry/index.ts');
	assert.ok(!/new SemanticStateCoordinator/.test(index.split('function startSession')[0]), 'coordinator must not exist before start');
});
