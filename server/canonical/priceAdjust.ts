/**
 * server/canonical/priceAdjust.ts
 *
 * Deterministic post-analysis price adjustment.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 * buildPricing() was a pure pass-through of ai.pricing.ai_estimated_resale_range
 * with `adjustments: []` hardcoded. There was NO code path by which a condition
 * defect or a confirmed era could move the number. A user could type "big tear
 * in the sleeve", watch the rating drop to RISKY BUY, and see the resale
 * estimate sit unchanged — because the rating reads condition and the price
 * never did.
 *
 * The model is asked to price with condition and era in mind, and sometimes
 * does. But "sometimes" is not a pricing system. This applies the deduction
 * deterministically so the same defect always moves the number the same way.
 *
 * ── Why percentages, not flat dollars ─────────────────────────────────────────
 * A broken zipper costs roughly a third of a jacket's value whether the jacket
 * is $30 or $300. A flat deduction would erase a cheap item and barely scratch
 * an expensive one.
 */
import type {
  AiAnalysis, DerivedConditionSummary,
} from "../../shared/canonical.types.js";

export interface PriceAdjustment {
  reason: string;
  impact: number;
  source: "server";
}

/** Severity bands. Starting points, then modulated by category. */
const BAND: Record<string, number> = {
  minor:    0.12,   // light stain, minor cracking, ordinary meaningful wear
  moderate: 0.25,   // noticeable stain, small hole, damaged graphic
  major:    0.38,   // tear, broken zipper, missing component
  unknown:  0.15,
};

/** Defect types that hit harder than their severity label suggests, because
 *  they break the garment's function rather than its appearance. */
const FUNCTIONAL = new Set([
  "broken_hardware", "broken_zipper", "missing_component", "tear", "hole",
]);

/** Total deduction ceiling. Past this the item is not really sellable and the
 *  estimate stops being meaningful. */
const MAX_TOTAL = 0.65;

/** Photo-derived findings need real certainty to move money. User-confirmed
 *  findings do not — the user was holding the item. */
const PHOTO_CERTAINTY_FLOOR = 80;

/**
 * Category modulation.
 *
 * A small hole guts a plain tee and barely registers on distressed workwear
 * that is supposed to look worn. Multipliers, not separate tables, so the
 * severity bands stay the single source of truth.
 */
function categoryFactor(ai: AiAnalysis, defectType: string): number {
  const item = `${ai.identification.item_type} ${ai.identification.subtype}`.toLowerCase();
  const styles = ai.visible_attributes.style_labels.join(" ").toLowerCase();

  // Intentionally distressed pieces absorb cosmetic wear.
  if (/distress|workwear|carhartt|dickies/.test(`${item} ${styles}`) &&
      !FUNCTIONAL.has(defectType)) {
    return 0.6;
  }
  // Plain basics have no story to carry a flaw; buyers simply pick another.
  if (/\b(tee|t-shirt|polo|basic)\b/.test(item)) return 1.15;
  // Outerwear lives or dies on its closures.
  if (/\b(jacket|coat|parka|vest)\b/.test(item) && FUNCTIONAL.has(defectType)) {
    return 1.2;
  }
  return 1.0;
}

/**
 * Combine multiple defects without double counting.
 *
 * The worst defect takes its full deduction; each additional one adds a third
 * of its own. Summing them outright would send two moderate flaws past 50%,
 * which overstates how buyers actually price a garment with a couple of issues.
 */
export function conditionAdjustments(
  ai: AiAnalysis,
  condition: DerivedConditionSummary,
): PriceAdjustment[] {
  const usable = condition.obvious_findings.filter(f =>
    f.photo_slot === "user_confirmed" || f.certainty >= PHOTO_CERTAINTY_FLOOR,
  );
  if (usable.length === 0) return [];

  const scored = usable.map(f => {
    const base = BAND[f.severity] ?? BAND.unknown;
    const fn = FUNCTIONAL.has(f.type) ? 1.25 : 1.0;
    return { f, pct: Math.min(0.6, base * fn * categoryFactor(ai, f.type)) };
  }).sort((a, b) => b.pct - a.pct);

  const out: PriceAdjustment[] = [];
  let total = 0;
  scored.forEach(({ f, pct }, i) => {
    const applied = i === 0 ? pct : pct / 3;
    if (total + applied > MAX_TOTAL) return;
    total += applied;
    const src = f.photo_slot === "user_confirmed" ? "user-confirmed" : "visible";
    out.push({
      reason: `Reduced for ${src} ${f.type.replace(/_/g, " ")}${f.location ? ` at ${f.location}` : ""}`,
      impact: -Math.round(applied * 100) / 100,
      source: "server",
    });
  });
  return out;
}