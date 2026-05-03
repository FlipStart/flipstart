/**
 * FlipStart — Flip Calculation Utilities
 *
 * ALL business logic lives here.
 * Zero React imports. Zero UI dependencies.
 * Every function is pure (input → output, no side effects).
 *
 * UI files MUST import from here — they MUST NOT contain formulas.
 */

import type {
  BuyLabel, Platform, RankLabel,
  FlipCalc, GlobalStats, GlobalRank, FlipResult,
} from '@/types/flip';
import { getRecommendation, type Recommendation } from '@/utils/recommendation';

// ─── Rank gate constants ──────────────────────────────────────────────────────
// Volume thresholds for rank eligibility.
// High stats alone cannot unlock a high rank — volume and consistency required.
const RANK_GATES = {
  GOAT:    100,   // 100+ flips + strong stats
  ELITE:    40,   // 40+ flips
  PRO:      15,   // 15+ flips
  SKILLED:   5,   // 5+ flips
  LEARNING:  1,   // any confirmed flip
  // Fewer than 1 → Beginner (no cap needed, this is the floor)
} as const;
import { WIN_LABELS } from '@/types/flip';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Combined platform fee rate (eBay ~13%, Depop ~10%, blended avg) */
export const FEE_RATE = 0.12;

/** Buy score weights (must sum to 1.0) */
export const SCORE_WEIGHTS = {
  profit:      0.50,
  confidence:  0.30,
  competition: 0.20,
} as const;

// ─── Core calculations ────────────────────────────────────────────────────────

/**
 * Calculate platform fees from the resale value.
 * Returns a whole dollar amount.
 */
export function calculateFees(resaleValue: number): number {
  return Math.round(resaleValue * FEE_RATE);
}

/**
 * Calculate net profit.
 * profit = resaleValue - fees - thriftPrice
 */
export function calculateProfit(
  resaleValue:  number,
  fees:         number,
  thriftPrice:  number,
): number {
  return resaleValue - fees - thriftPrice;
}

/**
 * Calculate ROI as a percentage.
 * roi = (profit / thriftPrice) * 100
 * Returns 0 if thriftPrice is 0 or negative (guards against divide-by-zero).
 */
export function calculateROI(profit: number, thriftPrice: number): number {
  if (thriftPrice <= 0) return 0;
  return Math.round((profit / thriftPrice) * 100);
}

/**
 * Calculate weighted buy score (0–100).
 *
 * Inputs are normalized before weighting:
 *   profit      → 0 at $0, 1 at $100+ (capped)
 *   confidence  → 0–100 divided by 100
 *   competition → High=0, Moderate=0.5, Low=1 (inverse)
 */
export function calculateBuyScore(
  profit:           number,
  matchConfidence:  number,
  competitionLevel: string,
): number {
  const normProfit = Math.min(1, Math.max(0, profit / 100));
  const normConf   = Math.min(1, Math.max(0, matchConfidence / 100));

  const compMap: Record<string, number> = {
    high:     0,
    moderate: 0.5,
    low:      1,
  };
  const normComp = compMap[competitionLevel.toLowerCase()] ?? 0.5;

  const raw =
    SCORE_WEIGHTS.profit      * normProfit +
    SCORE_WEIGHTS.confidence  * normConf   +
    SCORE_WEIGHTS.competition * normComp;

  return Math.round(raw * 100);
}

/**
 * Map a score + profit to a buy label.
 * If profit < 0, always returns TRASH regardless of score.
 */
export function getBuyLabel(score: number, profit: number): BuyLabel {
  if (profit < 0)   return '🤮 TRASH';
  if (score >= 85)  return '🔥 GRAIL FIND';
  if (score >= 70)  return '💰 STRONG BUY';
  if (score >= 55)  return '✅ BUY';
  if (score >= 40)  return '⚠️ RISKY BUY';
  if (score >= 25)  return "❌ DON'T BUY";
  return '🤮 TRASH';
}

