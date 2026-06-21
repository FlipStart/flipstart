/**
 * lib/majorAchievementStorage.ts
 *
 * FILE PATH: lib/majorAchievementStorage.ts
 *
 * Tracks which major achievement full-screen celebrations have already
 * been shown to the user so they fire exactly once per lifetime.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MajorAchievementType } from '@/lib/MajorAchievementModal';
export type { MajorAchievementType };

const STORAGE_KEY = '@flipstart/major_achievement_shown_v1';

// MajorAchievementType is defined in MajorAchievementModal.tsx and re-exported here

async function getShownSet(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

export async function hasShownMajorAchievement(
  type: MajorAchievementType,
): Promise<boolean> {
  const shown = await getShownSet();
  return shown.has(type);
}

export async function markMajorAchievementShown(
  type: MajorAchievementType,
): Promise<void> {
  try {
    const shown = await getShownSet();
    shown.add(type);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...shown]));
  } catch {
    // Never crash on notification storage
  }
}