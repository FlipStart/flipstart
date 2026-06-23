/**
 * lib/brandSync.ts
 *
 * Cloud sync for Brand Compendium discoveries + seen/unread state, backed by the
 * `user_brand_discoveries` table. Mirrors lib/achievementSync.ts and lib/xpSync.ts:
 *   - lazy getSupabase() (never imported at module top → no TestFlight crash)
 *   - every call wrapped in try/catch, dev-only warnings
 *   - fails safe to local-only; never blocks the app, never throws
 *
 * IDENTITY: FlipStart brands have no separate id — the canonical brand NAME is
 * the identity. We store it in brand_id (and brand_name).
 *
 * WHAT SYNCS
 *   • discovery rows  → from local BrandDiscoveryMeta (@flipstart/brand_discovery_meta)
 *                       plus any discovered brand passed in (migration of pre-meta
 *                       discoveries).
 *   • seen/unread     → local SEEN_BRANDS_KEY (@flipstart/seen_brand_discoveries)
 *   • reveal guard    → local REVEALED_BRANDS_KEY — downloaded brands are marked
 *                       revealed so the once-only reveal modal never replays on a
 *                       new device.
 *
 * Mystery Preview state is NOT synced (kept local by design).
 * Unknown brand names (either direction) are ignored with a dev warning.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportSyncWriteError } from '@/lib/syncDiag';
import { ALL_BRANDS, getBrandByName, type Brand } from '@/lib/brandCompendium';
import type { BrandDiscoveryMeta } from '@/lib/devBrandOverrides';

const SEEN_BRANDS_KEY     = '@flipstart/seen_brand_discoveries';
const REVEALED_BRANDS_KEY = '@flipstart/revealed_brand_discoveries';
const META_KEY            = '@flipstart/brand_discovery_meta';

/** Canonical brand names — the only names we ever write or trust. */
const CANONICAL_NAMES: Set<string> = new Set(ALL_BRANDS.map(b => b.name));

function isCanonical(name: string): boolean {
  if (CANONICAL_NAMES.has(name)) return true;
  if (__DEV__) console.warn('[brandSync] ignoring unknown brand:', name);
  return false;
}

async function getSupabase() {
  try { const { supabase } = await import('@/lib/supabase'); return supabase; }
  catch { return null; }
}

export interface RemoteBrandDiscovery {
  brand_id:         string;
  brand_name:       string;
  rarity:           string;
  category:         string | null;
  discovered_at:    string;
  collection_order: number | null;
  source_scan_id:   string | null;
  source_hunt_id:   string | null;
  source_item_name: string | null;
  source_context:   string | null;
  scan_count:       number;
  total_profit:     number;
  best_flip_profit: number;
  is_unread:        boolean;
  seen_at:          string | null;
}

// ─── Local set helpers ───────────────────────────────────────────────────────
async function readSet(key: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set<string>(); }
}
async function writeSet(key: string, set: Set<string>): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify([...set])); } catch { /* local-only ok */ }
}
async function readMeta(): Promise<Record<string, BrandDiscoveryMeta>> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
async function writeMeta(meta: Record<string, BrandDiscoveryMeta>): Promise<void> {
  try { await AsyncStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* local-only ok */ }
}

// ─── Fetch all remote rows for a user ────────────────────────────────────────
export async function loadRemoteBrandDiscoveries(userId: string): Promise<RemoteBrandDiscovery[]> {
  try {
    const sb = await getSupabase();
    if (!sb) return [];
    const { data, error } = await sb
      .from('user_brand_discoveries')
      .select('brand_id, brand_name, rarity, category, discovered_at, collection_order, source_scan_id, source_hunt_id, source_item_name, source_context, scan_count, total_profit, best_flip_profit, is_unread, seen_at')
      .eq('user_id', userId);
    if (error) { if (__DEV__) console.warn('[brandSync] load failed:', error.message); return []; }
    return (data ?? []) as RemoteBrandDiscovery[];
  } catch (err) {
    if (__DEV__) console.warn('[brandSync] load threw:', err);
    return [];
  }
}

// Build a row payload for a brand from meta (if present) + the canonical brand.
function buildRow(
  userId: string,
  brand: Brand,
  meta: BrandDiscoveryMeta | undefined,
  isUnread: boolean,
  remote?: RemoteBrandDiscovery,
) {
  const nowIso = new Date().toISOString();
  const discoveredIso = meta?.dateDiscovered
    ? new Date(meta.dateDiscovered).toISOString()
    : (remote?.discovered_at ?? nowIso);
  return {
    user_id:          userId,
    brand_id:         brand.name,
    brand_name:       brand.name,
    rarity:           brand.rarity,
    category:         brand.category ?? remote?.category ?? null,
    // preserve earliest discovery time when remote already has one
    discovered_at:    remote?.discovered_at && remote.discovered_at < discoveredIso
                        ? remote.discovered_at : discoveredIso,
    source_scan_id:   meta?.scanId   ?? remote?.source_scan_id   ?? null,
    source_hunt_id:   meta?.huntId   ?? remote?.source_hunt_id   ?? null,
    source_item_name: meta?.itemName ?? remote?.source_item_name ?? null,
    source_context:   meta?.discoverySource ?? remote?.source_context ?? null,
    // stats: prefer existing remote values, else meta-derived, else safe defaults
    scan_count:       remote?.scan_count ?? 1,
    total_profit:     remote?.total_profit ?? 0,
    best_flip_profit: remote?.best_flip_profit ?? meta?.estimatedProfit ?? 0,
    is_unread:        isUnread,
    seen_at:          isUnread ? (remote?.seen_at ?? null) : (remote?.seen_at ?? nowIso),
    updated_at:       nowIso,
  };
}

