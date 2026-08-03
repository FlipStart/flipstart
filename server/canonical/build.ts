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
  DerivedConditionSummary, DerivedEraEffective,
} from "../../shared/canonical.types.js";
import { validateAnalysis } from "./validate.js";
import { validateEra, qualifiesForY2kPrefix } from "./era.js";
import {
  conditionAdjustments, isCommonModernBasic, commonBasicCeiling,
} from "./priceAdjust.js";
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
  // Pricing is built AFTER era and condition are validated, and receives both.
  // Previously it took only ai.pricing and returned adjustments: [] — so a
  // confirmed tear or a confirmed vintage could never move the number.
  const pricing = buildPricing(v.cleaned, v.conditionSummary, eraRes.effective);

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
      // Declared in DerivedValidation but never emitted until now. It is the
      // field that proves a user-confirmed fact did not satisfy a photo
      // requirement — counted from real photo contributions only, so a typed
      // note can never reach the two-meaningful-photo bar that gates Diamonds.
      meaningful_photo_count: v.meaningfulPhotoCount,
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

function buildPricing(
  ai: AiAnalysis,
  condition: DerivedConditionSummary,
  era: DerivedEraEffective,
): DerivedPricing {
  const { low: rawLow, high: rawHigh } = ai.pricing.ai_estimated_resale_range;
  const usable = rawLow != null && rawHigh != null &&
                 Number.isFinite(rawLow) && Number.isFinite(rawHigh);

  if (!usable) {
    return {
      resale_low: null, resale_high: null, resale_point: null,
      adjustments: [], max_buy_price: null,
      price_basis_label: "ai_estimate", estimate_unavailable: true,
    };
  }

  const adjustments = [...conditionAdjustments(ai, condition)];
  let adjLow = rawLow as number, adjHigh = rawHigh as number;

  // ── Common modern basic ceiling ─────────────────────────────────────────────
  // The model still overprices recognisable-brand basics despite the prompt
  // telling it not to. A recognisable label is not a value driver, so this caps
  // the estimate unless a concrete premium signal is present — in which case
  // isCommonModernBasic returns false and nothing here applies.
  if (isCommonModernBasic(ai, era)) {
    const ceiling = commonBasicCeiling(ai);
    if (ceiling != null && adjHigh > ceiling) {
      const factor = ceiling / adjHigh;
      adjustments.push({
        reason: `Common modern ${ai.identification.item_type} — no premium model, graphic or material identified`,
        impact: -Math.round((1 - factor) * 100) / 100,
        source: "server",
      });
      adjLow = adjLow * factor;
      adjHigh = ceiling;
    }
  }

  // ── Condition ───────────────────────────────────────────────────────────────
  const condPct = adjustments
    .filter(a => a.reason.startsWith("Reduced for"))
    .reduce((s, a) => s + Math.abs(a.impact), 0);
  if (condPct > 0) {
    const keep = Math.max(0.35, 1 - condPct);
    adjLow  = adjLow  * keep;
    adjHigh = adjHigh * keep;
    // A serious defect on a cheap item must not round away to nothing.
    if (condPct >= 0.3 && adjHigh > 4) adjHigh = Math.min(adjHigh, (rawHigh as number) - 3);
  }

  const low  = Math.max(1, Math.round(adjLow));
  const high = Math.max(low, Math.round(adjHigh));
  const point = Math.round((low + high) / 2);
  return {
    resale_low: low,
    resale_high: high,
    resale_point: point,
    // Was hardcoded [] — the reason condition and era could never move price.
    adjustments,
    // Left null here on purpose: max buy depends on the user's minimum-profit
    // setting, which belongs to the recommendation module, not the analysis.
    max_buy_price: null,
    price_basis_label: "ai_estimate",
    estimate_unavailable: false,
  };
}