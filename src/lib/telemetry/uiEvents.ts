// The contract between UI scripts and the semantic state coordinator.
//
// UI code (panelToggle, projectModal, tagFilter, filterModal) announces the
// transitions it has *already performed* as document CustomEvents, the same
// pattern the site uses for `filter:opened` / `filter:closed`. The coordinator
// (state.ts) listens; it never reads or drives the DOM. If nothing listens
// (telemetry disabled, script failed) the UI behaves exactly the same.
//
// This module has no dependencies so UI scripts can import it without pulling
// in the telemetry client.

export const UI_EVENT = {
	skillsOpen: 'ui:skills-open',
	skillsLock: 'ui:skills-lock',
	skillsUnlock: 'ui:skills-unlock',
	skillsClose: 'ui:skills-close',
	skillClick: 'ui:skill-click',
	filterOpen: 'ui:filter-open',
	filterClose: 'ui:filter-close',
	projectOpen: 'ui:project-open',
	projectClose: 'ui:project-close',
} as const;

export type PersonId = 'mitko' | 'adam';
export type TriggerMethod = 'hover' | 'mouse' | 'touch' | 'pen' | 'keyboard';

export interface SkillsOpenDetail {
	person?: string;
	method?: string;
	locked?: boolean;
}
export interface SkillsLockDetail {
	person?: string;
	cause?: string;
}
export interface SkillsUnlockDetail {
	person?: string;
}
export interface SkillsCloseDetail {
	/** hover_leave | explicit | outside | escape | navigation */
	reason?: string;
	person?: string;
}
export interface SkillClickDetail {
	skillId?: string;
	person?: string;
}
export interface FilterOpenDetail {
	skillId?: string;
}
export interface FilterCloseDetail {
	skillId?: string;
	/** chip | backdrop | card_pill | escape | skill_toggle | skill_switch */
	reason?: string;
}
export interface ProjectOpenDetail {
	projectId?: string;
}
export interface ProjectCloseDetail {
	projectId?: string;
	/** explicit | backdrop | escape (omitted when the code path is unknown) */
	reason?: string;
}

/** Announce a transition. Never throws. */
export function announce<T extends object>(name: string, detail: T): void {
	try {
		document.dispatchEvent(new CustomEvent(name, { detail }));
	} catch {
		/* observing must never affect the UI */
	}
}
