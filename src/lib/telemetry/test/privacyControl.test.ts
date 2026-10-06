// The compact Privacy control (docs/privacy.md sections 1, 3, 5, 8, 9): derived "No optional services",
// independent permissions, unanswered vs refused, open/pin/close rules, hosting and stacking rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrivacyBarState, isNone, isUnanswered, planConsentWrites, selectChoice } from '../../privacyControl.ts';
import type { Permissions } from '../../privacyControl.ts';
import { CONSENT_KEYS, readConsent } from '../consent.ts';
import type { ConsentStorage } from '../consent.ts';
import { ExternalMediaPermission } from '../../externalMedia.ts';
import { TelemetryLifecycle } from '../lifecycle.ts';

const read = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8').split('\r\n').join('\n');

class MemStorage implements ConsentStorage {
	data = new Map<string, string>();
	getItem = (k: string) => this.data.get(k) ?? null;
	setItem = (k: string, v: string) => void this.data.set(k, v);
}

/** The real owners wired the way the client does, so the choice logic runs against production code. */
function rig() {
	const storage = new MemStorage();
	const media = new ExternalMediaPermission(storage);
	let started = 0;
	let stopped = 0;
	const life = new TelemetryLifecycle({
		config: { mode: 'consent' },
		storage,
		startSession: () => (started++, { stop: () => void stopped++ }),
	});
	life.init();
	const perms = (): Permissions => ({ media: media.status().allowed, analytics: life.status().running });
	const choose = (id: 'none' | 'media' | 'analytics') => {
		const cur = perms();
		const next = selectChoice(cur, id);
		const w = planConsentWrites(cur, next, { media: media.status().consent, analytics: life.status().consent }, true);
		if (w.media === 'allow') media.allow();
		else if (w.media === 'refuse') media.refuse();
		if (w.analytics === 'allow') life.allow();
		else if (w.analytics === 'refuse') life.refuse();
	};
	return { storage, media, life, perms, choose, get started() { return started; }, get stopped() { return stopped; } };
}

test('selection model: No optional services is derived; the two permissions are independent', () => {
	const none: Permissions = { media: false, analytics: false };
	assert.equal(isNone(none), true);
	const m = selectChoice(none, 'media');
	assert.deepEqual(m, { media: true, analytics: false });
	assert.equal(isNone(m), false); // selecting External media deselects No optional services
	const both = selectChoice(m, 'analytics');
	assert.deepEqual(both, { media: true, analytics: true }); // simultaneous
	assert.equal(isNone(both), false);
	assert.deepEqual(selectChoice(both, 'none'), none); // none disables both
	assert.deepEqual(selectChoice(none, 'none'), none);
	// disabling the last enabled permission returns to No optional services
	assert.equal(isNone(selectChoice(m, 'media')), true);
	assert.equal(isNone(selectChoice({ media: false, analytics: true }, 'analytics')), true);
	// disabling one of two keeps the other
	assert.deepEqual(selectChoice(both, 'media'), { media: false, analytics: true });
	assert.deepEqual(selectChoice(both, 'analytics'), { media: true, analytics: false });
	// dev builds where analytics is not visitor-controllable never change it
	assert.deepEqual(selectChoice({ media: true, analytics: true }, 'none', true), { media: false, analytics: true });
	assert.deepEqual(selectChoice({ media: false, analytics: true }, 'analytics', true), { media: false, analytics: true });
});

test('all four stored combinations are reachable and map to the documented key values', () => {
	const expected: Array<[Permissions, string, string]> = [
		[{ media: false, analytics: false }, 'refuse', 'refuse'],
		[{ media: true, analytics: false }, 'refuse', 'allow'],
		[{ media: false, analytics: true }, 'allow', 'refuse'],
		[{ media: true, analytics: true }, 'allow', 'allow'],
	];
	for (const [want, aKey, mKey] of expected) {
		const r = rig();
		if (want.media) r.choose('media');
		if (want.analytics) r.choose('analytics');
		if (!want.media && !want.analytics) r.choose('none');
		assert.deepEqual(r.perms(), want);
		assert.equal(readConsent(r.storage, 'analytics'), aKey);
		assert.equal(readConsent(r.storage, 'external_media'), mKey);
		assert.equal(r.life.status().running, want.analytics);
		assert.equal(r.media.status().allowed, want.media);
		// only the two existing keys, nothing new (no cookies/IDs/timestamps)
		assert.deepEqual([...r.storage.data.keys()].sort(), [CONSENT_KEYS.analytics, CONSENT_KEYS.external_media].sort());
	}
});

