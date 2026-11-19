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
  hunt_mode_legend:    'hunt_250',
  never_miss:          'streak_w52',
  weekly_podium:       'hunt_top3',
  weekly_champion:     'hunt_first',
  holy_grail:          'rare_value_1000',
  heavy_hitter:        'rare_value_500',
  bin_diver:           'rare_bin',
  treasure_hunter:     'profit_1000',
  scan_machine:        'scan_100',
  time_traveler:       'era_pre1970',
  jackpot:             'rare_100profit',
  band_tee_bloodhound: 'era_bandtee',
  brand_encyclopedia:  'brand_100',
  // 'first_achievement' has no single achievement_id → local-only, not synced.
};

/**
 * Celebrations that are one design with different words (a week streak) are
 * remembered by a key of their own: "week_streak:streak_w3". The part after the
 * colon is the achievement id, which is what gets mirrored to Supabase.
 */
export const STREAK_CELEBRATION_PREFIX = 'week_streak:';

/** Same as hasShownMajorAchievement, for any celebration key. */
export async function hasShownCelebration(key: string): Promise<boolean> {
  const shown = await getShownSet();
  return shown.has(key);
}
/** Same as markMajorAchievementShown, for any celebration key. */
export function markCelebrationShown(key: string): Promise<void> {
  return markMajorAchievementShown(key as MajorAchievementType);
}

const markedAt = new Map<string, number>();
/** True when this celebration was marked shown in the last `ms` (this app session). */
export function wasJustCelebrated(key: string, ms: number, now = Date.now()): boolean {
  const at = markedAt.get(key);
  return at != null && now - at >= 0 && now - at < ms;
}

export async function markMajorAchievementShown(
  type: MajorAchievementType,
): Promise<void> {
  markedAt.set(String(type), Date.now());
  try {
    const shown = await getShownSet();
    shown.add(type);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...shown]));
  } catch {
    // Never crash on notification storage
  }

  // Background: mirror celebration_seen to Supabase for signed-in users.
  // Fail-safe — never blocks or throws. first_achievement maps to nothing → skipped.
  const achievementId = String(type).startsWith(STREAK_CELEBRATION_PREFIX)
    ? String(type).slice(STREAK_CELEBRATION_PREFIX.length)
    : TYPE_TO_ACHIEVEMENT[type];
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