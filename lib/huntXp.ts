/**
 * lib/huntXp.ts
 *
 * Hunt Mode XP Engine — Pass 3A
 *
 * XP is ONLY awarded from completed Hunt Mode sessions.
 * Normal scans, app opens, and non-hunt activity earn ZERO XP.
 *
 * Key functions:
 *   calculateHuntXp(bundle, profile) — pure, no side effects
 *   applyHuntXp(bundle)              — async, loads profile → calculates → saves → returns result
 *   getCurrentRank(totalXp)
 *   getNextRank(totalXp)
 *   getRankProgress(totalXp)         — 0–100 % to next rank
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HuntBundle, HuntBundleItem } from '@/types/flip';

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

// ─── Rank ladder ──────────────────────────────────────────────────────────────

export interface Rank {
  xp:   number;
  rank: string;
}

export const RANK_LADDER: Rank[] = [
  { xp:        0, rank: 'Dung Beetle Scout'   },
  { xp:      100, rank: 'Scorpion Squasher'    },
  { xp:      300, rank: 'Meerkat Menace'       },
  { xp:      700, rank: 'Hyena Hustler'        },
  { xp:     1500, rank: 'Warthog Wanderer'     },
  { xp:     3000, rank: 'Jackal Jumper'        },
  { xp:     5000, rank: 'Zebra Zipper'         },
  { xp:     8000, rank: 'Gazelle Gatherer'     },
  { xp:    12000, rank: 'Antelope Alchemist'   },
  { xp:    18000, rank: 'Cheetah Flipper'      },
  { xp:    26000, rank: 'Leopard Learner'      },
  { xp:    38000, rank: 'Rhino Reseller'       },
  { xp:    55000, rank: 'Elephant Eloper'      },
  { xp:    80000, rank: 'Crocodile Closer'     },
  { xp:   110000, rank: 'Panther Profiteer'    },
  { xp:   150000, rank: 'Gorilla Gatherer'     },
  { xp:   200000, rank: 'Hippo Hunter'         },
  { xp:   270000, rank: 'Buffalo Baron'        },
  { xp:   360000, rank: 'Savannah Lord'        },
  { xp:   475000, rank: 'Apex Finder'          },
  { xp:   650000, rank: 'Lion Tracker'         },
  { xp:   900000, rank: 'Kingmaker'            },
  { xp:  1250000, rank: 'Lion King'            },
];

// ─── Rank helpers ─────────────────────────────────────────────────────────────

export function getCurrentRank(totalXp: number): Rank {
  let current = RANK_LADDER[0];
  for (const tier of RANK_LADDER) {
    if (totalXp >= tier.xp) current = tier;
    else break;
  }
  return current;
}

export function getNextRank(totalXp: number): Rank | null {
  for (let i = 0; i < RANK_LADDER.length - 1; i++) {
    if (totalXp < RANK_LADDER[i + 1].xp) return RANK_LADDER[i + 1];
  }
  return null; // already Lion King
}

/** Returns 0–100 progress percentage toward the next rank. */
export function getRankProgress(totalXp: number): number {
  const current = getCurrentRank(totalXp);
  const next    = getNextRank(totalXp);
  if (!next) return 100;
  const range = next.xp - current.xp;
  const earned = totalXp - current.xp;
  return Math.min(100, Math.round((earned / range) * 100));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface XpBreakdownItem {
  id:       string;
  label:    string;
  detail?:  string;
  xp:       number;
  category: 'base' | 'volume' | 'rarity' | 'profit' | 'time' | 'quality' | 'discovery' | 'streak';
}

export interface HuntXpProfile {
  totalXp:              number;
  currentRank:          string;
  completedHunts:       number;
  lastHuntDate?:        string;    // "YYYY-MM-DD" — used for streak calculation
  huntStreak:           number;    // consecutive days with at least one completed hunt
  discoveredBrands:     string[];  // display names of all-time discovered brands (kept items only)
  discoveredCategories: string[];  // display names of all-time discovered categories (kept items only)
  appliedHuntIds:       string[];  // prevents awarding XP twice for same hunt
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
}

// ─── Default profile ──────────────────────────────────────────────────────────

function defaultProfile(): HuntXpProfile {
  return {
    totalXp:              0,
    currentRank:          RANK_LADDER[0].rank,
    completedHunts:       0,
    lastHuntDate:         undefined,
    huntStreak:           0,
    discoveredBrands:     [],
    discoveredCategories: [],
    appliedHuntIds:       [],
  };
}

// ─── Discovery normalization ──────────────────────────────────────────────────

const IGNORED_VALUES = new Set(['unknown', 'n/a', 'other', 'none', 'misc', '']);

function normalizeDiscoveryKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function isDiscoverable(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const key = normalizeDiscoveryKey(raw);
  return key.length > 0 && !IGNORED_VALUES.has(key);
}

// ─── Hunt grade ───────────────────────────────────────────────────────────────

type HuntGrade = 'S' | 'A' | 'B' | 'C' | null;

function calculateHuntGrade(
  keptItems: HuntBundleItem[],
  totalProfit: number,
  estimatedROI: number,
): HuntGrade {
  const keptCount    = keptItems.length;
  const hasLegendary = keptItems.some(i => i.huntRating === 'legendary');

  // S — exceptional: 5+ kept, $100+ profit, 100%+ ROI, at least 1 legendary
  if (keptCount >= 5 && totalProfit >= 100 && estimatedROI >= 100 && hasLegendary) return 'S';

  // A — strong: 3+ kept, $50+ profit, 50%+ ROI
  if (keptCount >= 3 && totalProfit >= 50 && estimatedROI >= 50) return 'A';

  // B — decent: 2+ kept, $20+ profit
  if (keptCount >= 2 && totalProfit >= 20) return 'B';

  // C — minimal: at least 1 kept with positive profit
  if (keptCount >= 1 && totalProfit > 0) return 'C';

  return null;
}

// ─── Streak date helpers ──────────────────────────────────────────────────────

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateKey(d);
}

