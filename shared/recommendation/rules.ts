/**
 * The buy/skip decision. One implementation, used by both server and client.
 *
 * Framework-neutral on purpose: no fetch, no react-native, no node: imports.
 * esbuild bundles it for the server, Metro bundles it for the app, and both get
 * the same answer for the same input. That is what lets the thrift-price field
 * recompute on every keystroke with no network call.
 *
 * The AI never chooses the label. It supplies observations; this decides.
 */
import type { CanonicalAnalysisV1 } from "../canonical.types.js";
import { reason, longReason, type Reason, type ReasonCode } from "./reasons.js";
import { RECOMMENDATION_MODULE_VERSION } from "./version.js";
import type { RecommendationInput, RecommendationResult } from "./types.js";

/** Blended marketplace take. eBay ~13%, Depop ~10%. */
const FEE_RATE = 0.12;

/** Below this, a "profit" is not worth the handling and shipping effort. */
const THIN_MARGIN = 8;
const STRONG_MARGIN = 35;
const HEALTHY_MARGIN = 15;

export function computeRecommendation(input: RecommendationInput): RecommendationResult {
  const { canonical, thriftPrice, settings } = input;
  const d = canonical.derived;
  const ai = canonical.ai;

  const minProfit = settings?.minProfit ?? THIN_MARGIN;
  const reasons: Reason[] = [];
  const deep: Reason[] = [];
  const add = (c: ReasonCode) => { reasons.push(reason(c)); deep.push(longReason(c)); };

  // ── No usable estimate ──────────────────────────────────────────────────────
  // Null is a real state, not zero. STRONG_BUY and BUY are impossible without a
  // number, and inventing one would be worse than saying so.
  if (d.pricing.estimate_unavailable || d.pricing.resale_point == null) {
    add("NO_PRICE_ESTIMATE");
    if (d.condition_summary.has_obvious_damage) add("OBVIOUS_DAMAGE");
    const hopeless =
      d.condition_summary.has_obvious_damage &&
      (ai.marketability.sell_likelihood === "low" ||
       ai.marketability.sell_likelihood === "very_low");
    return {
      label: hopeless ? "SKIP" : "RISKY_BUY",
      reasons,
      riskyDisclaimer: hopeless ? "" : disclaimerFor(reasons),
      deepAnalysisReasons: deep,
      economics: { fees: null, profit: null, roi: null, maxBuyPrice: null },
      moduleVersion: RECOMMENDATION_MODULE_VERSION,
    };
  }

  // ── Economics ───────────────────────────────────────────────────────────────
  const resale = d.pricing.resale_point;
  const fees = Math.round(resale * FEE_RATE);
  const profit = Math.round(resale - fees - thriftPrice);
  const roi = thriftPrice > 0 ? Math.round((profit / thriftPrice) * 100) : (profit > 0 ? 999 : 0);
  const maxBuyPrice = Math.max(0, Math.round(resale - fees - minProfit));

  const economics = { fees, profit, roi, maxBuyPrice };
  const finish = (label: RecommendationResult["label"]): RecommendationResult => ({
    label, reasons,
    riskyDisclaimer: label === "RISKY_BUY" ? disclaimerFor(reasons) : "",
    deepAnalysisReasons: deep,
    economics,
    moduleVersion: RECOMMENDATION_MODULE_VERSION,
  });

  // ── Hard stops ──────────────────────────────────────────────────────────────
  if (profit < 0) { add("NEGATIVE_MARGIN"); return finish("SKIP"); }

  const slow = ai.marketability.expected_sell_speed === "slow" ||
               ai.marketability.expected_sell_speed === "very_slow";
  const lowLikelihood = ai.marketability.sell_likelihood === "low" ||
                        ai.marketability.sell_likelihood === "very_low";
  const narrow = ai.marketability.buyer_pool === "narrow" ||
                 ai.marketability.buyer_pool === "very_narrow";
  const highComp = ai.marketability.competition_level === "high";
  const lowIdentity = ai.identification.identity_confidence < 55;
  const lowPrice = ai.pricing.price_confidence < 50;
  const eraUncertain = d.era_effective.status === "unknown" && ai.era.era_evidence.length > 0;
  const authConcern = ai.risks.authenticity_concerns.length > 0;

  if (profit < minProfit) {
    add("THIN_MARGIN");
    if (slow) add("SLOW_SELL");
    return finish("SKIP");
  }

  // ── Obvious damage blocks STRONG_BUY and BUY outright ───────────────────────
  // Only obvious findings do this. A low-certainty "possible stain" is
  // informational and must not downgrade a good item — a false damage warning
  // costs more trust than a missed one costs money.
  if (d.condition_summary.has_obvious_damage) {
    add("OBVIOUS_DAMAGE");
    const unviable = (slow && lowLikelihood) || profit < minProfit * 2 ||
                     d.condition_summary.max_obvious_severity === "major";
    if (slow) add("SLOW_SELL");
    if (lowLikelihood) add("LOW_SELL_LIKELIHOOD");
    return finish(unviable ? "SKIP" : "RISKY_BUY");
  }

  // ── Risk signals — any one forces RISKY_BUY at best ─────────────────────────
  let risky = false;
  if (slow)         { add("SLOW_SELL"); risky = true; }
  if (lowLikelihood){ add("LOW_SELL_LIKELIHOOD"); risky = true; }
  if (narrow)       { add("NARROW_BUYER_POOL"); risky = true; }
  if (highComp)     { add("HIGH_COMPETITION"); risky = true; }
  if (lowIdentity)  { add("LOW_IDENTITY_CONFIDENCE"); risky = true; }
  if (lowPrice)     { add("LOW_PRICE_CONFIDENCE"); risky = true; }
  if (eraUncertain) { add("ERA_UNCERTAIN"); risky = true; }
  if (authConcern)  { add("AUTHENTICITY_CONCERN"); risky = true; }

  if (risky) {
    const unviable = profit < minProfit * 2 && (slow || lowLikelihood);
    return finish(unviable ? "SKIP" : "RISKY_BUY");
  }

  // ── Positive path ───────────────────────────────────────────────────────────
  if (d.era_effective.status === "confirmed_vintage") add("CONFIRMED_VINTAGE");
  if (ai.marketability.expected_sell_speed === "fast") add("FAST_SELL");
  if (ai.identification.identity_confidence >= 80) add("HIGH_CONFIDENCE");
  if (d.condition_summary.assessment_limited) add("CONDITION_UNASSESSED");

  if (profit >= STRONG_MARGIN && ai.identification.identity_confidence >= 70) {
    add("STRONG_MARGIN");
    return finish("STRONG_BUY");
  }
  if (profit >= HEALTHY_MARGIN) { add("HEALTHY_MARGIN"); return finish("BUY"); }
  // Above the minimum but below a comfortable margin. Still a BUY, but say so
  // accurately rather than calling $8 a healthy margin.
  add("THIN_MARGIN");
  return finish("BUY");
}

