/** Things worked on together outside of any employer, shown on the Personal section. */

export interface SideProject {
	id: string;
	name: string;
	tag: string;
	description: string;
}

export const sideProjects: SideProject[] = [
	{
		id: 'hypha',
		name: 'Hypha — The Wood Wide Web',
		tag: 'Strategy board game',
		description:
			'An original board game the two of us design and prototype together outside of work — one of two Ádám has been prototyping since March 2024.',
	},
];
