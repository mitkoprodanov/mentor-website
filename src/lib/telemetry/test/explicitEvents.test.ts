import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildContactEmailCopy,
	buildContactEmailOpen,
	buildCvDownload,
	buildExternalLinkClick,
	buildLinkedinClick,
	buildNavClick,
	pointerTypeOf,
} from '../explicitEvents.ts';
import { EventQueue } from '../queue.ts';
import { buildBatch } from '../transport.ts';
import { buildSessionContext, randomId } from '../session.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';

// ---- pointerTypeOf --------------------------------------------------------

test('pointerTypeOf: only a real, known PointerEvent value; keyboard/synthetic ("") is undefined, never guessed', () => {
	assert.equal(pointerTypeOf({ pointerType: 'mouse' }), 'mouse');
	assert.equal(pointerTypeOf({ pointerType: 'touch' }), 'touch');
	assert.equal(pointerTypeOf({ pointerType: 'pen' }), 'pen');
	assert.equal(pointerTypeOf({ pointerType: '' }), undefined);
	assert.equal(pointerTypeOf({}), undefined);
	assert.equal(pointerTypeOf(null), undefined);
	assert.equal(pointerTypeOf({ pointerType: 'nonsense' }), undefined);
});

// ---- nav_click -------------------------------------------------------------

test('nav_click: main surface carries target + origin_surface + origin_section, never skills_mode', () => {
	const opts = buildNavClick({ target: 'contact', originSurface: 'main', originSection: 'timeline' });
	assert.equal(opts?.target_type, undefined);
	assert.deepEqual(opts?.properties, { target: 'contact', origin_surface: 'main', origin_section: 'timeline' });
});

test('nav_click: skills surface carries skills_mode, never origin_section', () => {
	const opts = buildNavClick({ target: 'about', originSurface: 'skills', skillsMode: 'locked', originSection: 'about' });
	assert.deepEqual(opts?.properties, { target: 'about', origin_surface: 'skills', skills_mode: 'locked' });
});

test('nav_click: pointer_type included only when the event actually reports one', () => {
	const withPointer = buildNavClick({ target: 'timeline', originSurface: 'main', pointerType: 'touch' });
	assert.equal(withPointer?.properties?.pointer_type, 'touch');
	const withoutPointer = buildNavClick({ target: 'timeline', originSurface: 'main' });
	assert.equal('pointer_type' in (withoutPointer?.properties ?? {}), false);
});

test('nav_click: unknown target or surface is rejected (never emitted, never guessed)', () => {
	assert.equal(buildNavClick({ target: 'skills', originSurface: 'main' }), null);
	assert.equal(buildNavClick({ target: 'about', originSurface: 'project_modal' }), null);
});

test('nav_click: an unrecognized origin_section/skills_mode is silently dropped, not invented', () => {
	const opts = buildNavClick({ target: 'about', originSurface: 'main', originSection: 'bogus' });
	assert.equal('origin_section' in (opts?.properties ?? {}), false);
});

// ---- cv_download / linkedin_click ------------------------------------------

test('cv_download: valid person id', () => {
	const opts = buildCvDownload('mitko', 'mouse');
	assert.deepEqual(opts, { target_type: 'person', target_id: 'mitko', properties: { pointer_type: 'mouse' } });
});

test('cv_download: unknown/missing person id is rejected', () => {
	assert.equal(buildCvDownload(undefined), null);
	assert.equal(buildCvDownload('nobody'), null);
});

test('linkedin_click: person and company use the same event with distinct target_type/target_id', () => {
	const person = buildLinkedinClick('person', 'adam');
	assert.deepEqual(person, { target_type: 'person', target_id: 'adam', properties: undefined });
	const company = buildLinkedinClick('company', 'mentor-game-studio');
	assert.deepEqual(company, { target_type: 'company', target_id: 'mentor-game-studio', properties: undefined });
});

