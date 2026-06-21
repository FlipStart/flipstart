/**
 * lib/achievements.ts
 *
 * FlipStart Achievement System — 39 achievements across 7 categories.
 *
 * Architecture:
 *   - Pure data layer (no React, no hooks)
 *   - Unlock checking via pure functions that accept UserAchievementData
 *   - Called from the achievements screens with live data from:
 *       flips[]         → scan count, profit sum, ROI, era, buyLabel
 *       HuntXpProfile   → completedHunts, huntStreak, discoveredBrands
 */

import type { FlipResult, HistoryEntry } from '@/types/flip';
import { isHuntBundle } from '@/types/flip';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Achievement {
  id:          string;
  name:        string;   // "First Dollar"
  flavor:      string;   // "$1 Profit"
  requirement: string;   // "Earn $1 in total estimated profit"
  isMajor?:    boolean;  // Triggers full-screen celebration when unlocked
}

export interface AchievementCategory {
  id:          string;
  title:       string;
  description: string;
  icon:        string;    // MaterialIcons name
  iconColor:   string;    // Icon tint inside the badge circle
  barColor:    string;    // Progress bar fill colour
  achievements: Achievement[];
}

/** Snapshot of user data used to compute unlock status. */
export interface UserAchievementData {
  totalScans:           number;   // # of individual scans (not hunt bundles)
  totalProfit:          number;   // Sum of all flip.profit values
  maxSingleItemProfit:  number;   // Highest single-item profit
  maxSingleItemROI:     number;   // Highest single-item ROI (%)
  hasRiskyBuy:          boolean;  // Any flip with '⚠️ RISKY BUY' label saved
  completedHunts:       number;   // From HuntXpProfile
  huntStreak:           number;   // From HuntXpProfile
  discoveredBrandsCount: number;  // From HuntXpProfile.discoveredBrands.length
  eraFlags: {
    hasVintage:      boolean;
    hasY2K:          boolean;
    hasModern:       boolean;
    has2010s:        boolean;
    hasVintageBandTee: boolean;
  };
}