// ─── Pure XP calculation ──────────────────────────────────────────────────────
/**
 * calculateHuntXp — PURE function, no AsyncStorage, no side effects.
 * Pass the current profile snapshot; returns XP earned + breakdown.
 * The caller (applyHuntXp) handles persistence.
 */
export function calculateHuntXp(
  bundle: HuntBundle,
  profile: HuntXpProfile,
): { earned: number; breakdown: XpBreakdownItem[] } {
  const breakdown: XpBreakdownItem[] = [];
  let earned = 0;

  const keptItems  = bundle.keptItems;
  const totalScans = bundle.keptItemCount + bundle.removedItemCount;
  const profit     = bundle.totalEstimatedProfit;
  const roi        = bundle.estimatedROI;
  const durationMs = bundle.durationMs;

  // Helper to push a line and add to total
  const add = (item: Omit<XpBreakdownItem, 'id'>) => {
    if (item.xp === 0) return;
    breakdown.push({ ...item, id: `${item.category}_${breakdown.length}` });
    earned += item.xp;
  };

  // ── Base ────────────────────────────────────────────────────────────────────
  add({ label: 'Hunt completed',     xp: 3,                  category: 'base' });
  if (keptItems.length > 0) {
    add({
      label:  'Items kept',
      detail: `${keptItems.length} × +1 XP`,
      xp:     keptItems.length,
      category: 'base',
    });
  }

  // ── Scan volume (highest tier only) ─────────────────────────────────────────
  const volumeTiers = [
    { threshold: 50, xp: 25, label: '50+ scans in hunt' },
    { threshold: 25, xp: 10, label: '25+ scans in hunt' },
    { threshold: 10, xp:  5, label: '10+ scans in hunt' },
    { threshold:  5, xp:  2, label:  '5+ scans in hunt' },
  ];
  for (const tier of volumeTiers) {
    if (totalScans >= tier.threshold) {
      add({ label: tier.label, detail: `${totalScans} total scans`, xp: tier.xp, category: 'volume' });
      break;
    }
  }

  // ── Rarity (per kept item) ───────────────────────────────────────────────────
  const rarityXp: Record<string, number> = { legendary: 20, treasure: 8, risky: 1, trash: 0 };
  const rarityLabel: Record<string, string> = {
    legendary: 'Legendary Loot item',
    treasure:  'Treasure item',
    risky:     'Risky item',
  };
  const rarityCounts: Record<string, number> = {};
  for (const item of keptItems) {
    if (item.huntRating !== 'trash' && rarityXp[item.huntRating] > 0) {
      rarityCounts[item.huntRating] = (rarityCounts[item.huntRating] ?? 0) + 1;
    }
  }
  for (const [rating, count] of Object.entries(rarityCounts)) {
    const xp = rarityXp[rating] * count;
    add({
      label:    `${count} × ${rarityLabel[rating] ?? rating}`,
      detail:   `${count} × +${rarityXp[rating]} XP`,
      xp,
      category: 'rarity',
    });
  }

  // ── Profit milestone (highest tier only) ────────────────────────────────────
  const profitTiers = [
    { threshold: 10000, xp: 10000, label: '$10,000+ hunt profit' },
    { threshold:  5000, xp:  4000, label:  '$5,000+ hunt profit' },
    { threshold:  2500, xp:  1500, label:  '$2,500+ hunt profit' },
    { threshold:  1000, xp:   500, label:  '$1,000+ hunt profit' },
    { threshold:   500, xp:   200, label:    '$500+ hunt profit' },
    { threshold:   250, xp:    75, label:    '$250+ hunt profit' },
    { threshold:   100, xp:    25, label:    '$100+ hunt profit' },
    { threshold:    50, xp:    10, label:     '$50+ hunt profit' },
    { threshold:    25, xp:     5, label:     '$25+ hunt profit' },
  ];
  for (const tier of profitTiers) {
    if (profit >= tier.threshold) {
      add({ label: tier.label, detail: `$${Math.round(profit)} estimated`, xp: tier.xp, category: 'profit' });
      break;
    }
  }

  // ── Time bonus (highest tier only) ──────────────────────────────────────────
  const durationMin = durationMs / 60000;
  const timeTiers = [
    { minutes: 90, xp: 20, label: '90+ minute hunt' },
    { minutes: 45, xp:  8, label: '45+ minute hunt' },
    { minutes: 20, xp:  3, label: '20+ minute hunt' },
  ];
  for (const tier of timeTiers) {
    if (durationMin >= tier.minutes) {
      add({
        label:    tier.label,
        detail:   `${Math.round(durationMin)} minutes`,
        xp:       tier.xp,
        category: 'time',
      });
      break;
    }
  }

  // ── Hunt quality grade ───────────────────────────────────────────────────────
  const grade = calculateHuntGrade(keptItems, profit, roi);
  const gradeXp: Record<string, number> = { S: 100, A: 50, B: 25, C: 10 };
  if (grade && gradeXp[grade]) {
    add({
      label:    `Grade ${grade} hunt`,
      detail:   `${keptItems.length} kept · $${Math.round(profit)} profit · ${roi}% ROI`,
      xp:       gradeXp[grade],
      category: 'quality',
    });
  }

  // ── Discovery XP (kept items only, normalized, no blanks/unknowns) ──────────
  const knownCatKeys = new Set(profile.discoveredCategories.map(normalizeDiscoveryKey));
  const knownBrandKeys = new Set(profile.discoveredBrands.map(normalizeDiscoveryKey));

  const newCatKeys   = new Set<string>();
  const newBrandKeys = new Set<string>();
  const newCatNames: string[]   = [];
  const newBrandNames: string[] = [];

  for (const item of keptItems) {
    // Category
    if (isDiscoverable(item.category)) {
      const key = normalizeDiscoveryKey(item.category);
      if (!knownCatKeys.has(key) && !newCatKeys.has(key)) {
        newCatKeys.add(key);
        newCatNames.push(item.category.trim());
      }
    }
    // Brand
    if (isDiscoverable(item.brand)) {
      const key = normalizeDiscoveryKey(item.brand);
      if (!knownBrandKeys.has(key) && !newBrandKeys.has(key)) {
        newBrandKeys.add(key);
        newBrandNames.push(item.brand.trim());
      }
    }
  }

  if (newCatNames.length > 0) {
    add({
      label:    `${newCatNames.length} new categor${newCatNames.length === 1 ? 'y' : 'ies'} discovered`,
      detail:   newCatNames.join(', '),
      xp:       newCatNames.length * 5,
      category: 'discovery',
    });
  }
  if (newBrandNames.length > 0) {
    add({
      label:    `${newBrandNames.length} new brand${newBrandNames.length === 1 ? '' : 's'} discovered`,
      detail:   newBrandNames.join(', '),
      xp:       newBrandNames.length * 3,
      category: 'discovery',
    });
  }

  // ── Streak XP (highest applicable tier only) ─────────────────────────────────
  // Streak is calculated by applyHuntXp before calling calculateHuntXp,
  // so profile.huntStreak reflects the NEW streak value for this hunt.
  const streak = profile.huntStreak;
  const streakTiers = [
    { days: 100, xp: 1000, label: '100-day hunt streak' },
    { days:  30, xp:  200, label:  '30-day hunt streak' },
    { days:   7, xp:   30, label:   '7-day hunt streak' },
    { days:   2, xp:    5, label:   '2-day hunt streak' },
    { days:   1, xp:    3, label:  'First hunt of the day' },
  ];
  for (const tier of streakTiers) {
    if (streak >= tier.days) {
      add({
        label:    tier.label,
        detail:   `${streak} day${streak === 1 ? '' : 's'} in a row`,
        xp:       tier.xp,
        category: 'streak',
      });
      break;
    }
  }

  return { earned, breakdown };
}

