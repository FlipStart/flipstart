/**
 * lib/achievementSync.ts
 *
 * Cloud sync for achievement acknowledgement state (seen / unread / celebration),
 * backed by the `user_achievements` table. Mirrors lib/xpSync.ts:
 *   - lazy getSupabase() (never imported at module top → no TestFlight crash)
 *   - every call wrapped in try/catch, dev-only warnings
 *   - fails safe to local-only; never blocks the app, never throws
 *
 * WHAT SYNCS
 *   "Unlocked" is recomputed locally from already-synced stats, so this module
 *   does NOT drive unlock animations. It persists:
 *     • seen/unread state  → local SEEN_KEY  (@flipstart/seen_achievement_ids)
 *     • celebration state  → local MAJOR_KEY (@flipstart/major_achievement_shown_v1)
 *   so they carry across devices and don't replay.
 *
 * Unknown achievement_ids (from either side) are ignored with a dev warning.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportSyncWriteError } from '@/lib/syncDiag';
import { ACHIEVEMENT_CATEGORIES } from '@/lib/achievements';
import type { MajorAchievementType } from '@/lib/MajorAchievementModal';

const SEEN_KEY  = '@flipstart/seen_achievement_ids';
const MAJOR_KEY = '@flipstart/major_achievement_shown_v1';

// achievementId → MajorAchievementType. Mirrors MAJOR_MAP in dev-achievements.tsx.
// Celebration state in Supabase is keyed by achievement_id; locally it's tracked
// by MajorAchievementType, so we translate between them here.
const MAJOR_MAP: Record<string, MajorAchievementType> = {
  profit_10000:   'flipstart_legend',
  scan_5000:      'master_scanner',
  hunt_2500:      'hunt_mode_legend',
  streak_365:     'never_miss',
  rare_100profit: 'jackpot',
  era_bandtee:    'band_tee_bloodhound',
  brand_100:      'brand_encyclopedia',
};

/** Canonical achievement IDs — the only IDs we ever write or trust. */
const CANONICAL_IDS: Set<string> = new Set(
  ACHIEVEMENT_CATEGORIES.flatMap(c => c.achievements.map(a => a.id)),
);

function isCanonical(id: string): boolean {
  if (CANONICAL_IDS.has(id)) return true;
  if (__DEV__) console.warn('[achievementSync] ignoring unknown achievement_id:', id);
  return false;
}

async function getSupabase() {
  try { const { supabase } = await import('@/lib/supabase'); return supabase; }
  catch { return null; }
}

export interface RemoteAchievement {
  achievement_id:   string;
  unlocked_at:      string;
  seen_at:          string | null;
  is_unread:        boolean;
  celebration_seen: boolean;
  unlock_source:    string | null;
}

// ─── Local helpers (seen + celebration sets) ─────────────────────────────────
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
export async function loadRemoteAchievements(userId: string): Promise<RemoteAchievement[]> {
  try {
    const sb = await getSupabase();
    if (!sb) return [];
    const { data, error } = await sb
      .from('user_achievements')
      .select('achievement_id, unlocked_at, seen_at, is_unread, celebration_seen, unlock_source')
      .eq('user_id', userId);
    if (error) { if (__DEV__) console.warn('[achievementSync] load failed:', error.message); return []; }
    return (data ?? []) as RemoteAchievement[];
  } catch (err) {
    if (__DEV__) console.warn('[achievementSync] load threw:', err);
    return [];
  }
}

// ─── Upsert a single unlock (background, on unlock) ──────────────────────────
export async function upsertAchievementUnlock(
  userId: string,
  achievementId: string,
  opts: { unlockedAt?: number; isUnread?: boolean; unlockSource?: string } = {},
): Promise<void> {
  if (!isCanonical(achievementId)) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const unlockedAtIso = new Date(opts.unlockedAt ?? Date.now()).toISOString();
    const { error } = await sb.from('user_achievements').upsert(
      {
        user_id:        userId,
        achievement_id: achievementId,
        unlocked_at:    unlockedAtIso,
        is_unread:      opts.isUnread ?? true,
        unlock_source:  opts.unlockSource ?? null,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'user_id,achievement_id', ignoreDuplicates: false },
    );
    if (error) reportSyncWriteError('achievementSync.upsert', error);
  } catch (err) {
    if (__DEV__) console.warn('[achievementSync] upsert threw:', err);
  }
}

