/**
 * lib/achievements.ts
 *
 * FlipStart Achievement System: 67 achievements across 7 categories.
 *
 * Architecture:
 *   - Data layer only (no React, no hooks)
 *   - Every achievement has ONE rule in RULES below: a function of
 *     UserAchievementData. Nothing depends on the order of a list.
 *   - UserAchievementData is built from:
 *       flips[]            saved scans AND the kept finds inside saved Hunts
 *       HuntXpProfile      completedHunts, weekStreak, discoveredBrands
 *       AchievementExtras  things the saved history cannot tell us: how many
 *                          scans were finished (saved or not), how many were
 *                          passed on, the best week streak, the best weekly
 *                          leaderboard finish (lib/achievementStats.ts)
 *
 * Nov 2026 rework:
 *   - "$1 profit" is gone. Hunt counts stop at 250 (2,500 was one a day for
 *     seven years). Streaks are weekly, the same streak that pays Hunt XP.
 *   - Scan achievements count every finished scan, saved or not, so the first
 *     scan always unlocks Finally Flipping.
 *   - Kept Hunt finds count for profit, rare-find and era achievements. Before,
 *     only scans saved outside a Hunt did.
 *   - STICKY achievements stay unlocked once earned (a streak that later resets,
 *     a weekly finish, a scan counter). The rest are still recomputed from the
 *     saved history, so deleting the scan that earned one can lock it again.
 */

