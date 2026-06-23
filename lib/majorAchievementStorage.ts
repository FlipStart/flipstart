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

// MajorAchievementType → achievement_id (inverse of MAJOR_MAP). Used to mirror
// celebration_seen into the user_achievements row for signed-in users.
const TYPE_TO_ACHIEVEMENT: Record<string, string> = {
  flipstart_legend:    'profit_10000',
  master_scanner:      'scan_5000',
  hunt_mode_legend:    'hunt_2500',
  never_miss:          'streak_365',
  jackpot:             'rare_100profit',
  band_tee_bloodhound: 'era_bandtee',
  brand_encyclopedia:  'brand_100',
  // 'first_achievement' has no single achievement_id → local-only, not synced.
};

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

  // Background: mirror celebration_seen to Supabase for signed-in users.
  // Fail-safe — never blocks or throws. first_achievement maps to nothing → skipped.
  const achievementId = TYPE_TO_ACHIEVEMENT[type];
  if (achievementId) {
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id;
      if (uid) {
        const { markAchievementCelebrationSeenRemote } = await import('@/lib/achievementSync');
        markAchievementCelebrationSeenRemote(uid, achievementId).catch(() => {});
      }
    } catch {
      // local-only ok
    }
  }
}