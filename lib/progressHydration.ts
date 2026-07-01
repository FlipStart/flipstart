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
): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const flagKey = `@flipstart/seen_baseline_done:${uid}`;
    const done = await AsyncStorage.getItem(flagKey);
    if (done === 'true') return; // already seeded on this device for this account

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