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
  BuyLabel, Platform,
  FlipCalc, GlobalStats, FlipResult,
} from '@/types/flip';
import { getRecommendation, type Recommendation } from '@/utils/recommendation';

// ─── Rank gate constants ──────────────────────────────────────────────────────
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
/**
 * Find the highest whole-dollar thrift price at which the rating stays at
 * BUY or STRONG_BUY (i.e. does NOT drop to RISKY_BUY or SKIP).
 *
 * This exists so the "Worth grabbing if you can buy at $X or less" line is
 * mathematically consistent with the actual rating logic — paying MORE than
 * this price is guaranteed to downgrade the rating, so the number shown is a
 * real, honest ceiling rather than a disconnected AI suggestion.
 *
 * Approach: fees are derived from resaleValue only (not thriftPrice), so
 * profit decreases 1:1 as thriftPrice increases. We walk thriftPrice down
 * from resaleValue in $1 steps, re-running the exact same getRecommendation()
 * used everywhere else, until we find a BUY/STRONG_BUY price. This guarantees
 * the number can never disagree with the live rating shown on screen.
 *
 * Returns 0 if even $0 doesn't reach BUY/STRONG_BUY (nothing to recommend).
 */
/**
 * The highest price at which this item is still worth buying.
 *
 * Previously this searched for the price at which the rating became BUY. For
 * any item whose risk factors cap it at RISKY BUY, no such price exists, so the
 * walk fell through to 0 and the UI told the user to buy a $100 item for $1.
 *
 * The right question is not "what makes this a BUY" but "what is the most I
 * should pay" — the highest price at which it is still not a SKIP. That is the
 * number a reseller standing in the aisle actually needs, and it exists for
 * every item that is worth buying at all.
 *
 * Returns null when the item is not worth buying at any price. The caller must
 * render that as "not worth it", never as $0.
 */
export function findMaxBuyPriceForRating(
  resaleValue:      number,
  matchConfidence:  number,
  competitionLevel: string,
  demandLevel:      string = '',
  sellSpeed:        string = '',
  v1Signals: { buyerPool?: string; hasObviousDamage?: boolean; eraUnconfirmed?: boolean } = {},
): number | null {
  const fees = calculateFees(resaleValue);
  const ceiling = Math.max(0, Math.round(resaleValue));

  for (let price = ceiling; price >= 0; price--) {
    const profit = calculateProfit(resaleValue, fees, price);
    const roi    = calculateROI(profit, price);
    const rec = getRecommendation({
      netProfit: profit, resaleValue, thriftPrice: price, roi,
      matchConfidence, competitionLevel, demandLevel, sellSpeed,
      buyerPool:        v1Signals.buyerPool,
      hasObviousDamage: v1Signals.hasObviousDamage,
      eraUnconfirmed:   v1Signals.eraUnconfirmed,
    });
    if (rec.label !== 'SKIP') return price;
  }
  return null;
}

/**
 * The price at which this item would become a solid BUY, if such a price
 * exists. Null when risk factors cap it below BUY at any price.
 *
 * Kept separate from the max-buy figure because they answer different
 * questions: this one is aspirational ("get it this cheap and it is a real
 * win"), the other is a ceiling ("do not pay more than this").
 */
export function findBuyThresholdPrice(
  resaleValue:      number,
  matchConfidence:  number,
  competitionLevel: string,
  demandLevel:      string = '',
  sellSpeed:        string = '',
  v1Signals: { buyerPool?: string; hasObviousDamage?: boolean; eraUnconfirmed?: boolean } = {},
): number | null {
  const fees = calculateFees(resaleValue);
  for (let price = Math.max(0, Math.round(resaleValue)); price >= 0; price--) {
    const profit = calculateProfit(resaleValue, fees, price);
    const roi    = calculateROI(profit, price);
    const rec = getRecommendation({
      netProfit: profit, resaleValue, thriftPrice: price, roi,
      matchConfidence, competitionLevel, demandLevel, sellSpeed,
      buyerPool:        v1Signals.buyerPool,
      hasObviousDamage: v1Signals.hasObviousDamage,
      eraUnconfirmed:   v1Signals.eraUnconfirmed,
    });
    if (rec.label === 'BUY' || rec.label === 'STRONG_BUY') return price;
  }
  return null;
}

/**
 * The single source of truth for "what price are we rating this at".
 *
 * Every screen that shows a rating MUST use this. Results and Deep Analysis
 * previously each chose their own fallback — results used the AI's
 * suggested_buy_price, Deep Analysis used the stored thriftPrice — so the same
 * item produced RISKY BUY on one screen and SKIP on the other. Both were
 * internally correct; they were simply answering different questions.
 *
 * Order of preference:
 *   1. What the user typed. Always wins, including a deliberate 0.
 *   2. A previously saved thrift price on the flip.
 *   3. The AI's suggested buy price, as a starting assumption.
 *   4. 0 — profit then equals the full resale value, which is honest for an
 *      item the user has not priced yet.
 */
export function resolveEffectiveThriftPrice(opts: {
  /** Raw text from the input field, if the user is editing. */
  entered?: string | number | null;
  /** Price already stored on the flip, if any. */
  stored?: number | null;
  /** The AI's suggested_buy_price, used only as a starting point. */
  suggested?: number | null;
}): number {
  const parse = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // A typed 0 is a real answer — some thrift finds are free — so this checks
  // for null rather than falsiness.
  const entered = parse(opts.entered);
  if (entered !== null) return entered;

  const stored = parse(opts.stored);
  if (stored !== null && stored > 0) return stored;

  const suggested = parse(opts.suggested);
  if (suggested !== null && suggested > 0) return suggested;

  return 0;
}

export function computeFlipCalc(
  resaleValue:      number,
  thriftPrice:      number,
  matchConfidence:  number,
  competitionLevel: string,
  styleLabels:      string[],
  era:              string,
  demandLevel:      string = '',
  sellSpeed:        string = '',
  /** Canonical V1 risk signals. Optional so v0 scans and existing callers keep
   *  working — they simply carry fewer risk factors. */
  v1Signals: {
    buyerPool?: string;
    hasObviousDamage?: boolean;
    eraUnconfirmed?: boolean;
  } = {},
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
    buyerPool:        v1Signals.buyerPool,
    hasObviousDamage: v1Signals.hasObviousDamage,
    eraUnconfirmed:   v1Signals.eraUnconfirmed,
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