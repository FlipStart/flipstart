/**
 * CanonicalAnalysisV1 — Phase 0 contract.
 *
 * Two layers, and the split is the whole point:
 *   `ai`      — verbatim model output. NEVER mutated after parse.
 *   `derived` — everything code decides. The model may not write here.
 *
 * A disagreement between what the model said and what validation concluded stays
 * visible in `derived.validation.downgrades` rather than being silently smoothed
 * over in place. That is what makes a bad scan diagnosable after the fact.
 */

// ─── Shared enums ─────────────────────────────────────────────────────────────

export type PhotoSlot = 'front' | 'tag' | 'detail';

/**
 * Where a piece of evidence came from.
 *
 * 'user_confirmed' exists because every evidence object requires a source, the
 * prompt forbids fabricating a photo slot for something the model did not see,
 * and validation discards evidence citing an unsupplied slot. Without this
 * value a user-confirmed fact had nowhere valid to live: it was either dropped
 * or recorded as something the AI claimed to have seen.
 *
 * It is deliberately NOT a member of PhotoSlot. photo_refs and
 * photo_slots_provided must keep meaning "actual photographs" — a
 * user-confirmed fact must never count toward the meaningful-photo rules that
 * gate Diamonds.
 */
export type EvidenceSource = PhotoSlot | 'user_confirmed';

export type BroadCategory =
  | 'clothing' | 'shoes' | 'bags' | 'accessories' | 'jewelry' | 'watches'
  | 'electronics' | 'housewares' | 'media' | 'toys' | 'sporting_goods'
  | 'furniture' | 'collectibles' | 'other' | 'unknown';

export type EraStatus =
  | 'confirmed_vintage' | 'likely_vintage' | 'vintage_inspired' | 'modern' | 'unknown';

export type ProductionDecade =
  | 'pre_1950s' | '1950s' | '1960s' | '1970s' | '1980s'
  | '1990s' | '2000s' | '2010s' | '2020s' | 'unknown';

export type StyleEra =
  | 'y2k' | 'retro_1950s' | 'retro_1960s' | 'retro_1970s'
  | 'retro_1980s' | 'retro_1990s' | 'none' | 'unknown';

export type EraEvidenceType =
  | 'manufacturing_date' | 'copyright_date' | 'dated_event' | 'model_or_date_code'
  | 'documented_tag_format' | 'logo_version' | 'union_label' | 'care_label_format'
  | 'construction' | 'stitching' | 'hardware' | 'material_technology'
  | 'country_of_manufacture' | 'style_only' | 'other';

export type EvidenceStrength = 'hard' | 'strong_supporting' | 'weak_supporting';

/** What period an evidence item points at. Two broad values exist because real
 *  evidence often proves AGE without proving DECADE — a union label proves old,
 *  an RFID tag proves recent, neither names a decade. */
export type SupportedPeriod =
  | Exclude<ProductionDecade, 'unknown'> | 'vintage_broad' | 'modern_broad' | 'unknown';

export type IdentificationField =
  | 'canonical_brand' | 'item_type' | 'subtype' | 'subject' | 'team' | 'artist'
  | 'event' | 'character_or_license' | 'product_line' | 'model_or_product_number' | 'other';

export type ConditionFindingType =
  | 'possible_stain' | 'hole' | 'tear' | 'cracking' | 'peeling' | 'broken_hardware'
  | 'missing_component' | 'repair' | 'heavy_wear' | 'other';

export type Severity = 'minor' | 'moderate' | 'major' | 'unknown';

export type ClosureType =
  | 'zip_full' | 'zip_quarter' | 'zip_half' | 'button' | 'snap'
  | 'pullover' | 'drawstring' | 'buckle' | 'none' | 'unknown';

export type CollarType =
  | 'crew' | 'v_neck' | 'hood' | 'mock' | 'polo'
  | 'corduroy' | 'ribbed' | 'shirt_collar' | 'none' | 'unknown';