// ─── AsyncStorage helpers ─────────────────────────────────────────────────────

export async function loadXpProfile(): Promise<HuntXpProfile> {
  try {
    const raw = await AsyncStorage.getItem(activeKey());
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<HuntXpProfile>;
    return { ...defaultProfile(), ...parsed };
  } catch {
    return defaultProfile();
  }
}

export async function saveXpProfile(profile: HuntXpProfile, userId?: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(activeKey(), JSON.stringify(profile));
  } catch { /* never block app flow */ }
  // Cloud sync — use explicit userId param if provided, otherwise _activeUserId
  const syncUserId = userId ?? _activeUserId;
  if (syncUserId) {
    import('@/lib/xpSync').then(({ saveXpProfile: cloudSave }) => {
      cloudSave(profile, syncUserId).catch(() => {});
    }).catch(() => {});
  }
}

/**
 * syncXpOnLogin — called once after auth resolves for a logged-in user.
 *
 * Critical safety rules:
 *   1. Immediately sets _activeUserId so all subsequent XP calls use this user's key.
 *   2. ONLY reads from this user's account-scoped key — never the guest key.
 *      This prevents previous-user or guest XP from polluting this account.
 *   3. Merges local account data (if any) with cloud — both guaranteed same user.
 *   4. If no local account data, uses cloud value directly (no merge risk).
 */