import type { FlipResult, HistoryEntry, HuntBundle } from '@/types/flip';
import { isHuntBundle } from '@/types/flip';
import { huntItemToFlip } from '@/utils/huntItemToFlip';
import { ALL_BRANDS, TOTAL_SUPPORTED_BRANDS, computeDiscoveredBrands } from '@/lib/brandCompendium';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Achievement {
  id:          string;
  name:        string;   // "Side Hustle"
  flavor:      string;   // "$50 Profit"
  requirement: string;   // "Earn $50 in total estimated profit"
  isMajor?:    boolean;  // Unlocking it shows a full-screen celebration (and a gold crown in the list)
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

/** What the saved history cannot tell us. All optional: absent means "unknown, use the history". */
export interface AchievementExtras {
  /** Scans finished on this account, saved or not. */
  scanCount?:      number;
  /** Scans the user looked at and did not save. */
  passCount?:      number;
  /** Most scans finished in one day. */
  bestDayScans?:   number;
  /** Consecutive weeks with a qualifying Hunt, right now and at its best. */
  weekStreak?:     number;
  bestWeekStreak?: number;
  /** Best finish on a finished Weekly board that had enough hunters. 1 = first. */
  bestWeeklyRank?: number | null;
  /** Brands found in Hunt Mode (HuntXpProfile.discoveredBrands). */
  huntBrands?:     string[];
  /** Sticky achievements this account has already earned. */
  earnedIds?:      string[];
}

/** Snapshot of user data used to compute unlock status. */
export interface UserAchievementData {
  totalScans:           number;   // finished scans (saved or not), never less than what is saved
  passedScans:          number;
  bestDayScans:         number;
  totalProfit:          number;   // saved scans + kept Hunt finds
  bestDayProfit:        number;   // most estimated profit saved in one day
  finds20:              number;   // saved finds with $20+ estimated profit
  pricedFinds:          number;   // saved finds with a price paid entered
  lifetimeROI:          number;   // across priced finds (%)
  maxSingleItemProfit:  number;
  maxSingleItemROI:     number;
  maxItemValue:         number;   // highest estimated resale value of a saved find
  hasBinDive:           boolean;  // paid $5 or less for a find worth $100+
  hasRiskyBuy:          boolean;
  completedHunts:       number;
  maxHuntKept:          number;   // most finds kept in one Hunt
  maxHuntProfit:        number;   // most estimated profit in one Hunt
  maxHuntXp:            number;   // most XP earned in one Hunt
  bestWeeklyRank:       number | null;
  huntStreak:           number;   // old daily streak (kept for older callers; not used by any rule)
  weekStreak:           number;   // best weekly streak
  discoveredBrandsCount: number;
  rareBrands:           number;   // Rare or Legendary brands found
  legendaryBrands:      number;
  eraFlags: {
    hasVintage:      boolean;
    hasY2K:          boolean;
    hasModern:       boolean;
    has2010s:        boolean;
    has1990s:        boolean;
    has1980s:        boolean;
    has1970s:        boolean;
    hasPre1970:      boolean;
    hasVintageBandTee: boolean;
  };
  earnedIds:            Set<string>;
}

// ─── Numbers used in more than one place ──────────────────────────────────────

/** A weekly finish only counts when that week's board had at least this many hunters. */
export const MIN_HUNTERS_FOR_FINISH = 25;
export const WEEK_STREAK_STEPS = [2, 3, 4, 8, 12, 26, 52] as const;

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
      { id: 'profit_50',     name: 'Side Hustle',      flavor: '$50 Profit',      requirement: 'Earn $50 in total estimated profit'      },
      { id: 'profit_100',    name: 'Flipping Forward', flavor: '$100 Profit',     requirement: 'Earn $100 in total estimated profit'     },
      { id: 'profit_500',    name: 'Gas Money',        flavor: '$500 Profit',     requirement: 'Earn $500 in total estimated profit'     },
      { id: 'profit_1000',   name: 'Treasure Hunter',  flavor: '$1,000 Profit',   requirement: 'Earn $1,000 in total estimated profit', isMajor: true },
      { id: 'profit_5000',   name: 'Part-Time Job',    flavor: '$5,000 Profit',   requirement: 'Earn $5,000 in total estimated profit'   },
      { id: 'profit_10000',  name: 'FlipStart Legend', flavor: '$10,000 Profit',  requirement: 'Earn $10,000 in total estimated profit', isMajor: true },
      { id: 'profit_day100', name: 'Payday',           flavor: '$100 in a Day',   requirement: 'Save $100 of estimated profit in one day' },
      { id: 'profit_ten20',  name: 'Steady Hands',     flavor: '10 Solid Finds',  requirement: 'Save 10 finds with $20+ estimated profit each' },
      { id: 'profit_roi100', name: 'Double Up',        flavor: '100%+ Lifetime ROI', requirement: 'Reach 100%+ ROI across 10 or more priced finds' },
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
      { id: 'scan_1',      name: 'Finally Flipping', flavor: '1 Scan',          requirement: 'Scan your first item', isMajor: true },
      { id: 'scan_10',     name: 'Looking Around',   flavor: '10 Scans',        requirement: 'Scan 10 items'              },
      { id: 'scan_100',    name: 'Scan Machine',     flavor: '100 Scans',       requirement: 'Scan 100 items', isMajor: true },
      { id: 'scan_500',    name: 'Scanning Fiend',   flavor: '500 Scans',       requirement: 'Scan 500 items'             },
      { id: 'scan_1000',   name: 'Data Hunter',      flavor: '1,000 Scans',     requirement: 'Scan 1,000 items'           },
      { id: 'scan_5000',   name: 'Master Scanner',   flavor: '5,000 Scans',     requirement: 'Scan 5,000 items', isMajor: true },
      { id: 'scan_day10',  name: 'Rack Runner',      flavor: '10 Scans in a Day', requirement: 'Scan 10 items in one day' },
      { id: 'scan_pass25', name: 'Picky',            flavor: '25 Passes',       requirement: 'Pass on 25 items you scanned' },
    ],
  },
  {
    id:          'hunt',
    title:       'Hunt Mode Achievements',
    description: 'Master the hunt.',
    icon:        'pets',
    iconColor:   '#7CC576',
    barColor:    '#2A4A2A',
    achievements: [
      { id: 'hunt_1',         name: 'Welcome to the Hunt', flavor: '1 Hunt',          requirement: 'Complete your first Hunt'   },
      { id: 'hunt_10',        name: 'Weekend Warrior',     flavor: '10 Hunts',        requirement: 'Complete 10 Hunts'          },
      { id: 'hunt_25',        name: 'Safari Regular',      flavor: '25 Hunts',        requirement: 'Complete 25 Hunts'          },
      { id: 'hunt_50',        name: 'Workhorse',           flavor: '50 Hunts',        requirement: 'Complete 50 Hunts'          },
      { id: 'hunt_100',       name: 'Store Raider',        flavor: '100 Hunts',       requirement: 'Complete 100 Hunts'         },
      { id: 'hunt_250',       name: 'Hunt Mode Legend',    flavor: '250 Hunts',       requirement: 'Complete 250 Hunts', isMajor: true },
      { id: 'hunt_keep5',     name: 'Full Cart',           flavor: '5 Finds, 1 Hunt', requirement: 'Keep 5 finds in one Hunt'   },
      { id: 'hunt_keep10',    name: 'Haul of Fame',        flavor: '10 Finds, 1 Hunt', requirement: 'Keep 10 finds in one Hunt' },
      { id: 'hunt_profit100', name: 'Big Game',            flavor: '$100 Hunt',       requirement: 'Finish a Hunt with $100+ estimated profit' },
      { id: 'hunt_profit250', name: 'Trophy Hunt',         flavor: '$250 Hunt',       requirement: 'Finish a Hunt with $250+ estimated profit' },
      { id: 'hunt_xp50',      name: 'XP Run',              flavor: '50 XP Hunt',      requirement: 'Earn 50+ XP in one Hunt'    },
      { id: 'hunt_xp150',     name: 'XP Feast',            flavor: '150 XP Hunt',     requirement: 'Earn 150+ XP in one Hunt'   },
      { id: 'hunt_top10',     name: 'Top 10',              flavor: 'Weekly Top 10',   requirement: 'Finish a week in the top 10 for Weekly XP' },
      { id: 'hunt_top3',      name: 'Podium',              flavor: 'Weekly Top 3',    requirement: 'Finish a week in the top 3 for Weekly XP', isMajor: true },
      { id: 'hunt_first',     name: 'King of the Week',    flavor: 'Weekly #1',       requirement: 'Finish a week at #1 for Weekly XP', isMajor: true },
    ],
  },
  {
    id:          'streak',
    title:       'Hunt Streak Achievements',
    description: 'Hunt every week.',
    icon:        'whatshot',
    iconColor:   '#C84A2A',
    barColor:    '#C84A2A',
    achievements: [
      { id: 'streak_w2',  name: 'Back for More',   flavor: '2 Week Streak',  requirement: 'Hunt 2 weeks in a row', isMajor: true },
      { id: 'streak_w3',  name: 'On Fire',         flavor: '3 Week Streak',  requirement: 'Hunt 3 weeks in a row', isMajor: true },
      { id: 'streak_w4',  name: 'Locked In',       flavor: '4 Week Streak',  requirement: 'Hunt 4 weeks in a row', isMajor: true },
      { id: 'streak_w8',  name: 'Hunt Predator',   flavor: '8 Week Streak',  requirement: 'Hunt 8 weeks in a row', isMajor: true },
      { id: 'streak_w12', name: 'Unstoppable',     flavor: '12 Week Streak', requirement: 'Hunt 12 weeks in a row', isMajor: true },
      { id: 'streak_w26', name: 'Dedication Pays', flavor: '26 Week Streak', requirement: 'Hunt 26 weeks in a row', isMajor: true },
      { id: 'streak_w52', name: 'Never Miss',      flavor: '52 Week Streak', requirement: 'Hunt 52 weeks in a row', isMajor: true },
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
      { id: 'rare_value_50',   name: 'Nice Find',    flavor: '$50+ Item',        requirement: 'Save an item worth $50 or more'      },
      { id: 'rare_value_100',  name: 'Grail Find',   flavor: '$100+ Item',       requirement: 'Save an item worth $100 or more'     },
      { id: 'rare_value_500',  name: 'Heavy Hitter', flavor: '$500+ Item',       requirement: 'Save an item worth $500 or more', isMajor: true },
      { id: 'rare_value_1000', name: 'Holy Grail',   flavor: '$1,000+ Item',     requirement: 'Save an item worth $1,000 or more', isMajor: true },
      { id: 'rare_100profit',  name: 'Jackpot',      flavor: '$250+ Profit Item', requirement: 'Find an item with $250+ estimated profit', isMajor: true },
      { id: 'rare_500roi',     name: 'Perfect Flip', flavor: '500%+ ROI',        requirement: 'Save an item with 500%+ ROI'         },
      { id: 'rare_1000roi',    name: 'Ten Bagger',   flavor: '1,000%+ ROI',      requirement: 'Save an item with 1,000%+ ROI'       },
      { id: 'rare_bin',        name: 'Bin Diver',    flavor: '$5 Into $100',     requirement: 'Pay $5 or less for an item worth $100+', isMajor: true },
      { id: 'rare_risky',      name: 'Risk Taker',   flavor: 'Risky Buy Saved',  requirement: 'Save an item marked "Risky Buy"'     },
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
      { id: 'era_vintage', name: 'Vintage Hunter',      flavor: 'Vintage Item',     requirement: 'Find and save a Vintage item'       },
      { id: 'era_y2k',     name: 'Y2K Demon',           flavor: 'Y2K Item',         requirement: 'Find and save a Y2K item'           },
      { id: 'era_modern',  name: 'Modern Merchant',     flavor: 'Modern Item',      requirement: 'Find and save a Modern item'        },
      { id: 'era_2010s',   name: 'New Age Flipper',     flavor: '2010s Item',       requirement: 'Find and save a 2010s item'         },
      { id: 'era_1990s',   name: '90s Kid',             flavor: '1990s Item',       requirement: 'Find and save an item from the 1990s' },
      { id: 'era_1980s',   name: 'Totally 80s',         flavor: '1980s Item',       requirement: 'Find and save an item from the 1980s' },
      { id: 'era_1970s',   name: 'Disco Digger',        flavor: '1970s Item',       requirement: 'Find and save an item from the 1970s' },
      { id: 'era_pre1970', name: 'Time Traveler',       flavor: 'Pre-1970 Item',    requirement: 'Find and save an item made before 1970', isMajor: true },
      { id: 'era_bandtee', name: 'Band Tee Bloodhound', flavor: 'Vintage Band Tee', requirement: 'Find and save a Vintage band tee', isMajor: true },
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
      { id: 'brand_1',          name: 'Brand Beginner',     flavor: '1 Brand',    requirement: 'Discover 1 unique brand'    },
      { id: 'brand_10',         name: 'Brand Explorer',     flavor: '10 Brands',  requirement: 'Discover 10 unique brands'  },
      { id: 'brand_50',         name: 'Brand Collector',    flavor: '50 Brands',  requirement: 'Discover 50 unique brands'  },
      { id: 'brand_100',        name: 'Brand Encyclopedia', flavor: '100 Brands', requirement: 'Discover 100 unique brands', isMajor: true },
      { id: 'brand_150',        name: 'Brand Scholar',      flavor: '150 Brands', requirement: 'Discover 150 unique brands' },
      { id: 'brand_200',        name: 'Brand Master',       flavor: '200 Brands', requirement: 'Discover 200 unique brands' },
      { id: 'brand_all',        name: 'Completionist',      flavor: 'Every Brand', requirement: 'Discover every brand in the Brand Compendium' },
      { id: 'brand_rare',       name: 'Rare Sighting',      flavor: 'Rare Brand', requirement: 'Discover a Rare brand'      },
      { id: 'brand_legendary',  name: 'Legendary Sighting', flavor: 'Legendary Brand', requirement: 'Discover a Legendary brand' },
      { id: 'brand_legendary5', name: 'Legend Collector',   flavor: '5 Legendary Brands', requirement: 'Discover 5 Legendary brands' },
    ],
  },
];