export type LogoPlacement =
  | 'center_chest' | 'left_chest' | 'right_chest' | 'full_front'
  | 'back' | 'sleeve' | 'hem' | 'allover' | 'none' | 'unknown';

export type Silhouette =
  | 'boxy' | 'fitted' | 'oversized' | 'relaxed' | 'cropped' | 'long' | 'unknown';
export type SizeSystem = 'alpha' | 'numeric' | 'waist_inseam' | 'shoe' | 'other' | 'unknown';
export type SizeSource = 'tag_legible' | 'user_confirmed' | 'not_visible' | 'unknown';
export type MaterialSource = 'tag_legible' | 'user_confirmed' | 'visual_estimate' | 'unknown';
export type CanonicalRating = 'STRONG_BUY' | 'BUY' | 'RISKY_BUY' | 'SKIP';
export type RecognitionStatus = 'none' | 'candidate' | 'likely' | 'confirmed';

/** Integer 0-100. The strict schema cannot enforce a range (OpenAI rejects
 *  `minimum`/`maximum`), so this is a documentation alias and the bound is
 *  enforced in semantic validation. */
export type Confidence = number;

// ─── ai — verbatim model output ───────────────────────────────────────────────

export type EvidenceMode = 'direct_transcription' | 'visual_observation' | 'inference';

export interface IdentificationEvidence {
  field: IdentificationField;
  observation: string;
  /** How the claim was obtained. product_line and model_or_product_number
   *  require 'direct_transcription' — inference can never populate them.
   *  Replaces the prose-inspection heuristic. */
  evidence_mode: EvidenceMode;
  photo_slot: EvidenceSource;
}

/** Fields that can carry observable-field evidence. */
export type ObservableField =
  | 'size_label' | 'primary_color' | 'secondary_colors' | 'material_composition'
  | 'style_labels' | 'closure_type' | 'collar_type' | 'hood_present'
  | 'pocket_configuration' | 'logo_identity' | 'logo_placement' | 'logo_scale'
  | 'material_signals' | 'construction_signals' | 'stitching_signals' | 'silhouette'
  | 'tag_characteristics' | 'manufacturing_clues';

export interface ObservableFieldEvidence {
  field: ObservableField;
  observation: string;
  photo_slot: EvidenceSource;
}

export interface AiIdentification {
  /** ERA-NEUTRAL. Never contains "Vintage", "Y2K", a decade, or "retro".
   *  Validated era prefixes live on derived.identification.display_item_name. */
  generic_item_name: string;
  canonical_brand: string;
  brand_confidence: Confidence;
  broad_category: BroadCategory;
  item_type: string;
  subtype: string;
  subject: string;
  team: string;
  artist: string;
  event: string;
  character_or_license: string;
  /** Transcribed from a legible marking ONLY. Never inferred from resemblance. */
  product_line: string;
  model_or_product_number: string;
  identity_confidence: Confidence;
  identification_evidence: IdentificationEvidence[];
}

export interface AiVisibleAttributes {
  /** Exactly as printed. "32x30" stays "32x30". */
  size_label: string;
  size_system: SizeSystem;
  size_source: SizeSource;
  primary_color: string;
  secondary_colors: string[];
  color_confidence: Confidence;
  material_composition: string[];
  material_source: MaterialSource;
  material_confidence: Confidence;
  style_labels: string[];
}

export interface AiPhotoEvidence {
  // front/tag/detail_evidence removed in schema v1.1: every observation already
  // carries a photo_slot inside its structured evidence object, so the
  // per-photo arrays were a second copy. Group identification_evidence,
  // observable_field_evidence, era_evidence and condition_findings by
  // photo_slot instead.
  /** Required for consequential claims — anything that dates the item,
   *  identifies a specific product, or moves its value. Optional for plainly
   *  visible descriptive fields. Entries naming an unsupplied slot are
   *  here. Entries naming an unsupplied slot are discarded in validation. */
  observable_field_evidence: ObservableFieldEvidence[];
  missing_or_unreadable_evidence: string[];
  /** Advisory for a FUTURE scan. There is no add-a-photo flow. */
  recommended_rescan_photo: string;
}

