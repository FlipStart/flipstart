/**
 * server/leaderboard/avatarSweep.ts
 *
 * Removes public profile pictures that no account uses any more.
 *
 * The leaderboard shows a small moderated COPY of each profile picture, stored
 * under a random file name in the public-avatars bucket. A copy stops being
 * used when:
 *
 *   - the account is deleted (its leaderboard row goes; the file would stay)
 *   - you remove a reported picture from the dashboard
 *   - a new picture replaced it and the old file could not be removed right then
 *   - a copy was uploaded but the decision could not be saved
 *
 * Nothing links to such a file, but it is still a person's picture at a public
 * address, so it should not be kept. Once a day this deletes them.
 *
 * It is built to be unable to delete a picture that is in use:
 *
 *   - the list of pictures in use must be read in full and match an exact count,
 *     or nothing is deleted
 *   - only files it could have made itself are considered (<random id>.jpg)
 *   - a file must be at least a day old (a copy uploaded moments ago may not
 *     have been written to its account yet)
 *   - at most 200 files per run, and never when more than half the bucket would
 *     go at once (that would mean something is wrong with the list, not the files)
 */
import { getLeaderboardStore, type LeaderboardStore } from "./store.js";

export const SWEEP_MIN_AGE_MS = 24 * 3600_000;
export const SWEEP_MAX_REMOVALS = 200;
export const SWEEP_EVERY_MS = 24 * 3600_000;
export const SWEEP_FIRST_RUN_MS = 5 * 60_000;
const PAGE = 1000;
const MAX_PAGES = 200;
/** Exactly what identity.ts uploads: a random UUID and ".jpg". */
export const SWEPT_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

export interface SweepResult { files: number; inUse: number; orphans: number; removed: number; skipped?: string }

/** Which files may go. Pure, so the rules can be tested without storage. */
export function orphansAmong(
  files: Array<{ name: string; createdAt: string | null }>, inUse: Set<string>, now: number,
): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!SWEPT_NAME.test(f.name) || inUse.has(f.name)) continue;
    const made = f.createdAt ? Date.parse(f.createdAt) : NaN;
    if (!Number.isFinite(made) || now - made < SWEEP_MIN_AGE_MS) continue;   // unknown age counts as new
    out.push(f.name);
  }
  return out;
}

let sweeping = false;

/** One pass. Never throws. Null when it could not run at all. */
export async function sweepOrphanAvatars(now = Date.now(), storeOverride?: LeaderboardStore | null): Promise<SweepResult | null> {
  if (sweeping) return null;
  sweeping = true;
  try {
    const store = storeOverride === undefined ? getLeaderboardStore() : storeOverride;
    if (!store) return null;

    const inUse = await store.avatarFilesInUse();
    if (!inUse) { console.warn("[leaderboard] picture sweep skipped: the list of pictures in use could not be read in full"); return null; }

    const files: Array<{ name: string; createdAt: string | null }> = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await store.listPublicAvatars(page * PAGE, PAGE);
      if (!batch) { console.warn("[leaderboard] picture sweep skipped: the bucket could not be listed"); return null; }
      files.push(...batch);
      if (batch.length < PAGE) break;
    }

    const orphans = orphansAmong(files, inUse, now);
    const result: SweepResult = { files: files.length, inUse: inUse.size, orphans: orphans.length, removed: 0 };
    if (orphans.length === 0) return result;

    // Half the bucket unused at once is not housekeeping, it is a wrong list.
    if (files.length >= 20 && orphans.length > files.length / 2) {
      result.skipped = "too_many";
      console.warn(`[leaderboard] picture sweep stopped: ${orphans.length} of ${files.length} files look unused, which is too many to be right. Nothing was deleted.`);
      return result;
    }

    const batch = orphans.slice(0, SWEEP_MAX_REMOVALS);
    for (let i = 0; i < batch.length; i += 100) {
      const n = await store.removePublicAvatarFiles(batch.slice(i, i + 100));
      if (n == null) break;
      result.removed += n;
    }
    console.log(`[leaderboard] picture sweep: ${result.removed} unused picture(s) removed (${files.length} files, ${inUse.size} in use)`);
    return result;
  } catch (err) {
    console.warn("[leaderboard] picture sweep failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    sweeping = false;
  }
}

let timers: Array<ReturnType<typeof setTimeout>> = [];

/** Start the daily sweep. Calling it again does nothing. The timers never keep the process alive. */
export function startAvatarSweepJob(): void {
  if (timers.length > 0) return;
  const first = setTimeout(() => { void sweepOrphanAvatars(); }, SWEEP_FIRST_RUN_MS);
  const every = setInterval(() => { void sweepOrphanAvatars(); }, SWEEP_EVERY_MS);
  (first as any).unref?.(); (every as any).unref?.();
  timers = [first, every];
}

/** Tests only. */
export function __resetAvatarSweepForTests(): void {
  for (const t of timers) { clearTimeout(t as any); clearInterval(t as any); }
  timers = []; sweeping = false;
}