/**
 * server/comps/evaluate.ts
 *
 * Search-level evaluation: reliable sample, sufficiency, dispersion, confidence,
 * and — the point of this file — which numbers may be SHOWN.
 *
 * ── The failure this exists to prevent ────────────────────────────────────────
 * Two comps at $30 and $100 produced a displayed median of $65 and a range of
 * $47-$83. summarize() correctly called the sample "insufficient" and then
 * returned the statistics anyway, and the screen rendered them because it
 * checked whether stats EXISTED rather than whether they were trustworthy.
 *
 * So eligibility is computed here and the public numbers are null when they are
 * not earned. A consumer cannot render a suppressed median by mistake, because
 * there is nothing in the field to render.
 *
 * ── Listing quality vs search quality ────────────────────────────────────────
 * One excellent match is not a market. Ninety poor matches are not a market
 * either. These are separate questions and this file keeps them separate.
 */
import type { ScoredComp } from "./matching.js";
import { computeStats, type CompsStats } from "./stats.js";

/** Bumped when the meaning of the statistics changes. Part of the cache key. */
export const STATS_VERSION = "stats-2";

export type ResultState = "strong" | "moderate" | "limited" | "weak" | "insufficient";
export type ConfidenceLabel = "high" | "moderate" | "low" | "insufficient";
export type DispersionClass = "tight" | "moderate" | "wide" | "extreme" | "unknown";

export type SuppressionReason =
  | "NO_RELIABLE_MATCHES"
  | "SAMPLE_TOO_SMALL_FOR_MEDIAN"
  | "SAMPLE_TOO_SMALL_FOR_RANGE"
  | "MATCH_QUALITY_TOO_LOW"
  | "PRICE_DISPERSION_TOO_HIGH"
  | "INVALID_PRICE_SAMPLE";

/** Public display needs at least this many reliable comps for a median. Below
 *  three, a "median" is just one of the two prices, or their midpoint. */
const MIN_FOR_MEDIAN = 3;
/** Q1-Q3 needs enough points for quartiles to mean anything. */
const MIN_FOR_RANGE = 5;

export interface CompsEvaluation {
  statsVersion: string;

  // ── Counts, deliberately not collapsed into one "sold" number ──────────────
  counts: {
    raw: number;
    normalized: number;
    rejected: number;
    weak: number;
    moderate: number;
    strong: number;
    reliable: number;
    duplicatesRemoved: number;
    outliersRemoved: number;
    finalSample: number;
  };

  // ── What a normal user may see. Null means "not earned" ────────────────────
  public: {
    medianSoldPrice: number | null;
    typicalLow: number | null;
    typicalHigh: number | null;
    medianShipping: number | null;
    reliableMatchCount: number;
    canShowMedian: boolean;
    canShowTypicalRange: boolean;
    limitedSample: boolean;
    statisticsSuppressedReason: SuppressionReason | null;
  };

  /** Founder-only. Always computed, never rendered by the app. Named `debug`
   *  precisely so reading it from a UI path looks wrong. */
  debug: {
    stats: CompsStats | null;
    medianMatchScore: number;
    topMatchScore: number;
    strongSharePercent: number;
    iqrOverMedian: number | null;
    dispersion: DispersionClass;
    outliers: Array<{ price: number; reason: "PRICE_OUTLIER" }>;
  };

  confidencePercent: number;
  confidenceLabel: ConfidenceLabel;
  confidenceComponents: {
    matchQuality: number;      // /40
    sampleSize: number;        // /25
    priceConsistency: number;  // /25
    dataCompleteness: number;  // /10
  };
  confidencePenalties: string[];

  resultState: ResultState;

  summary: {
    reviewedCount: number;
    filteredOutCount: number;
    possibleMatchCount: number;
    reliableMatchCount: number;
    summaryText: string;
  };

  statsMs: number;
}

const pct = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * Duplicate removal beyond the matcher's external-id check.
 *
 * Conservative on purpose: two genuine sales of the same item at the same price
 * are two data points, so title+price alone is not enough. Collapsing them would
 * understate a real market. Requires the same URL, or the same title AND price
 * AND date.
 */
function dedupe(comps: ScoredComp[]): { kept: ScoredComp[]; removed: number } {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenTriples = new Set<string>();
  const kept: ScoredComp[] = [];
  let removed = 0;
  for (const s of comps) {
    const c = s.comp;
    const triple = `${c.title.toLowerCase()}|${c.soldPrice}|${c.soldAt ?? ""}`;
    if (seenIds.has(c.externalId) ||
        (c.listingUrl && seenUrls.has(c.listingUrl)) ||
        (c.soldAt && seenTriples.has(triple))) {
      removed++; continue;
    }
    seenIds.add(c.externalId);
    if (c.listingUrl) seenUrls.add(c.listingUrl);
    if (c.soldAt) seenTriples.add(triple);
    kept.push(s);
  }
  return { kept, removed };
}