export interface AiEraEvidence {
  observation: string;
  type: EraEvidenceType;
  /** A proposal. Validation re-derives effective_strength and uses that instead. */
  proposed_strength: EvidenceStrength;
  supports: SupportedPeriod;
  /** Four-digit year, ONLY when directly legible or from a readable date code.
   *  Never estimated. On copyright_date/dated_event this is the artwork year,
   *  not the production year — validation keeps them separate. */
  observed_year: number | null;
  photo_slot: EvidenceSource;
}

export interface AiEraConflict {
  observation: string;
  conflicts_with: string;
  proposed_strength: EvidenceStrength;
  photo_slot: EvidenceSource;
}

export interface AiEra {
  era_status: EraStatus;
  production_decade: ProductionDecade;
  style_era: StyleEra;
  /** DISPLAY ONLY. No code path may read this for logic. */
  estimated_era_range: string;
  era_confidence: Confidence;
  era_evidence: AiEraEvidence[];
  conflicting_era_evidence: AiEraConflict[];
}

export interface AiConditionFinding {
  type: ConditionFindingType;
  location: string;
  severity: Severity;
  /** 0-100. >= 80 plus a value-affecting defect makes a finding "obvious". */
  certainty: Confidence;
  photo_slot: EvidenceSource;
  evidence: string;
}

export interface AiCondition {
  condition_findings: AiConditionFinding[];
  visible_condition_observations: string[];
  condition_confidence: Confidence;
  condition_unknowns: string[];
}

export interface AiMarketability {
  expected_sell_speed: 'fast' | 'moderate' | 'slow' | 'very_slow' | 'unknown';
  sell_likelihood: 'high' | 'moderate' | 'low' | 'very_low' | 'unknown';
  buyer_pool: 'broad' | 'moderate' | 'narrow' | 'very_narrow' | 'unknown';
  competition_level: 'low' | 'moderate' | 'high' | 'unknown';
  marketability_confidence: Confidence;
  marketability_reasons: string[];
}

export interface AiPricing {
  /** low and high are null together, or both valid non-negative numbers. */
  ai_estimated_resale_range: { low: number | null; high: number | null };
  price_confidence: Confidence;
  pricing_basis: string[];
  pricing_unknowns: string[];
}

export interface AiRisks {
  /** Concrete warnings not already captured by marketability, condition,
   *  pricing or era. risky_buy_reasons was removed in schema v1.1 — the shared
   *  recommendation module derives risk reasons from validated fields, and
   *  asking the model to restate them produced a drifting second list. */
  risk_flags: string[];
  authenticity_concerns: string[];
  escalation_signals: string[];
}

export interface AiFeatures {
  closure_type: ClosureType;
  collar_type: CollarType;
  hood_present: 'yes' | 'no' | 'unknown';
  pocket_configuration: string[];
  logo_identity: string[];
  logo_placement: LogoPlacement;
  logo_scale: 'large' | 'medium' | 'small' | 'unknown';
  material_signals: string[];
  construction_signals: string[];
  stitching_signals: string[];
  silhouette: Silhouette;
  tag_characteristics: string[];
  manufacturing_clues: string[];
}

export interface AiAnalysis {
  identification: AiIdentification;
  visible_attributes: AiVisibleAttributes;
  photo_evidence: AiPhotoEvidence;
  era: AiEra;
  condition: AiCondition;
  marketability: AiMarketability;
  pricing: AiPricing;
  risks: AiRisks;
  features: AiFeatures;
}

// ─── meta ─────────────────────────────────────────────────────────────────────