// ─── Mark seen (background, when user views the achievement) ──────────────────
export async function markAchievementSeenRemote(userId: string, achievementId: string): Promise<void> {
  if (!isCanonical(achievementId)) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    // upsert so a seen-mark also lands if the unlock row never made it up.
    const { error } = await sb.from('user_achievements').upsert(
      {
        user_id:        userId,
        achievement_id: achievementId,
        unlocked_at:    new Date().toISOString(), // only used if row is new
        is_unread:      false,
        seen_at:        new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'user_id,achievement_id', ignoreDuplicates: false },
    );
    if (error) reportSyncWriteError('achievementSync.markSeen', error);
  } catch (err) {
    if (__DEV__) console.warn('[achievementSync] markSeen threw:', err);
  }
}

// ─── Mark celebration seen (background, when full-screen modal acknowledged) ──
export async function markAchievementCelebrationSeenRemote(
  userId: string,
  achievementId: string,
): Promise<void> {
  if (!isCanonical(achievementId)) return;
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('user_achievements').upsert(
      {
        user_id:          userId,
        achievement_id:   achievementId,
        unlocked_at:      new Date().toISOString(), // only used if row is new
        celebration_seen: true,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: 'user_id,achievement_id', ignoreDuplicates: false },
    );
    if (error) reportSyncWriteError('achievementSync.markCelebration', error);
  } catch (err) {
    if (__DEV__) console.warn('[achievementSync] markCelebration threw:', err);
  }
}

// ─── Delete a row (dev reset only) ───────────────────────────────────────────
export async function deleteAchievementRemote(userId: string, achievementId: string): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;
    const { error } = await sb.from('user_achievements')
      .delete().eq('user_id', userId).eq('achievement_id', achievementId);
    if (error && __DEV__) console.warn('[achievementSync] delete failed:', error.message);
  } catch (err) {
    if (__DEV__) console.warn('[achievementSync] delete threw:', err);
  }
}

/**
 * reconcileAchievementsToLocalTruth — call AFTER a destructive scan deletion /
 * clear-history, with the FINAL locally-unlocked achievement ids (the source of
 * truth). It makes the cloud and local notification state match local truth so
 * deleted progress can't resurrect on the next sync:
 *
 *   1. Delete remote rows whose achievement_id is NOT in finalUnlockedIds.
 *   2. Clean local SEEN_KEY  — drop seen ids no longer unlocked (otherwise the
 *      next sync re-uploads them as rows → resurrection).
 *   3. Clean local MAJOR_KEY — drop celebration flags for now-locked majors so a
 *      future re-unlock can celebrate again.
 *
 * Surviving achievements are left untouched (their seen/unread state is
 * preserved). Fail-safe: never throws; local deletion already stands.
 */
export async function reconcileAchievementsToLocalTruth(
  userId: string,
  finalUnlockedIds: string[],
): Promise<void> {
  try {
    const final = new Set(finalUnlockedIds.filter(isCanonical));

    // ── Clean local SEEN_KEY (drop now-locked ids) ──────────────────────────
    const seen = await readSet(SEEN_KEY);
    let seenChanged = false;
    for (const id of [...seen]) {
      if (!final.has(id)) { seen.delete(id); seenChanged = true; }
    }
    if (seenChanged) await writeSet(SEEN_KEY, seen);

    // ── Clean local MAJOR_KEY (drop celebration of now-locked majors) ───────
    const major = await readSet(MAJOR_KEY);
    let majorChanged = false;
    for (const [achId, type] of Object.entries(MAJOR_MAP)) {
      if (!final.has(achId) && major.has(type)) { major.delete(type); majorChanged = true; }
    }
    if (majorChanged) await writeSet(MAJOR_KEY, major);

    // ── Delete stale remote rows ────────────────────────────────────────────
    const sb = await getSupabase();
    if (!sb) return;
    const remote = await loadRemoteAchievements(userId);
    const stale  = remote.map(r => r.achievement_id).filter(id => !final.has(id));
    let removed = 0;
    for (const id of stale) {
      const { error } = await sb.from('user_achievements')
        .delete().eq('user_id', userId).eq('achievement_id', id);
      if (error) { reportSyncWriteError('achievementSync.reconcileDelete', error); }
      else removed++;
    }

    if (__DEV__) console.log('[achievementSync] reconcile:', {
      finalUnlocked: final.size, remoteRows: remote.length, removed,
    });
  } catch (err) {
    if (__DEV__) console.warn('[achievementSync] reconcile threw:', err);
  }
}


