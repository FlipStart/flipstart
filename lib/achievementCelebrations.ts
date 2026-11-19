/**
 * lib/achievementCelebrations.ts
 *
 * Full-screen achievement celebrations that are NOT tied to pressing Save on a
 * scan. components/achievements/CelebrationHost.tsx shows them, one at a time,
 * on the main tabs (never over a scan, a Hunt, a paywall or the demo).
 *
 *   first_achievement   the first finished scan, saved or not: "Finally Flipping"
 *   week_streak_N       2, 3, 4, 8, 12, 26 weeks in a row, one design each (52 is Never Miss)
 *   weekly_podium       finished a week in the top 3
 *   weekly_champion     finished a week at #1
 *   hunt_mode_legend    250 Hunts
 *   holy_grail, heavy_hitter, bin_diver, treasure_hunter, scan_machine,
 *   time_traveler       mid-game milestones
 *
 * The celebrations that fire on Save (Jackpot, Band Tee Bloodhound, Master
 * Scanner, Brand Encyclopedia, FlipStart Legend) stay in app/results.tsx.
 *
 * A celebration is marked "shown" only when the user dismisses it, so one that
 * was queued when the app closed comes back next time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MajorAchievementType, MajorAchievementText } from '@/lib/MajorAchievementModal';
import {
  hasShownCelebration, markCelebrationShown, STREAK_CELEBRATION_PREFIX, wasJustCelebrated,
} from '@/lib/majorAchievementStorage';
import { recordScanDecided } from '@/lib/achievementStats';
import { WEEK_STREAK_STEPS } from '@/lib/achievements';

export interface Celebration {
  /** What "already shown" is remembered under. */
  key:   string;
  type:  MajorAchievementType;
  text?: MajorAchievementText;
}

// ─── The queue ────────────────────────────────────────────────────────────────

let queue: Celebration[] = [];
let inFlight = 0;                       // work that may still add to the queue
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(cb => { try { cb(); } catch { /* never breaks the queue */ } });