export interface CanonicalMeta {
  schema_version: '1';
  prompt_version: string;
  schema_hash: string;
  model: string;
  photo_slots_provided: PhotoSlot[];
  plan_at_scan: 'free' | 'trial' | 'monthly' | 'annual';
  /** current_year - 20. Stamped so a historical decision stays readable. */
  vintage_cutoff_year: number;
  current_year_at_scan: number;
  /** True when the user confirmed camera context for this scan. */
  user_context_supplied: boolean;
  /**
   * Immutable analysis-input metadata.
   *
   * Deliberately in `meta`, NOT in `ai`: `ai` is the verbatim model response,
   * and putting user-supplied text there would blur the line between what the
   * model observed and what the user told it. Provenance has to stay legible
   * — a user-confirmed stain is a real fact, but it is not a photo-derived one.
   */
  input_context?: {
    user_context: string | null;
    source: "camera_confirmed";
    confirmed: boolean;
    hash: string | null;
    char_count: number;
  };
  scan_attempt_id: string;
  analysis_id: string;
  analyzed_at: number;
  photo_refs: Record<PhotoSlot, string | null>;
}

// ─── derived — server only ────────────────────────────────────────────────────

export interface ValidationDowngrade {
  rule_id: string;
  field: string;
  from: string;
  to: string;
  /** Full detail, internal. Never shown to a user. */
  internal_detail: string;
  /** Plain-language, shown only when it materially helps the user. */
  user_message: string;
  show_to_user: boolean;
}

export interface DerivedValidation {
  passed: boolean;
  downgrades: ValidationDowngrade[];
  rejected_fields: string[];
  confidence_caps_applied: string[];
  /**
   * Photos that actually contributed usable evidence.
   *
   * Counted from real photo slots only. A user_confirmed fact is authoritative
   * but is not a photograph, so it can never satisfy the two-meaningful-photo
   * requirement that gates Diamonds — otherwise typing a note would unlock one.
   */
  meaningful_photo_count: number;
}

/** Era evidence after the server re-derives strength. */
export interface EffectiveEraEvidence extends AiEraEvidence {
  effective_strength: EvidenceStrength;
  /** Set when effective_strength < proposed_strength. */
  downgrade_reason: string | null;
  /** True when a trusted reference registry confirmed the format/generation. */
  reference_matched: boolean;
}

export interface DerivedEraEffective {
  status: EraStatus;
  confidence: Confidence;
  production_decade_effective: ProductionDecade;
  /** The decade containing vintage_cutoff_year. Computed, never hardcoded. */
  straddle_decade: ProductionDecade;
  /** Derived from validated MANUFACTURING evidence only. The cutoff-straddle
   *  and Y2K-title decisions read this — never prose, never a copyright year.
   *
   *  NOT the earliest year. A directly verified manufacturing date or date code
   *  outranks a year that merely references a patent, technology, label origin,
   *  or product generation. Qualifying evidence that conflicts with no
   *  deterministic winner resolves to null, not to whichever year is older. */
  production_year_effective: number | null;
  /** How the year was chosen, or why it could not be. */
  production_year_source:
    | 'verified_manufacturing_date'
    | 'verified_date_code'
    | 'agreed_multiple'
    | 'conflict_unresolved'
    | 'none';
  cutoff_applied: number;
  /** Which route established confirmed_vintage, if any.
   *
   *  A           — direct hard manufacturing evidence. Supports an exact decade.
   *  B_standard  — two independent strong manufacturing clues. Broad vintage only.
   *  B_enhanced  — B_standard plus label+construction clue classes, a third
   *                corroborating clue, two meaningful photos, and confidence >= 90.
   */
  /**
   * 'U' is user-confirmed: the user told us the item's age while holding it.
   *
   * It sets ANALYSIS truth — status, decade, display prefix, pricing — but
   * never grants unlock eligibility. Analysis truth and reward eligibility are
   * separate decisions: without this route the Diamond gate was silently
   * gating the analysis too, so "this is vintage" came back likely_vintage
   * with the decade wiped.
   */
  confirmed_vintage_route: 'A' | 'B_standard' | 'B_enhanced' | 'U' | null;
  /** Gates vintage Diamonds ONLY. False for B_standard, true for A and
   *  B_enhanced when all normal Diamond rules also pass. Never affects
   *  era_status, the "Vintage" title, or displayed analysis. */
  vintage_for_unlocks: boolean;
  /** Why Enhanced Route B was or was not reached. Populated whenever
   *  confirmed_vintage was established by either B route, so a blocked Diamond
   *  can explain itself rather than silently failing. */
  enhanced_route_b: EnhancedRouteBAssessment | null;
  evidence: EffectiveEraEvidence[];
}

