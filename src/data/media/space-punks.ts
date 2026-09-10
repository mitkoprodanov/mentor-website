import type { ProjectMedia } from './types';

/** Showcase gallery for Space Punks / Flying Wild Hog (see data/timeline.ts). */
export const spacePunksMedia: ProjectMedia[] = [
	{
		src: 'https://www.youtube.com/watch?v=3a6yQj7KrHc',
		kind: 'youtube',
		person: 'mitko',
		caption: "The official reveal trailer",
		tagIds: ['gameplay', 'ability', 'unreal-engine', 'unreal-gas', 'unreal-eqs', 'eos'],  
	},
	{
		src: '',
		kind: 'text',
		person: 'mitko',
		caption: "Used Unreal Engine’s Environment Query System (EQS) to support procedurally generated cooperative missions and gained hands-on experience with the Gameplay Ability System (GAS), Unreal Engine’s framework for networked abilities and gameplay effects.",
		tagIds: ['gameplay', 'ability', 'unreal-engine', 'unreal-eqs', 'unreal-gas'],  
	},
	{
		src: 'https://www.youtube.com/watch?v=pDfjsUC0koE',
		kind: 'youtube',
		start: 35,
		end: 103,
		person: 'mitko',
		caption: "A humorous, comic-book-style game taking you through colorful, varied worlds",
		tagIds: ['gameplay', 'ability', 'unreal-engine', 'unreal-gas', 'unreal-eqs', 'eos'],  
	},
];