test('unanswered is distinct from explicit No optional services, while both are effectively off', () => {
	const fresh = rig();
	assert.deepEqual(fresh.perms(), { media: false, analytics: false });
	assert.equal(isUnanswered(fresh.media.status().consent, fresh.life.status().consent, true), true);
	assert.equal(fresh.storage.data.size, 0); // silence is not remembered as a refusal
	assert.equal(fresh.started, 0);
	fresh.choose('none');
	assert.deepEqual(fresh.perms(), { media: false, analytics: false });
	assert.equal(isUnanswered(fresh.media.status().consent, fresh.life.status().consent, true), false);
	assert.equal(readConsent(fresh.storage, 'analytics'), 'refuse');
	assert.equal(readConsent(fresh.storage, 'external_media'), 'refuse');
	// dev builds: analytics not choosable, so only media decides "answered"
	assert.equal(isUnanswered(null, null, false), true);
	assert.equal(isUnanswered('allow', null, false), false);
	assert.equal(isUnanswered(null, 'allow', true), false); // a stored analytics answer: not a fresh visitor (media stays off)
});

test('grant/revoke: analytics starts a fresh session only on allow and stops on revoke; media is separate', () => {
	const r = rig();
	r.choose('media');
	assert.equal(r.started, 0); // media never starts analytics
	r.choose('analytics');
	assert.equal(r.started, 1);
	r.choose('analytics');
	assert.equal(r.stopped, 1); // revoke stops immediately
	assert.equal(r.media.status().allowed, true); // media untouched
	r.choose('analytics');
	assert.equal(r.started, 2); // a fresh session
	r.choose('none'); // both off at once
	assert.deepEqual(r.perms(), { media: false, analytics: false });
	assert.equal(r.stopped, 2);
	r.choose('media');
	assert.equal(new ExternalMediaPermission(r.storage).status().allowed, true); // remembered on next load
});

test('planConsentWrites: unchanged stored values are not rewritten; unset ones are completed', () => {
	const both = { media: true, analytics: true };
	assert.deepEqual(planConsentWrites(both, both, { media: 'allow', analytics: 'allow' }, true), {});
	assert.deepEqual(planConsentWrites({ media: false, analytics: false }, { media: true, analytics: false }, { media: null, analytics: null }, true), { media: 'allow', analytics: 'refuse' });
	assert.deepEqual(planConsentWrites(both, { media: false, analytics: false }, { media: 'allow', analytics: 'allow' }, true), { media: 'refuse', analytics: 'refuse' });
	assert.deepEqual(planConsentWrites(both, both, { media: null, analytics: null }, false), { media: 'allow' });
});

test('bar state: hover/focus preview, click pins, unhover keeps a pinned bar', () => {
	const s = new PrivacyBarState();
	assert.equal(s.visible, false);
	s.pointerEnter();
	assert.equal(s.visible, true); // preview
	s.pointerLeave();
	assert.equal(s.visible, false); // hover alone is not sticky
	s.focusIn();
	assert.equal(s.visible, true);
	s.focusOut();
	assert.equal(s.visible, false);
	s.pointerEnter();
	s.toggleClick(); // pin
	s.pointerLeave();
	assert.equal(s.visible, true);
	assert.equal(s.isPinned, true);
	s.toggleClick(); // the lock again = explicit close
	assert.equal(s.visible, false);
	s.pointerEnter(); // hovering right after a close must not instantly re-preview
	s.pin();
	s.close();
	assert.equal(s.visible, false);
	s.pointerLeave();
	s.pointerEnter();
	assert.equal(s.visible, true); // a fresh hover previews again
});

test('bar state: outside press / Escape / close button close a pinned bar; idle ones are not consumed', () => {
	for (const close of ['outside', 'escape', 'close'] as const) {
		const s = new PrivacyBarState();
		s.pin();
		s.toggleDetails();
		assert.equal(s.details, true);
		if (close === 'outside') assert.equal(s.outsidePress(), true);
		if (close === 'escape') assert.equal(s.escape(), true);
		if (close === 'close') s.close();
		assert.equal(s.visible, false, close);
		assert.equal(s.details, false, close);
	}
	const idle = new PrivacyBarState();
	assert.equal(idle.outsidePress(), false);
	assert.equal(idle.escape(), false);
});

