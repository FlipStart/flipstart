/**
 * lib/devFlags.ts
 *
 * TEMPORARY build-visibility flags.
 *
 * These exist so a screen that is normally __DEV__-only can be reached in a
 * TestFlight build during a specific testing window. One constant per flag, read
 * everywhere, so turning it off is a single edit rather than hunting through
 * three files and hoping you found them all.
 */

/**
 * Makes the monetization harness (app/dev-monetization.tsx) reachable in
 * TestFlight.
 *
 * ── SET BACK TO false AFTER TESTFLIGHT VALIDATION ───────────────────────────
 *
 * What this exposes, and what still protects it:
 *
 *   Diagnostics  — still require MONETIZATION_DIAG_SECRET, which is server-side
 *                  and not in the build. Unchanged by this flag.
 *
 *   Purchases    — become tappable by anyone who finds the screen. In a sandbox
 *                  build those purchases are free, BUT the Phase 3 sandbox
 *                  allowlist means a non-allowlisted user is granted ZERO scans.
 *                  The store transaction succeeds and the ledger refuses it.
 *                  That containment is the only reason this is acceptable
 *                  temporarily.
 *
 * It would NOT be acceptable with REVENUECAT_PURCHASE_ENVIRONMENT=production,
 * because real money and real grants would be one tap from a settings screen.
 *
 * ── OFF as of the production launch build ───────────────────────────────────
 * The harness was reaching TestFlight testers, which is exactly what the
 * comment above warned about. It is now __DEV__-only again: the entry in
 * Settings does not render, the route is not registered, and the screen itself
 * refuses to mount.
 *
 * Turning it back on is a one-line edit — but do NOT do so while
 * REVENUECAT_PURCHASE_ENVIRONMENT=production. The sandbox allowlist is what
 * made this containable, and it does not apply to production purchases.
 */
export const MONETIZATION_HARNESS_VISIBLE = false;