/**
 * How a timeline entry's box seams with its neighbours across a fork or
 * merge (see data/timeline.ts) — computed in Timeline.astro from same-
 * employer name matches plus the hardcoded Mentor-era → Together Again join.
 *
 * `mitkoAbove`/`mitkoBelow`/`adamAbove`/`adamBelow` are set on an *apart*
 * entry: consumed by ApartBlock (via TimelineNode) to square off that box's
 * own touching edge, keep it top-aligned in its fork row, and skip a
 * redundant join-year label; and by Timeline.astro itself to decide where to
 * render a TrackConnector bridging the gap to the neighbouring box.
 *
 * `squareTopLeft`/`squareTopRight`/`squareBottomLeft`/`squareBottomRight`
 * are derived from those same flags for the *together* entry on the other
 * side of the seam: consumed by CompanyBlock to square off just the one
 * corner a connector bridges into, leaving the rest of that full-width box's
 * corners rounded as normal.
 */
export interface Continuation {
	mitkoAbove?: boolean;
	mitkoBelow?: boolean;
	adamAbove?: boolean;
	adamBelow?: boolean;
	squareTopLeft?: boolean;
	squareTopRight?: boolean;
	squareBottomLeft?: boolean;
	squareBottomRight?: boolean;
}