test('bar state: unanswered reminder is visible, non-blocking, not closed by outside press or Escape', () => {
	const s = new PrivacyBarState();
	s.setUnanswered(true);
	assert.equal(s.visible, true);
	assert.equal(s.outsidePress(), false);
	assert.equal(s.escape(), false); // a modal can still be escaped
	assert.equal(s.visible, true);
	s.pin();
	assert.equal(s.outsidePress(), true); // a pinned bar does close on outside press
	assert.equal(s.visible, false); // and the reminder stays dismissed for this page load
});

test('selecting a permission never closes a pinned bar', () => {
	const script = read('src/scripts/privacyConsent.client.ts');
	const choose = script.slice(script.indexOf('const choose ='), script.indexOf('// ---- open / close'));
	assert.ok(choose.includes('state.pin()') && !choose.includes('close()'));
});

test('privacy UI markup: three choices, exact copy, Details with the documented minimum text', () => {
	const markup = read('src/components/PrivacyConsent.astro').split('<style>')[0];
	for (const t of ['No optional services', 'Maximum privacy', 'External media', 'Essential visuals', 'Analytics', 'Site improvement',
		'Privacy settings for optional site services.', 'Details',
		'Loads embedded content from YouTube, Facebook and LinkedIn. Your browser connects to these providers when their content is displayed.',
		'Collects anonymous usage data to understand how the site is used and improve it. No persistent visitor ID, cross-site tracking or session replay. Raw analytics data is retained for 90 days.',
		'Your privacy choices are stored in this browser and can be changed at any time using Privacy.']) {
		assert.ok(markup.includes(t), t);
	}
	assert.equal((markup.match(/data-privacy-choice="/g) ?? []).length, 3);
	assert.equal((markup.match(/aria-pressed="false"/g) ?? []).length, 3);
	assert.match(markup, /id="mgs-options-toggle"[^>]*aria-label="Privacy"/);
	assert.ok(markup.includes('aria-label="Minimize Privacy"'));
	assert.ok(!markup.includes('×')); // minimize is a < chevron, not an X
	const at = (t: string): number => markup.indexOf(t);
	// tab → sentence → controls → Details → minimize
	assert.ok(at('id="mgs-options-toggle"') < at('Privacy settings for optional site services.'));
	assert.ok(at('Privacy settings for optional site services.') < at('data-privacy-choice="none"'));
	assert.ok(at('data-privacy-choice="analytics"') < at('data-privacy-action="details"') && at('data-privacy-action="details"') < at('data-privacy-action="close"'));
	// minimize exists only while pinned: hidden by default, shown by the script only when pinned
	assert.match(markup, /data-privacy-action="close"[^>]*\shidden>/);
	assert.match(read('src/scripts/privacyConsent.client.ts'), /closeBtn\.hidden = !state\.isPinned/);
	assert.match(markup, /mgs-options-group[\s\S]*data-privacy-choice="media"[\s\S]*data-privacy-choice="analytics"/);
	assert.ok(!/Worker|D1|Cloudflare|utm_|session ID/i.test(markup));
	assert.ok(read('src/components/PrivacyConsent.astro').includes("content: '✓'")); // selected is not colour-only
});

test('privacy UI stacking: viewport-fixed, above backdrops, no blur/transform ancestor, safe areas, reduced motion', () => {
	const ui = read('src/components/PrivacyConsent.astro');
	const css = ui.split('<style>')[1];
	assert.match(css, /\.mgs-options-toggle,\s*\.mgs-options-tray \{\s*position: fixed;\s*z-index: 1000;/);
	assert.ok(css.includes('display: contents')); // the wrapper creates no box or stacking context
	assert.ok(!/backdrop-filter|filter:|will-change/.test(css));
	const start = css.indexOf('.mgs-options-root {');
	const root = css.slice(start, css.indexOf('}', start));
	assert.ok(!/transform|filter|opacity|isolation|contain/.test(root));
	for (const inset of ['safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right']) assert.ok(css.includes(inset), inset);
	assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}transition: none/);
	// every other layer on the page (filter/person backdrops, modal chrome, navbar, rotate overlay) is below it
	for (const f of ['src/components/ScrollyRegion.astro', 'src/components/NavBar.astro', 'src/components/RotateOverlay.astro']) {
		for (const m of read(f).matchAll(/z-index:\s*(\d+)/g)) assert.ok(Number(m[1]) < 1000, `${f} z-index ${m[1]}`);
	}
	// mounted once, outside the NavBar and every modal container
	assert.equal((read('src/pages/index.astro').match(/<PrivacyConsent \/>/g) ?? []).length, 1);
	assert.ok(!read('src/components/NavBar.astro').includes('PrivacyConsent'));
	assert.ok(!/privacy/i.test(read('src/components/projects/ProjectModal.astro')));
});

test('hosting: one root re-hosted into the open modal <dialog> and back; state and logic shared; modal untouched', () => {
	const script = read('src/scripts/privacyConsent.client.ts');
	assert.ok(script.includes("d.matches(':modal')"));
	assert.ok(script.includes('host.appendChild(root)'));
	assert.ok(!/cloneNode|innerHTML|createElement/.test(script)); // no duplicate markup
	assert.equal((script.match(/new PrivacyBarState\(/g) ?? []).length, 1); // one state
	assert.match(script, /MutationObserver\(syncHost\)[\s\S]{0,120}attributeFilter: \['open'\]/);
	assert.ok(script.includes("document.addEventListener('close'"));
	assert.match(script, /moving = true;[\s\S]{0,200}refocus\?\.focus/);
	// the move itself never closes/resets Privacy and never touches the dialog
	const sync = script.slice(script.indexOf('const syncHost'), script.indexOf('// ---- rendering'));
	assert.ok(!/state\.|\.close\(|\.showModal|\.show\(|\.remove\(/.test(sync));
	// no storage of its own (the old persisted "dismissed" hint is gone; nothing new is stored)
	assert.ok(!/localStorage|sessionStorage|document\.cookie|mgs_privacy_dismissed/.test(script));
	// outside detection ignores the whole root wherever hosted; Escape never closes the dialog beneath it
	assert.match(script, /composedPath\(\)\.includes\(root\)/);
	assert.ok(script.includes('e.preventDefault(); // close Privacy only'));
	// External media changes update an open modal in place: it subscribes to the same permission
	assert.match(read('src/scripts/projectModal.client.ts'), /externalMedia\.subscribe\(/);
});

test('single source of truth: no preset/level state remains in the privacy code', () => {
	for (const f of ['src/scripts/privacyConsent.client.ts', 'src/lib/privacyControl.ts', 'src/components/PrivacyConsent.astro']) {
		assert.ok(!/preset|privacyLevel|cumulative/i.test(read(f)), f);
	}
});

// Brave Shields (cosmetic filtering) injects `display:none !important` for generic selectors that look
// like cookie/consent banners (e.g. `.privacy-bar`, `#privacy-bar`), so the bar had no box in production.
// The component's OWN ids/classes must stay neutral and project-namespaced. (`data-*` attributes and
// visible/ARIA text are unaffected.)
test('privacy UI selectors: project-namespaced, free of filter-sensitive terms', () => {
	const markup = read('src/components/PrivacyConsent.astro').split('<style>')[0];
	const css = read('src/components/PrivacyConsent.astro').split('<style>')[1];
	const names = new Set<string>();
	for (const m of markup.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) names.add(c);
	for (const m of markup.matchAll(/\sid="([^"]*)"/g)) names.add(m[1]);
	for (const m of css.matchAll(/[.#]([A-Za-z_][\w-]*)/g)) if (!/^\d/.test(m[1]) && /[a-z]/i.test(m[1])) names.add(m[1]);
	const own = [...names].filter((n) => /^(mgs-|privacy|cookie|consent|gdpr|tracking|analytics)/i.test(n) || /privacy|cookie|consent|gdpr|tracking|analytics/i.test(n));
	assert.ok(own.length > 0);
	for (const n of own) {
		assert.ok(!/cookie|consent|privacy|gdpr|tracking|analytics/i.test(n), `filter-sensitive selector name: ${n}`);
		assert.ok(n.startsWith('mgs-'), `not in the mgs- namespace: ${n}`);
	}
	const root = markup.match(/<div class="([^"]*)" id="([^"]*)"/);
	assert.ok(root && root[1].startsWith('mgs-') && root[2].startsWith('mgs-'), 'root must use the mgs- namespace');
	// the client script must only look up the renamed ids
	const client = read('src/scripts/privacyConsent.client.ts');
	for (const m of client.matchAll(/\$(?:<[^>]*>)?\('#([\w-]+)'\)/g)) assert.ok(m[1].startsWith('mgs-'), `client selector #${m[1]}`);
});