export async function syncXpOnLogin(userId: string): Promise<void> {
  try {
    // Step 1: lock in the active user ID immediately
    _activeUserId = userId;
    if (__DEV__) console.log('[xp] syncXpOnLogin for', userId);

    const { fetchXpProfile, saveXpProfile: cloudSave, mergeXpProfiles } = await import('@/lib/xpSync');

    // Step 2: read only from THIS user's account-scoped key
    const key        = accountXpKey(userId);
    let localProfile: HuntXpProfile | null = null;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) localProfile = { ...defaultProfile(), ...(JSON.parse(raw) as Partial<HuntXpProfile>) };
    } catch { /* ok — treat as no local data */ }

    // Step 3: fetch cloud
    const cloud = await fetchXpProfile(userId);

    if (!cloud) {
      // No cloud record yet
      if (localProfile) {
        // Push this user's existing local data to cloud
        cloudSave(localProfile, userId).catch(() => {});
      }
      // No local + no cloud = fresh account, nothing to do
      return;
    }

    if (localProfile) {
      // Both exist — safe to merge (both are guaranteed this user's data)
      const merged = mergeXpProfiles(localProfile, cloud);
      await saveXpProfile(merged, userId);
    } else {
      // No local account data — write cloud value to local account key
      try { await AsyncStorage.setItem(key, JSON.stringify(cloud)); } catch { /* ok */ }
    }
  } catch (err) {
    if (__DEV__) console.warn('[huntXp] syncXpOnLogin threw:', err);
  }
}