// ─── Category definitions ─────────────────────────────────────────────────────

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  {
    id:          'profit',
    title:       'Profit Achievements',
    description: 'Make smart buys. Maximize profits.',
    icon:        'trending-up',
    iconColor:   '#BE9C2C',
    barColor:    '#BE9C2C',
    achievements: [
      { id: 'profit_1',     name: 'First Dollar',     flavor: '$1 Profit',      requirement: 'Earn $1 in total estimated profit'       },
      { id: 'profit_50',    name: 'Side Hustle',      flavor: '$50 Profit',     requirement: 'Earn $50 in total estimated profit'      },
      { id: 'profit_100',   name: 'Flipping Forward', flavor: '$100 Profit',    requirement: 'Earn $100 in total estimated profit'     },
      { id: 'profit_500',   name: 'Gas Money',        flavor: '$500 Profit',    requirement: 'Earn $500 in total estimated profit'     },
      { id: 'profit_1000',  name: 'Treasure Hunter',  flavor: '$1,000 Profit',  requirement: 'Earn $1,000 in total estimated profit'   },
      { id: 'profit_5000',  name: 'Part-Time Job',    flavor: '$5,000 Profit',  requirement: 'Earn $5,000 in total estimated profit'   },
      { id: 'profit_10000', name: 'FlipStart Legend', flavor: '$10,000 Profit', requirement: 'Earn $10,000 in total estimated profit', isMajor: true },
    ],
  },
  {
    id:          'scan',
    title:       'Scan Achievements',
    description: 'Analyze more items. Learn the market.',
    icon:        'camera-alt',
    iconColor:   '#3A7EBF',
    barColor:    '#3A7EBF',
    achievements: [
      { id: 'scan_1',    name: 'Finally Flipping', flavor: '1 Scan',      requirement: 'Scan your first item'    },
      { id: 'scan_10',   name: 'Looking Around',   flavor: '10 Scans',    requirement: 'Scan 10 items'           },
      { id: 'scan_100',  name: 'Scan Machine',     flavor: '100 Scans',   requirement: 'Scan 100 items'          },
      { id: 'scan_500',  name: 'Scanning Fiend',   flavor: '500 Scans',   requirement: 'Scan 500 items'          },
      { id: 'scan_1000', name: 'Data Hunter',       flavor: '1,000 Scans', requirement: 'Scan 1,000 items'       },
      { id: 'scan_5000', name: 'Master Scanner',   flavor: '5,000 Scans', requirement: 'Scan 5,000 items', isMajor: true },
    ],
  },
  {
    id:          'hunt',
    title:       'Hunt Mode Achievements',
    description: 'Master the hunt.',
    icon:        'explore',
    iconColor:   '#2A4A2A',
    barColor:    '#2A4A2A',
    achievements: [
      { id: 'hunt_1',    name: 'Welcome to the Hunt', flavor: '1 Hunt',       requirement: 'Complete your first hunt'      },
      { id: 'hunt_10',   name: 'Weekend Warrior',     flavor: '10 Hunts',     requirement: 'Complete 10 hunts'             },
      { id: 'hunt_50',   name: 'Workhorse',           flavor: '50 Hunts',     requirement: 'Complete 50 hunts'             },
      { id: 'hunt_100',  name: 'Store Raider',        flavor: '100 Hunts',    requirement: 'Complete 100 hunts'            },
      { id: 'hunt_500',  name: 'Safari Veteran',      flavor: '500 Hunts',    requirement: 'Complete 500 hunts'            },
      { id: 'hunt_1000', name: 'King of the Hunt',    flavor: '1,000 Hunts',  requirement: 'Complete 1,000 hunts'          },
      { id: 'hunt_2500', name: 'Hunt Mode Legend',    flavor: '2,500 Hunts',  requirement: 'Complete 2,500 hunts', isMajor: true },
    ],
  },
  {
    id:          'streak',
    title:       'Hunt Streak Achievements',
    description: 'Stay consistent.',
    icon:        'whatshot',
    iconColor:   '#C84A2A',
    barColor:    '#C84A2A',
    achievements: [
      { id: 'streak_3',   name: 'On Fire',           flavor: '3 Day Streak',   requirement: 'Maintain a 3-day hunt streak'   },
      { id: 'streak_7',   name: 'Locked In',         flavor: '7 Day Streak',   requirement: 'Maintain a 7-day hunt streak'   },
      { id: 'streak_14',  name: 'Hunt Predator',     flavor: '14 Day Streak',  requirement: 'Maintain a 14-day hunt streak'  },
      { id: 'streak_30',  name: 'Unstoppable',       flavor: '30 Day Streak',  requirement: 'Maintain a 30-day hunt streak'  },
      { id: 'streak_100', name: 'Dedication Pays',   flavor: '100 Day Streak', requirement: 'Maintain a 100-day hunt streak' },
      { id: 'streak_365', name: 'Never Miss',        flavor: '365 Day Streak', requirement: 'Maintain a 365-day hunt streak', isMajor: true },
    ],
  },
  {
    id:          'rareFind',
    title:       'Rare Find Achievements',
    description: 'Discover incredible flips.',
    icon:        'auto-awesome',
    iconColor:   '#3A7EBF',
    barColor:    '#3A7EBF',
    achievements: [
      { id: 'rare_50profit',  name: 'Grail Find',   flavor: '$50+ Profit Item',  requirement: 'Find an item with $50+ estimated profit'  },
      { id: 'rare_100profit', name: 'Jackpot',      flavor: '$1,000+ Profit Item', requirement: 'Find an item with $1,000+ estimated profit', isMajor: true },
      { id: 'rare_500roi',    name: 'Perfect Flip', flavor: '500%+ ROI',         requirement: 'Save an item with 500%+ ROI'              },
      { id: 'rare_risky',     name: 'Risk Taker',   flavor: 'Risky Buy Saved',   requirement: 'Save an item marked "Risky Buy"'           },
    ],
  },
  {
    id:          'era',
    title:       'Era Achievements',
    description: 'Discover items from every era.',
    icon:        'history',
    iconColor:   '#8B5A2B',
    barColor:    '#8B5A2B',
    achievements: [
      { id: 'era_vintage',    name: 'Vintage Hunter',      flavor: 'Vintage Item',      requirement: 'Find and save a Vintage item'             },
      { id: 'era_y2k',        name: 'Y2K Demon',           flavor: 'Y2K Item',          requirement: 'Find and save a Y2K item'                 },
      { id: 'era_modern',     name: 'Modern Merchant',     flavor: 'Modern Item',       requirement: 'Find and save a Modern item'              },
      { id: 'era_2010s',      name: 'New Age Flipper',     flavor: '2010s Item',        requirement: 'Find and save a 2010s item'               },
      { id: 'era_bandtee',    name: 'Band Tee Bloodhound', flavor: 'Vintage Band Tee',  requirement: 'Find and save a Vintage band tee', isMajor: true },
    ],
  },
  {
    id:          'brand',
    title:       'FlipStart Brand Achievements',
    description: 'Build brand knowledge.',
    icon:        'local-offer',
    iconColor:   '#BE9C2C',
    barColor:    '#BE9C2C',
    achievements: [
      { id: 'brand_1',   name: 'Brand Beginner',     flavor: '1 Brand',    requirement: 'Discover 1 unique brand'    },
      { id: 'brand_10',  name: 'Brand Explorer',     flavor: '10 Brands',  requirement: 'Discover 10 unique brands'  },
      { id: 'brand_50',  name: 'Brand Collector',    flavor: '50 Brands',  requirement: 'Discover 50 unique brands'  },
      { id: 'brand_100', name: 'Brand Encyclopedia', flavor: '100 Brands', requirement: 'Discover 100 unique brands', isMajor: true },
    ],
  },
];

export const TOTAL_ACHIEVEMENTS = ACHIEVEMENT_CATEGORIES.reduce(
  (sum, cat) => sum + cat.achievements.length, 0
); // 39

