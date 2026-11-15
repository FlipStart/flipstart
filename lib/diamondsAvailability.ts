/**
 * lib/diamondsAvailability.ts
 *
 * The ONE switch for Diamonds in the Rough.
 *
 * While false, Diamonds are off everywhere, not just hidden:
 *   - nothing is detected (computeUnlockedDiamonds returns none)
 *   - nothing is marked new, so no badge or notification can appear
 *   - nothing is written to or removed from the cloud (a paused feature must
 *     never wipe what people already earned)
 *   - the Diamonds screen shows "Temporarily unavailable"
 *
 * Saved scans keep their diamond fields, so turning this back on restores
 * everything. NOTE for that day: seen-state was not seeded while off, so every
 * diamond a user already qualifies for would surface as new at once. Seed the
 * seen baseline before flipping this to true.
 *
 * A constant, not a remote flag: nothing outside the app can turn this on.
 */
export const DIAMONDS_ENABLED = false;