/**
 * CanonicalAnalysisV1 assembly.
 *
 * Runs the whole judgement pipeline in dependency order:
 *   validate -> era -> recognition -> display name -> pricing -> progress
 *
 * `ai` is the parsed model response, cloned once by the validator and never
 * mutated afterwards. Everything the server concludes lands in `derived`, so a
 * disagreement between the model and validation stays visible instead of being
 * silently smoothed over.
 */
import type {
    AiAnalysis, CanonicalAnalysisV1, CanonicalMeta, DerivedAnalysis,
    DerivedIdentification, DerivedPricing, PhotoSlot,
  } from "../../shared/canonical.types.js";
  import { validateAnalysis } from "./validate.js";
  import { validateEra, qualifiesForY2kPrefix } from "./era.js";
  import { evaluateRecognition, evaluateDiamondEligibility } from "../recognition/matcher.js";
  
  export interface BuildInput {
    ai: AiAnalysis;
    meta: Omit<CanonicalMeta, "photo_slots_provided"> & { photo_slots_provided: PhotoSlot[] };
  }
  
  export function buildCanonicalAnalysis(input: BuildInput): CanonicalAnalysisV1 {
    const { meta } = input;
  
    // 1. Semantic validation. Returns a clone; the input is untouched.
    const v = validateAnalysis({
      ai: input.ai,
      photoSlotsProvided: meta.photo_slots_provided,
    });
  
    // 2. Era. Route selection happens before the confidence cap is applied —
    //    Enhanced requires >= 90 and Standard caps at 85, so capping first would
    //    make Enhanced unreachable.
    const eraRes = validateEra({
      era: v.cleaned.era,
      photoSlotsProvided: meta.photo_slots_provided,
      meaningfulPhotoCount: v.meaningfulPhotoCount,
      vintageCutoffYear: meta.vintage_cutoff_year,
      eraConfidenceCeiling: v.eraConfidenceCeiling,
    });
  
    // 3. Recognition. Only features backed by surviving observable-field evidence
    //    may contribute to a score.
    const evidencedFeatureFields = new Set(
      v.cleaned.photo_evidence.observable_field_evidence.map(e => e.field as string),
    );
    const recognition = evaluateRecognition({
      ai: v.cleaned,
      photoSlotsProvided: meta.photo_slots_provided,
      photoContributions: v.photoContributions,
      meaningfulPhotoCount: v.meaningfulPhotoCount,
      evidencedFeatureFields,
    });
  
    // 4. Display name: resolve the base first, then apply a validated era prefix.
    const identification = buildDisplayName(v.cleaned, recognition, eraRes.effective);
  
    // 5. Pricing. Null is a real state and must never render as $0.
    const pricing = buildPricing(v.cleaned);
  
    // 6. Progress and Diamonds — structured fields only.
    const validationPassed = true; // hard failures throw before reaching here
    const progress = evaluateDiamondEligibility({
      ai: v.cleaned,
      era: eraRes.effective,
      recognition,
      meaningfulPhotoCount: v.meaningfulPhotoCount,
      identityConfidence: v.identityConfidence,
      validationPassed,
    });
  
    const derived: DerivedAnalysis = {
      validation: {
        passed: validationPassed,
        downgrades: [...v.downgrades, ...eraRes.logs],
        rejected_fields: v.rejectedFields,
        confidence_caps_applied: v.confidenceCaps,
      },
      identification,
      era_effective: eraRes.effective,
      condition_summary: v.conditionSummary,
      photo_contributions: v.photoContributions,
      recognition,
      pricing,
      progress,
      comps: {
        source: null, sample_count: 0, median: null,
        range_low: null, range_high: null, comp_match_score: null,
        query_components: {
          brand: v.cleaned.identification.canonical_brand,
          model: v.cleaned.identification.model_or_product_number,
          item_type: v.cleaned.identification.item_type,
          size: v.cleaned.visible_attributes.size_label,
          era: eraRes.effective.production_decade_effective,
        },
      },
    };
  
    return { meta, ai: v.cleaned, derived };
  }
  
  /**
   * Name resolution: confirmed recognition may replace the base; candidate and
   * likely may not. The era prefix is applied afterwards, so a downgrade in
   * either dimension regenerates cleanly from canonical fields.
   */
  function buildDisplayName(
    ai: AiAnalysis,
    recognition: CanonicalAnalysisV1["derived"]["recognition"],
    era: CanonicalAnalysisV1["derived"]["era_effective"],
  ): DerivedIdentification {
    const generic = ai.identification.generic_item_name;
    const useSpecific =
      recognition.recognition_status === "confirmed" && Boolean(recognition.specific_item_name);
  
    const resolvedBase = useSpecific ? (recognition.specific_item_name as string) : generic;
    const nameSource: DerivedIdentification["name_source"] =
      useSpecific ? "confirmed_recognition" : "generic";
  
    let prefix: DerivedIdentification["era_prefix_applied"] = null;
    if (era.status === "confirmed_vintage") {
      // Y2K wins over Vintage, and only with a validated MANUFACTURING year in
      // the window. style_era y2k alone never qualifies.
      prefix = qualifiesForY2kPrefix(era) ? "Y2K" : "Vintage";
    }
  
    return {
      generic_item_name: generic,
      resolved_base_item_name: resolvedBase,
      name_source: nameSource,
      display_item_name: prefix ? `${prefix} ${resolvedBase}` : resolvedBase,
      era_prefix_applied: prefix,
    };
  }
  
  function buildPricing(ai: AiAnalysis): DerivedPricing {
    const { low, high } = ai.pricing.ai_estimated_resale_range;
    const usable = low != null && high != null && Number.isFinite(low) && Number.isFinite(high);
  
    if (!usable) {
      return {
        resale_low: null, resale_high: null, resale_point: null,
        adjustments: [], max_buy_price: null,
        price_basis_label: "ai_estimate", estimate_unavailable: true,
      };
    }
  
    const point = Math.round((low + high) / 2);
    return {
      resale_low: Math.round(low),
      resale_high: Math.round(high),
      resale_point: point,
      adjustments: [],
      // Left null here on purpose: max buy depends on the user's minimum-profit
      // setting, which belongs to the recommendation module, not the analysis.
      max_buy_price: null,
      price_basis_label: "ai_estimate",
      estimate_unavailable: false,
    };
  }