test('linkedin_click: a person id outside mitko/adam is rejected even if it matches the id pattern', () => {
	assert.equal(buildLinkedinClick('person', 'someone-else'), null);
});

test('linkedin_click: missing target id is rejected', () => {
	assert.equal(buildLinkedinClick('company', undefined), null);
	assert.equal(buildLinkedinClick('company', ''), null);
});

// ---- contact email ----------------------------------------------------------

test('contact_email_copy: carries company identity, no email address, no pointer info', () => {
	const opts = buildContactEmailCopy('mentor-game-studio');
	assert.deepEqual(opts, { target_type: 'company', target_id: 'mentor-game-studio' });
});

test('contact_email_open: carries company identity + pointer type when known', () => {
	const opts = buildContactEmailOpen('mentor-game-studio', 'touch');
	assert.deepEqual(opts, { target_type: 'company', target_id: 'mentor-game-studio', properties: { pointer_type: 'touch' } });
});

test('contact email builders reject a missing company id rather than emitting an untargeted event', () => {
	assert.equal(buildContactEmailCopy(undefined), null);
	assert.equal(buildContactEmailOpen(null), null);
});

// ---- external_link_click ----------------------------------------------------

test('external_link_click: known destination + project id', () => {
	const opts = buildExternalLinkClick('official_site', 'heroes6', 'mouse');
	assert.deepEqual(opts, {
		target_type: 'project',
		target_id: 'heroes6',
		properties: { destination_type: 'official_site', pointer_type: 'mouse' },
	});
});

test('external_link_click: destination without a project id omits target_type/target_id, keeps the property', () => {
	const opts = buildExternalLinkClick('official_site', undefined);
	assert.equal(opts?.target_type, undefined);
	assert.equal(opts?.target_id, undefined);
	assert.deepEqual(opts?.properties, { destination_type: 'official_site' });
});

test('external_link_click: an unwired destination type never emits (extend the allowlist, not guess)', () => {
	assert.equal(buildExternalLinkClick('anything_else', 'heroes6'), null);
	assert.equal(buildExternalLinkClick(undefined, 'heroes6'), null);
});

// ---- Worker validator round-trip -------------------------------------------

test('one of each Pass 3 explicit-action event passes the real Worker validator', () => {
	const clock = { now: () => 5000, iso: () => '2026-09-29T10:00:00.000Z' };
	const q = new EventQueue(clock, 1000, randomId);
	q.emit('nav_click', buildNavClick({ target: 'contact', originSurface: 'main', originSection: 'timeline', pointerType: 'mouse' })!);
	q.emit('cv_download', buildCvDownload('mitko', 'touch')!);
	q.emit('linkedin_click', buildLinkedinClick('person', 'adam')!);
	q.emit('linkedin_click', buildLinkedinClick('company', 'mentor-game-studio')!);
	q.emit('contact_email_copy', buildContactEmailCopy('mentor-game-studio')!);
	q.emit('contact_email_open', buildContactEmailOpen('mentor-game-studio', 'mouse')!);
	q.emit('external_link_click', buildExternalLinkClick('official_site', 'heroes6', 'mouse')!);
	q.emit('external_link_click', buildExternalLinkClick('linkedin_post_fallback', 'hod')!);

	const session = buildSessionContext(
		{
			search: '', referrer: '', innerWidth: 1280, innerHeight: 720, screenWidth: 1920, screenHeight: 1080,
			maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: true }),
		},
		'sess_pass3_0001',
		'2026-09-29T10:00:00.000Z',
	);
	const events = q.peek(100, 1e6);
	assert.equal(events.length, 8);
	const result = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, false, events))));
	assert.equal(result.ok, true, result.ok ? '' : result.detail);
});

test('contact_email_copy never carries the email address itself', () => {
	const opts = buildContactEmailCopy('mentor-game-studio');
	const json = JSON.stringify(opts);
	assert.equal(json.includes('@'), false);
});