/**
 * Calculate star rating (1–5) from profit.
 * 5 stars = $50+ profit
 * 4 stars = $20–$49
 * 3 stars = $10–$19
 * 2 stars = $0–$9
 * 1 star  = negative profit
 */
export function getStarRating(profit: number): number {
  if (profit >= 50) return 5;
  if (profit >= 20) return 4;
  if (profit >= 10) return 3;
  if (profit >= 0)  return 2;
  return 1;
}

/**
 * Determine best resale platform based on item style and value.
 * Vintage/street items under $45 → Depop (younger audience, lower fees)
 * High-value items $45+ → eBay (larger buyer pool, buyer protection)
 * Otherwise → Either
 */
export function getBestPlatform(
  styleLabels:  string[],
  era:          string,
  resaleValue:  number,
): Platform {
  const styleText = styleLabels.join(' ').toLowerCase();
  const isVintage = /vintage|retro|y2k|90s|80s|streetwear|workwear|western|deadstock/i.test(styleText) ||
                    /vintage|retro|y2k|90s|80s/i.test(era);
  if (isVintage && resaleValue < 45) return 'Depop';
  if (resaleValue >= 45)             return 'eBay';
  return 'Either';
}

/**
 * Derive the rationale for a star rating.
 * Returns bullet-point explanations for the analysis-details screen.
 */
export function getStarRationale(
  profit:          number,
  matchConfidence: number,
  competitionLevel: string,
): string[] {
  const reasons: string[] = [];

  if (profit >= 50)       reasons.push('Exceptional profit margin ($50+)');
  else if (profit >= 20)  reasons.push('Strong profit margin ($20+)');
  else if (profit >= 10)  reasons.push('Moderate profit margin ($10+)');
  else if (profit >= 0)   reasons.push('Thin profit margin (under $10)');
  else                    reasons.push('Negative profit — costs exceed resale value');

  if (matchConfidence >= 80)       reasons.push(`High match confidence (${matchConfidence}%)`);
  else if (matchConfidence >= 55)  reasons.push(`Moderate match confidence (${matchConfidence}%)`);
  else                             reasons.push(`Low match confidence (${matchConfidence}%) — estimate may be off`);

  const comp = competitionLevel.toLowerCase();
  if (comp === 'low')      reasons.push('Low seller competition — easier to sell');
  else if (comp === 'high') reasons.push('High seller competition — harder to stand out');
  else                      reasons.push('Moderate seller competition');

  return reasons;
}

/**
 * Derive a platform recommendation rationale for the analysis-details screen.
 */
export function getPlatformRationale(platform: Platform, resaleValue: number): string {
  if (platform === 'Depop') {
    return 'Depop has a younger audience that pays premiums for vintage and streetwear. Lower fees (~10%) vs eBay.';
  }
  if (platform === 'eBay') {
    return `eBay has the largest buyer pool for items valued $${resaleValue}+. Buyer protection increases buyer confidence.`;
  }
  return 'This item sells well on both platforms. List on both for maximum exposure.';
}

// ─── Full live recalculation (single call for UI) ────────────────────────────

/**
 * Compute all live values from a resale value + thrift price.
 * UI calls this once on every thrift price change.
 * Returns a FlipCalc object — UI just renders it.
 */
export function computeFlipCalc(
  resaleValue:      number,
  thriftPrice:      number,
  matchConfidence:  number,
  competitionLevel: string,
  styleLabels:      string[],
  era:              string,
  demandLevel:      string = '',
  sellSpeed:        string = '',
): FlipCalc {
  const fees        = calculateFees(resaleValue);
  const profit      = calculateProfit(resaleValue, fees, thriftPrice);
  const roi         = calculateROI(profit, thriftPrice);
  const buyScore    = calculateBuyScore(profit, matchConfidence, competitionLevel);
  const buyLabel    = getBuyLabel(buyScore, profit);
  const stars       = getStarRating(profit);
  const bestPlatform = getBestPlatform(styleLabels, era, resaleValue);

  // Situational recommendation — replaces the old binary buy/skip logic
  const recommendation = getRecommendation({
    netProfit:        profit,
    resaleValue,
    thriftPrice,
    roi,
    matchConfidence,
    competitionLevel,
    demandLevel,
    sellSpeed,
  });

  return {
    thriftPrice, fees, profit, roi,
    buyScore, buyLabel, stars, bestPlatform,
    recommendation,
  };
}

