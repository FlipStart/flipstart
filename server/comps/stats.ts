/**
 * server/comps/stats.ts
 *
 * Comps statistics and confidence.
 *
 * MEDIAN, never mean. eBay sold data has a long right tail — one mispriced
 * bundle or a graded collectible drags a mean far above what anything actually
 * sells for, and a reseller acting on that mean overpays.
 *
 * Statistics run on soldPrice ONLY. Shipping is reported separately: a $20 tee
 * with $6 shipping is not a $26 tee.
 */
import type { NormalizedSoldComp } from "./types.js";
import type { ScoredComp } from "./matching.js";

export interface CompsStats {
  sampleSize: number;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  /** Median of shipping where stated. Never folded into the price stats. */
  medianShipping: number | null;
  /** Days between oldest and newest sale in the accepted set. */
  spanDays: number | null;
  outliersRemoved: number;
  bestOfferShare: number;
}

export type CompsConfidence = "high" | "medium" | "low" | "insufficient";

export interface CompsSummary {
  stats: CompsStats | null;
  confidence: CompsConfidence;
  confidenceReasons: string[];
  medianMatchScore: number;
  usable: boolean;
}

const q = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * IQR outlier removal.
 *
 * Chosen over standard deviation because SD assumes a symmetric distribution
 * and resale prices are not symmetric — the tail would widen SD enough to keep
 * the very outliers it is meant to remove.
 */
function withoutOutliers(prices: number[]): { kept: number[]; removed: number } {
  if (prices.length < 6) return { kept: prices, removed: 0 };
  const s = [...prices].sort((a, b) => a - b);
  const iqr = q(s, 0.75) - q(s, 0.25);
  const lo = q(s, 0.25) - 1.5 * iqr;
  const hi = q(s, 0.75) + 1.5 * iqr;
  const kept = s.filter(p => p >= lo && p <= hi);
  return { kept: kept.length >= 3 ? kept : s, removed: s.length - kept.length };
}

export function computeStats(comps: NormalizedSoldComp[]): CompsStats | null {
  if (comps.length === 0) return null;
  const raw = comps.map(c => c.soldPrice).filter(p => p > 0);
  if (raw.length === 0) return null;

  const { kept, removed } = withoutOutliers(raw);
  const s = [...kept].sort((a, b) => a - b);
  const ship = comps.map(c => c.shippingPrice).filter((v): v is number => v != null && v >= 0).sort((a, b) => a - b);
  const dates = comps.map(c => c.soldAt).filter((d): d is string => !!d).sort();
  const spanDays = dates.length >= 2
    ? Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000)
    : null;
  const bo = comps.filter(c => c.bestOfferAccepted === true).length;

  return {
    sampleSize: s.length,
    median: Math.round(q(s, 0.5) * 100) / 100,
    mean: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 100) / 100,
    p25: Math.round(q(s, 0.25) * 100) / 100,
    p75: Math.round(q(s, 0.75) * 100) / 100,
    min: s[0], max: s[s.length - 1],
    medianShipping: ship.length ? Math.round(q(ship, 0.5) * 100) / 100 : null,
    spanDays,
    outliersRemoved: removed,
    bestOfferShare: comps.length ? Math.round((bo / comps.length) * 100) / 100 : 0,
  };
}

/**
 * Confidence from sample size, match quality and price dispersion.
 *
 * Dispersion matters as much as count: forty comps spread from $5 to $400 are
 * not forty comps for the same thing, and reporting a confident median from
 * them would be worse than reporting nothing.
 */
export function summarize(scored: ScoredComp[]): CompsSummary {
  const accepted = scored.filter(s => s.accepted);
  const stats = computeStats(accepted.map(s => s.comp));
  const scores = accepted.map(s => s.score).sort((a, b) => a - b);
  const medianMatchScore = scores.length ? Math.round(q(scores, 0.5)) : 0;
  const reasons: string[] = [];

  if (!stats || accepted.length < 3) {
    reasons.push(`only ${accepted.length} usable comps`);
    return { stats, confidence: "insufficient", confidenceReasons: reasons, medianMatchScore, usable: false };
  }

  const spread = stats.median > 0 ? (stats.p75 - stats.p25) / stats.median : 99;
  let confidence: CompsConfidence;
  if (accepted.length >= 12 && medianMatchScore >= 70 && spread <= 0.6) {
    confidence = "high";
  } else if (accepted.length >= 6 && medianMatchScore >= 55 && spread <= 1.0) {
    confidence = "medium";
  } else {
    confidence = "low";
  }
  reasons.push(`${accepted.length} comps`, `median match ${medianMatchScore}`,
               `IQR spread ${(spread * 100).toFixed(0)}% of median`);
  if (stats.outliersRemoved) reasons.push(`${stats.outliersRemoved} outliers removed`);

  // `confidence` cannot be "insufficient" on this path — the early return above
  // owns that case — so usability here is simply true.
  return { stats, confidence, confidenceReasons: reasons, medianMatchScore, usable: true };
}