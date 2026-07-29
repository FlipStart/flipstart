/**
 * CanonicalAnalysisV1 -> legacy response shape.
 *
 * The shipped app reads `{identification, market_data, risk_analysis, listings}`
 * and spreads those straight into its own state. Returning only the canonical
 * object makes every field fall back to its default — "Unknown Item", $0,
 * SKIP — which is what a V1 scan looks like on the current build.
 *
 * Emitting BOTH shapes means the existing App Store build renders a V1 scan
 * correctly with no client change and no EAS build, while `canonical` rides
 * along for the new screens to consume once they exist. The adapter is deleted
 * when the client reads canonical directly.
 *
 * This is a projection, not a second source of truth. Every value here is
 * derived from the canonical object; nothing is recomputed or invented.
 */
import type { CanonicalAnalysisV1 } from "../../shared/canonical.types.js";

export interface LegacyShape {
  identification: {
    item_name: string;
    brand: string;
    category: string;
    estimated_era: string;
    style_labels: string[];
    material_guess: string;
    [k: string]: unknown;
  };
  market_data: {
    estimated_resale_range: { low: number; high: number };
    average_sold_price: number;
    suggested_buy_price: number;
    demand: string;
    sell_speed: string;
    competition_level: string;
    base_estimated_value: number;
    price_adjustments: Array<{ reason: string; impact: number; type: "positive" | "negative" }>;
    adjusted_estimated_value: number;
  };
  risk_analysis: { match_confidence: number; risk_flags: string[] };
  listings: { ebay_title: string; depop_title: string; description: string };
}

/** Legacy UI expects Title Case for these; canonical uses lowercase enums. */
const DEMAND: Record<string, string> = {
  high: "High", moderate: "Medium", low: "Low", very_low: "Low", unknown: "Medium",
};
const SPEED: Record<string, string> = {
  fast: "Fast", moderate: "Moderate", slow: "Slow", very_slow: "Slow", unknown: "Moderate",
};
const COMPETITION: Record<string, string> = {
  low: "Low", moderate: "Moderate", high: "High", unknown: "Moderate",
};

export function toLegacyShape(c: CanonicalAnalysisV1): LegacyShape {
  const ai = c.ai;
  const d = c.derived;

  // The validated display title — includes a Vintage/Y2K prefix only when the
  // evidence earned it. Never the raw model name.
  const itemName = d.identification.display_item_name || ai.identification.generic_item_name;

  // Era as human text. estimated_era_range is display-only by design; fall back
  // to the validated status so the field is never blank.
  const eraText =
    ai.era.estimated_era_range ||
    (d.era_effective.status === "modern" ? "Modern"
      : d.era_effective.status === "confirmed_vintage" ? "Vintage"
      : d.era_effective.status === "likely_vintage" ? "Likely vintage"
      : d.era_effective.status === "vintage_inspired" ? "Modern, vintage-inspired"
      : "Unknown");

  // Pricing. Null is a real state — the legacy UI has no way to express it, so
  // 0 is the honest projection and the SKIP rating that follows is correct.
  const low = d.pricing.resale_low ?? 0;
  const high = d.pricing.resale_high ?? 0;
  const point = d.pricing.resale_point ?? 0;

  // Legacy screens show risk_flags directly. Fold in the reasons a user would
  // want to see, without duplicating anything already flagged.
  const flags = [...ai.risks.risk_flags];
  for (const f of d.condition_summary.obvious_findings) {
    const line = `${f.type.replace(/_/g, " ")} — ${f.location}`;
    if (!flags.some(x => x.toLowerCase().includes(f.type.replace(/_/g, " ")))) flags.push(line);
  }
  if (d.pricing.estimate_unavailable) flags.push("No reliable resale estimate for this item");

  return {
    identification: {
      item_name: itemName,
      brand: ai.identification.canonical_brand || "Unknown",
      category: ai.identification.broad_category || "Other",
      estimated_era: eraText,
      style_labels: ai.visible_attributes.style_labels ?? [],
      material_guess: ai.visible_attributes.material_composition.join(", ") || "Unknown",
      // Extra fields the old `structured` block carried. Harmless to the legacy
      // reader (it spreads whatever it gets) and useful while debugging.
      canonicalBrand: ai.identification.canonical_brand,
      canonicalItemName: itemName,
      itemType: ai.identification.item_type,
      subType: ai.identification.subtype,
      eraEstimate: eraText,
      eraConfidence: d.era_effective.confidence,
      eraEvidence: d.era_effective.evidence.map(e => e.observation),
      sportsTeam: ai.identification.team,
      logoPlacement: ai.features.logo_placement,
      size_label: ai.visible_attributes.size_label,
    },
    market_data: {
      estimated_resale_range: { low, high },
      // NOT a sold comp. Named for the legacy field only; no comps exist yet.
      average_sold_price: point,
      suggested_buy_price: Math.max(0, Math.round(point * 0.3)),
      demand: DEMAND[ai.marketability.sell_likelihood] ?? "Medium",
      sell_speed: SPEED[ai.marketability.expected_sell_speed] ?? "Moderate",
      competition_level: COMPETITION[ai.marketability.competition_level] ?? "Moderate",
      base_estimated_value: point,
      price_adjustments: [],
      adjusted_estimated_value: point,
    },
    risk_analysis: {
      match_confidence: ai.identification.identity_confidence,
      risk_flags: flags.slice(0, 3),
    },
    listings: {
      ebay_title: itemName,
      depop_title: itemName,
      description: ai.pricing.pricing_basis[0] ?? "",
    },
  };
}