// ─── Global stats (derived from history) ─────────────────────────────────────

/**
 * Derive global stats from the full confirmed flip history.
 * This is the ONLY place this computation happens.
 * history.tsx and stats sections call this — they do not compute inline.
 */
export function deriveGlobalStats(history: FlipResult[]): GlobalStats {
  const totalFlips  = history.length;
  const totalProfit = history.reduce((sum, f) => sum + Math.max(0, f.profit), 0);
  const totalCost   = history.reduce((sum, f) => sum + f.thriftPrice, 0);
  const lifetimeRoi = totalCost > 0 ? Math.round((totalProfit / totalCost) * 100) : 0;
  const avgProfit   = totalFlips > 0 ? Math.round(totalProfit / totalFlips) : 0;
  const wins        = history.filter(f => (WIN_LABELS as readonly string[]).includes(f.buyLabel)).length;
  const winRate     = totalFlips > 0 ? Math.round((wins / totalFlips) * 100) : 0;

  return { totalFlips, totalProfit, totalCost, lifetimeRoi, avgProfit, winRate };
}

// ─── Global rank ──────────────────────────────────────────────────────────────

/**
 * Compute global rank from derived stats.
 *
 * Raw score formula:
 *   (lifetimeRoi × 0.35) + (avgProfit × 0.30) + (winRate × 0.25) + (volumeBonus × 0.10)
 *
 * Volume bonus (0–100) rewards consistency:
 *   10 flips → 10pts, 25 → 25pts, 50 → 50pts, 100+ → 100pts
 *
 * Sample-size gate: high scores with few flips are capped at a lower rank.
 * This means 1 lucky flip cannot produce an Elite or GOAT rank.
 *
 * Rank gates (minimum confirmed flips to be ELIGIBLE for that rank):
 *   GOAT:    100+  flips AND score ≥ 95
 *   Elite:    40+  flips AND score ≥ 85
 *   Pro:      15+  flips AND score ≥ 70
 *   Skilled:   5+  flips AND score ≥ 55
 *   Learning:  1+  flip  (any confirmed flip exits Beginner)
 *   Beginner:  0   flips
 */
export function calcGlobalRank(stats: GlobalStats): GlobalRank {
  const n = stats.totalFlips;

  // Volume bonus: log-scale reward capped at 100
  const volumeBonus = Math.min(100, Math.round(n > 0 ? (Math.log10(n + 1) / Math.log10(101)) * 100 : 0));

  const rawScore = Math.round(
    stats.lifetimeRoi * 0.35 +
    stats.avgProfit   * 0.30 +
    stats.winRate     * 0.25 +
    volumeBonus       * 0.10,
  );

  // Apply sample-size gate: cap the rank based on how many flips exist
  let rank: RankLabel;

  if (n >= RANK_GATES.GOAT && rawScore >= 95) {
    rank = '🐐 GOAT';
  } else if (n >= RANK_GATES.ELITE && rawScore >= 85) {
    rank = '🐐 Elite';
  } else if (n >= RANK_GATES.PRO && rawScore >= 70) {
    rank = '💰 Pro';
  } else if (n >= RANK_GATES.SKILLED && rawScore >= 55) {
    rank = '📈 Skilled';
  } else if (n >= RANK_GATES.LEARNING) {
    rank = '🧠 Learning';
  } else {
    rank = '🪨 Beginner';
  }

  return { rank, score: rawScore };
}