/**
 * Price validity. Statistics run on the ITEM price only.
 *
 * A best offer with `bestOfferAccepted === true` carries the accepted amount per
 * the provider docs, so it is exact and admissible. Everything unverifiable is
 * excluded rather than guessed at.
 */
function validForStats(s: ScoredComp): boolean {
  const c = s.comp;
  if (!Number.isFinite(c.soldPrice) || c.soldPrice <= 0) return false;
  if (c.currency && c.currency !== "USD") return false;
  return true;
}

/** IQR trimming, only once the sample can afford it. */
function trimOutliers(prices: number[]): { kept: number[]; removed: number[] } {
  if (prices.length < MIN_FOR_RANGE) return { kept: prices, removed: [] };
  const s = [...prices].sort((a, b) => a - b);
  const iqr = pct(s, 0.75) - pct(s, 0.25);
  if (iqr === 0) return { kept: s, removed: [] };
  const lo = pct(s, 0.25) - 1.5 * iqr;
  const hi = pct(s, 0.75) + 1.5 * iqr;
  const kept = s.filter(p => p >= lo && p <= hi);
  // Never trim below the range minimum — a trimmed-to-nothing sample is worse
  // than an untrimmed one.
  if (kept.length < MIN_FOR_RANGE) return { kept: s, removed: [] };
  return { kept, removed: s.filter(p => p < lo || p > hi) };
}

function classifyDispersion(iqrOverMedian: number | null): DispersionClass {
  if (iqrOverMedian == null || !Number.isFinite(iqrOverMedian)) return "unknown";
  if (iqrOverMedian <= 0.30) return "tight";
  if (iqrOverMedian <= 0.60) return "moderate";
  if (iqrOverMedian <= 1.00) return "wide";
  return "extreme";
}