// ─── Upsert a single discovery (background, on discover) ──────────────────────
export async function upsertBrandDiscovery(
  userId: string,
  meta: BrandDiscoveryMeta,
  opts: { isUnread?: boolean } = {},
): Promise<void> {
  if (!isCanonical(meta.brandName)) return;
  const brand = getBrandByName(meta.brandName);
  if (!brand) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const row = buildRow(userId, brand, meta, opts.isUnread ?? true);
    const { error } = await sb.from('user_brand_discoveries')
      .upsert(row, { onConflict: 'user_id,brand_id', ignoreDuplicates: false });
    if (error) reportSyncWriteError('brandSync.upsert', error);
  } catch (err) {
    if (__DEV__) console.warn('[brandSync] upsert threw:', err);
  }
}

// ─── Mark seen (background, when user views the discovery) ─────────────────────
export async function markBrandDiscoverySeenRemote(userId: string, brandName: string): Promise<void> {
  if (!isCanonical(brandName)) return;
  const brand = getBrandByName(brandName);
  if (!brand) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const nowIso = new Date().toISOString();
    // upsert so a seen-mark also lands if the discovery row never made it up.
    const { error } = await sb.from('user_brand_discoveries').upsert(
      {
        user_id:     userId,
        brand_id:    brand.name,
        brand_name:  brand.name,
        rarity:      brand.rarity,
        category:    brand.category ?? null,
        discovered_at: nowIso, // only used if row is new
        is_unread:   false,
        seen_at:     nowIso,
        updated_at:  nowIso,
      },
      { onConflict: 'user_id,brand_id', ignoreDuplicates: false },
    );
    if (error) reportSyncWriteError('brandSync.markSeen', error);
  } catch (err) {
    if (__DEV__) console.warn('[brandSync] markSeen threw:', err);
  }
}

// ─── Delete a row (dev reset only) ────────────────────────────────────────────
export async function deleteBrandDiscoveryRemoteDevOnly(userId: string, brandName: string): Promise<void> {
  const brand = getBrandByName(brandName);
  const id = brand?.name ?? brandName;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('user_brand_discoveries')
      .delete().eq('user_id', userId).eq('brand_id', id);
    if (error && __DEV__) console.warn('[brandSync] delete failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[brandSync] delete threw:', err);
  }
}

/**
 * reconcileBrandsToLocalTruth — call AFTER a destructive scan deletion /
 * clear-history, with the FINAL locally-discovered brand names (source of
 * truth). Makes cloud + local state match so deleted brands can't resurrect:
 *
 *   1. Delete remote rows whose brand_id is NOT in finalDiscoveredNames.
 *   2. Clean local META_KEY — drop discovery metadata for undiscovered brands
 *      (otherwise the next sync re-uploads them from stale meta → resurrection).
 *   3. Clean local SEEN_BRANDS_KEY + REVEALED_BRANDS_KEY — drop undiscovered
 *      brands so they neither re-upload as seen nor stay reveal-suppressed.
 *
 * Surviving brands are left untouched (seen/unread preserved). Fail-safe.
 */
export async function reconcileBrandsToLocalTruth(
  userId: string,
  finalDiscoveredNames: string[],
): Promise<void> {
  try {
    const final = new Set(finalDiscoveredNames.filter(isCanonical));

    // ── Clean local META_KEY ────────────────────────────────────────────────
    const meta = await readMeta();
    let metaChanged = false;
    for (const name of Object.keys(meta)) {
      if (!final.has(name)) { delete meta[name]; metaChanged = true; }
    }
    if (metaChanged) await writeMeta(meta);

    // ── Clean local SEEN + REVEALED sets ────────────────────────────────────
    const seen = await readSet(SEEN_BRANDS_KEY);
    let seenChanged = false;
    for (const n of [...seen]) { if (!final.has(n)) { seen.delete(n); seenChanged = true; } }
    if (seenChanged) await writeSet(SEEN_BRANDS_KEY, seen);

    const revealed = await readSet(REVEALED_BRANDS_KEY);
    let revChanged = false;
    for (const n of [...revealed]) { if (!final.has(n)) { revealed.delete(n); revChanged = true; } }
    if (revChanged) await writeSet(REVEALED_BRANDS_KEY, revealed);

    // ── Delete stale remote rows ────────────────────────────────────────────
    const sb = await getSupabase();
    if (!sb) return;
    const remote = await loadRemoteBrandDiscoveries(userId);
    const stale  = remote.map(r => r.brand_id).filter(id => !final.has(id));
    let removed = 0;
    for (const id of stale) {
      const { error } = await sb.from('user_brand_discoveries')
        .delete().eq('user_id', userId).eq('brand_id', id);
      if (error) { reportSyncWriteError('brandSync.reconcileDelete', error); }
      else removed++;
    }

    if (__DEV__) console.log('[brandSync] reconcile:', {
      finalDiscovered: final.size, remoteRows: remote.length, removed,
    });
  } catch (err) {
    if (__DEV__) console.warn('[brandSync] reconcile threw:', err);
  }
}

