/**
 * lib/onboarding-storage.ts
 * Thin helpers for persisting onboarding state.
 * Uses AsyncStorage — already in package.json.
 *
 * VERSIONED ONBOARDING
 * ─────────────────────────────────────────────────────────────────────────────
 * Onboarding is gated by a version number, not just a boolean. Bumping
 * ONBOARDING_VERSION forces every user through onboarding ONE more time
 * (without wiping any scan history, Hunt progress, achievements, or profile data).
 *
 * Migration of the legacy `onboardingComplete: true` flag:
 *   - old flag true + no version stored  → treated as completed version 1
 *   - then 1 < ONBOARDING_VERSION (2)    → onboarding shows again once
 *   - finishing stores completedOnboardingVersion = ONBOARDING_VERSION
 *
 * To force testers through onboarding again in a future build, bump this number.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Current onboarding version. Bump to force all users through onboarding once. */
export const ONBOARDING_VERSION = 2;

const KEY_COMPLETE   = 'onboardingComplete';        // legacy boolean (kept for back-compat)
const KEY_VERSION    = 'completedOnboardingVersion'; // new: highest onboarding version finished
const KEY_USER_MODE  = 'userMode';
const KEY_INTERESTS  = 'onboardingInterests';

export type UserMode = 'resell' | 'personal';

/**
 * Resolve the highest onboarding version this device has completed.
 * Handles the legacy boolean: if `onboardingComplete === 'true'` but no version
 * is stored, the user finished the pre-versioning onboarding → treat as version 1.
 * Returns 0 when onboarding has never been completed.
 */
export async function getCompletedOnboardingVersion(): Promise<number> {
  try {
    const [[, versionRaw], [, legacyRaw]] = await AsyncStorage.multiGet([KEY_VERSION, KEY_COMPLETE]);
    if (versionRaw != null) {
      const n = parseInt(versionRaw, 10);
      return Number.isFinite(n) ? n : 0;
    }
    // No version stored — migrate the legacy boolean.
    if (legacyRaw === 'true') return 1;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Whether onboarding should be shown. True when the completed version is behind
 * the current ONBOARDING_VERSION (covers never-onboarded, legacy v1 users, and
 * any future version bump).
 */
export async function needsOnboarding(): Promise<boolean> {
  const completed = await getCompletedOnboardingVersion();
  return completed < ONBOARDING_VERSION;
}

/**
 * Back-compat shim. Old callers asked "is onboarding complete?"; that now means
 * "is the device caught up to the current onboarding version?".
 */
export async function isOnboardingComplete(): Promise<boolean> {
  return !(await needsOnboarding());
}

/**
 * Mark onboarding finished for the CURRENT version. Writes both the new version
 * key and the legacy boolean (so anything still reading the old key stays happy).
 */
export async function completeOnboarding(mode: UserMode): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [KEY_VERSION,   String(ONBOARDING_VERSION)],
      [KEY_COMPLETE,  'true'],
      [KEY_USER_MODE, mode],
    ]);
  } catch {
    // fail silently — user still proceeds to home
  }
}

export async function getUserMode(): Promise<UserMode | null> {
  try {
    const val = await AsyncStorage.getItem(KEY_USER_MODE);
    return (val as UserMode) ?? null;
  } catch {
    return null;
  }
}

export async function setUserMode(mode: UserMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_USER_MODE, mode);
  } catch {}
}

/** Onboarding interests — stored locally only (no server/personalization yet). */
export async function setOnboardingInterests(interests: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_INTERESTS, JSON.stringify(interests));
  } catch {}
}

export async function getOnboardingInterests(): Promise<string[]> {
  try {
    const val = await AsyncStorage.getItem(KEY_INTERESTS);
    return val ? (JSON.parse(val) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Dev / settings helper — resets onboarding so it shows again on next launch.
 * Clears the version key AND the legacy boolean (so migration can't re-skip it),
 * plus the locally-stored interests. Does NOT touch scans, Hunt, achievements,
 * brands, diamonds, or profile data.
 */
export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY_VERSION, KEY_COMPLETE, KEY_USER_MODE, KEY_INTERESTS]);
  } catch {}
}