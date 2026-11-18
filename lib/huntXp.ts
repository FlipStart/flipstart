/**
 * lib/huntXp.ts
 *
 * Hunt Mode XP on the phone.
 *
 * ── The server awards XP. This file does not. ───────────────────────────────
 * Finishing a Hunt asks the server to score it (lib/huntCompletion.ts →
 * server/hunt/completeHunt.ts). The server works the XP out from its own record
 * of the Hunt's scans, saves it, and sends back the result. What is kept on the
 * phone is a COPY of the account's profile, for screens to read without a
 * network call. The app cannot write XP to the cloud at all.
 *
 * XP is ONLY earned from completed Hunt Mode sessions.
 *
 * Key functions:
 *   applyHuntXp(bundle)      finish a Hunt: server result, or "pending" when offline
 *   loadXpProfile()          the phone's copy of the profile
 *   syncXpOnLogin(userId)    refresh that copy from the server
 *   getCurrentRank / getNextRank / getRankProgress   the shared ladder
 *
 * The guided demo is the one place XP is worked out on the phone (same rules,
 * shared/hunt/xpRules.ts). It is shown and thrown away, never saved or sent.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HuntBundle, HuntBundleItem } from '@/types/flip';
import { isHuntDemoActive } from '@/lib/huntDemoMode';
import { huntEconomics } from '@/lib/huntEconomics';
import {
  RANK_LADDER, getCurrentRank, getNextRank, getRankProgress, type Rank,
} from '@shared/hunt/ranks';
import {
  calculateHuntXp as scoreHunt, type XpBreakdownItem, type XpItem,
} from '@shared/hunt/xpRules';
import {
  completionPayloadFor, sendCompletion, enqueueCompletion, flushCompletions,
  type ServerCompletion, type ServerProfile,
} from '@/lib/huntCompletion';

export { RANK_LADDER, getCurrentRank, getNextRank, getRankProgress };
export type { Rank, XpBreakdownItem };

// ─── Storage keys — account-scoped to prevent cross-user contamination ────────

const GUEST_XP_KEY  = '@flipstart/huntXpProfile';          // guest / unauthenticated
const accountXpKey  = (uid: string) => `@flipstart/xp:${uid}`; // per-user

// Module-level active user ID — set by AppProviders when auth state changes.
// All loadXpProfile / saveXpProfile calls route through this.
let _activeUserId: string | null = null;

/**
 * Called by AppProviders in _layout.tsx whenever userId changes (including null
 * on sign-out). Must be called BEFORE any loadXpProfile/saveXpProfile calls for
 * the new session so they target the correct storage key.
 */
export function setXpUserId(userId: string | null): void {
  _activeUserId = userId;
  if (__DEV__) console.log('[xp] setXpUserId →', userId ?? 'guest');
}

