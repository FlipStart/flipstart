/**
 * lib/diamondSync.ts
 *
 * Cloud sync for Diamonds in the Rough discoveries + seen/unread state, backed
 * by the `user_diamond_discoveries` table. Mirrors lib/brandSync.ts and
 * lib/achievementSync.ts:
 *   - lazy getSupabase() (never imported at module top → no TestFlight crash)
 *   - every call wrapped in try/catch, dev-only warnings
 *   - fails safe to local-only; never blocks the app, never throws
 *
 * IDENTITY: diamond_id (DIAMONDS def id). Artwork is NEVER synced — the app
 * resolves the bundled WEBP locally from diamond_id → def → diamondArtwork.ts.
 *
 * WHAT SYNCS
 *   • discovery rows  → from computeUnlockedDiamonds(flips) (+ dev unlocks).
 *   • seen/unread     → local SEEN_KEY (@flipstart/seen_diamond_ids_v1).
 * Diamonds have no separate META or REVEALED key, so resurrection risk is lower
 * than brands — the upload source is the authoritative computed unlock set.
 *
 * Unknown diamond_ids (either direction) are ignored with a dev warning.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportSyncWriteError } from '@/lib/syncDiag';
import { DIAMONDS, getDiamondById, type UnlockedDiamond, type DiamondDef } from '@/lib/diamonds';

const SEEN_KEY = '@flipstart/seen_diamond_ids_v1';

/** Canonical diamond IDs — the only IDs we ever write or trust. */
const CANONICAL_IDS: Set<string> = new Set(DIAMONDS.map(d => d.id));

function isCanonical(id: string): boolean {
  if (CANONICAL_IDS.has(id)) return true;
  if (__DEV__) console.warn('[diamondSync] ignoring unknown diamond_id:', id);
  return false;
}

async function getSupabase() {
  try { const { supabase } = await import('@/lib/supabase'); return supabase; }
  catch { return null; }
}

export interface RemoteDiamondDiscovery {
  diamond_id:        string;
  diamond_title:     string;
  diamond_category:  string | null;
  diamond_label:     string | null;
  discovered_at:     string;
  collection_order:  number | null;
  source_scan_id:    string | null;
  source_hunt_id:    string | null;
  source_item_name:  string | null;
  source_context:    string | null;
  is_unread:         boolean;
  seen_at:           string | null;
  reveal_seen:       boolean;
}

// ─── Local seen-set helpers ──────────────────────────────────────────────────
async function readSet(key: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set<string>(); }
}
async function writeSet(key: string, set: Set<string>): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify([...set])); } catch { /* local-only ok */ }
}

// ─── Fetch all remote rows for a user ────────────────────────────────────────
export async function loadRemoteDiamondDiscoveries(userId: string): Promise<RemoteDiamondDiscovery[]> {
  try {
    const sb = await getSupabase();
    if (!sb) return [];
    const { data, error } = await sb
      .from('user_diamond_discoveries')
      .select('diamond_id, diamond_title, diamond_category, diamond_label, discovered_at, collection_order, source_scan_id, source_hunt_id, source_item_name, source_context, is_unread, seen_at, reveal_seen')
      .eq('user_id', userId);
    if (error) { if (__DEV__) console.warn('[diamondSync] load failed:', error.message); return []; }
    return (data ?? []) as RemoteDiamondDiscovery[];
  } catch (err) {
    if (__DEV__) console.warn('[diamondSync] load threw:', err);
    return [];
  }
}

