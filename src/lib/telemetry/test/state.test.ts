import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventQueue } from '../queue.ts';
import { buildBatch } from '../transport.ts';
import { buildSessionContext, randomId } from '../session.ts';
import { SemanticStateCoordinator, bindUiEvents } from '../state.ts';
import { announce, UI_EVENT } from '../uiEvents.ts';
import type { TelemetryEvent } from '../types.ts';
import { validateBatch } from '../../../../workers/telemetry/src/validate.ts';

/** The real queue + real event creation, a real EventTarget carrying the same
 *  CustomEvents the UI scripts dispatch (through the real `announce` helper). */
function rig(opts: { emitThrows?: boolean; newId?: () => string | null } = {}) {
	const queue = new EventQueue({ now: () => 5000, iso: () => '2026-09-26T10:00:00.000Z' }, 1000, randomId);
	const bus = new EventTarget();
	(globalThis as { document?: unknown }).document = bus; // announce() dispatches on `document`
	const c = new SemanticStateCoordinator({
		emit: (type, o) => {
			if (opts.emitThrows) throw new Error('telemetry down');
			queue.emit(type, o);
		},
		newId: opts.newId ?? (() => randomId()),
	});
	bindUiEvents(c, bus);
	const events = () => queue.peek(500, 1e9);
	const types = () => events().map((e) => e.event_type);
	const last = () => events().at(-1)!;
	return { c, events, types, last, queue };
}

const session = buildSessionContext(
	{
		search: '', referrer: '', innerWidth: 1280, innerHeight: 720, screenWidth: 1920, screenHeight: 1080,
		maxTouchPoints: 0, hasTouchStart: false, matchMedia: () => ({ matches: true }),
	},
	'sess_0123456789',
	'2026-09-26T10:00:00.000Z',
);

const skillsOpen = (person = 'mitko', method = 'hover', locked = false) =>
	announce(UI_EVENT.skillsOpen, { person, method, locked });

test('initial surface is main, navbar usable, nothing emitted', () => {
	const { c, events } = rig();
	assert.deepEqual(c.state, {
		surface: 'main', projectId: null, skillId: null, skillsMode: null,
		viewInstanceId: null, underlying: 'main', navbarAvailable: true,
	});
	assert.equal(c.isActive('main'), true);
	assert.equal(c.isActive('skills'), false);
	assert.equal(events().length, 0);
});

test('hover opens Skills: surface, mode, event with trigger person/method/locked', () => {
	const { c, events } = rig();
	skillsOpen('adam', 'hover', false);
	assert.equal(c.state.surface, 'skills');
	assert.equal(c.state.skillsMode, 'hover');
	assert.equal(c.state.navbarAvailable, true);
	assert.equal(c.isActive('main'), false); // main is suspended under Skills
	const [e] = events();
	assert.equal(e.event_type, 'skills_open');
	assert.deepEqual(e.properties, { trigger_person: 'adam', trigger_method: 'hover', locked: false });
	assert.equal(e.view_instance_id, c.state.viewInstanceId);
	assert.ok(e.view_instance_id);
});

test('hover -> lock -> unlock -> close sequence, one instance throughout', () => {
	const { c, events, types } = rig();
	skillsOpen('mitko', 'hover', false);
	// The click on Skills while hovered announces open(locked): that is a lock, not a 2nd open.
	skillsOpen('mitko', 'mouse', true);
	assert.equal(c.state.skillsMode, 'locked');
	announce(UI_EVENT.skillsUnlock, { person: 'mitko' });
	assert.equal(c.state.skillsMode, 'hover');
	announce(UI_EVENT.skillsClose, { reason: 'explicit', person: 'mitko' });
	assert.equal(c.state.surface, 'main');
	assert.equal(c.state.skillsMode, null);
	assert.deepEqual(types(), ['skills_open', 'skills_lock', 'skills_unlock', 'skills_close']);
	const ids = new Set(events().map((e) => e.view_instance_id));
	assert.equal(ids.size, 1);
	assert.deepEqual(events()[1].properties, { trigger_person: 'mitko' });
	assert.deepEqual(events()[3].properties, { reason: 'explicit', locked: false, trigger_person: 'mitko' });
});