function activeKey(): string {
  return _activeUserId ? accountXpKey(_activeUserId) : GUEST_XP_KEY;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HuntXpProfile {
  totalXp:              number;
  currentRank:          string;
  completedHunts:       number;
  lastHuntDate?:        string;    // "YYYY-MM-DD" (server date)
  huntStreak:           number;    // consecutive days with a completed hunt (streak achievements)
  /** Consecutive weeks with a qualifying Hunt. This is the streak that pays XP. */
  weekStreak?:          number;
  discoveredBrands:     string[];  // display names of all-time discovered brands (kept items only)
  discoveredCategories: string[];  // display names of all-time discovered categories (kept items only)
  appliedHuntIds:       string[];  // hunts already awarded (kept for older app versions)
  /** Holds the Founding Hunter badge. Set from the server only, and never taken away. */
  foundingHunter?:      boolean;
}

export interface HuntXpResult {
  totalXpEarned:  number;
  breakdown:      XpBreakdownItem[];
  previousTotalXp: number;
  newTotalXp:     number;
  previousRank:   Rank;
  newRank:        Rank;
  didRankUp:      boolean;
  progressBefore: number;
  progressAfter:  number;
  /**
   * The server could not be reached. The Hunt is saved; its XP is awarded when
   * the app next reaches the server. Totals here are unchanged, not "zero earned".
   */
  pending?:       boolean;
  /** Big finds that counted at a capped value because evidence was missing. */
  cappedBigFinds?: number;
  /** This account holds the Founding Hunter badge. */
  foundingHunter?: boolean;
}

// ─── Default profile ──────────────────────────────────────────────────────────

function defaultProfile(): HuntXpProfile {
  return {
    totalXp:              0,
    currentRank:          RANK_LADDER[0].rank,
    completedHunts:       0,
    lastHuntDate:         undefined,
    huntStreak:           0,
    weekStreak:           0,
    discoveredBrands:     [],
    discoveredCategories: [],
    appliedHuntIds:       [],
  };
}

// ─── XP on the phone: the demo, display only ──────────────────────────────────
/**
 * Score a bundle with the shared rules ON THE PHONE. Pure, saves nothing.
 *
 * Used by the guided demo, whose made-up Hunt never reaches the server. It
 * assumes every scan has full evidence, which is right for the demo's canned
 * finds and is exactly why this is never used for a real Hunt: a real Hunt's
 * evidence is whatever the server recorded, and only the server can score it.
 */
export function calculateHuntXp(
  bundle: HuntBundle,
  profile: HuntXpProfile,
): { earned: number; breakdown: XpBreakdownItem[] } {
  const toItem = (i: HuntBundleItem, kept: boolean): XpItem => ({
    id:          i.scanId || i.huntItemId,
    kept,
    thriftPrice: i.thriftPrice,
    status:      'normal',
    evidence:    { camera: true, secondPhoto: true, uniqueImage: true, notScreen: true, confidentId: true },
    resale:      Number((i.scanSnapshot as any)?.market_data?.adjusted_estimated_value ?? 0),
    brand:       i.brand,
    category:    i.category,
    itemKey:     null,
    economics:   price => {
      const e = huntEconomics(i.scanSnapshot, price);
      return { profit: e.profit, roi: e.roi, rating: e.huntRating };
    },
  });
  const r = scoreHunt({
    items: [...bundle.keptItems.map(i => toItem(i, true)), ...bundle.removedItems.map(i => toItem(i, false))],
    durationMs: bundle.durationMs,
    weekStart: 'this-week',
    prevWeekStart: 'last-week',
    profile: {
      discoveredBrands:     profile.discoveredBrands,
      discoveredCategories: profile.discoveredCategories,
      weekStreak:           profile.weekStreak ?? 0,
      lastStreakWeek:       null,
    },
  });
  return { earned: r.earned, breakdown: r.breakdown };
}

// ─── The phone's copy of the profile ──────────────────────────────────────────

/**
 * Load XP profile from AsyncStorage.
 *
 * Pass `forUserId` from a React screen to bypass _activeUserId and read the
 * correct account-scoped key directly -- avoids the race where _activeUserId
 * hasn't been set yet when useFocusEffect fires on focus or token refresh.
 *
 * Callers that already own the active context (applyHuntXp, hunt-complete)
 * can omit forUserId and fall back to activeKey() as before.
 */
export async function loadXpProfile(forUserId?: string | null): Promise<HuntXpProfile> {
  try {
    const key = forUserId !== undefined
      ? (forUserId ? accountXpKey(forUserId) : GUEST_XP_KEY)
      : activeKey();
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<HuntXpProfile>;
    return { ...defaultProfile(), ...parsed };
  } catch {
    return defaultProfile();
  }
}

/**
 * Save the phone's copy. LOCAL ONLY: the app never writes XP to the cloud (the
 * server is the only writer, and the database refuses anything else).
 */
export async function saveXpProfile(profile: HuntXpProfile, userId?: string | null): Promise<void> {
  if (isHuntDemoActive()) return;                // demo XP is never stored
  try {
    const key = userId ? accountXpKey(userId) : activeKey();
    await AsyncStorage.setItem(key, JSON.stringify(profile));
  } catch { /* never block app flow */ }
}

/** The server's profile, in the shape the phone keeps. Applied hunt ids are carried over. */
function profileFromServer(p: ServerProfile, previous: HuntXpProfile, huntId?: string): HuntXpProfile {
  const applied = new Set(previous.appliedHuntIds ?? []);
  if (huntId) applied.add(huntId);
  return {
    totalXp:              p.totalXp,
    currentRank:          getCurrentRank(p.totalXp).rank,
    completedHunts:       p.completedHunts,
    lastHuntDate:         p.lastHuntDate ?? undefined,
    huntStreak:           p.huntStreak,
    weekStreak:           p.weekStreak,
    discoveredBrands:     p.discoveredBrands ?? [],
    discoveredCategories: p.discoveredCategories ?? [],
    appliedHuntIds:       Array.from(applied).slice(-200),
    foundingHunter:       previous.foundingHunter === true,
  };
}

/**
 * syncXpOnLogin — called once after auth resolves for a logged-in user.
 *
 *   1. Immediately sets _activeUserId so all subsequent XP calls use this user's key.
 *   2. Replaces this account's copy on the phone with the server's profile. The
 *      server is the source of truth: nothing is merged and nothing is pushed.
 *   3. If the server can't be reached, the copy already on the phone is kept.
 */
export async function syncXpOnLogin(userId: string): Promise<void> {
  try {
    _activeUserId = userId;
    if (__DEV__) console.log('[xp] syncXpOnLogin for', userId);

    const { fetchXpProfile } = await import('@/lib/xpSync');
    const cloud = await fetchXpProfile(userId);
    if (!cloud) return;                              // unreachable, or a brand-new account

    const key = accountXpKey(userId);
    let local: HuntXpProfile = defaultProfile();
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) local = { ...defaultProfile(), ...(JSON.parse(raw) as Partial<HuntXpProfile>) };
    } catch { /* treat as no local copy */ }

    const next: HuntXpProfile = {
      ...defaultProfile(),
      ...cloud,
      currentRank:    getCurrentRank(cloud.totalXp ?? 0).rank,
      appliedHuntIds: Array.from(new Set([...(local.appliedHuntIds ?? []), ...(cloud.appliedHuntIds ?? [])])).slice(-200),
      // The badge is not part of the cloud row the app can read. Keep what the server last said.
      foundingHunter: local.foundingHunter === true,
    };
    try { await AsyncStorage.setItem(key, JSON.stringify(next)); } catch { /* ok */ }
  } catch (err) {
    if (__DEV__) console.warn('[huntXp] syncXpOnLogin threw:', err);
  }
}