// Build a row payload from a def + the computed UnlockedDiamond record.
function buildRow(
  userId: string,
  def: DiamondDef,
  rec: UnlockedDiamond | undefined,
  isUnread: boolean,
  remote?: RemoteDiamondDiscovery,
) {
  const nowIso = new Date().toISOString();
  const discoveredIso = rec?.discoveredAt
    ? new Date(rec.discoveredAt).toISOString()
    : (remote?.discovered_at ?? nowIso);
  return {
    user_id:          userId,
    diamond_id:       def.id,
    diamond_title:    def.title,
    diamond_category: def.category ?? remote?.diamond_category ?? null,
    diamond_label:    def.badge ?? remote?.diamond_label ?? null,
    // preserve earliest discovery time when remote already has one
    discovered_at:    remote?.discovered_at && remote.discovered_at < discoveredIso
                        ? remote.discovered_at : discoveredIso,
    source_scan_id:   rec?.sourceScanId ?? remote?.source_scan_id ?? null,
    source_hunt_id:   remote?.source_hunt_id ?? null,
    source_item_name: remote?.source_item_name ?? null,
    source_context:   rec?.isFromHunt ? 'hunt_mode' : (remote?.source_context ?? 'normal_scan'),
    is_unread:        isUnread,
    seen_at:          isUnread ? (remote?.seen_at ?? null) : (remote?.seen_at ?? nowIso),
    updated_at:       nowIso,
  };
}

// ─── Upsert a single unlock (background, on unlock) ──────────────────────────
export async function upsertDiamondDiscovery(
  userId: string,
  rec: UnlockedDiamond,
  opts: { isUnread?: boolean } = {},
): Promise<void> {
  if (!isCanonical(rec.id)) return;
  const def = getDiamondById(rec.id);
  if (!def) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const row = buildRow(userId, def, rec, opts.isUnread ?? true);
    const { error } = await sb.from('user_diamond_discoveries')
      .upsert(row, { onConflict: 'user_id,diamond_id', ignoreDuplicates: false });
    if (error) reportSyncWriteError('diamondSync.upsert', error);
  } catch (err) {
    if (__DEV__) console.warn('[diamondSync] upsert threw:', err);
  }
}

// ─── Mark seen (background, when user views the diamond) ───────────────────────
export async function markDiamondDiscoverySeenRemote(userId: string, diamondId: string): Promise<void> {
  if (!isCanonical(diamondId)) return;
  const def = getDiamondById(diamondId);
  if (!def) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const nowIso = new Date().toISOString();
    const { error } = await sb.from('user_diamond_discoveries').upsert(
      {
        user_id:       userId,
        diamond_id:    def.id,
        diamond_title: def.title,
        discovered_at: nowIso, // only used if row is new
        is_unread:     false,
        seen_at:       nowIso,
        updated_at:    nowIso,
      },
      { onConflict: 'user_id,diamond_id', ignoreDuplicates: false },
    );
    if (error) reportSyncWriteError('diamondSync.markSeen', error);
  } catch (err) {
    if (__DEV__) console.warn('[diamondSync] markSeen threw:', err);
  }
}

// ─── Mark reveal seen (forward-compat; no Diamond reveal modal exists yet) ────
export async function markDiamondRevealSeenRemote(userId: string, diamondId: string): Promise<void> {
  if (!isCanonical(diamondId)) return;
  const def = getDiamondById(diamondId);
  if (!def) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('user_diamond_discoveries').upsert(
      {
        user_id:       userId,
        diamond_id:    def.id,
        diamond_title: def.title,
        discovered_at: new Date().toISOString(),
        reveal_seen:   true,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id,diamond_id', ignoreDuplicates: false },
    );
    if (error) reportSyncWriteError('diamondSync.markReveal', error);
  } catch (err) {
    if (__DEV__) console.warn('[diamondSync] markReveal threw:', err);
  }
}

// ─── Delete a row (dev reset only) ────────────────────────────────────────────
export async function deleteDiamondDiscoveryRemoteDevOnly(userId: string, diamondId: string): Promise<void> {
  const def = getDiamondById(diamondId);
  const id = def?.id ?? diamondId;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('user_diamond_discoveries')
      .delete().eq('user_id', userId).eq('diamond_id', id);
    if (error && __DEV__) console.warn('[diamondSync] delete failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[diamondSync] delete threw:', err);
  }
}