export const TOTAL_ACHIEVEMENTS = ACHIEVEMENT_CATEGORIES.reduce(
  (sum, cat) => sum + cat.achievements.length, 0
); // 67

// ─── The rules: one per achievement ───────────────────────────────────────────

type Rule = (d: UserAchievementData) => boolean;

const RULES: Record<string, Rule> = {
  profit_50:     d => d.totalProfit >= 50,
  profit_100:    d => d.totalProfit >= 100,
  profit_500:    d => d.totalProfit >= 500,
  profit_1000:   d => d.totalProfit >= 1000,
  profit_5000:   d => d.totalProfit >= 5000,
  profit_10000:  d => d.totalProfit >= 10000,
  profit_day100: d => d.bestDayProfit >= 100,
  profit_ten20:  d => d.finds20 >= 10,
  profit_roi100: d => d.pricedFinds >= 10 && d.lifetimeROI >= 100,

  scan_1:      d => d.totalScans >= 1,
  scan_10:     d => d.totalScans >= 10,
  scan_100:    d => d.totalScans >= 100,
  scan_500:    d => d.totalScans >= 500,
  scan_1000:   d => d.totalScans >= 1000,
  scan_5000:   d => d.totalScans >= 5000,
  scan_day10:  d => d.bestDayScans >= 10,
  scan_pass25: d => d.passedScans >= 25,

  hunt_1:         d => d.completedHunts >= 1,
  hunt_10:        d => d.completedHunts >= 10,
  hunt_25:        d => d.completedHunts >= 25,
  hunt_50:        d => d.completedHunts >= 50,
  hunt_100:       d => d.completedHunts >= 100,
  hunt_250:       d => d.completedHunts >= 250,
  hunt_keep5:     d => d.maxHuntKept >= 5,
  hunt_keep10:    d => d.maxHuntKept >= 10,
  hunt_profit100: d => d.maxHuntProfit >= 100,
  hunt_profit250: d => d.maxHuntProfit >= 250,
  hunt_xp50:      d => d.maxHuntXp >= 50,
  hunt_xp150:     d => d.maxHuntXp >= 150,
  hunt_top10:     d => d.bestWeeklyRank != null && d.bestWeeklyRank <= 10,
  hunt_top3:      d => d.bestWeeklyRank != null && d.bestWeeklyRank <= 3,
  hunt_first:     d => d.bestWeeklyRank === 1,

  streak_w2:  d => d.weekStreak >= 2,
  streak_w3:  d => d.weekStreak >= 3,
  streak_w4:  d => d.weekStreak >= 4,
  streak_w8:  d => d.weekStreak >= 8,
  streak_w12: d => d.weekStreak >= 12,
  streak_w26: d => d.weekStreak >= 26,
  streak_w52: d => d.weekStreak >= 52,

  rare_value_50:   d => d.maxItemValue >= 50,
  rare_value_100:  d => d.maxItemValue >= 100,
  rare_value_500:  d => d.maxItemValue >= 500,
  rare_value_1000: d => d.maxItemValue >= 1000,
  rare_100profit:  d => d.maxSingleItemProfit >= 250,
  rare_500roi:     d => d.maxSingleItemROI >= 500,
  rare_1000roi:    d => d.maxSingleItemROI >= 1000,
  rare_bin:        d => d.hasBinDive,
  rare_risky:      d => d.hasRiskyBuy,

  era_vintage: d => d.eraFlags.hasVintage,
  era_y2k:     d => d.eraFlags.hasY2K,
  era_modern:  d => d.eraFlags.hasModern,
  era_2010s:   d => d.eraFlags.has2010s,
  era_1990s:   d => d.eraFlags.has1990s,
  era_1980s:   d => d.eraFlags.has1980s,
  era_1970s:   d => d.eraFlags.has1970s,
  era_pre1970: d => d.eraFlags.hasPre1970,
  era_bandtee: d => d.eraFlags.hasVintageBandTee,

  brand_1:          d => d.discoveredBrandsCount >= 1,
  brand_10:         d => d.discoveredBrandsCount >= 10,
  brand_50:         d => d.discoveredBrandsCount >= 50,
  brand_100:        d => d.discoveredBrandsCount >= 100,
  brand_150:        d => d.discoveredBrandsCount >= 150,
  brand_200:        d => d.discoveredBrandsCount >= 200,
  brand_all:        d => d.discoveredBrandsCount >= TOTAL_SUPPORTED_BRANDS,
  brand_rare:       d => d.rareBrands >= 1,
  brand_legendary:  d => d.legendaryBrands >= 1,
  brand_legendary5: d => d.legendaryBrands >= 5,
};

