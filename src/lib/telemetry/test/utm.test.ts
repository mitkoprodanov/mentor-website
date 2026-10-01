// Campaign attribution (utm_source/medium/campaign/content) on the session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionContext, parseUtm } from '../session.ts';
import type { SessionEnv } from '../session.ts';
import { EventQueue } from '../queue.ts';
import { Transport } from '../transport.ts';
import type { Fetch } from '../transport.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';

const env = (search: string): SessionEnv => ({
	search,
	referrer: '',
	innerWidth: 1280,
	innerHeight: 720,
	screenWidth: 1920,
	screenHeight: 1080,
	maxTouchPoints: 0,
	hasTouchStart: false,
	matchMedia: (q) => ({ matches: q === '(pointer: fine)' || q === '(any-pointer: fine)' || q === '(hover: hover)' }),
});

const STARTED = '2026-09-25T10:00:00.000Z';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
const utmOf = (search: string) => {
	const c = buildSessionContext(env(search), 'sess-id-0010', STARTED) as unknown as Record<string, unknown>;
	return Object.fromEntries(UTM_KEYS.filter((k) => k in c).map((k) => [k, c[k]]));
};

test('utm: all four valid parameters', () => {
	assert.deepEqual(
		utmOf('?utm_source=linkedin&utm_medium=social&utm_campaign=portfolio_launch&utm_content=company_post'),
		{ utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'portfolio_launch', utm_content: 'company_post' },
	);
});

test('utm: partial attribution keeps only what was supplied', () => {
	assert.deepEqual(utmOf('?utm_source=email&utm_campaign=studio_outreach'), {
		utm_source: 'email',
		utm_campaign: 'studio_outreach',
	});
});

test('utm: no attribution leaves all four fields absent', () => {
	assert.deepEqual(utmOf(''), {});
	assert.deepEqual(utmOf('?other=1'), {});
});

test('utm: uppercase is lowercased; whitespace is trimmed', () => {
	assert.deepEqual(utmOf('?utm_source=LinkedIn&utm_medium=%20Social%20&utm_campaign=Portfolio_Launch'), {
		utm_source: 'linkedin',
		utm_medium: 'social',
		utm_campaign: 'portfolio_launch',
	});
	assert.equal(parseUtm('?utm_source=%09%20x%20%0A').utm_source, 'x');
});

test('utm: invalid characters are omitted, not sanitized or sent raw', () => {
	assert.deepEqual(utmOf('?utm_source=link%20edin&utm_medium=so.cial&utm_campaign=a%2Fb&utm_content=%3Cscript%3E'), {});
	assert.deepEqual(utmOf('?utm_source=https%3A%2F%2Fevil.test&utm_medium=a@b.com&utm_campaign=x%C3%A9'), {});
	assert.deepEqual(utmOf('?utm_source=a+b'), {}); // "+" decodes to a space inside the value
});

test('utm: empty values are omitted', () => {
	assert.deepEqual(utmOf('?utm_source=&utm_medium=%20%20&utm_campaign&utm_content='), {});
});

test('utm: over-length values are omitted (never truncated); limit is inclusive', () => {
	assert.deepEqual(utmOf(`?utm_source=${'a'.repeat(41)}`), {});
	assert.deepEqual(utmOf(`?utm_source=${'a'.repeat(40)}`), { utm_source: 'a'.repeat(40) });
});

test('utm: unrelated parameters (including utm_term) are ignored', () => {
	const ctx = buildSessionContext(
		env('?utm_term=kw&fbclid=abc&gclid=1&email=a%40b.com&company=acme&utm_source=linkedin'),
		'sess-id-0011',
		STARTED,
	);
	assert.deepEqual(Object.keys(ctx).filter((k) => k.startsWith('utm')), ['utm_source']);
	assert.ok(!JSON.stringify(ctx).match(/fbclid|gclid|acme|a@b|kw/));
});