test('close reasons: hover_leave, outside, escape, navigation; locked flag recorded', () => {
	const { events } = rig();
	for (const reason of ['hover_leave', 'outside', 'escape', 'navigation']) {
		skillsOpen('adam', 'hover', reason === 'outside');
		announce(UI_EVENT.skillsClose, { reason });
	}
	const closes = events().filter((e) => e.event_type === 'skills_close');
	assert.deepEqual(closes.map((e) => e.properties), [
		{ reason: 'hover_leave', locked: false },
		{ reason: 'outside', locked: true },
		{ reason: 'escape', locked: false },
		{ reason: 'navigation', locked: false },
	]);
});

test('unknown close reason is omitted, never invented', () => {
	const { last } = rig();
	skillsOpen();
	announce(UI_EVENT.skillsClose, {});
	assert.deepEqual(last().properties, { locked: false });
});

test('touch open is locked from the start', () => {
	const { c, events } = rig();
	skillsOpen('mitko', 'touch', true);
	assert.equal(c.state.skillsMode, 'locked');
	assert.deepEqual(events()[0].properties, { trigger_person: 'mitko', trigger_method: 'touch', locked: true });
});

test('duplicate UI callbacks create no duplicate semantic events', () => {
	const { c, types } = rig();
	skillsOpen();
	skillsOpen(); // pointerenter fired again
	announce(UI_EVENT.skillsLock, {});
	announce(UI_EVENT.skillsLock, {});
	announce(UI_EVENT.skillsUnlock, {});
	announce(UI_EVENT.skillsUnlock, {});
	announce(UI_EVENT.skillsClose, { reason: 'outside' });
	announce(UI_EVENT.skillsClose, { reason: 'outside' }); // outside click with nothing open
	announce(UI_EVENT.skillsClose, { reason: 'escape' });
	assert.deepEqual(types(), ['skills_open', 'skills_lock', 'skills_unlock', 'skills_close']);
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	announce(UI_EVENT.projectClose, { projectId: 'heroes6', reason: 'explicit' });
	announce(UI_EVENT.projectClose, { projectId: 'heroes6', reason: 'explicit' });
	assert.deepEqual(types().slice(4), ['project_open', 'project_close']);
	assert.equal(c.state.surface, 'main');
});

test('project open/close uses the canonical project id and its own instance', () => {
	const { c, events } = rig();
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	assert.equal(c.state.surface, 'project_modal');
	assert.equal(c.state.projectId, 'heroes6');
	assert.equal(c.state.navbarAvailable, false);
	assert.equal(c.isActive('main'), false);
	announce(UI_EVENT.projectClose, { projectId: 'heroes6', reason: 'backdrop' });
	assert.equal(c.state.surface, 'main');
	const [open, close] = events();
	assert.equal(open.event_type, 'project_open');
	assert.equal(open.target_type, 'project');
	assert.equal(open.target_id, 'heroes6');
	assert.equal(close.target_id, 'heroes6');
	assert.deepEqual(close.properties, { reason: 'backdrop' });
	assert.equal(open.view_instance_id, close.view_instance_id);
	// No static project<->person association leaks into the payload.
	assert.equal(open.properties, undefined);
});

test('a project close for a different project is ignored', () => {
	const { c, types } = rig();
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	announce(UI_EVENT.projectClose, { projectId: 'exigo' });
	assert.equal(c.state.surface, 'project_modal');
	assert.deepEqual(types(), ['project_open']);
});

test('skill click -> filtered view open/close, restoring Skills beneath', () => {
	const { c, events, types } = rig();
	skillsOpen('mitko', 'hover', false);
	const skillsInstance = c.state.viewInstanceId;
	// tagFilter: skill_click, then panelToggle's auto-lock, then the filter opens.
	announce(UI_EVENT.skillClick, { skillId: 'unity', person: 'mitko' });
	announce(UI_EVENT.skillsLock, { cause: 'skill_click', person: 'mitko' });
	announce(UI_EVENT.filterOpen, { skillId: 'unity' });
	assert.equal(c.state.surface, 'skill_filtered');
	assert.equal(c.state.skillId, 'unity');
	assert.equal(c.state.underlying, 'skills');
	assert.equal(c.state.skillsMode, 'locked');
	assert.equal(c.state.navbarAvailable, false);
	assert.equal(c.isActive('skills'), false); // suspended under the filtered view
	announce(UI_EVENT.filterClose, { skillId: 'unity', reason: 'backdrop' });
	// Skills was left up (locked) by the real UI: it is the surface again, same instance.
	assert.equal(c.state.surface, 'skills');
	assert.equal(c.state.viewInstanceId, skillsInstance);
	assert.equal(c.state.navbarAvailable, true);
	assert.deepEqual(types(), ['skills_open', 'skill_click', 'skills_lock', 'skill_filter_open', 'skill_filter_close']);
	const click = events()[1];
	assert.equal(click.target_type, 'skill');
	assert.equal(click.target_id, 'unity');
	assert.deepEqual(click.properties, { trigger_person: 'mitko' });
	assert.equal(click.view_instance_id, skillsInstance); // happened inside that Skills instance
	assert.deepEqual(events()[4].properties, { reason: 'backdrop' });
	// Then Skills closes normally; no second skills_open was emitted for the restoration.
	announce(UI_EVENT.skillsClose, { reason: 'outside' });
	assert.equal(c.state.surface, 'main');
	assert.equal(types().filter((t) => t === 'skills_open').length, 1);
});

