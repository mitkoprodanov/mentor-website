/**
 * Shared pixel geometry for the apart-tracks and the fork/merge connector
 * between them, so the connector's lines land exactly on each track's dot
 * column regardless of viewport width (both are fixed px, not percentages).
 */
export const DOT_COLUMN_PX = 110;
export const TRACK_GAP_PX = 32;
/** Each track's dot sits this many px out from the shared centerline. */
export const FORK_OFFSET_PX = TRACK_GAP_PX / 2 + DOT_COLUMN_PX / 2;
