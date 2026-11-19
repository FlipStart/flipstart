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
const hydratedWaiters = new Map<string, Array<() => void>>();

export function markProgressHydrated(uid: string): void {
  hydrated.add(uid);
  const waiting = hydratedWaiters.get(uid) ?? [];
  hydratedWaiters.delete(uid);
  waiting.forEach(resolve => { try { resolve(); } catch { /* ignore */ } });
}

/**
 * Resolves true once this account's progress state is ready (markProgressHydrated),
 * or false after `timeoutMs`. Lets the Progress tab wait for the global watcher
 * instead of racing it.
 */
export function whenProgressHydrated(uid: string, timeoutMs = 20_000): Promise<boolean> {
  if (hydrated.has(uid)) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const list = hydratedWaiters.get(uid) ?? [];
    list.push(() => { clearTimeout(timer); resolve(true); });
    hydratedWaiters.set(uid, list);
  });
}

// ─── Signing in ───────────────────────────────────────────────────────────────
//
// Signing in (after signing out, or switching accounts) must never replay what
// the account already has: no "new" badges for old brands or achievements, and
// no full-screen celebrations for milestones reached long ago. The "seen" and
// "celebrated" records on the phone are wiped on an account switch, and the
// copy in Supabase is not always complete or quick to arrive, so it cannot be
// relied on. Instead, once the account's history is fully loaded, everything it
// has unlocked at that moment is marked seen and celebrated. Only what is
// unlocked after that point notifies.
//
// A cold start of an app that was already signed in is NOT a sign-in: its
// records were never wiped, so it notifies exactly as before (a streak earned
// just before the app closed still gets its celebration on the next open).

const signedInThisSession = new Set<string>();
/** Per sign-in: resolves when the wipe of the last account's records and this account's downloads are done. */
const loginSyncs = new Map<string, { promise: Promise<void>; resolve: () => void }>();

/**
 * The account was signed into during this session (not restored at launch).
 * Call synchronously, before any await, so nothing can notify for it first.
 */
export function markSignedIn(uid: string): void {
  signedInThisSession.add(uid);
  if (!loginSyncs.has(uid)) {
    let resolve: () => void = () => {};
    const promise = new Promise<void>(r => { resolve = r; });
    loginSyncs.set(uid, { promise, resolve });
  }
}
/** The sign-in's own work (wipe, downloads) to wait for. Its failure counts as done. */
export function setSignInSync(uid: string, work: Promise<unknown>): void {
  const entry = loginSyncs.get(uid);
  if (!entry) return;
  work.then(() => entry.resolve(), () => entry.resolve());
}
export function wasJustSignedIn(uid: string): boolean { return signedInThisSession.has(uid); }
/** The sign-in has been settled (everything it had was marked seen). */
export function settleSignIn(uid: string): void {
  signedInThisSession.delete(uid);
  const entry = loginSyncs.get(uid);
  entry?.resolve();
  loginSyncs.delete(uid);
}
/** Waits for the sign-in's wipe and downloads (XP, seen state), at most `timeoutMs`. */
export async function waitForSignInSync(uid: string, timeoutMs = 15_000): Promise<void> {
  const entry = loginSyncs.get(uid);
  if (!entry) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([entry.promise, new Promise<void>(res => { timer = setTimeout(res, timeoutMs); })]);
  if (timer) clearTimeout(timer);
}

/** Tests only. */
export function __resetProgressHydrationForTests(): void {
  hydrated.clear(); hydratedWaiters.clear(); signedInThisSession.clear(); loginSyncs.clear();
}

export function isProgressHydrated(uid: string): boolean {
  return hydrated.has(uid);
}

/** Called on sign-out / account switch so the next login re-hydrates. */
export function resetProgressHydration(): void {
  hydrated.clear();
}

/**
 * seedSeenBaselineOnce — on the FIRST time an account is opened on this device,
 * mark everything currently unlocked (achievements, brands, diamonds) as already
 * "seen" so a returning user isn't spammed with notifications for their entire
 * existing collection. Only unlocks earned AFTER this point will notify.
 *
 * Persistent + account-scoped: runs exactly once per account per device (guarded
 * by an AsyncStorage flag). Fail-safe — never throws.
 */
export async function seedSeenBaselineOnce(
  uid: string,
  current: { achievements: string[]; brands: string[]; diamonds: string[] },
  opts: { force?: boolean } = {},
): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    // v2 (Nov 18, 2026): every account takes one fresh snapshot after this update,
    // which clears the badges an account switch used to leave behind.
    const flagKey = `@flipstart/seen_baseline_v2_done:${uid}`;
    const done = await AsyncStorage.getItem(flagKey);
    // force: a sign-in. Everything the account has right now counts as seen.
    if (done === 'true' && !opts.force) return; // already seeded on this device for this account

    const SEEN_ACHV     = '@flipstart/seen_achievement_ids';
    const SEEN_BRANDS   = '@flipstart/seen_brand_discoveries';
    const SEEN_DIAMONDS = '@flipstart/seen_diamond_ids_v1';

    const union = async (key: string, ids: string[]) => {
      try {
        const raw = await AsyncStorage.getItem(key);
        const set = new Set<string>(raw ? JSON.parse(raw) : []);
        ids.forEach(id => set.add(id));
        await AsyncStorage.setItem(key, JSON.stringify([...set]));
      } catch { /* local-only ok */ }
    };

    await Promise.all([
      union(SEEN_ACHV,     current.achievements),
      union(SEEN_BRANDS,   current.brands),
      union(SEEN_DIAMONDS, current.diamonds),
    ]);

    await AsyncStorage.setItem(flagKey, 'true');
  } catch { /* fail-safe: notifications just fall back to normal diffing */ }
}