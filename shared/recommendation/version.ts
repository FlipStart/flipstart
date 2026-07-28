/** Bump on any change to rules.ts or reasons.ts. The client compares this
 *  against the value stored on a DecisionSnapshot; a mismatch means a stale app
 *  build, and the client renders the stored result rather than computing a
 *  different answer locally. */
export const RECOMMENDATION_MODULE_VERSION = "rec-v1";