/**
 * Enhanced Route B lets a genuinely old item unlock a vintage Diamond without a
 * printed manufacturing date — the common real case for pre-2000 garments,
 * which frequently carry no date anywhere.
 *
 * The safeguard is not a date; it is corroboration across independent clue
 * CLASSES. One physical label clue plus one construction clue plus a third
 * supporting clue is a different quality of evidence from three observations of
 * the same tag, and much harder for a modern reproduction to satisfy.
 */
export interface EnhancedRouteBAssessment {
  qualified: boolean;
  /** documented_tag_format | care_label_format | union_label | logo_version */
  label_class_clue: string | null;
  /** construction | stitching | hardware | material_technology,
   *  or a SECOND independent label-class clue */
  construction_class_clue: string | null;
  /** Third corroborating clue. May be another manufacturing clue, or style
   *  evidence — style is permitted HERE and only here. */
  third_clue: string | null;
  total_useful_clues: number;
  meaningful_photo_count: number;
  /** Each unmet requirement, in plain language, for diamond_unlock_blockers. */
  unmet_requirements: string[];
}

export interface DerivedIdentification {
  /** Era-neutral base, copied verbatim from ai.identification.generic_item_name. */
  generic_item_name: string;
  /** The base actually used for display. Equals specific_item_name when
   *  recognition is CONFIRMED, otherwise generic_item_name. candidate and
   *  likely never replace the generic name. */
  resolved_base_item_name: string;
  name_source: 'generic' | 'confirmed_recognition';
  /** resolved_base_item_name with a validated era prefix applied.
   *  The ONLY title any screen may render. */
  display_item_name: string;
  era_prefix_applied: 'Vintage' | 'Y2K' | null;
}

export interface DerivedConditionSummary {
  obvious_findings: AiConditionFinding[];
  informational_findings: AiConditionFinding[];
  /** THE rating gate. Derived by code; the model never sets it. */
  has_obvious_damage: boolean;
  max_obvious_severity: 'none' | 'minor' | 'moderate' | 'major';
  assessment_limited: boolean;
}

export interface PhotoContribution {
  /** Real photo slots only. user_confirmed evidence never appears here — it is
   *  not a photograph and must not satisfy the two-meaningful-photo rule. */
  slot: PhotoSlot;
  requirements_supported: Array<
    | 'brand_identity' | 'specific_product_identity' | 'era_qualification'
    | 'condition_requirement' | 'authenticity_concern' | 'diamond_definition_requirement'>;
  evidence_refs: string[];
}

export interface DerivedRecognition {
  generic_item_name: string;
  specific_item_name: string | null;
  recognition_status: RecognitionStatus;
  recognition_confidence: Confidence;
  recognition_evidence: string[];
  conflicting_recognition_evidence: string[];
  recognition_candidates: Array<{ recognition_id: string; score: number; status: RecognitionStatus }>;
  /** Definitions that scored but are not yet enabled in production. */
  definitions_in_test_mode: string[];
}

export interface DerivedPricing {
  /** Null when no safe estimate exists. Render "No reliable estimate", never $0.
   *  Null forbids STRONG_BUY and BUY — see the recommendation rules. */
  resale_low: number | null;
  resale_high: number | null;
  resale_point: number | null;
  adjustments: Array<{ reason: string; impact: number; source: 'server' }>;
  /** Null when resale_point is null. Never invent a max buy price. */
  max_buy_price: number | null;
  price_basis_label: 'ai_estimate' | 'sold_comps';
  /** True when pricing could not be established and the rating is constrained. */
  estimate_unavailable: boolean;
}

