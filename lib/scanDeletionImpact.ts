/**
 * lib/scanDeletionImpact.ts
 *
 * Pure helpers that simulate what progress would be lost if a scan (or all
 * scans) were deleted. They NEVER mutate state — they recompute the unlocked
 * sets with and without the target scan(s) and diff them.
 *
 * Achievements, brands, and diamonds are all derived from the saved flip
 * history, so deleting a contributing scan can re-lock them. These helpers let
 * the UI warn the user before that happens.
 */

import type { HistoryEntry } from '@/types/flip';
import { isHuntBundle } from '@/types/flip';
import {
  buildUserAchievementData, getAllUnlockedIds, ACHIEVEMENT_CATEGORIES,
} from '@/lib/achievements';
import { computeDiscoveredBrands } from '@/lib/brandCompendium';
import { getUnlockedDiamondIds, getDiamondById } from '@/lib/diamonds';

// Flat id→name lookup for achievements (no getAchievementById in the lib).
const ACHV_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const cat of ACHIEVEMENT_CATEGORIES) {
    for (const a of cat.achievements) m[a.id] = a.name;
  }
  return m;
})();

export interface DeletionImpact {
  scanId?:              string;
  affectedAchievements: Array<{ id: string; title: string }>;
  affectedBrands:       Array<{ id: string; name: string }>;
  affectedDiamonds:     Array<{ id: string; title: string }>;
  affectedStats: {
    scansRemoved:  number;
    profitRemoved: number;
  };
  hasProgressImpact: boolean;
}

export interface ClearHistoryImpact {
  scansToDelete:        number;
  achievementsToRemove: number;
  brandsToRemove:       number;
  diamondsToRemove:     number;
  hasProgressImpact:    boolean;
}

/** Context derived from the xp profile — values NOT recomputed from flips. */
export interface ImpactContext {
  completedHunts: number;
  huntStreak:     number;
  huntBrands:     string[]; // xp.discoveredBrands (hunt-mode discoveries)
}

const EMPTY_CTX: ImpactContext = { completedHunts: 0, huntStreak: 0, huntBrands: [] };

function unlockedAchievements(flips: HistoryEntry[], ctx: ImpactContext): Set<string> {
  const brandCount = computeDiscoveredBrands(flips, ctx.huntBrands).size;
  const data = buildUserAchievementData(flips, ctx.completedHunts, ctx.huntStreak, brandCount);
  return new Set(getAllUnlockedIds(data));
}

/**
 * Impact of deleting ONE scan. Returns the achievements/brands/diamonds that are
 * unlocked now but would NOT be unlocked once this scan is removed.
 */
export function getScanDeletionImpact(
  flips:  HistoryEntry[],
  scanId: string,
  ctx:    ImpactContext = EMPTY_CTX,
): DeletionImpact {
  const target = flips.find(f => f.id === scanId);
  const after  = flips.filter(f => f.id !== scanId);

  // ── Achievements ──
  const achvBefore = unlockedAchievements(flips, ctx);
  const achvAfter  = unlockedAchievements(after, ctx);
  const affectedAchievements = [...achvBefore]
    .filter(id => !achvAfter.has(id))
    .map(id => ({ id, title: ACHV_NAME[id] ?? id }));

  // ── Brands ──
  const brandsBefore = computeDiscoveredBrands(flips, ctx.huntBrands);
  const brandsAfter  = computeDiscoveredBrands(after, ctx.huntBrands);
  const affectedBrands = [...brandsBefore]
    .filter(n => !brandsAfter.has(n))
    .map(n => ({ id: n, name: n }));

  // ── Diamonds ──
  const diamondsBefore = new Set(getUnlockedDiamondIds(flips));
  const diamondsAfter  = new Set(getUnlockedDiamondIds(after));
  const affectedDiamonds = [...diamondsBefore]
    .filter(id => !diamondsAfter.has(id))
    .map(id => ({ id, title: getDiamondById(id)?.title ?? id }));

  // ── Stats ──
  const profitRemoved = target && !isHuntBundle(target)
    ? ((target as any).profit ?? 0)
    : 0;
  const scansRemoved = target && !isHuntBundle(target) ? 1 : 0;

  const hasProgressImpact =
    affectedAchievements.length > 0 ||
    affectedBrands.length > 0 ||
    affectedDiamonds.length > 0;

  return {
    scanId,
    affectedAchievements,
    affectedBrands,
    affectedDiamonds,
    affectedStats: { scansRemoved, profitRemoved },
    hasProgressImpact,
  };
}

/**
 * The currently-valid unlocked sets for a given flips array. Used after a
 * deletion to prune stale unseen badges down to what still exists.
 */
export function computeValidSets(
  flips: HistoryEntry[],
  ctx:   ImpactContext = EMPTY_CTX,
): { achievements: string[]; brands: string[]; diamonds: string[] } {
  return {
    achievements: [...unlockedAchievements(flips, ctx)],
    brands:       [...computeDiscoveredBrands(flips, ctx.huntBrands)],
    diamonds:     getUnlockedDiamondIds(flips),
  };
}

export function getClearHistoryImpact(
  flips: HistoryEntry[],
  ctx:   ImpactContext = EMPTY_CTX,
): ClearHistoryImpact {
  const scansToDelete = flips.length;

  // After clearing, flips = []. Brands keep any hunt-mode discoveries from xp.
  const achvBefore = unlockedAchievements(flips, ctx);
  const achvAfter  = unlockedAchievements([], ctx);
  const achievementsToRemove = [...achvBefore].filter(id => !achvAfter.has(id)).length;

  const brandsBefore = computeDiscoveredBrands(flips, ctx.huntBrands);
  const brandsAfter  = computeDiscoveredBrands([], ctx.huntBrands);
  const brandsToRemove = [...brandsBefore].filter(n => !brandsAfter.has(n)).length;

  const diamondsToRemove = getUnlockedDiamondIds(flips).length; // all diamonds come from flips

  const hasProgressImpact =
    achievementsToRemove > 0 || brandsToRemove > 0 || diamondsToRemove > 0;

  return {
    scansToDelete,
    achievementsToRemove,
    brandsToRemove,
    diamondsToRemove,
    hasProgressImpact,
  };
}