test('filtered view over main (no Skills) restores main', () => {
	const { c } = rig();
	announce(UI_EVENT.filterOpen, { skillId: 'csharp' });
	assert.equal(c.state.underlying, 'main');
	announce(UI_EVENT.filterClose, { skillId: 'csharp', reason: 'escape' });
	assert.equal(c.state.surface, 'main');
});

test('switching directly between skills closes one instance and opens another', () => {
	const { events, types } = rig();
	announce(UI_EVENT.filterOpen, { skillId: 'unity' });
	announce(UI_EVENT.filterClose, { skillId: 'unity', reason: 'skill_switch' });
	announce(UI_EVENT.filterOpen, { skillId: 'csharp' });
	assert.deepEqual(types(), ['skill_filter_open', 'skill_filter_close', 'skill_filter_open']);
	assert.notEqual(events()[0].view_instance_id, events()[2].view_instance_id);
});

test('every distinct blocking opening gets a new view_instance_id; one instance keeps its id', () => {
	const { events } = rig();
	skillsOpen('mitko', 'hover', false);
	announce(UI_EVENT.skillsClose, { reason: 'hover_leave' });
	skillsOpen('adam', 'hover', false);
	announce(UI_EVENT.skillsLock, {});
	announce(UI_EVENT.skillsClose, { reason: 'explicit' });
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	announce(UI_EVENT.projectClose, { projectId: 'heroes6' });
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' }); // same project again
	announce(UI_EVENT.projectClose, { projectId: 'heroes6' });
	announce(UI_EVENT.filterOpen, { skillId: 'unity' });
	announce(UI_EVENT.filterClose, { skillId: 'unity' });
	const byType = (t: string) => events().filter((e) => e.event_type === t);
	const [s1, s2] = byType('skills_open');
	assert.notEqual(s1.view_instance_id, s2.view_instance_id);
	assert.equal(byType('skills_lock')[0].view_instance_id, s2.view_instance_id);
	assert.equal(byType('skills_close')[1].view_instance_id, s2.view_instance_id);
	const [p1, p2] = byType('project_open');
	assert.notEqual(p1.view_instance_id, p2.view_instance_id);
	assert.equal(byType('project_close')[0].view_instance_id, p1.view_instance_id);
	assert.equal(byType('project_close')[1].view_instance_id, p2.view_instance_id);
	const all = [s1, s2, p1, p2, byType('skill_filter_open')[0]].map((e) => e.view_instance_id);
	assert.equal(new Set(all).size, all.length);
});

test('Skills raised beneath a blocking view is announced only when it is presented', () => {
	const { c, types } = rig();
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	// Pointer over a person card inside the modal: the class flips but nothing is shown.
	skillsOpen('mitko', 'hover', false);
	assert.equal(c.state.surface, 'project_modal');
	assert.equal(c.state.skillsMode, 'hover');
	assert.deepEqual(types(), ['project_open']);
	// If it goes away again before the modal closes: no phantom open/close.
	announce(UI_EVENT.skillsClose, { reason: 'hover_leave' });
	announce(UI_EVENT.projectClose, { projectId: 'heroes6' });
	assert.deepEqual(types(), ['project_open', 'project_close']);
	// If it is still up when the modal closes, it is presented then.
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	skillsOpen('adam', 'hover', false);
	announce(UI_EVENT.projectClose, { projectId: 'heroes6' });
	assert.equal(c.state.surface, 'skills');
	assert.deepEqual(types().slice(2), ['project_open', 'project_close', 'skills_open']);
});

