// Semantic UI state for telemetry: which blocking surface currently owns the
// visitor's attention. It is told about transitions by the UI (see
// uiEvents.ts); it never inspects the DOM or CSS, and it never controls the UI.
//
// Layers, bottom to top:
//   main            always there (About/Timeline/Contact + persistent Person cards)
//   skills          optional layer over main (hover or locked)
//   blocking view   optional: project detail dialog OR skill filtered view
//
// The current surface is the topmost layer. Everything beneath it is
// suspended: a later visibility engine asks `isActive(owner)` and only counts
// targets whose owning surface is the current one. Closing a blocking view
// restores whatever was beneath it (skills if it is still up, else main).
//
// All emission goes through the injected `emit` (the telemetry client's
// queue). Emit failures are swallowed; state is updated before emitting.

import { UI_EVENT } from './uiEvents.ts';
import type {
	FilterCloseDetail,
	FilterOpenDetail,
	ProjectCloseDetail,
	ProjectOpenDetail,
	SkillClickDetail,
	SkillsCloseDetail,
	SkillsLockDetail,
	SkillsOpenDetail,
	SkillsUnlockDetail,
} from './uiEvents.ts';
import type { EmitOptions, PropertyValue } from './types.ts';

export type Surface = 'main' | 'skills' | 'project_modal' | 'skill_filtered';
export type SkillsMode = 'hover' | 'locked';

/** Read-only snapshot for future telemetry code (visibility engine, nav_click). */
export interface SemanticState {
	surface: Surface;
	/** Canonical project ID while `project_modal` is the surface. */
	projectId: string | null;
	/** Canonical skill/tag ID while `skill_filtered` is the surface. */
	skillId: string | null;
	/** Set whenever a Skills layer is up (even while suspended by a blocking view). */
	skillsMode: SkillsMode | null;
	/** Instance ID of the current blocking surface (skills / project / filter); null on main. */
	viewInstanceId: string | null;
	/** What the surface becomes if the current blocking view closes. */
	underlying: 'main' | 'skills';
	/** Navbar is usable on main and skills, not in project detail / filtered view. */
	navbarAvailable: boolean;
}

export interface StateDeps {
	emit(eventType: string, opts?: EmitOptions): void;
	/** Random ID for a view instance; null if no CSPRNG (instances then go untagged). */
	newId(): string | null;
}

const TARGET_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const TOKEN_RE = /^[a-z][a-z0-9_]{0,39}$/;
const PEOPLE = new Set(['mitko', 'adam']);
const METHODS = new Set(['hover', 'mouse', 'touch', 'pen', 'keyboard']);

const validId = (v: unknown): string | null =>
	typeof v === 'string' && TARGET_ID_RE.test(v) ? v : null;
const token = (v: unknown): string | null =>
	typeof v === 'string' && TOKEN_RE.test(v) ? v : null;
const person = (v: unknown): string | null => (typeof v === 'string' && PEOPLE.has(v) ? v : null);

/** Drops null/undefined so payloads only carry facts we actually know. */
function props(o: Record<string, PropertyValue | undefined>): Record<string, PropertyValue> | undefined {
	const out: Record<string, PropertyValue> = {};
	for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
	return Object.keys(out).length ? out : undefined;
}

interface SkillsLayer {
	mode: SkillsMode;
	person: string | null;
	method: string | null;
	instanceId: string | null;
	/** skills_open has been emitted. False while the layer was raised beneath a
	 *  blocking view (nothing is presented), so no phantom open/close pair. */
	announced: boolean;
}

type Blocking =
	| { kind: 'project'; projectId: string | null; instanceId: string | null }
	| { kind: 'filter'; skillId: string | null; instanceId: string | null };

export class SemanticStateCoordinator {
	private readonly deps: StateDeps;
	private skills: SkillsLayer | null = null;
	private blocking: Blocking | null = null;
	private readonly listeners = new Set<(s: SemanticState) => void>();

	constructor(deps: StateDeps) {
		this.deps = deps;
	}