export function evaluateComps(
  scored: ScoredComp[],
  rawCount: number,
): CompsEvaluation {
  const t0 = Date.now();
  const penalties: string[] = [];

  const rejected = scored.filter(s => !s.accepted && !s.weak);
  const weakAll = scored.filter(s => s.weak);
  const acceptedAll = scored.filter(s => s.accepted);

  // Reliable sample = accepted, deduped, price-valid. Weak candidates never
  // enter it, however many of them there are.
  const { kept: deduped, removed: duplicatesRemoved } = dedupe(acceptedAll);
  const reliable = deduped.filter(validForStats);
  const invalidDropped = deduped.length - reliable.length;
  if (invalidDropped > 0) penalties.push(`${invalidDropped} listings had unusable prices`);
  if (duplicatesRemoved > 0) penalties.push(`${duplicatesRemoved} duplicate listings removed`);

  const strong = reliable.filter(s => s.matchClass === "strong");
  const moderate = reliable.filter(s => s.matchClass === "moderate");

  const scores = reliable.map(s => s.score).sort((a, b) => a - b);
  const medianMatchScore = scores.length ? Math.round(pct(scores, 0.5)) : 0;
  const topMatchScore = scores.length ? scores[scores.length - 1] : 0;
  const strongShare = reliable.length ? Math.round((strong.length / reliable.length) * 100) : 0;

  // ── Outliers, applied AFTER relevance filtering ────────────────────────────
  const rawPrices = reliable.map(s => s.comp.soldPrice);
  const { kept: trimmed, removed: outlierPrices } = trimOutliers(rawPrices);
  if (outlierPrices.length > 0) penalties.push(`${outlierPrices.length} price outliers removed`);

  const finalComps = reliable.filter(s => trimmed.includes(s.comp.soldPrice));
  const stats = computeStats(finalComps.map(s => s.comp));
  const n = trimmed.length;

  const iqrOverMedian = stats && stats.median > 0 ? (stats.p75 - stats.p25) / stats.median : null;
  const dispersion = classifyDispersion(iqrOverMedian);
  if (dispersion === "wide") penalties.push("prices are widely spread");
  if (dispersion === "extreme") penalties.push("prices are extremely spread — likely mixed variants");

  // ── Confidence, from measurable parts ──────────────────────────────────────
  // Match quality /40.
  const mq = n === 0 ? 0 : Math.min(40,
    (Math.max(0, medianMatchScore - 60) / 40) * 26 +   // 60-100 maps to 0-26
    (strongShare / 100) * 14);
  // Sample size /25, with a ceiling so volume alone cannot buy confidence.
  const ss = n === 0 ? 0 : n === 1 ? 3 : n === 2 ? 6 : n <= 4 ? 12 : n <= 9 ? 19 : 25;
  // Price consistency /25.
  const pc = n < 2 || iqrOverMedian == null ? 0
    : dispersion === "tight" ? 25 : dispersion === "moderate" ? 17
    : dispersion === "wide" ? 8 : 2;
  // Data completeness /10.
  const withDates = finalComps.filter(s => s.comp.soldAt).length;
  const dc = n === 0 ? 0 : Math.round(
    6 * (withDates / Math.max(1, n)) +
    4 * (1 - Math.min(1, (duplicatesRemoved + invalidDropped) / Math.max(1, acceptedAll.length))));

  let confidencePercent = Math.max(0, Math.min(100, Math.round(mq + ss + pc + dc)));

  // Sufficiency OVERRIDES the percentage. A single 98-score match is a great
  // listing and not a market, so it cannot present as high confidence.
  if (n < MIN_FOR_MEDIAN) confidencePercent = Math.min(confidencePercent, 35);
  if (n === 0) confidencePercent = 0;

  const confidenceLabel: ConfidenceLabel =
    n === 0 ? "insufficient"
    : confidencePercent >= 75 ? "high"
    : confidencePercent >= 50 ? "moderate"
    : confidencePercent >= 20 ? "low" : "insufficient";

  // ── Public eligibility ─────────────────────────────────────────────────────
  let suppressed: SuppressionReason | null = null;
  let canShowMedian = false;
  let canShowTypicalRange = false;

  if (n === 0) suppressed = "NO_RELIABLE_MATCHES";
  else if (n < MIN_FOR_MEDIAN) suppressed = "SAMPLE_TOO_SMALL_FOR_MEDIAN";
  else if (medianMatchScore < 70) suppressed = "MATCH_QUALITY_TOO_LOW";
  else {
    canShowMedian = true;
    if (n < MIN_FOR_RANGE) suppressed = "SAMPLE_TOO_SMALL_FOR_RANGE";
    else if (dispersion === "extreme") suppressed = "PRICE_DISPERSION_TOO_HIGH";
    else canShowTypicalRange = true;
  }
  const limitedSample = canShowMedian && n < MIN_FOR_RANGE;

  const resultState: ResultState =
    n === 0 ? "insufficient"
    : n >= MIN_FOR_RANGE && confidencePercent >= 75 ? "strong"
    : n >= MIN_FOR_RANGE && canShowMedian ? "moderate"
    : n <= 4 && n >= 1 ? "limited"
    : "weak";

  const filteredOut = rawCount - reliable.length;
  const summaryText =
    n === 0
      ? `${rawCount} sold listings reviewed · no reliable matches`
      : n < MIN_FOR_MEDIAN
        ? `${rawCount} sold listings reviewed · ${n} possible ${n === 1 ? "match" : "matches"}`
        : `${rawCount} sold listings reviewed · ${filteredOut} filtered out · ${n} reliable matches`;

  return {
    statsVersion: STATS_VERSION,
    counts: {
      raw: rawCount, normalized: scored.length, rejected: rejected.length,
      weak: weakAll.length, moderate: moderate.length, strong: strong.length,
      reliable: reliable.length, duplicatesRemoved,
      outliersRemoved: outlierPrices.length, finalSample: n,
    },
    public: {
      medianSoldPrice: canShowMedian ? stats?.median ?? null : null,
      typicalLow: canShowTypicalRange ? stats?.p25 ?? null : null,
      typicalHigh: canShowTypicalRange ? stats?.p75 ?? null : null,
      medianShipping: canShowMedian ? stats?.medianShipping ?? null : null,
      reliableMatchCount: n,
      canShowMedian, canShowTypicalRange, limitedSample,
      statisticsSuppressedReason: suppressed,
    },
    debug: {
      stats, medianMatchScore, topMatchScore, strongSharePercent: strongShare,
      iqrOverMedian: iqrOverMedian == null ? null : Math.round(iqrOverMedian * 100) / 100,
      dispersion,
      outliers: outlierPrices.map(p => ({ price: p, reason: "PRICE_OUTLIER" as const })),
    },
    confidencePercent,
    confidenceLabel,
    confidenceComponents: {
      matchQuality: Math.round(mq), sampleSize: ss,
      priceConsistency: pc, dataCompleteness: dc,
    },
    confidencePenalties: penalties,
    resultState,
    summary: {
      reviewedCount: rawCount,
      filteredOutCount: Math.max(0, filteredOut),
      possibleMatchCount: acceptedAll.length,
      reliableMatchCount: n,
      summaryText,
    },
    statsMs: Date.now() - t0,
  };
}