// ─── Finishing a Hunt ─────────────────────────────────────────────────────────

function resultFrom(previousTotalXp: number, newTotalXp: number, earned: number, breakdown: XpBreakdownItem[]): HuntXpResult {
  const previousRank = getCurrentRank(previousTotalXp);
  const newRank      = getCurrentRank(newTotalXp);
  return {
    totalXpEarned:  earned,
    breakdown,
    previousTotalXp,
    newTotalXp,
    previousRank,
    newRank,
    didRankUp:      newRank.rank !== previousRank.rank,
    progressBefore: getRankProgress(previousTotalXp),
    progressAfter:  getRankProgress(newTotalXp),
  };
}

/** The app's result for a server answer. Exported for the queue (lib/useFlipStore). */
export function resultFromServer(r: ServerCompletion): HuntXpResult {
  return {
    ...resultFrom(r.previousTotalXp, r.newTotalXp, r.xpEarned, r.breakdown ?? []),
    cappedBigFinds: r.cappedBigFinds || 0,
    foundingHunter: r.foundingHunter === true,
  };
}

/** Bring the phone's copy up to date after the server answered for a Hunt. */
export async function applyServerCompletion(huntId: string, r: ServerCompletion, userId?: string | null): Promise<void> {
  if (!r.profile) return;
  const uid = userId ?? _activeUserId;
  const previous = await loadXpProfile(uid ?? undefined);
  const next = profileFromServer(r.profile, previous, huntId);
  if (r.foundingHunter === true) next.foundingHunter = true;
  await saveXpProfile(next, uid);
}

// ─── The server's profile, on demand ──────────────────────────────────────────

