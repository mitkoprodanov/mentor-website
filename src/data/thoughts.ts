/**
 * The six "thoughts" that float over the About hero — each a short category
 * title (always visible as a pill) paired with the fuller description that
 * reveals on hover / click (see components/sections/ThoughtCloud.astro and
 * scripts/thoughtCloud.client.ts).
 *
 * This is the single source for the copy: edit a title or description here and
 * both the pill and its revealed panel update. Order is the on-screen order
 * (filled left→right, top→bottom into the cloud's grid of anchors).
 */

export interface Thought {
	/** Stable id — also used to build the description panel's element id. */
	id: string;
	/** The always-visible pill label. Keep it to a few words. */
	title: string;
	/** The fuller text revealed on hover / click. */
	description: string;
}

export const thoughts: Thought[] = [
	{
		id: 'in-sync',
		title: '15 Years in Sync',
		description:
			'We’ve worked together for over 15 years, combining programming and design expertise with near-zero friction as a complete feature and systems development team.',
	},
	{
		id: 'shipped-experiences',
		title: 'Shipped Experiences',
		description:
			'Our shared experience spans large-scale gameplay systems and complex content features across several shipped and live products, explored in the Timeline below.',
	},
	{
		id: 'true-ownership',
		title: 'True Ownership',
		description:
			'We take ownership of our contributions, whether guided by clearly defined stakeholder direction or driven by our own creative initiative.',
	},
	{
		id: 'easy-integration',
		title: 'Easy Integration',
		description:
			'We integrate easily into both structured organizations and small independent teams, balancing developer and player perspectives throughout our work.',
	},
	{
		id: 'complete-development',
		title: 'Complete Development',
		description:
			'Research, documentation, tooling, content creation and quality assurance run alongside development, keeping our iteration loop responsive.',
	},
	{
		id: 'built-to-scale',
		title: 'Built to Scale',
		description:
			'We offer flexible engagement and can scale both our involvement and overall capacity through our network of trusted specialists.',
	},
];
