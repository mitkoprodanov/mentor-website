import { timeline, type CompanyDef, type ExperienceRef } from './timeline';
import type { PersonId } from './people';

function allExperienceRefs(): ExperienceRef[] {
	const refs: ExperienceRef[] = [];
	const collectCompany = (company: CompanyDef) => {
		for (const project of company.projects) {
			refs.push(...project.experiences);
		}
	};
	for (const entry of timeline) {
		if (entry.kind === 'together') {
			collectCompany(entry.company);
		} else {
			entry.mitko.forEach(collectCompany);
			entry.adam.forEach(collectCompany);
		}
	}
	return refs;
}

const linkedSkillsByPerson: Record<PersonId, Set<string>> = { mitko: new Set(), adam: new Set() };
for (const ref of allExperienceRefs()) {
	for (const skill of ref.skills ?? []) {
		linkedSkillsByPerson[ref.person].add(skill);
	}
}

/** Skill labels (matching that person's `skillGroups`) that have at least one linked experience in the Timeline. */
export function getLinkedSkills(personId: PersonId): Set<string> {
	return linkedSkillsByPerson[personId];
}