// ─── applyHuntXp — loads profile, calculates, saves, returns result ───────────
/**
 * The main entry point called when a hunt is saved.
 *
 * Flow:
 *   1. Load XP profile from AsyncStorage
 *   2. Check appliedHuntIds — if already applied, return early with zero XP
 *   3. Calculate new streak before XP calc (so streak bonus uses updated value)
 *   4. calculateHuntXp (pure) — returns earned + breakdown
 *   5. Update profile (totalXp, rank, streak, discoveries, appliedHuntIds)
 *   6. Save profile to AsyncStorage
 *   7. Return full HuntXpResult for caller to attach to bundle + show UI
 */
export async function applyHuntXp(bundle: HuntBundle): Promise<HuntXpResult> {
  const profile = await loadXpProfile();

  const previousTotalXp  = profile.totalXp;
  const previousRank     = getCurrentRank(previousTotalXp);
  const progressBefore   = getRankProgress(previousTotalXp);

  // ── Duplicate prevention ────────────────────────────────────────────────────
  if (profile.appliedHuntIds.includes(bundle.id)) {
    // XP was already awarded for this hunt — return zero-XP result
    const newRank = getCurrentRank(previousTotalXp);
    return {
      totalXpEarned:  0,
      breakdown:      [],
      previousTotalXp,
      newTotalXp:     previousTotalXp,
      previousRank:   newRank,
      newRank,
      didRankUp:      false,
      progressBefore,
      progressAfter:  progressBefore,
    };
  }

  // ── Update streak before XP calculation (streak bonus uses new value) ───────
  const todayKey = toDateKey(new Date());
  let newStreak = profile.huntStreak;

  if (profile.lastHuntDate === todayKey) {
    // Same day — streak unchanged (already counted today's hunt)
    // But still check: if streak is 0, bump to 1 (first hunt ever)
    newStreak = Math.max(1, newStreak);
  } else if (profile.lastHuntDate === yesterdayKey()) {
    // Consecutive day — increment streak
    newStreak = newStreak + 1;
  } else {
    // Streak broken or first hunt ever
    newStreak = 1;
  }

  // Apply new streak to profile snapshot for calculation
  const profileForCalc: HuntXpProfile = { ...profile, huntStreak: newStreak };

  // ── Calculate XP (pure) ──────────────────────────────────────────────────────
  const { earned, breakdown } = calculateHuntXp(bundle, profileForCalc);

  // ── Collect newly discovered brands/categories ───────────────────────────────
  const keptItems      = bundle.keptItems;
  const knownCatKeys   = new Set(profile.discoveredCategories.map(normalizeDiscoveryKey));
  const knownBrandKeys = new Set(profile.discoveredBrands.map(normalizeDiscoveryKey));
  const addedCats: string[]   = [];
  const addedBrands: string[] = [];

  for (const item of keptItems) {
    if (isDiscoverable(item.category)) {
      const key = normalizeDiscoveryKey(item.category);
      if (!knownCatKeys.has(key)) { knownCatKeys.add(key); addedCats.push(item.category.trim()); }
    }
    if (isDiscoverable(item.brand)) {
      const key = normalizeDiscoveryKey(item.brand);
      if (!knownBrandKeys.has(key)) { knownBrandKeys.add(key); addedBrands.push(item.brand.trim()); }
    }
  }

  // ── Build updated profile ────────────────────────────────────────────────────
  const newTotalXp = previousTotalXp + earned;
  const newRank    = getCurrentRank(newTotalXp);

  const updatedProfile: HuntXpProfile = {
    totalXp:              newTotalXp,
    currentRank:          newRank.rank,
    completedHunts:       profile.completedHunts + 1,
    lastHuntDate:         todayKey,
    huntStreak:           newStreak,
    discoveredCategories: [...profile.discoveredCategories, ...addedCats],
    discoveredBrands:     [...profile.discoveredBrands, ...addedBrands],
    appliedHuntIds:       [...profile.appliedHuntIds, bundle.id],
  };

  await saveXpProfile(updatedProfile);

  const progressAfter = getRankProgress(newTotalXp);

  return {
    totalXpEarned:   earned,
    breakdown,
    previousTotalXp,
    newTotalXp,
    previousRank,
    newRank,
    didRankUp:       newRank.rank !== previousRank.rank,
    progressBefore,
    progressAfter,
  };
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