/**
 * syncDiamondsWithSupabase — called from the global watcher (which has flips +
 * the computed unlock records) and indirectly on login.
 *
 * Merge strategy (diamond_id = identity):
 *   DOWNLOAD  remote is_unread=false → add to local SEEN_KEY (no re-badge)
 *   UPLOAD    each locally-unlocked record → upsert (earliest discovered_at kept)
 *
 * Adding remote-seen ids to SEEN_KEY before the Progress screen recomputes
 * prevents already-seen diamonds from re-badging. Never throws.
 *
 * @param records  computeUnlockedDiamonds(flips) values (+ dev unlocks), the
 *                 authoritative local unlock set.
 */
export async function syncDiamondsWithSupabase(
  userId: string,
  records: UnlockedDiamond[],
): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;

    const remote     = await loadRemoteDiamondDiscoveries(userId);
    const remoteById = new Map(remote.map(r => [r.diamond_id, r]));

    // ── DOWNLOAD: remote seen → local SEEN ──────────────────────────────────
    const localSeen = await readSet(SEEN_KEY);
    let seenChanged = false;
    for (const r of remote) {
      if (!isCanonical(r.diamond_id)) continue;
      if (!r.is_unread && !localSeen.has(r.diamond_id)) { localSeen.add(r.diamond_id); seenChanged = true; }
    }
    if (seenChanged) await writeSet(SEEN_KEY, localSeen);

    const mergedSeen = await readSet(SEEN_KEY);

    // ── UPLOAD: local unlocked records ──────────────────────────────────────
    const rows: ReturnType<typeof buildRow>[] = [];
    for (const rec of records) {
      if (!isCanonical(rec.id)) continue;
      const def = getDiamondById(rec.id);
      if (!def) continue;
      const r    = remoteById.get(rec.id);
      const seen = mergedSeen.has(rec.id);
      // Skip rows already consistent on remote (avoids sync storms).
      if (r && r.is_unread === !seen) continue;
      rows.push(buildRow(userId, def, rec, !seen, r));
    }

    if (rows.length > 0) {
      const { error } = await sb.from('user_diamond_discoveries')
        .upsert(rows, { onConflict: 'user_id,diamond_id', ignoreDuplicates: false });
      if (error) reportSyncWriteError('diamondSync.bulkUpsert', error);
    }

    if (__DEV__) console.log('[diamondSync] sync complete:', { remote: remote.length, uploaded: rows.length });
  } catch (err) {
    if (__DEV__) console.warn('[diamondSync] sync threw:', err);
  }
}

/**
 * reconcileDiamondsToLocalTruth — call AFTER a destructive scan deletion /
 * clear-history with the FINAL locally-unlocked diamond ids (source of truth).
 * Deletes remote rows not in the final set and cleans the local SEEN set so a
 * future sync can't resurrect a removed Diamond. Fail-safe.
 */
export async function reconcileDiamondsToLocalTruth(
  userId: string,
  finalUnlockedIds: string[],
): Promise<void> {
  try {
    const final = new Set(finalUnlockedIds.filter(isCanonical));

    // Clean local SEEN of now-locked ids.
    const seen = await readSet(SEEN_KEY);
    let seenChanged = false;
    for (const id of [...seen]) { if (!final.has(id)) { seen.delete(id); seenChanged = true; } }
    if (seenChanged) await writeSet(SEEN_KEY, seen);

    // Delete stale remote rows.
    const sb = await getSupabase();
    if (!sb) return;
    const remote = await loadRemoteDiamondDiscoveries(userId);
    const stale  = remote.map(r => r.diamond_id).filter(id => !final.has(id));
    let removed = 0;
    for (const id of stale) {
      const { error } = await sb.from('user_diamond_discoveries')
        .delete().eq('user_id', userId).eq('diamond_id', id);
      if (error) reportSyncWriteError('diamondSync.reconcileDelete', error);
      else removed++;
    }

    if (__DEV__) console.log('[diamondSync] reconcile:', {
      finalUnlocked: final.size, remoteRows: remote.length, removed,
    });
  } catch (err) {
    if (__DEV__) console.warn('[diamondSync] reconcile threw:', err);
  }
}