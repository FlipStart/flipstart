/**
 * lib/xpSync.ts
 *
 * Cloud sync for XP profiles (HuntXpProfile).
 * Strategy: higher value wins for numerics, union wins for arrays.
 * Never wipes local progress. Fails safe to local-only.
 */

import type { HuntXpProfile } from '@/lib/huntXp';

async function getSupabase() {
  try { const { supabase } = await import('@/lib/supabase'); return supabase; }
  catch { return null; }
}

// ─── Save XP profile to cloud ─────────────────────────────────────────────────
export async function saveXpProfile(profile: HuntXpProfile, userId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    // Write all individual columns so the Supabase dashboard shows live values.
    // raw_profile is also written as the authoritative source for fetchXpProfile.
    const { error } = await sb.from('xp_profiles').upsert(
      {
        user_id:               userId,
        total_xp:              profile.totalXp,
        current_rank:          profile.currentRank,
        completed_hunts:       profile.completedHunts,
        hunt_streak:           profile.huntStreak,
        last_hunt_date:        profile.lastHuntDate ?? null,
        discovered_brands:     profile.discoveredBrands,
        discovered_categories: profile.discoveredCategories,
        raw_profile:           profile as any,
      },
      { onConflict: 'user_id' }
    );
    if (error && __DEV__) console.warn('[xpSync] save failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[xpSync] save threw:', err);
  }
}

// ─── Fetch cloud XP profile ───────────────────────────────────────────────────
export async function fetchXpProfile(userId: string): Promise<HuntXpProfile | null> {
  try {
    const sb = await getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('xp_profiles')
      .select('raw_profile').eq('user_id', userId).single();
    if (error) { if (__DEV__) console.warn('[xpSync] fetch failed:', error.message); return null; }
    return data?.raw_profile as HuntXpProfile ?? null;
  } catch (err) {
    if (__DEV__) console.warn('[xpSync] fetch threw:', err);
    return null;
  }
}

// ─── Merge two XP profiles — higher progress wins ────────────────────────────
export function mergeXpProfiles(local: HuntXpProfile, cloud: HuntXpProfile): HuntXpProfile {
  // Union arrays — deduplicated
  const unionStrings = (a: string[], b: string[]) =>
    Array.from(new Set([...(a ?? []), ...(b ?? [])]));

  // For streak: keep the higher value; for lastHuntDate: keep the more recent
  const betterDate = (a?: string, b?: string): string | undefined => {
    if (!a && !b) return undefined;
    if (!a) return b;
    if (!b) return a;
    return a >= b ? a : b;
  };

  return {
    totalXp:              Math.max(local.totalXp ?? 0,          cloud.totalXp ?? 0),
    currentRank:          (local.totalXp ?? 0) >= (cloud.totalXp ?? 0)
                            ? local.currentRank : cloud.currentRank,
    completedHunts:       Math.max(local.completedHunts ?? 0,   cloud.completedHunts ?? 0),
    huntStreak:           Math.max(local.huntStreak ?? 0,        cloud.huntStreak ?? 0),
    lastHuntDate:         betterDate(local.lastHuntDate, cloud.lastHuntDate),
    discoveredBrands:     unionStrings(local.discoveredBrands ?? [],     cloud.discoveredBrands ?? []),
    discoveredCategories: unionStrings(local.discoveredCategories ?? [], cloud.discoveredCategories ?? []),
    appliedHuntIds:       unionStrings(local.appliedHuntIds ?? [],       cloud.appliedHuntIds ?? []),
  };
}