test('Skills closed by the same click that opens a project (either order) ends on project, then main', () => {
	for (const order of ['skills-first', 'project-first']) {
		const { c, types } = rig();
		skillsOpen('mitko', 'hover', false);
		const close = () => announce(UI_EVENT.skillsClose, { reason: 'outside' });
		const open = () => announce(UI_EVENT.projectOpen, { projectId: 'exigo' });
		if (order === 'skills-first') { close(); open(); } else { open(); close(); }
		assert.equal(c.state.surface, 'project_modal', order);
		announce(UI_EVENT.projectClose, { projectId: 'exigo', reason: 'explicit' });
		assert.equal(c.state.surface, 'main', order);
		assert.equal(types().filter((t) => t === 'skills_open').length, 1, order);
		assert.equal(types().filter((t) => t === 'skills_close').length, 1, order);
	}
});

test('telemetry failure or missing emit never affects UI state', () => {
	const { c } = rig({ emitThrows: true });
	skillsOpen('mitko', 'hover', true);
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	assert.equal(c.state.surface, 'project_modal');
	announce(UI_EVENT.projectClose, { projectId: 'heroes6' });
	assert.equal(c.state.surface, 'skills');
	announce(UI_EVENT.skillsClose, { reason: 'escape' });
	assert.equal(c.state.surface, 'main');
	// telemetry disabled == emit is a no-op
	const off = new SemanticStateCoordinator({ emit: () => {}, newId: () => null });
	off.skillsOpen({ person: 'adam', method: 'hover', locked: false });
	off.filterOpen({ skillId: 'unity' });
	assert.equal(off.state.surface, 'skill_filtered');
	off.filterClose({ skillId: 'unity' });
	assert.equal(off.state.surface, 'skills');
});

test('a throwing subscriber cannot break the coordinator', () => {
	const { c } = rig();
	c.subscribe(() => { throw new Error('bad subscriber'); });
	const seen: string[] = [];
	c.subscribe((s) => seen.push(s.surface));
	skillsOpen();
	announce(UI_EVENT.projectOpen, { projectId: 'heroes6' });
	assert.deepEqual(seen, ['skills', 'project_modal']);
});

test('garbage from the UI is sanitized, not forwarded', () => {
	const { events, c } = rig();
	announce(UI_EVENT.skillsOpen, { person: 'someone else', method: 'telepathy', locked: 'yes' });
	announce(UI_EVENT.skillsClose, { reason: 'Not A Token!' });
	announce(UI_EVENT.skillClick, { skillId: 'has spaces', person: 'x' }); // dropped
	announce(UI_EVENT.projectOpen, { projectId: 'x'.repeat(65) }); // state changes, no event
	assert.equal(c.state.surface, 'project_modal');
	announce(UI_EVENT.projectClose, {});
	assert.deepEqual(events().map((e) => e.event_type), ['skills_open', 'skills_close']);
	assert.deepEqual(events()[0].properties, { locked: false });
	assert.doesNotThrow(() => announce(UI_EVENT.filterOpen, undefined as unknown as object));
});

test('all emitted payloads pass the Worker strict validator', () => {
	const { queue } = rig();
	skillsOpen('mitko', 'hover', false);
	skillsOpen('mitko', 'mouse', true);
	announce(UI_EVENT.skillClick, { skillId: 'unity', person: 'mitko' });
	announce(UI_EVENT.skillsLock, { cause: 'skill_click', person: 'mitko' });
	announce(UI_EVENT.filterOpen, { skillId: 'unity' });
	announce(UI_EVENT.filterClose, { skillId: 'unity', reason: 'card_pill' });
	announce(UI_EVENT.skillsUnlock, { person: 'adam' });
	announce(UI_EVENT.skillsClose, { reason: 'explicit', person: 'adam' });
	skillsOpen('adam', 'touch', true);
	announce(UI_EVENT.skillsClose, { reason: 'navigation' });
	announce(UI_EVENT.projectOpen, { projectId: 'mandragora' });
	announce(UI_EVENT.projectClose, { projectId: 'mandragora', reason: 'escape' });
	announce(UI_EVENT.filterOpen, { skillId: 'csharp' });
	announce(UI_EVENT.filterClose, { skillId: 'csharp', reason: 'chip' });
	const events: TelemetryEvent[] = queue.peek(500, 1e9);
	assert.ok(events.length >= 12);
	for (const followUp of [false, true]) {
		const res = validateBatch(JSON.parse(JSON.stringify(buildBatch(session, followUp, events))));
		assert.equal(res.ok, true, res.ok ? '' : res.detail);
	}
});
