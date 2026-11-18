/**
 * lib/xpSync.ts
 *
 * Reads this account's XP profile from the cloud. READ ONLY.
 *
 * The app used to write its own XP total here. It no longer can: Hunt XP is
 * worked out and saved by the server (server/hunt), and the database refuses XP
 * writes from the app. Nothing in the app should ever upsert xp_profiles.
 */

import type { HuntXpProfile } from '@/lib/huntXp';

async function getSupabase() {
  try { const { supabase } = await import('@/lib/supabase'); return supabase; }
  catch { return null; }
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