/**
 * Achievements that stay unlocked once earned. What they measure can go back
 * down (a streak resets) or is not in the saved history at all (a scan that was
 * not saved, a leaderboard finish), so they are remembered in
 * AchievementExtras.earnedIds and carried between devices by achievementSync.
 */
export function isStickyAchievement(id: string): boolean {
  return id.startsWith('scan_') || id.startsWith('streak_w')
      || id === 'hunt_top10' || id === 'hunt_top3' || id === 'hunt_first';
}

// ─── Data builder ─────────────────────────────────────────────────────────────

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

function dayKey(ts: number): string {
  const d = new Date(num(ts));
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The production decade of a saved find, e.g. "1990s" or "pre_1950s". '' when not known. */
function decadeOf(f: FlipResult): string {
  const v1 = String((f as any)?.v1?.productionDecade ?? '').toLowerCase();
  if (v1 && v1 !== 'unknown') return v1;
  // Older scans only have the display text ("Vintage 1990s"). A styling word
  // ("90s style", "Y2K") never reaches the era field, so a decade here is a real one.
  const m = /\b(19[0-9]0|20[0-2]0)s\b/.exec(String(f.era ?? ''));
  return m ? `${m[1]}s` : '';
}

/**
 * Build a UserAchievementData snapshot from raw app state.
 *
 * The first four arguments are what every screen already had. `extras` carries
 * what the saved history cannot (lib/achievementStats.ts loads it); without it
 * the scan, streak and weekly-finish achievements fall back to what the history
 * and the arguments show.
 */
export function buildUserAchievementData(
  flips: HistoryEntry[],
  completedHunts: number,
  huntStreak: number,
  discoveredBrandsCount: number,
  extras: AchievementExtras = {},
): UserAchievementData {
  const list    = Array.isArray(flips) ? flips : [];
  const scans   = list.filter(f => !isHuntBundle(f)) as FlipResult[];
  const bundles = list.filter(f => isHuntBundle(f)) as HuntBundle[];

  // Every saved find: scans saved on their own, plus the finds kept in a Hunt.
  const kept: FlipResult[] = [];
  for (const b of bundles) {
    for (const item of b.keptItems ?? []) {
      try { kept.push(huntItemToFlip(item, b.timestamp)); } catch { /* a broken item is skipped */ }
    }
  }
  const finds = [...scans, ...kept];

  const totalProfit = finds.reduce((s, f) => s + num(f.profit), 0);
  const byDay = new Map<string, number>();
  for (const f of finds) {
    const k = dayKey(f.timestamp);
    byDay.set(k, (byDay.get(k) ?? 0) + Math.max(0, num(f.profit)));
  }
  const priced      = finds.filter(f => num(f.thriftPrice) > 0);
  const pricedCost  = priced.reduce((s, f) => s + num(f.thriftPrice), 0);
  const pricedGain  = priced.reduce((s, f) => s + num(f.profit), 0);

  // Scans finished: whatever is larger, the counter or what the history proves.
  const huntScans  = bundles.reduce((s, b) => s + (b.keptItems?.length ?? 0) + (b.removedItems?.length ?? 0), 0);
  const savedByDay = new Map<string, number>();
  for (const f of scans) savedByDay.set(dayKey(f.timestamp), (savedByDay.get(dayKey(f.timestamp)) ?? 0) + 1);

  const eraLower   = (f: FlipResult) => String(f.era ?? '').toLowerCase();
  const styleLower = (f: FlipResult) =>
    (f.styleLabels ?? []).join(' ').toLowerCase() + ' ' + String(f.itemName ?? '').toLowerCase();
  const decades    = new Set(finds.map(decadeOf).filter(Boolean));

  // Brands: the same set the Brand Compendium shows, when the caller can supply it.
  let brandCount = num(discoveredBrandsCount);
  let rareBrands = 0, legendaryBrands = 0;
  try {
    const names = computeDiscoveredBrands(list, extras.huntBrands ?? []);
    brandCount = Math.max(brandCount, names.size);
    for (const b of ALL_BRANDS) {
      if (!names.has(b.name)) continue;
      if (b.rarity === 'legendary') { legendaryBrands++; rareBrands++; }
      else if (b.rarity === 'rare') rareBrands++;
    }
  } catch { /* brand list unavailable: the count passed in stands */ }

  const rank = extras.bestWeeklyRank;

  return {
    totalScans:   Math.max(num(extras.scanCount), scans.length + huntScans),
    passedScans:  num(extras.passCount),
    bestDayScans: Math.max(num(extras.bestDayScans), 0, ...savedByDay.values()),
    totalProfit,
    bestDayProfit: Math.max(0, ...byDay.values()),
    finds20:      finds.filter(f => num(f.profit) >= 20).length,
    pricedFinds:  priced.length,
    lifetimeROI:  pricedCost > 0 ? (pricedGain / pricedCost) * 100 : 0,
    maxSingleItemProfit: Math.max(0, ...finds.map(f => num(f.profit))),
    maxSingleItemROI:    Math.max(0, ...finds.map(f => num(f.roi))),
    maxItemValue:        Math.max(0, ...finds.map(f => num(f.resaleValue))),
    hasBinDive:   finds.some(f => num(f.thriftPrice) > 0 && num(f.thriftPrice) <= 5 && num(f.resaleValue) >= 100),
    hasRiskyBuy:  finds.some(f => f.buyLabel === '⚠️ RISKY BUY'),
    completedHunts: num(completedHunts),
    maxHuntKept:   Math.max(0, ...bundles.map(b => num(b.keptItemCount) || (b.keptItems?.length ?? 0))),
    maxHuntProfit: Math.max(0, ...bundles.map(b => num(b.totalEstimatedProfit))),
    maxHuntXp:     Math.max(0, ...bundles.map(b => num(b.xpEarned))),
    bestWeeklyRank: typeof rank === 'number' && rank >= 1 ? Math.floor(rank) : null,
    huntStreak:   num(huntStreak),
    weekStreak:   Math.max(num(extras.weekStreak), num(extras.bestWeekStreak)),
    discoveredBrandsCount: brandCount,
    rareBrands,
    legendaryBrands,
    eraFlags: {
      hasVintage:  finds.some(f => eraLower(f).includes('vintage')),
      hasY2K:      finds.some(f => eraLower(f).includes('y2k')),
      hasModern:   finds.some(f => eraLower(f).includes('modern')),
      has2010s:    finds.some(f => eraLower(f).includes('2010')) || decades.has('2010s'),
      has1990s:    decades.has('1990s'),
      has1980s:    decades.has('1980s'),
      has1970s:    decades.has('1970s'),
      hasPre1970:  decades.has('1960s') || decades.has('1950s') || decades.has('pre_1950s'),
      hasVintageBandTee: finds.some(f =>
        eraLower(f).includes('vintage') && styleLower(f).includes('band')),
    },
    earnedIds: new Set(extras.earnedIds ?? []),
  };
}

// ─── Unlock checking ──────────────────────────────────────────────────────────

function isUnlocked(id: string, data: UserAchievementData): boolean {
  if (isStickyAchievement(id) && data.earnedIds?.has(id)) return true;
  const rule = RULES[id];
  try { return rule ? rule(data) : false; } catch { return false; }
}

/** Returns the set of achievement IDs that are unlocked for a given category. */
export function getUnlockedIds(
  category: AchievementCategory,
  data: UserAchievementData,
): Set<string> {
  const unlocked = new Set<string>();
  for (const ach of category.achievements) {
    if (isUnlocked(ach.id, data)) unlocked.add(ach.id);
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

/** Look one achievement up by id, with the category it belongs to. */
export function findAchievement(id: string): { achievement: Achievement; category: AchievementCategory } | null {
  for (const category of ACHIEVEMENT_CATEGORIES) {
    const achievement = category.achievements.find(a => a.id === id);
    if (achievement) return { achievement, category };
  }
  return null;
}