test('utm: the URL / query string is never part of the session payload', () => {
	const search = '?utm_source=linkedin&utm_medium=social&utm_campaign=portfolio_launch&utm_content=company_post&secret=tok123';
	const ctx = buildSessionContext(env(search), 'sess-id-0012', STARTED);
	const json = JSON.stringify(ctx);
	assert.ok(!json.includes('?') && !json.includes('secret') && !json.includes('tok123') && !json.includes('http'));
	assert.ok(!('search' in ctx) && !('url' in ctx));
});

test('utm: attribution rides the creation batch, passes the Worker validator, never appears on events', async () => {
	let now = 1000;
	const clock = { now: () => now, iso: () => STARTED };
	const q = new EventQueue(clock, clock.now());
	const session = buildSessionContext(env('?utm_source=LinkedIn&utm_campaign=portfolio_launch'), 'sess-id-0013', STARTED);
	const bodies: any[] = [];
	const send: Fetch = async (_u, init) => {
		bodies.push(JSON.parse(init.body));
		return { ok: true, status: 200 };
	};
	const t = new Transport('https://w.test/v1/batch', session, q, send, () => now);
	q.emit('session_start');
	await t.flush();
	now += 1000;
	q.emit('nav_click', { target_type: 'nav', target_id: 'about' });
	await t.flush();
	assert.equal(bodies.length, 2);
	assert.equal(bodies[0].session.utm_source, 'linkedin');
	assert.equal(bodies[0].session.utm_campaign, 'portfolio_launch');
	assert.ok(!('utm_medium' in bodies[0].session));
	assert.equal(bodies[1].session.session_id, 'sess-id-0013'); // follow-up still targets the same session
	assert.ok(!UTM_KEYS.some((k) => k in bodies[1].session)); // not repeated
	assert.ok(!bodies.some((b) => b.events.some((e: any) => UTM_KEYS.some((k) => k in e)))); // not on events
	const v = validateBatch(bodies[0]);
	assert.equal(v.ok, true, v.ok ? '' : v.detail);
});

test('utm: separate page loads never inherit attribution from each other', () => {
	const first = buildSessionContext(env('?utm_source=linkedin'), 'sess-id-0014', STARTED) as unknown as Record<string, unknown>;
	const second = buildSessionContext(env(''), 'sess-id-0015', STARTED) as unknown as Record<string, unknown>;
	const third = buildSessionContext(env('?utm_source=email'), 'sess-id-0016', STARTED) as unknown as Record<string, unknown>;
	assert.equal(first.utm_source, 'linkedin');
	assert.ok(!UTM_KEYS.some((k) => k in second));
	assert.equal(third.utm_source, 'email');
});

test('referrer: path kept, query/fragment/credentials stripped; UTMs stay intact and separate', () => {
	const e = {
		...env('?utm_source=linkedin&utm_medium=organic_social&utm_campaign=portfolio_site_launch&utm_content=mitko_launch_post'),
		referrer: 'https://u:p@l.example.com/feed/post-1?utm_source=zzz&fbclid=SECRET123#x',
	};
	const ctx = buildSessionContext(e, 'sess-id-0017', STARTED);
	assert.equal(ctx.referrer, 'https://l.example.com/feed/post-1');
	assert.deepEqual(
		[ctx.utm_source, ctx.utm_medium, ctx.utm_campaign, ctx.utm_content],
		['linkedin', 'organic_social', 'portfolio_site_launch', 'mitko_launch_post'],
	);
	assert.ok(!JSON.stringify(ctx).match(/SECRET123|zzz|u:p/));
	assert.ok(!('referrer' in buildSessionContext({ ...env(''), referrer: 'about:blank' }, 'sess-id-0018', STARTED)));
	assert.ok(!('referrer' in buildSessionContext({ ...env(''), referrer: 'not a url' }, 'sess-id-0019', STARTED)));
});
