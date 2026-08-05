import type { PersonId } from './people';

/** Things worked on outside of any employer, shown in the Projects section. */

export interface Project {
	id: string;
	name: string;
	/** WorkTag ids (see data/tags.ts) — engine, genre, and/or award tags. */
	tagIds: string[];
	/** Short strap-line shown under the name. */
	detail: string;
	description: string;
	/** Optional web page / demo link. */
	url?: string;
	/** Who worked on it — defaults to both people if omitted. */
	people?: PersonId[];
}

export const projects: Project[] = [
	{
		id: 'hypha',
		name: 'Hypha — The Wood Wide Web',
		tagIds: ['tabletop', 'strategy', 'board-game'],
		detail: 'Strategy board game',
		description:
			'An original board game the two of us design and prototype together outside of work — one of two Ádám has been prototyping since March 2024.',
	},
	{
		id: 'biobot',
		name: 'Biobot',
		tagIds: ['tabletop', 'card-game', 'qubit-spring-1st-place'],
		detail: '1st Place — Qubit Spring Card Game Design Competition',
		description: 'An original card game designed and prototyped for the Qubit Spring Card Game Design Competition.',
		people: ['mitko'],
	},
];