export function subscribeCelebrations(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function currentCelebration(): Celebration | null { return queue[0] ?? null; }
/**
 * True while a celebration is waiting or being worked out. The notifications
 * popup holds off while this is true, so the two never land on top of each other.
 */
export function hasPendingCelebration(): boolean { return queue.length > 0 || inFlight > 0; }

function enqueue(c: Celebration): void {
  if (queue.some(q => q.key === c.key)) return;
  queue = [...queue, c];
  emit();
}

/** The user dismissed the celebration on screen. */
export async function finishCelebration(key: string): Promise<void> {
  queue = queue.filter(q => q.key !== key);
  emit();
  try { await markCelebrationShown(key); } catch { /* shown again at worst */ }
}

// ─── First scan ───────────────────────────────────────────────────────────────

let hasSavedHistory = false;
/** Told by the app whenever the saved history is known: does this account have any? */
export function setHasSavedHistory(has: boolean): void { hasSavedHistory = has; }

/**
 * A scan was finished and decided on (saved or passed on). Counts it, and
 * queues the first-achievement celebration when it was this account's first.
 * Starts synchronously, so hasPendingCelebration() is already true by the time
 * the next screen appears.
 */
export function onScanDecided(saved: boolean): Promise<void> {
  inFlight++;
  return (async () => {
    try {
      const total = await recordScanDecided(saved);
      // An account that already has saved scans or Hunts (from before this
      // counter existed, or from another phone) is not having its first scan.
      if (total === 1 && !hasSavedHistory && !(await hasShownCelebration('first_achievement'))) {
        enqueue({ key: 'first_achievement', type: 'first_achievement' });
      }
    } catch { /* never affects the scan flow */ }
    finally { inFlight--; emit(); }
  })();
}

// ─── Celebrations that follow an unlock ───────────────────────────────────────

/** Mid-game milestones: rare enough to deserve the full screen, reachable enough to be seen. */
const MILESTONES: Record<string, MajorAchievementType> = {
  rare_value_1000: 'holy_grail',
  rare_value_500:  'heavy_hitter',
  rare_bin:        'bin_diver',
  profit_1000:     'treasure_hunter',
  scan_100:        'scan_machine',
  era_pre1970:     'time_traveler',
};
/** Streak lengths that get the full screen: all of them. */
const STREAK_FULL_SCREEN = new Set<number>([2, 3, 4, 8, 12, 26, 52]);

const JUST_NOW_MS = 3 * 60 * 1000;

const streakKey = (weeks: number) => `${STREAK_CELEBRATION_PREFIX}streak_w${weeks}`;

/** What each unlock celebrates as. Ordered: the first match in a group wins. */
function celebrationFor(id: string): Celebration | null {
  if (id === 'hunt_250')   return { key: 'hunt_mode_legend', type: 'hunt_mode_legend' };
  if (id === 'hunt_first') return { key: 'weekly_champion',  type: 'weekly_champion' };
  if (id === 'hunt_top3')  return { key: 'weekly_podium',    type: 'weekly_podium' };
  if (id === 'streak_w52') return { key: 'never_miss',       type: 'never_miss' };
  if (MILESTONES[id])      return { key: MILESTONES[id], type: MILESTONES[id] };
  const m = /^streak_w(\d+)$/.exec(id);
  if (m) {
    const weeks = Number(m[1]);
    if (!STREAK_FULL_SCREEN.has(weeks)) return null;
    // Each streak length has its own design (lib/MajorAchievementModal).
    return { key: streakKey(weeks), type: `week_streak_${weeks}` as MajorAchievementType };
  }
  return null;
}

const BASELINE_KEY = (uid: string) => `@flipstart/celebration_baseline_v2:${uid}`;

/**
 * Called with everything this account has unlocked, each time that is worked
 * out. Queues the celebrations that are new.
 *
 * The first time it runs for an account on a phone it only takes note of what
 * is already unlocked: an update, or signing in on a new phone, never replays
 * a celebration for something earned earlier.
 *
 * Only the biggest of a group is shown: #1 covers the top 3, and the longest
 * streak covers the shorter ones.
 */
export async function queueUnlockCelebrations(uid: string | null, unlockedIds: string[]): Promise<void> {
  if (!uid) return;
  inFlight++;
  try {
    const unlocked = new Set(unlockedIds ?? []);
    const pending: Celebration[] = [];
    for (const id of unlocked) {
      const c = celebrationFor(id);
      if (c && !(await hasShownCelebration(c.key))) pending.push(c);
    }

    let baselined = false;
    try { baselined = (await AsyncStorage.getItem(BASELINE_KEY(uid))) === '1'; } catch { baselined = true; }
    if (!baselined) {
      for (const c of pending) await markCelebrationShown(c.key);
      try { await AsyncStorage.setItem(BASELINE_KEY(uid), '1'); } catch { /* baselined again next time */ }
      return;
    }
    if (pending.length === 0) return;

    const skip = new Set<string>();
    if (pending.some(c => c.key === 'weekly_champion')) skip.add('weekly_podium');
    if (pending.some(c => c.key === 'holy_grail'))      skip.add('heavy_hitter');   // one find, one screen
    // A $500 item usually also earned Jackpot ($250 profit) on the result a
    // moment ago. That was its full screen; a second one on Home is too much.
    if (wasJustCelebrated('jackpot', JUST_NOW_MS))      skip.add('heavy_hitter');
    const streaks = [...WEEK_STREAK_STEPS].filter(w => unlocked.has(`streak_w${w}`));
    const longest = streaks.length ? Math.max(...streaks) : 0;
    for (const w of streaks) {
      if (w !== longest) skip.add(w === 52 ? 'never_miss' : streakKey(w));
    }

    for (const c of pending) {
      if (skip.has(c.key)) await markCelebrationShown(c.key);   // covered by a bigger one
      else enqueue(c);
    }
  } catch { /* a celebration is a nicety */ }
  finally { inFlight--; emit(); }
}

/** Tests only. */
export function __resetCelebrationsForTests(): void {
  queue = []; inFlight = 0; hasSavedHistory = false; listeners.clear();
}