/**
 * lib/onboarding-storage.ts
 * Thin helpers for persisting onboarding state.
 * Uses AsyncStorage — already in package.json.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_COMPLETE  = 'onboardingComplete';
const KEY_USER_MODE = 'userMode';

export type UserMode = 'resell' | 'personal';

export async function isOnboardingComplete(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(KEY_COMPLETE);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function completeOnboarding(mode: UserMode): Promise<void> {
  try {
    await AsyncStorage.multiSet([
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

/** Dev / settings helper — resets onboarding so it shows again on next launch */
export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY_COMPLETE, KEY_USER_MODE]);
  } catch {}
}