type ProfileTransport = () => Promise<any>;
let profileTransportOverride: ProfileTransport | null = null;
/** Tests only. */
export function __setProfileTransportForTests(t: ProfileTransport | null): void { profileTransportOverride = t; }

async function defaultProfileTransport(): Promise<any> {
  const { createTRPCClient } = await import('@/lib/trpc');
  return createTRPCClient().hunt.profile.query();
}

export const PROFILE_REFRESH_TIMEOUT_MS = 8_000;

/**
 * Ask the server for this account's XP profile and bring the phone's copy up to
 * date. Used by the leaderboard's My Hunt Level, which shows lifetime XP as the
 * server holds it. Returns the fresh copy, or null when the server could not be
 * reached (the copy on the phone is left alone). Never throws.
 */
export async function refreshXpFromServer(userId: string | null | undefined, timeoutMs = PROFILE_REFRESH_TIMEOUT_MS): Promise<HuntXpProfile | null> {
  if (!userId || isHuntDemoActive()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res: any = await Promise.race([
      (profileTransportOverride ?? defaultProfileTransport)(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    const p = res?.ok === true ? res.profile : null;
    if (!p || typeof p.totalXp !== 'number' || !Number.isFinite(p.totalXp)) return null;
    const previous = await loadXpProfile(userId);
    const next = profileFromServer(p as ServerProfile, previous);
    // The badge is never taken away, so an answer without it changes nothing.
    if (res.foundingHunter === true) next.foundingHunter = true;
    await saveXpProfile(next, userId);
    return next;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Send any Hunts whose XP is still waiting on the server. `onSettled` gets each
 * Hunt's result so the saved bundle can show it. Safe to call often.
 */
export async function flushPendingHuntXp(
  userId: string | null | undefined,
  onSettled?: (huntId: string, result: HuntXpResult) => void,
): Promise<number> {
  if (!userId || isHuntDemoActive()) return 0;
  return flushCompletions(userId, async (huntId, r) => {
    await applyServerCompletion(huntId, r, userId);
    onSettled?.(huntId, resultFromServer(r));
  });
}

/**
 * The main entry point called when a hunt is saved.
 *
 *   Real Hunt   the server scores and awards it. This returns its answer. If the
 *               server can't be reached within a few seconds the request is
 *               queued and this returns { pending: true } with totals unchanged.
 *   Demo        scored on the phone against a brand-new profile, shown, discarded.
 *
 * Never throws and never blocks saving the Hunt to history.
 */
export async function applyHuntXp(bundle: HuntBundle): Promise<HuntXpResult> {
  if (isHuntDemoActive()) {
    // Same numbers for every viewer; nothing is read from or written to the real profile.
    const { earned, breakdown } = calculateHuntXp(bundle, defaultProfile());
    return resultFrom(0, earned, earned, breakdown);
  }

  const uid = _activeUserId;
  const profile = await loadXpProfile();
  const unchanged = (pending: boolean): HuntXpResult =>
    ({ ...resultFrom(profile.totalXp, profile.totalXp, 0, []), ...(pending ? { pending: true } : {}) });

  // Scans need an account, so a Hunt without one has nothing the server could score.
  if (!uid) return unchanged(false);

  const payload = completionPayloadFor(bundle);
  const sent = await sendCompletion(payload, undefined, uid);
  if (sent.kind === 'done') {
    await applyServerCompletion(bundle.id, sent.result, uid);
    return resultFromServer(sent.result);
  }
  if (sent.kind === 'retry') {
    await enqueueCompletion(uid, payload);
    return unchanged(true);
  }
  return unchanged(false);
}

// ─── Completion result passthrough ───────────────────────────────────────────
// Short-lived module-level store for passing XP result from hunt-active
// to hunt-complete without route params (result is consumed once on mount).
// This is safe because hunt-complete is always navigated to immediately
// after applyHuntXp returns — not stored across sessions.

let _lastCompletionResult: HuntXpResult | null = null;

export function setLastCompletionResult(result: HuntXpResult): void {
  _lastCompletionResult = result;
}

export function consumeLastCompletionResult(): HuntXpResult | null {
  const r = _lastCompletionResult;
  _lastCompletionResult = null;
  return r;
}