/**
 * The buy/skip decision. NOT part of CanonicalAnalysisV1.
 *
 * The analysis describes the item and never changes. The decision depends on
 * what the user pays for it, which is entered afterwards and can change any
 * number of times. Storing a recommendation inside the analysis would mean
 * either mutating an immutable object or persisting one computed at a fake
 * $0 thrift price — both wrong.
 *
 * Produced by shared/recommendation, which runs identically on server and
 * client, so editing the thrift price recomputes locally with no network call.
 */
export interface DecisionSnapshot {
  analysis_id: string;
  /** Ties the decision to the exact analysis that produced it. */
  canonical_schema_version: '1';
  canonical_schema_hash: string;
  /** The price the user actually entered. Finite and >= 0.
   *  A real 0 is valid — some thrift finds are free. */
  thrift_price: number;
  label: CanonicalRating;
  reasons: Array<{ code: string; text: string }>;
  /** Populated ONLY when label === 'RISKY_BUY'. */
  risky_disclaimer: string;
  deep_analysis_reasons: Array<{ code: string; text: string }>;
  economics: {
    fees: number | null;
    profit: number | null;
    roi: number | null;
    max_buy_price: number | null;
  };
  /** Client compares against its own MODULE_VERSION; on mismatch it renders
   *  the stored snapshot rather than computing a different answer locally. */
  recommendation_module_version: string;
  computed_at: number;
}

/**
 * Client-side draft price while the user is typing.
 *
 * NOT part of DecisionSnapshot. The absence of a snapshot IS the unpriced state,
 * so no boolean is needed and $0 is never a placeholder — a genuinely free item
 * is a real thrift_price of 0 and produces a real snapshot.
 *
 *   null            -> nothing entered yet. No snapshot. Render the analysis only.
 *   0               -> user explicitly entered zero. Valid. Snapshot created.
 *   any other value -> normal case.
 */
export type DraftThriftPrice = number | null;

export interface DerivedProgress {
  brand_match: string;
  diamond_candidate_id: string;
  diamond_match_score: number;
  diamond_unlock_eligible: boolean;
  diamond_unlock_evidence: string[];
  diamond_unlock_blockers: string[];
  achievement_signals: string[];
  category_signals: string[];
}

/** Reserved for marketplace intelligence. Empty at launch. */
export interface DerivedComps {
  source: string | null;
  sample_count: number;
  median: number | null;
  range_low: number | null;
  range_high: number | null;
  comp_match_score: number | null;
  query_components: {
    brand: string; model: string; item_type: string; size: string; era: string;
  };
}

export interface DerivedAnalysis {
  validation: DerivedValidation;
  identification: DerivedIdentification;
  era_effective: DerivedEraEffective;
  condition_summary: DerivedConditionSummary;
  photo_contributions: PhotoContribution[];
  recognition: DerivedRecognition;
  pricing: DerivedPricing;
  progress: DerivedProgress;
  comps: DerivedComps;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export interface CanonicalAnalysisV1 {
  meta: CanonicalMeta;
  ai: AiAnalysis;
  derived: DerivedAnalysis;
}

/** Historical results carry no meta.schema_version. Never backfill it. */
export interface LegacyV0Analysis {
  identification: Record<string, unknown>;
  market_data: Record<string, unknown>;
  risk_analysis: Record<string, unknown>;
  legacy_display?: { style_labels?: string[] };
}

export type AnyAnalysis = CanonicalAnalysisV1 | LegacyV0Analysis;

export function isCanonicalV1(a: AnyAnalysis): a is CanonicalAnalysisV1 {
  return (a as CanonicalAnalysisV1)?.meta?.schema_version === '1';
}