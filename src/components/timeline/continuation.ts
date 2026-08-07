/**
 * How a timeline entry's box should merge with its neighbours. Computed in
 * Timeline.astro (from same-employer name matches plus the Mentor-era join)
 * and consumed by TimelineNode → CompanyBlock/ApartBlock to flatten the right
 * edges/corners so continuing work reads as one card rather than two.
 */
export interface Continuation {
	togetherAbove?: boolean;
	togetherBelow?: boolean;
	/** Partial seams on a full-width `together` box: only one column (left = Mitko, right = Ádám) continues into the neighbour, so only that corner is squared/pulled flush. */
	togetherAboveLeft?: boolean;
	togetherAboveRight?: boolean;
	togetherBelowLeft?: boolean;
	togetherBelowRight?: boolean;
	mitkoAbove?: boolean;
	mitkoBelow?: boolean;
	adamAbove?: boolean;
	adamBelow?: boolean;
	/** For a `together` card: who is newly joining this company (name + join year go on their side) vs continuing the same employer from the adjacent apart entry, and who is leaving (leave year on their side) vs continuing on. A shared join/leave (both) stays centered. */
	mitkoJoins?: boolean;
	adamJoins?: boolean;
	mitkoLeaves?: boolean;
	adamLeaves?: boolean;
}