/** One sentence under the rating card. Names the two most important reasons
 *  rather than listing everything. */
function disclaimerFor(reasons: Reason[]): string {
  const priority: ReasonCode[] = [
    "OBVIOUS_DAMAGE", "NO_PRICE_ESTIMATE", "AUTHENTICITY_CONCERN",
    "LOW_IDENTITY_CONFIDENCE", "SLOW_SELL", "LOW_SELL_LIKELIHOOD",
    "NARROW_BUYER_POOL", "ERA_UNCERTAIN", "HIGH_COMPETITION", "LOW_PRICE_CONFIDENCE",
  ];
  const picked = priority
    .filter(c => reasons.some(r => r.code === c))
    .slice(0, 2)
    .map(c => reasons.find(r => r.code === c)!.text.toLowerCase());
  if (!picked.length) return "This one carries more uncertainty than usual.";
  return `Could still be profitable, but ${picked.join(" and ")}.`;
}

/**
 * Highest price at which the rating still holds at BUY or better.
 * Pure, so the client can run it in a loop as the user types.
 */
export function findMaxBuyPriceForRating(
  canonical: CanonicalAnalysisV1,
  settings?: RecommendationInput["settings"],
): number | null {
  const resale = canonical.derived.pricing.resale_point;
  if (resale == null) return null;
  for (let price = Math.floor(resale); price >= 0; price--) {
    const r = computeRecommendation({ canonical, thriftPrice: price, settings });
    if (r.label === "BUY" || r.label === "STRONG_BUY") return price;
  }
  return 0;
}