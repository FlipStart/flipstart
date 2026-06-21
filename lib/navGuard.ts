/**
 * lib/navGuard.ts
 * Global single-tap guard for navigation.
 *
 * Tapping two buttons in quick succession (before the first screen has loaded)
 * can fire two navigations and push two screens. Call navGuard() at the top of
 * any navigation handler: the first tap returns true (and locks for a short
 * window); taps during the lock return false and should be ignored.
 *
 *   onPress={() => { if (!navGuard()) return; router.push('/somewhere'); }}
 *
 * The lock auto-expires so navigation is never permanently blocked, and can be
 * released early once a screen settles via releaseNavGuard().
 */

let lockedUntil = 0;

// How long a single navigation "owns" the lock. Long enough to cover a screen
// transition, short enough to never feel stuck.
const LOCK_MS = 700;

/** Returns true if this navigation may proceed (and locks out rapid repeats). */
export function navGuard(): boolean {
  const now = Date.now();
  if (now < lockedUntil) return false;
  lockedUntil = now + LOCK_MS;
  return true;
}

/** Optional: release the lock early (e.g. after a screen mounts). */
export function releaseNavGuard(): void {
  lockedUntil = 0;
}