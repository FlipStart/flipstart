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
    /** Canonical values the legacy shape has no field for. Spread through by
     *  loading.tsx and read by the screens via flip.structured?.v1. */
    v1?: Record<string, unknown>;
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
  risk_analysis: {
    match_confidence: number;
    risk_flags: string[];
    /** The AI's own risky-buy reasoning. The old deep-analysis screen invented
     *  its own justification from templates; passing these through lets it use
     *  the model's actual reasons instead. */
    risky_buy_reasons: string[];
  };
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

  /**
   * Everything the model observed on one photo, gathered from the structured
   * evidence objects that each carry a photo_slot. Replaces the removed
   * front/tag/detail_evidence arrays — same information, but sourced from the
   * evidence validation actually operates on rather than a parallel copy.
   */
  const bySlot = (slot: "front" | "tag" | "detail"): string[] => {
    const out: string[] = [];
    for (const e of ai.identification.identification_evidence) {
      if (e.photo_slot === slot) out.push(e.observation);
    }
    for (const e of ai.photo_evidence.observable_field_evidence) {
      if (e.photo_slot === slot) out.push(e.observation);
    }
    for (const e of ai.era.era_evidence) {
      if (e.photo_slot === slot) out.push(e.observation);
    }
    for (const f of ai.condition.condition_findings) {
      if (f.photo_slot === slot) out.push(f.evidence);
    }
    // De-duplicate: one physical detail can legitimately support both an
    // identity claim and an era claim, and the user should see it once.
    return [...new Set(out.map(s => s.trim()).filter(Boolean))].slice(0, 8);
  };

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
      // Per-photo evidence for "What the AI Saw", now DERIVED by grouping the
      // structured evidence by photo_slot rather than read from dedicated
      // arrays. Same content, one source, and it cannot drift from the
      // evidence the validator actually acted on.
      frontEvidence:  bySlot("front"),
      tagEvidence:    bySlot("tag"),
      detailEvidence: bySlot("detail"),
      sportsTeam: ai.identification.team,
      logoPlacement: ai.features.logo_placement,
      size_label: ai.visible_attributes.size_label,

      // ── Canonical passthrough ────────────────────────────────────────────
      // loading.tsx spreads `identification` wholesale, so anything added here
      // reaches the screens without a schema change on the client. These are
      // the fields the old shape has no home for but the UI genuinely needs —
      // without them the app silently shows template text where the model
      // produced a real answer.
      v1: {
        // Verbatim confirmed context, so the results screen can show the user
        // exactly what they typed. Read from meta (server-owned), never from
        // `ai` — a user-confirmed fact must not be presentable as something the
        // model observed.
        // ── Previously blocked, now surfaced ──────────────────────────────
        // Each of these reached neither the adapter nor the UI, so work the
        // model did was invisible. Server-side-only fields (evidence strengths,
        // features.*, validation gates) are deliberately still not here — they
        // are consumed before this point, not blocked.
        escalationSignals:   ai.risks.escalation_signals,
        productLine:         ai.identification.product_line,
        modelNumber:         ai.identification.model_or_product_number,
        subject:             ai.identification.subject,
        artist:              ai.identification.artist,
        characterOrLicense:  ai.identification.character_or_license,
        secondaryColors:     ai.visible_attributes.secondary_colors,
        conditionChecked:    ai.condition.visible_condition_observations,
        conditionConfidence: ai.condition.condition_confidence,
        marketConfidence:    ai.marketability.marketability_confidence,
        brandConfidence:     ai.identification.brand_confidence,

        userContext:      c.meta.input_context?.user_context ?? null,
        // Which specific facts the model attributed to the user, so the UI can
        // label them rather than presenting them as photo observations.
        userConfirmedFacts: [
          ...ai.condition.condition_findings
              .filter(f => f.photo_slot === "user_confirmed")
              .map(f => `${f.type.replace(/_/g, " ")} — ${f.location}`),
          ...ai.era.era_evidence
              .filter(e => e.photo_slot === "user_confirmed")
              .map(e => e.observation),
          ...ai.photo_evidence.observable_field_evidence
              .filter(e => e.photo_slot === "user_confirmed")
              .map(e => e.observation),
          ...ai.identification.identification_evidence
              .filter(e => e.photo_slot === "user_confirmed")
              .map(e => e.observation),
        ].slice(0, 8),
        // Photo evidence directly contradicting a user-confirmed fact. Both are
        // kept; the user decides.
        sourceConflicts: d.validation.downgrades
          .filter(dg => dg.rule_id === "SOURCE_CONFLICT")
          .map(dg => dg.user_message)
          .filter(Boolean),
        userContextChars: c.meta.input_context?.char_count ?? 0,
        // Needed so Generate Listings can ask the server to look the confirmed
        // context up by analysis. Without it the lookup always misses and
        // listings silently lose the context.
        analysisId:       c.meta.analysis_id,
        // Which photos the user actually supplied. The UI needs this to say
        // "no flaws in the front photo" rather than implying it checked
        // everything, or implying it failed to.
        photoSlots:       c.meta.photo_slots_provided,
        eraStatus:        d.era_effective.status,
        eraConfidence:    d.era_effective.confidence,
        productionDecade: d.era_effective.production_decade_effective,
        styleEra:         ai.era.style_era,
        vintageRoute:     d.era_effective.confirmed_vintage_route,

        sizeLabel:        ai.visible_attributes.size_label,
        sizeSystem:       ai.visible_attributes.size_system,
        primaryColor:     ai.visible_attributes.primary_color,
        materialSource:   ai.visible_attributes.material_source,

        // Only the findings that passed the obvious-damage bar. The rest are
        // informational and must not drive anything.
        obviousDamage:    d.condition_summary.obvious_findings.map(
                            f => `${f.type.replace(/_/g, ' ')} — ${f.location}`),
        conditionUnknowns: ai.condition.condition_unknowns,
        assessmentLimited: d.condition_summary.assessment_limited,

        buyerPool:         ai.marketability.buyer_pool,
        marketabilityReasons: ai.marketability.marketability_reasons,

        pricingBasis:     ai.pricing.pricing_basis,
        pricingUnknowns:  ai.pricing.pricing_unknowns,
        priceConfidence:  ai.pricing.price_confidence,
        estimateUnavailable: d.pricing.estimate_unavailable,

        missingEvidence:  ai.photo_evidence.missing_or_unreadable_evidence,
        rescanAdvice:     ai.photo_evidence.recommended_rescan_photo,
        authenticityConcerns: ai.risks.authenticity_concerns,

        displayName:      itemName,
        eraPrefix:        d.identification.era_prefix_applied,
      },
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
      // risky_buy_reasons no longer comes from the model. The shared
      // recommendation module derives risk factors from validated marketability,
      // condition, pricing and era fields; only the two conclusions the model
      // genuinely cannot know are added here.
      risky_buy_reasons: [
        ...(d.condition_summary.has_obvious_damage
          ? [`Visible ${d.condition_summary.max_obvious_severity} damage affects value`] : []),
        ...(d.pricing.estimate_unavailable
          ? ["No reliable resale estimate for this item"] : []),
      ].slice(0, 6),
    },
    listings: {
      ebay_title: itemName,
      depop_title: itemName,
      description: ai.pricing.pricing_basis[0] ?? "",
    },
  };
}