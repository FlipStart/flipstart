/**
 * lib/devAchievementOverrides.ts
 *
 * FILE PATH: lib/devAchievementOverrides.ts
 *
 * DEV ONLY — manually force-unlocked achievement IDs for testing.
 * These are merged with real unlocked IDs in the achievements screens.
 * Has no effect in production builds.
 *
 * Also exposes helpers to clear "seen" and "major shown" state
 * so animations can be re-triggered during testing.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DEV_UNLOCKED_KEY = '@flipstart/dev_unlocked_achievements';
const SEEN_KEY         = '@flipstart/seen_achievement_ids';
const MAJOR_KEY        = '@flipstart/major_achievement_shown_v1';

// ─── Dev unlocked set ─────────────────────────────────────────────────────────

export async function getDevUnlocked(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DEV_UNLOCKED_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

export async function addDevUnlocked(id: string): Promise<void> {
  try {
    const set = await getDevUnlocked();
    set.add(id);
    await AsyncStorage.setItem(DEV_UNLOCKED_KEY, JSON.stringify([...set]));
  } catch {}
}

export async function removeDevUnlocked(id: string): Promise<void> {
  try {
    const set = await getDevUnlocked();
    set.delete(id);
    await AsyncStorage.setItem(DEV_UNLOCKED_KEY, JSON.stringify([...set]));
  } catch {}
}

export async function clearAllDevUnlocked(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEV_UNLOCKED_KEY);
  } catch {}
}

// ─── Seen / major shown helpers (for resetting animations) ───────────────────

export async function removeFromSeen(id: string): Promise<void> {
  try {
    const raw  = await AsyncStorage.getItem(SEEN_KEY);
    const seen = new Set<string>(raw ? JSON.parse(raw) : []);
    seen.delete(id);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {}
}

export async function clearAllSeen(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEEN_KEY);
  } catch {}
}

export async function removeFromMajorShown(type: string): Promise<void> {
  try {
    const raw  = await AsyncStorage.getItem(MAJOR_KEY);
    const seen = new Set<string>(raw ? JSON.parse(raw) : []);
    seen.delete(type);
    await AsyncStorage.setItem(MAJOR_KEY, JSON.stringify([...seen]));
  } catch {}
}

export async function clearAllMajorShown(): Promise<void> {
  try {
    await AsyncStorage.removeItem(MAJOR_KEY);
  } catch {}
}