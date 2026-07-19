/**
 * lib/scanSync.ts
 *
 * Cloud sync for scan history (FlipResult entries).
 * Local-first: every call is fire-and-forget safe.
 * All Supabase access is via dynamic import — never at module level.
 *
 * Exported functions are called from useFlipStore.tsx after local state
 * is already updated, so a cloud failure never blocks the UI.
 */

import type { FlipResult } from '@/types/flip';

// ─── Helper: get supabase lazily ─────────────────────────────────────────────
async function getSupabase() {
  try {
    const { supabase } = await import('@/lib/supabase');
    return supabase;
  } catch {
    return null;
  }
}

// ─── Upsert one scan ─────────────────────────────────────────────────────────
export async function upsertScan(scan: FlipResult, userId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('scans').upsert(
      {
        user_id:    userId,
        local_id:   scan.id,
        raw_result: scan as any,
        // Individual columns for queryability
        item_name:  scan.itemName,
        brand:      scan.brand,
        category:   scan.category,
        image_uri:  scan.imageUri,
        profit:     scan.profit,
        thrift_price: scan.thriftPrice,
        // Sold-outcome columns (queryable mirrors of raw_result fields)
        status:     scan.status ?? 'scanned',
        sold_price: scan.soldPrice ?? null,
        sold_at:    scan.soldAt ? new Date(scan.soldAt).toISOString() : null,
      },
      { onConflict: 'user_id,local_id' }
    );
    if (error && __DEV__) console.warn('[scanSync] upsert failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[scanSync] upsert threw:', err);
  }
}

// ─── Delete one scan ─────────────────────────────────────────────────────────
export async function deleteScan(scanId: string, userId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('scans').delete()
      .eq('local_id', scanId).eq('user_id', userId);
    if (error && __DEV__) console.warn('[scanSync] delete failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[scanSync] delete threw:', err);
  }
}

// ─── Delete all scans for user ────────────────────────────────────────────────
export async function deleteAllScans(userId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('scans').delete().eq('user_id', userId);
    if (error && __DEV__) console.warn('[scanSync] deleteAll failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[scanSync] deleteAll threw:', err);
  }
}

// ─── Fetch all scans for user ─────────────────────────────────────────────────
export async function fetchScans(userId: string): Promise<FlipResult[]> {
  try {
    const sb = await getSupabase();
    if (!sb) return [];
    const { data, error } = await sb.from('scans')
      .select('raw_result').eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) { if (__DEV__) console.warn('[scanSync] fetch failed:', error.message); return []; }
    return (data ?? [])
      .map((r: any) => r.raw_result as FlipResult)
      .filter(Boolean);
  } catch (err) {
    if (__DEV__) console.warn('[scanSync] fetch threw:', err);
    return [];
  }
}

// ─── Merge local + cloud, dedup by id (cloud wins) ────────────────────────────
export function mergeScans(local: FlipResult[], cloud: FlipResult[]): FlipResult[] {
  const map = new Map<string, FlipResult>();
  for (const s of local)  map.set(s.id, s);
  for (const s of cloud)  map.set(s.id, s); // cloud overwrites
  return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
}