	// ---- reading ---------------------------------------------------------

	get state(): SemanticState {
		const b = this.blocking;
		const surface: Surface = b ? (b.kind === 'project' ? 'project_modal' : 'skill_filtered') : this.skills ? 'skills' : 'main';
		return {
			surface,
			projectId: b?.kind === 'project' ? b.projectId : null,
			skillId: b?.kind === 'filter' ? b.skillId : null,
			skillsMode: this.skills?.mode ?? null,
			viewInstanceId: b ? b.instanceId : this.skills ? this.skills.instanceId : null,
			underlying: this.skills ? 'skills' : 'main',
			navbarAvailable: surface === 'main' || surface === 'skills',
		};
	}

	/** Does `owner` currently own attention? Targets owned by any other surface are suspended. */
	isActive(owner: Surface): boolean {
		return this.state.surface === owner;
	}

	subscribe(listener: (s: SemanticState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// ---- Skills ----------------------------------------------------------

	skillsOpen(d: SkillsOpenDetail): void {
		const wantLocked = d.locked === true;
		if (this.skills) {
			// Already up (e.g. hovered): a click that locks it is a lock, not a second open.
			if (wantLocked) this.skillsLock({ person: d.person });
			return;
		}
		this.skills = {
			mode: wantLocked ? 'locked' : 'hover',
			person: person(d.person),
			method: METHODS.has(d.method ?? '') ? (d.method as string) : null,
			instanceId: null,
			announced: false,
		};
		if (!this.blocking) this.announceSkills();
		this.notify();
	}

	skillsLock(d: SkillsLockDetail): void {
		const s = this.skills;
		if (!s || s.mode === 'locked') return;
		s.mode = 'locked';
		if (s.announced) {
			this.emit('skills_lock', {
				view_instance_id: s.instanceId ?? undefined,
				properties: props({ trigger_person: person(d.person), cause: token(d.cause) }),
			});
		}
		this.notify();
	}

	skillsUnlock(d: SkillsUnlockDetail): void {
		const s = this.skills;
		if (!s || s.mode !== 'locked') return;
		s.mode = 'hover';
		if (s.announced) {
			this.emit('skills_unlock', {
				view_instance_id: s.instanceId ?? undefined,
				properties: props({ trigger_person: person(d.person) }),
			});
		}
		this.notify();
	}

	skillsClose(d: SkillsCloseDetail): void {
		const s = this.skills;
		if (!s) return;
		this.skills = null;
		if (s.announced) {
			this.emit('skills_close', {
				view_instance_id: s.instanceId ?? undefined,
				properties: props({
					reason: token(d.reason),
					locked: s.mode === 'locked',
					trigger_person: person(d.person),
				}),
			});
		}
		this.notify();
	}

	private announceSkills(): void {
		const s = this.skills;
		if (!s || s.announced) return;
		s.announced = true;
		s.instanceId = this.deps.newId();
		this.emit('skills_open', {
			view_instance_id: s.instanceId ?? undefined,
			properties: props({
				trigger_person: s.person,
				trigger_method: s.method,
				locked: s.mode === 'locked',
			}),
		});
	}

	// ---- Skill click + filtered view --------------------------------------

	skillClick(d: SkillClickDetail): void {
		const skillId = validId(d.skillId);
		if (!skillId) return;
		this.emit('skill_click', {
			target_type: 'skill',
			target_id: skillId,
			view_instance_id: this.state.viewInstanceId ?? undefined,
			properties: props({ trigger_person: person(d.person) }),
		});
	}

	filterOpen(d: FilterOpenDetail): void {
		const skillId = validId(d.skillId);
		const b = this.blocking;
		if (b?.kind === 'filter' && b.skillId === skillId) return; // duplicate callback
		if (b) this.closeBlocking('superseded');
		const instanceId = this.deps.newId();
		this.blocking = { kind: 'filter', skillId, instanceId };
		if (skillId) {
			this.emit('skill_filter_open', {
				target_type: 'skill',
				target_id: skillId,
				view_instance_id: instanceId ?? undefined,
			});
		}
		this.notify();
	}

	filterClose(d: FilterCloseDetail): void {
		const b = this.blocking;
		if (b?.kind !== 'filter') return;
		this.closeBlocking(token(d.reason));
	}

	// ---- Project detail -----------------------------------------------------

	projectOpen(d: ProjectOpenDetail): void {
		const projectId = validId(d.projectId);
		const b = this.blocking;
		if (b?.kind === 'project' && b.projectId === projectId) return; // duplicate callback
		if (b) this.closeBlocking('superseded');
		const instanceId = this.deps.newId();
		this.blocking = { kind: 'project', projectId, instanceId };
		if (projectId) {
			this.emit('project_open', {
				target_type: 'project',
				target_id: projectId,
				view_instance_id: instanceId ?? undefined,
			});
		}
		this.notify();
	}

	projectClose(d: ProjectCloseDetail): void {
		const b = this.blocking;
		if (b?.kind !== 'project') return;
		const id = validId(d.projectId);
		if (id && b.projectId && id !== b.projectId) return; // a different project's callback
		this.closeBlocking(token(d.reason));
	}

	// ---- shared -------------------------------------------------------------

	/** Closes whichever blocking view is up, emits its close event and restores
	 *  the layer beneath (raising a deferred skills_open if Skills was raised
	 *  while nothing of it was presented). */
	private closeBlocking(reason: string | null): void {
		const b = this.blocking;
		if (!b) return;
		this.blocking = null;
		if (b.kind === 'project' && b.projectId) {
			this.emit('project_close', {
				target_type: 'project',
				target_id: b.projectId,
				view_instance_id: b.instanceId ?? undefined,
				properties: props({ reason }),
			});
		} else if (b.kind === 'filter' && b.skillId) {
			this.emit('skill_filter_close', {
				target_type: 'skill',
				target_id: b.skillId,
				view_instance_id: b.instanceId ?? undefined,
				properties: props({ reason }),
			});
		}
		this.announceSkills();
		this.notify();
	}

	private emit(eventType: string, opts: EmitOptions): void {
		try {
			this.deps.emit(eventType, opts);
		} catch {
			/* telemetry must never affect state or the UI */
		}
	}

	private notify(): void {
		if (this.listeners.size === 0) return;
		const snapshot = this.state;
		for (const l of this.listeners) {
			try {
				l(snapshot);
			} catch {
				/* a bad subscriber must not break the others or the UI */
			}
		}
	}
}

/** Connects UI announcements (uiEvents.ts) to a coordinator. Returns an unbind function. */
export function bindUiEvents(coordinator: SemanticStateCoordinator, target: EventTarget): () => void {
	const handlers: Array<[string, (d: any) => void]> = [
		[UI_EVENT.skillsOpen, (d) => coordinator.skillsOpen(d)],
		[UI_EVENT.skillsLock, (d) => coordinator.skillsLock(d)],
		[UI_EVENT.skillsUnlock, (d) => coordinator.skillsUnlock(d)],
		[UI_EVENT.skillsClose, (d) => coordinator.skillsClose(d)],
		[UI_EVENT.skillClick, (d) => coordinator.skillClick(d)],
		[UI_EVENT.filterOpen, (d) => coordinator.filterOpen(d)],
		[UI_EVENT.filterClose, (d) => coordinator.filterClose(d)],
		[UI_EVENT.projectOpen, (d) => coordinator.projectOpen(d)],
		[UI_EVENT.projectClose, (d) => coordinator.projectClose(d)],
	];
	const bound = handlers.map(([name, fn]) => {
		const listener = (e: Event) => {
			try {
				fn((e as CustomEvent).detail ?? {});
			} catch {
				/* never affect the UI */
			}
		};
		target.addEventListener(name, listener);
		return [name, listener] as const;
	});
	return () => bound.forEach(([name, l]) => target.removeEventListener(name, l));
}
