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
	/** The main Vision's tooltip (thought detail panel) shown/hidden — consumed
	 *  by the Visibility Matrix wiring (visibility.client.ts), not by the
	 *  semantic state coordinator (Vision never changes `surface`). */
	visionTooltipShow: 'ui:vision-tooltip-show',
	visionTooltipHide: 'ui:vision-tooltip-hide',
} as const;

export type PersonId = 'mitko' | 'adam';
export type TriggerMethod = 'hover' | 'focus' | 'mouse' | 'touch' | 'pen' | 'keyboard';

export interface SkillsOpenDetail {
	person?: string;
	/** hover | focus | mouse | touch | pen | keyboard */
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
	/** hover_leave | focus_leave | explicit | outside | escape | navigation.
	 *  `hover_leave`/`focus_leave` clear only that one reveal reason (Skills
	 *  stays open if hover, focus, or lock still holds it); any other reason
	 *  clears all reasons and always closes it. */
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
	/** explicit | backdrop | cancel (native dialog `cancel` event — Escape or
	 *  another platform cancellation such as a back gesture; omitted when the
	 *  code path is unknown) */
	reason?: string;
}
export interface VisionTooltipShowDetail {
	/** The thought's own stable content id (data/thoughts.ts), not the
	 *  scope-prefixed DOM element id. */
	tooltipId?: string;
	/** hover | focus | click | touch — only ever a value the DOM event
	 *  actually exposes (see vision.client.ts); never guessed. */
	method?: string;
}
export interface VisionTooltipHideDetail {
	tooltipId?: string;
}

/** Announce a transition. Never throws. */
export function announce<T extends object>(name: string, detail: T): void {
	try {
		document.dispatchEvent(new CustomEvent(name, { detail }));
	} catch {
		/* observing must never affect the UI */
	}
}