/**
 * syncAchievementsWithSupabase — called once after login (alongside syncXpOnLogin).
 *
 * Merge strategy (achievement_id is identity):
 *   DOWNLOAD  remote rows where is_unread=false        → add to local SEEN_KEY
 *             remote rows where celebration_seen=true  → add mapped type to MAJOR_KEY
 *   UPLOAD    local SEEN_KEY ids   → upsert {is_unread:false, seen_at}
 *             local unlocked ids   → upsert {unlocked_at} (records the unlock)
 *             local MAJOR_KEY types→ upsert {celebration_seen:true} on mapped ids
 *
 * Adding remote-seen ids to SEEN_KEY BEFORE the Progress screen recomputes
 * notifications is what prevents already-seen achievements from replaying.
 * Never throws; partial failure leaves local intact.
 *
 * @param unlockedIds  locally-unlocked achievement ids (from getAllUnlockedIds)
 */
export async function syncAchievementsWithSupabase(
  userId: string,
  unlockedIds: string[],
): Promise<void> {
  try {
    const sb = await getSupabase();
    if (!sb) return;

    const remote = await loadRemoteAchievements(userId);

    // ── DOWNLOAD: remote seen → local SEEN_KEY ──────────────────────────────
    const localSeen = await readSet(SEEN_KEY);
    let seenChanged = false;
    for (const r of remote) {
      if (!isCanonical(r.achievement_id)) continue;
      if (!r.is_unread && !localSeen.has(r.achievement_id)) {
        localSeen.add(r.achievement_id);
        seenChanged = true;
      }
    }
    if (seenChanged) await writeSet(SEEN_KEY, localSeen);

    // ── DOWNLOAD: remote celebration → local MAJOR_KEY ──────────────────────
    const localMajor = await readSet(MAJOR_KEY);
    let majorChanged = false;
    for (const r of remote) {
      const type = MAJOR_MAP[r.achievement_id];
      if (type && r.celebration_seen && !localMajor.has(type)) {
        localMajor.add(type);
        majorChanged = true;
      }
    }
    if (majorChanged) await writeSet(MAJOR_KEY, localMajor);

    // Re-read seen set (now unioned) for upload decisions.
    const mergedSeen = await readSet(SEEN_KEY);
    const remoteById = new Map(remote.map(r => [r.achievement_id, r]));

    // ── UPLOAD: local unlocked rows missing/!=seen on remote ────────────────
    const rowsToUpsert: Array<{
      user_id: string; achievement_id: string; unlocked_at: string;
      is_unread: boolean; seen_at: string | null; celebration_seen: boolean; updated_at: string;
    }> = [];

    const nowIso = new Date().toISOString();
    const validUnlocked = unlockedIds.filter(isCanonical);

    for (const id of validUnlocked) {
      const r        = remoteById.get(id);
      const seen     = mergedSeen.has(id);
      const majorTy  = MAJOR_MAP[id];
      const celebSeen = majorTy ? localMajor.has(majorTy) : false;

      // Skip rows already consistent on remote to avoid needless writes.
      if (r && r.is_unread === !seen
            && (r.celebration_seen || !celebSeen)) {
        continue;
      }
      rowsToUpsert.push({
        user_id:          userId,
        achievement_id:   id,
        // preserve earliest unlock time if remote already has one
        unlocked_at:      r?.unlocked_at ?? nowIso,
        is_unread:        !seen,
        seen_at:          seen ? (r?.seen_at ?? nowIso) : null,
        celebration_seen: celebSeen || !!r?.celebration_seen,
        updated_at:       nowIso,
      });
    }

    // Also push local-seen ids that may not be in unlockedIds yet (dev-unlocked etc.)
    for (const id of mergedSeen) {
      if (!isCanonical(id)) continue;
      if (validUnlocked.includes(id)) continue; // already handled above
      const r = remoteById.get(id);
      if (r && !r.is_unread) continue;            // already seen on remote
      rowsToUpsert.push({
        user_id:          userId,
        achievement_id:   id,
        unlocked_at:      r?.unlocked_at ?? nowIso,
        is_unread:        false,
        seen_at:          r?.seen_at ?? nowIso,
        celebration_seen: !!r?.celebration_seen,
        updated_at:       nowIso,
      });
    }

    if (rowsToUpsert.length > 0) {
      const { error } = await sb.from('user_achievements')
        .upsert(rowsToUpsert, { onConflict: 'user_id,achievement_id', ignoreDuplicates: false });
      if (error) reportSyncWriteError('achievementSync.bulkUpsert', error);
    }

    if (__DEV__) console.log('[achievementSync] sync complete:', {
      remote: remote.length, uploaded: rowsToUpsert.length,
    });
  } catch (err) {
    if (__DEV__) console.warn('[achievementSync] sync threw:', err);
  }
}