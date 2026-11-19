/**
 * lib/achievementStats.ts
 *
 * The few numbers achievements need that the saved scan history cannot give:
 *
 *   - how many scans were FINISHED (saved or not), and how many were passed on
 *   - the most scans finished in one day
 *   - the best weekly Hunt streak (the live streak resets; the achievement stays)
 *   - the best finish on a finished Weekly leaderboard (read from the server,
 *     never sent by the phone)
 *   - which "sticky" achievements this account has already earned
 *
 * Kept per account on this phone. The earned set is also filled from Supabase by
 * lib/achievementSync, so a new phone does not lose a streak or a weekly finish.
 *
 * Everything here is fail-safe: a storage or network problem never throws, it
 * only means an achievement shows up a little later.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isStickyAchievement, type AchievementExtras } from '@/lib/achievements';
import { isHuntDemoActive } from '@/lib/huntDemoMode';

const KEY = (uid: string | null) => `@flipstart/achievement_stats_v1:${uid ?? 'guest'}`;
/** How often the best weekly finish is re-read from the server. */
export const FINISH_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FINISH_TIMEOUT_MS = 6000;

export interface AchievementStats {
  scans:           number;
  passes:          number;
  day:             string;         // local day the dayScans count belongs to
  dayScans:        number;
  bestDayScans:    number;
  bestWeekStreak:  number;
  bestWeeklyRank:  number | null;
  finishCheckedAt: number;
  earned:          string[];
}

const EMPTY: AchievementStats = {
  scans: 0, passes: 0, day: '', dayScans: 0, bestDayScans: 0,
  bestWeekStreak: 0, bestWeeklyRank: null, finishCheckedAt: 0, earned: [],
};

const int = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function clean(p: any): AchievementStats {
  const rank = int(p?.bestWeeklyRank);
  return {
    scans:           int(p?.scans),
    passes:          int(p?.passes),
    day:             typeof p?.day === 'string' ? p.day : '',
    dayScans:        int(p?.dayScans),
    bestDayScans:    int(p?.bestDayScans),
    bestWeekStreak:  int(p?.bestWeekStreak),
    bestWeeklyRank:  rank >= 1 ? rank : null,
    finishCheckedAt: int(p?.finishCheckedAt),
    earned:          Array.isArray(p?.earned) ? p.earned.filter((x: unknown) => typeof x === 'string') : [],
  };
}

export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// ─── Which account ────────────────────────────────────────────────────────────

let activeUid: string | null = null;
/** Set by the celebration host whenever the signed-in account changes. */
export function setAchievementUser(uid: string | null): void {
  if (uid === activeUid) return;
  activeUid = uid;
  cached = null;
  if (uid) void adoptGuestStats(uid);
}
export function getAchievementUser(): string | null { return activeUid; }

// ─── Listeners: "something an achievement depends on just changed" ────────────

const listeners = new Set<() => void>();
export function subscribeAchievementStats(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function changed(): void {
  listeners.forEach(cb => { try { cb(); } catch { /* a listener never breaks a write */ } });
}

// ─── Storage (one write at a time, so two quick updates never lose one) ───────

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

async function read(uid: string | null): Promise<AchievementStats> {
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    return raw ? clean(JSON.parse(raw)) : { ...EMPTY, earned: [] };
  } catch { return { ...EMPTY, earned: [] }; }
}
async function write(uid: string | null, s: AchievementStats): Promise<void> {
  try { await AsyncStorage.setItem(KEY(uid), JSON.stringify(s)); } catch { /* tried again on the next change */ }
}

/** Change the stored numbers. Returns what was stored before and after. */
function update(
  uid: string | null,
  fn: (s: AchievementStats) => AchievementStats | null,
): Promise<{ before: AchievementStats; after: AchievementStats }> {
  return serial(async () => {
    const before = await read(uid);
    const after = fn(before);
    if (!after) return { before, after: before };
    await write(uid, after);
    if (uid === activeUid) cached = null;
    return { before, after };
  });
}

export function loadAchievementStats(uid: string | null = activeUid): Promise<AchievementStats> {
  return serial(() => read(uid));
}

/**
 * Scans done before signing in belong to the account that signs in. Folded in
 * once, then the guest numbers are cleared.
 */
async function adoptGuestStats(uid: string): Promise<void> {
  try {
    const guest = await serial(() => read(null));
    if (guest.scans === 0 && guest.passes === 0 && guest.earned.length === 0) return;
    await update(uid, s => ({
      ...s,
      scans:        s.scans + guest.scans,
      passes:       s.passes + guest.passes,
      bestDayScans: Math.max(s.bestDayScans, guest.bestDayScans),
      day:          s.day || guest.day,
      dayScans:     s.day && s.day !== guest.day ? s.dayScans : s.dayScans + guest.dayScans,
      earned:       [...new Set([...s.earned, ...guest.earned])],
    }));
    await serial(async () => { try { await AsyncStorage.removeItem(KEY(null)); } catch { /* harmless */ } });
    changed();
  } catch { /* the guest numbers stay where they are */ }
}