// ─── Data builder ─────────────────────────────────────────────────────────────

/**
 * Build a UserAchievementData snapshot from raw app state.
 * Call this once per render with live data from hooks.
 */
export function buildUserAchievementData(
  flips: HistoryEntry[],
  completedHunts: number,
  huntStreak: number,
  discoveredBrandsCount: number,
): UserAchievementData {
  const scans = flips.filter(f => !isHuntBundle(f)) as FlipResult[];

  const totalProfit = scans.reduce((s, f) => s + (f.profit ?? 0), 0);
  const maxSingleItemProfit = scans.length
    ? Math.max(...scans.map(f => f.profit ?? 0))
    : 0;
  const maxSingleItemROI = scans.length
    ? Math.max(...scans.map(f => f.roi ?? 0))
    : 0;

  const hasRiskyBuy = scans.some(f => f.buyLabel === '⚠️ RISKY BUY');

  const eraLower = (f: FlipResult) => (f.era ?? '').toLowerCase();
  const styleLower = (f: FlipResult) =>
    (f.styleLabels ?? []).join(' ').toLowerCase() + ' ' + (f.itemName ?? '').toLowerCase();

  return {
    totalScans: scans.length,
    totalProfit,
    maxSingleItemProfit,
    maxSingleItemROI,
    hasRiskyBuy,
    completedHunts,
    huntStreak,
    discoveredBrandsCount,
    eraFlags: {
      hasVintage:      scans.some(f => eraLower(f).includes('vintage')),
      hasY2K:          scans.some(f => eraLower(f).includes('y2k')),
      hasModern:       scans.some(f => eraLower(f).includes('modern')),
      has2010s:        scans.some(f => eraLower(f).includes('2010')),
      hasVintageBandTee: scans.some(f =>
        eraLower(f).includes('vintage') && styleLower(f).includes('band')),
    },
  };
}

// ─── Unlock checking ──────────────────────────────────────────────────────────

/** Returns the set of achievement IDs that are unlocked for a given category. */
export function getUnlockedIds(
  category: AchievementCategory,
  data: UserAchievementData,
): Set<string> {
  const unlocked = new Set<string>();
  const a = category.achievements;

  switch (category.id) {
    case 'profit': {
      const thresholds = [1, 50, 100, 500, 1000, 5000, 10000];
      a.forEach((ach, i) => { if (data.totalProfit >= thresholds[i]) unlocked.add(ach.id); });
      break;
    }
    case 'scan': {
      const thresholds = [1, 10, 100, 500, 1000, 5000];
      a.forEach((ach, i) => { if (data.totalScans >= thresholds[i]) unlocked.add(ach.id); });
      break;
    }
    case 'hunt': {
      const thresholds = [1, 10, 50, 100, 500, 1000, 2500];
      a.forEach((ach, i) => { if (data.completedHunts >= thresholds[i]) unlocked.add(ach.id); });
      break;
    }
    case 'streak': {
      const thresholds = [3, 7, 14, 30, 100, 365];
      a.forEach((ach, i) => { if (data.huntStreak >= thresholds[i]) unlocked.add(ach.id); });
      break;
    }
    case 'rareFind': {
      if (data.maxSingleItemProfit >= 50)  unlocked.add('rare_50profit');
      if (data.maxSingleItemProfit >= 1000) unlocked.add('rare_100profit');
      if (data.maxSingleItemROI >= 500)    unlocked.add('rare_500roi');
      if (data.hasRiskyBuy)                unlocked.add('rare_risky');
      break;
    }
    case 'era': {
      if (data.eraFlags.hasVintage)        unlocked.add('era_vintage');
      if (data.eraFlags.hasY2K)            unlocked.add('era_y2k');
      if (data.eraFlags.hasModern)         unlocked.add('era_modern');
      if (data.eraFlags.has2010s)          unlocked.add('era_2010s');
      if (data.eraFlags.hasVintageBandTee) unlocked.add('era_bandtee');
      break;
    }
    case 'brand': {
      const thresholds = [1, 10, 50, 100];
      a.forEach((ach, i) => { if (data.discoveredBrandsCount >= thresholds[i]) unlocked.add(ach.id); });
      break;
    }
  }

  return unlocked;
}

/** Convenience: just the count. */
export function getUnlockedCount(
  category: AchievementCategory,
  data: UserAchievementData,
): number {
  return getUnlockedIds(category, data).size;
}

/** Total unlocked across all categories. */
export function getTotalUnlocked(data: UserAchievementData): number {
  return ACHIEVEMENT_CATEGORIES.reduce(
    (sum, cat) => sum + getUnlockedCount(cat, data), 0
  );
}

/** All unlocked achievement IDs across every category (for notification detection). */
export function getAllUnlockedIds(data: UserAchievementData): string[] {
  const ids: string[] = [];
  for (const cat of ACHIEVEMENT_CATEGORIES) {
    getUnlockedIds(cat, data).forEach(id => ids.push(id));
  }
  return ids;
}