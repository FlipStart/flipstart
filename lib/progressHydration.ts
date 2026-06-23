/**
 * lib/progressHydration.ts
 *
 * Tiny session-scoped signal that tells the progress-notification paths whether
 * an account's cloud "seen" state has been downloaded yet this session.
 *
 * WHY: notifications are surfaced by diffing computed unlocks against the local
 * SEEN keys. Right after login / account switch those keys are freshly wiped, so
 * anything computed before the Supabase download finishes looks "new" and the
 * old, already-seen items replay as notifications. Both the global watcher
 * (_layout) and the Progress tab compute notifications; this flag lets whichever
 * runs first AWAIT the download once, and the other skip the wait.
 *
 * Not persisted — resets on app restart (cold start keeps local SEEN intact, so
 * a fresh download is harmless there) and on sign-out (so re-login re-hydrates).
 */

const hydrated = new Set<string>();

export function markProgressHydrated(uid: string): void {
  hydrated.add(uid);
}

export function isProgressHydrated(uid: string): boolean {
  return hydrated.has(uid);
}

/** Called on sign-out / account switch so the next login re-hydrates. */
export function resetProgressHydration(): void {
  hydrated.clear();
}