// ─── Writers ──────────────────────────────────────────────────────────────────

/**
 * A scan was finished and decided on: saved, or passed on. Returns how many
 * scans this account has now finished (0 when nothing was counted).
 */
export async function recordScanDecided(saved: boolean, now: Date = new Date()): Promise<number> {
  if (isHuntDemoActive()) return 0;               // the guided demo's finds are not real scans
  const uid = activeUid;
  try {
    const today = localDay(now);
    const { after } = await update(uid, s => {
      const dayScans = (s.day === today ? s.dayScans : 0) + 1;
      return {
        ...s,
        scans:        s.scans + 1,
        passes:       s.passes + (saved ? 0 : 1),
        day:          today,
        dayScans,
        bestDayScans: Math.max(s.bestDayScans, dayScans),
      };
    });
    changed();
    return after.scans;
  } catch { return 0; }
}

/** Remember sticky achievements as earned, so they never lock again. */
export async function rememberEarned(uid: string | null, ids: string[]): Promise<void> {
  const sticky = (ids ?? []).filter(isStickyAchievement);
  if (sticky.length === 0) return;
  try {
    await update(uid, s => {
      const have = new Set(s.earned);
      const add = sticky.filter(id => !have.has(id));
      return add.length ? { ...s, earned: [...s.earned, ...add] } : null;
    });
  } catch { /* remembered next time */ }
}

// ─── The server's part: best weekly finish ────────────────────────────────────

type FinishFetcher = () => Promise<any>;
let fetchOverride: FinishFetcher | null = null;
/** Tests only. */
export function __setFinishFetcherForTests(f: FinishFetcher | null): void { fetchOverride = f; }

async function fetchFinishes(): Promise<any> {
  if (fetchOverride) return fetchOverride();
  const { createTRPCClient } = await import('@/lib/trpc');
  return (createTRPCClient() as any).leaderboard.myFinishes.query();
}

let refreshing = false;
/**
 * Ask the server for this account's best weekly finish, at most every six
 * hours. Runs in the background; listeners hear about it when the rank improved.
 */
export async function refreshWeeklyFinishIfDue(uid: string | null = activeUid, now = Date.now()): Promise<void> {
  if (!uid || refreshing) return;
  refreshing = true;
  try {
    const s = await loadAchievementStats(uid);
    if (now - s.finishCheckedAt < FINISH_CHECK_EVERY_MS && now >= s.finishCheckedAt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res: any = await Promise.race([
      fetchFinishes(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), FINISH_TIMEOUT_MS); }),
    ]).catch(() => null);
    if (timer) clearTimeout(timer);
    if (!res || res.ok !== true) return;            // not answered: asked again next time
    const best = int(res.best);
    const { before, after } = await update(uid, st => ({
      ...st,
      finishCheckedAt: now,
      bestWeeklyRank: best >= 1
        ? (st.bestWeeklyRank ? Math.min(st.bestWeeklyRank, best) : best)
        : st.bestWeeklyRank,
    }));
    if (after.bestWeeklyRank !== before.bestWeeklyRank) changed();
  } catch { /* asked again next time */ }
  finally { refreshing = false; }
}

// ─── What the achievement rules read ──────────────────────────────────────────

let cached: AchievementExtras | null = null;
/** The extras from the last load, for code that cannot wait (deletion warnings). */
export function peekAchievementExtras(): AchievementExtras { return cached ?? {}; }

/**
 * Everything lib/achievements needs beyond the saved history, for this account.
 * Also keeps the best weekly streak up to date from the live XP profile.
 */
export async function loadAchievementExtras(
  uid: string | null,
  profile: { weekStreak?: number; discoveredBrands?: string[] } | null | undefined,
): Promise<AchievementExtras> {
  try {
    const live = int(profile?.weekStreak);
    let s = await loadAchievementStats(uid);
    if (live > s.bestWeekStreak) {
      s = (await update(uid, st => (live > st.bestWeekStreak ? { ...st, bestWeekStreak: live } : null))).after;
    }
    const extras: AchievementExtras = {
      scanCount:      s.scans,
      passCount:      s.passes,
      bestDayScans:   s.bestDayScans,
      weekStreak:     live,
      bestWeekStreak: s.bestWeekStreak,
      bestWeeklyRank: s.bestWeeklyRank,
      huntBrands:     profile?.discoveredBrands ?? [],
      earnedIds:      s.earned,
    };
    if (uid === activeUid) cached = extras;
    return extras;
  } catch {
    return { weekStreak: int(profile?.weekStreak), huntBrands: profile?.discoveredBrands ?? [] };
  }
}

/** Tests only. */
export function __resetAchievementStatsForTests(): void {
  activeUid = null; cached = null; refreshing = false; fetchOverride = null;
  listeners.clear(); chain = Promise.resolve();
}