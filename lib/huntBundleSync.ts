/**
 * lib/huntBundleSync.ts
 *
 * Cloud sync for completed hunt bundles (HuntBundle entries).
 * Same local-first pattern as scanSync.ts.
 */

import type { HuntBundle } from '@/types/flip';

async function getSupabase() {
  try { const { supabase } = await import('@/lib/supabase'); return supabase; }
  catch { return null; }
}

// ─── Upsert one hunt bundle ───────────────────────────────────────────────────
export async function upsertHuntBundle(bundle: HuntBundle, userId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('hunt_bundles').upsert(
      { id: bundle.id, user_id: userId, raw_bundle: bundle as any },
      { onConflict: 'id,user_id' }
    );
    if (error && __DEV__) console.warn('[huntBundleSync] upsert failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[huntBundleSync] upsert threw:', err);
  }
}

// ─── Delete one hunt bundle ───────────────────────────────────────────────────
export async function deleteHuntBundle(bundleId: string, userId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('hunt_bundles').delete()
      .eq('id', bundleId).eq('user_id', userId);
    if (error && __DEV__) console.warn('[huntBundleSync] delete failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[huntBundleSync] delete threw:', err);
  }
}

// ─── Delete all hunt bundles for user ────────────────────────────────────────
export async function deleteAllHuntBundles(userId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('hunt_bundles').delete().eq('user_id', userId);
    if (error && __DEV__) console.warn('[huntBundleSync] deleteAll failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[huntBundleSync] deleteAll threw:', err);
  }
}

// ─── Fetch all hunt bundles for user ─────────────────────────────────────────
export async function fetchHuntBundles(userId: string): Promise<HuntBundle[]> {
  try {
    const sb = await getSupabase();
    if (!sb) return [];
    const { data, error } = await sb.from('hunt_bundles')
      .select('raw_bundle').eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) { if (__DEV__) console.warn('[huntBundleSync] fetch failed:', error.message); return []; }
    return (data ?? []).map((r: any) => r.raw_bundle as HuntBundle);
  } catch (err) {
    if (__DEV__) console.warn('[huntBundleSync] fetch threw:', err);
    return [];
  }
}

// ─── Merge local + cloud bundles, dedup by id (cloud wins) ───────────────────
export function mergeHuntBundles(local: HuntBundle[], cloud: HuntBundle[]): HuntBundle[] {
  const map = new Map<string, HuntBundle>();
  for (const b of local) map.set(b.id, b);
  for (const b of cloud) map.set(b.id, b); // cloud overwrites
  return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
}