/**
 * syncBrandCompendiumWithSupabase — called on login (download-focused) and from
 * the Progress screen (with the computed discovered set, for upload/reconcile).
 *
 * Merge strategy (brand name = identity):
 *   DOWNLOAD  remote rows  → reconstruct local BrandDiscoveryMeta if missing
 *             remote is_unread=false → add to local SEEN_BRANDS_KEY
 *             all remote discoveries → mark REVEALED locally (suppress re-reveal)
 *   UPLOAD    local meta rows + any discoveredNames missing on remote → upsert
 *             local-seen names → is_unread=false
 *
 * Adding remote-seen names to SEEN_BRANDS_KEY (and marking revealed) BEFORE the
 * Progress screen recomputes notifications prevents already-seen brands from
 * re-badging or re-revealing. Never throws; partial failure leaves local intact.
 *
 * @param discoveredNames canonical brand names discovered locally (from
 *        computeDiscoveredBrands). Pass [] at login when not yet computed.
 */
export async function syncBrandCompendiumWithSupabase(
  userId: string,
  discoveredNames: string[] = [],
): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;

    const remote     = await loadRemoteBrandDiscoveries(userId);
    const remoteById = new Map(remote.map(r => [r.brand_id, r]));

    // ── DOWNLOAD: reconstruct local meta for remote discoveries missing it ──
    const localMeta = await readMeta();
    let metaChanged = false;
    for (const r of remote) {
      if (!isCanonical(r.brand_id)) continue;
      if (!localMeta[r.brand_id]) {
        localMeta[r.brand_id] = {
          brandName:       r.brand_id,
          rarity:          r.rarity,
          category:        r.category ?? '',
          dateDiscovered:  Date.parse(r.discovered_at) || Date.now(),
          discoverySource: (r.source_context as BrandDiscoveryMeta['discoverySource']) ?? 'normal_scan',
          scanId:          r.source_scan_id ?? undefined,
          huntId:          r.source_hunt_id ?? undefined,
          itemName:        r.source_item_name ?? undefined,
          estimatedProfit: r.best_flip_profit ?? undefined,
        };
        metaChanged = true;
      }
    }
    if (metaChanged) await writeMeta(localMeta);

    // ── DOWNLOAD: remote seen → local SEEN; all remote → local REVEALED ─────
    const localSeen     = await readSet(SEEN_BRANDS_KEY);
    const localRevealed = await readSet(REVEALED_BRANDS_KEY);
    let seenChanged = false, revealedChanged = false;
    for (const r of remote) {
      if (!isCanonical(r.brand_id)) continue;
      if (!r.is_unread && !localSeen.has(r.brand_id)) { localSeen.add(r.brand_id); seenChanged = true; }
      if (!localRevealed.has(r.brand_id))             { localRevealed.add(r.brand_id); revealedChanged = true; }
    }
    if (seenChanged)     await writeSet(SEEN_BRANDS_KEY, localSeen);
    if (revealedChanged) await writeSet(REVEALED_BRANDS_KEY, localRevealed);

    // ── UPLOAD: union of local meta keys + discoveredNames ──────────────────
    const mergedSeen = await readSet(SEEN_BRANDS_KEY);
    const uploadNames = new Set<string>([
      ...Object.keys(localMeta),
      ...discoveredNames,
    ].filter(isCanonical));

    const rows: ReturnType<typeof buildRow>[] = [];
    for (const name of uploadNames) {
      const brand = getBrandByName(name);
      if (!brand) continue;
      const r    = remoteById.get(name);
      const seen = mergedSeen.has(name);
      // Skip rows already consistent on remote (avoids needless writes / sync storm).
      if (r && r.is_unread === !seen) continue;
      rows.push(buildRow(userId, brand, localMeta[name], !seen, r));
    }

    if (rows.length > 0) {
      const { error } = await sb.from('user_brand_discoveries')
        .upsert(rows, { onConflict: 'user_id,brand_id', ignoreDuplicates: false });
      if (error) reportSyncWriteError('brandSync.bulkUpsert', error);
    }

    if (__DEV__) console.log('[brandSync] sync complete:', { remote: remote.length, uploaded: rows.length });
  } catch (err) {
    if (__DEV__) console.warn('[brandSync] sync threw:', err);
  }
}