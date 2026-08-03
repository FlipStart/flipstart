/**
 * Recognition matching and Diamond eligibility.
 *
 * Two separate questions, deliberately kept apart:
 *   recognition — what IS this?
 *   Diamond     — does it earn a reward?
 * An item can be `confirmed` and still not unlock anything.
 */
import type {
  AiAnalysis, DerivedEraEffective, DerivedRecognition, DerivedProgress,
  PhotoContribution, PhotoSlot, RecognitionStatus,
} from "../../shared/canonical.types.js";
import { RECOGNITION_REGISTRY, type RecognitionDefinition, type AttrTest } from "./registry.js";

/** Minimum confidence for any unlock. */
const UNLOCK_CONFIDENCE = 70;
/** Diamonds need corroboration across photos. */
const DIAMOND_MIN_MEANINGFUL_PHOTOS = 2;

function readPath(ai: AiAnalysis, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
    ai as unknown,
  );
}

function testAttr(ai: AiAnalysis, t: AttrTest): boolean {
  const v = readPath(ai, t.field);
  switch (t.op) {
    case "equals":
      return String(v) === String(t.value);
    case "equals_ci":
      return String(v ?? "").trim().toLowerCase() === String(t.value).toLowerCase();
    case "in":
      return (t.value as string[]).some(x => String(v ?? "").trim().toLowerCase() === x.toLowerCase());
    case "contains_any": {
      const hay = Array.isArray(v)
        ? (v as unknown[]).map(x => String(x).toLowerCase())
        : [String(v ?? "").toLowerCase()];
      return (t.value as string[]).some(needle =>
        hay.some(h => h.includes(needle.toLowerCase())));
    }
    default:
      return false;
  }
}

export interface RecognitionInput {
  ai: AiAnalysis;
  photoSlotsProvided: PhotoSlot[];
  photoContributions: PhotoContribution[];
  meaningfulPhotoCount: number;
  /** Features with no surviving observable-field evidence are excluded from
   *  scoring — a Detroit Jacket cannot confirm on a corduroy collar no photo
   *  supports. */
  evidencedFeatureFields: Set<string>;
}

export function evaluateRecognition(input: RecognitionInput): DerivedRecognition {
  const { ai, photoSlotsProvided, meaningfulPhotoCount, evidencedFeatureFields } = input;
  const slots = new Set(photoSlotsProvided);

  const candidates: DerivedRecognition["recognition_candidates"] = [];
  const testMode: string[] = [];
  let best: { def: RecognitionDefinition; score: number; status: RecognitionStatus; evidence: string[] } | null = null;

  for (const def of RECOGNITION_REGISTRY) {
    if (!def.applicable_category.includes(ai.identification.broad_category)) continue;
    if (def.disqualifying_attributes.some(t => testAttr(ai, t))) {
      candidates.push({ recognition_id: def.recognition_id, score: 0, status: "none" });
      continue;
    }
    if (!def.required_attributes.every(t => testAttr(ai, t))) continue;
    if (!def.required_photos.every(s => slots.has(s))) continue;

    let score = 0;
    const evidence: string[] = [];
    for (const t of def.supporting_attributes) {
      // A feature with no surviving evidence cannot contribute.
      const fieldLeaf = t.field.split(".").pop() ?? "";
      if (t.field.startsWith("features.") && !evidencedFeatureFields.has(fieldLeaf)) continue;
      if (testAttr(ai, t)) { score += t.weight ?? 0; evidence.push(`${fieldLeaf} matched`); }
    }

    // A valuable specific identity needs >= 2 meaningful photos, OR one photo
    // carrying direct model identification. Front-only structural resemblance
    // can never reach confirmed — enforced here so no definition can opt out.
    const directId = Boolean(ai.identification.model_or_product_number.trim());
    const photoOk = meaningfulPhotoCount >= 2 || directId;

    let status: RecognitionStatus = "none";
    if (score >= def.confirmed_threshold && evidence.length >= def.minimum_evidence && photoOk) {
      status = "confirmed";
    } else if (score >= def.confirmed_threshold * 0.8 && evidence.length >= def.minimum_evidence) {
      status = "likely";
    } else if (score >= def.candidate_threshold) {
      status = "candidate";
    }

    if (status !== "none") {
      candidates.push({ recognition_id: def.recognition_id, score, status });
      if (!def.enabled_in_production) testMode.push(def.recognition_id);
      if (!best || score > best.score) best = { def, score, status, evidence };
    }
  }

  // A definition still in test mode may score and be recorded, but may never
  // replace the displayed name or unlock anything.
  const usable = best && best.def.enabled_in_production ? best : null;

  return {
    generic_item_name: ai.identification.generic_item_name,
    specific_item_name: usable?.status === "confirmed" ? usable.def.canonical_name : null,
    recognition_status: usable ? usable.status : (best ? "candidate" : "none"),
    recognition_confidence: usable ? Math.min(100, usable.score) : 0,
    recognition_evidence: usable?.evidence ?? [],
    conflicting_recognition_evidence: [],
    recognition_candidates: candidates,
    definitions_in_test_mode: testMode,
  };
}

export interface DiamondInput {
  ai: AiAnalysis;
  era: DerivedEraEffective;
  recognition: DerivedRecognition;
  meaningfulPhotoCount: number;
  identityConfidence: number;
  validationPassed: boolean;
}

/**
 * Diamond eligibility. Reads structured fields only — never title text, era
 * strings, or reason strings. The old system substring-matched free text
 * against ['vintage','retro','distressed',...], which let a modern distressed
 * tee clear a vintage gate.
 */
export function evaluateDiamondEligibility(input: DiamondInput): DerivedProgress {
  const { ai, era, recognition, meaningfulPhotoCount, identityConfidence, validationPassed } = input;
  const blockers: string[] = [];
  const evidence: string[] = [];

  if (!validationPassed) blockers.push("validation did not pass");
  if (meaningfulPhotoCount < DIAMOND_MIN_MEANINGFUL_PHOTOS) {
    blockers.push(`needs ${DIAMOND_MIN_MEANINGFUL_PHOTOS} meaningful photos, found ${meaningfulPhotoCount}`);
  }
  if (identityConfidence < UNLOCK_CONFIDENCE) {
    blockers.push(`identity confidence ${identityConfidence} below ${UNLOCK_CONFIDENCE}`);
  }
  if (ai.risks.authenticity_concerns.length) {
    blockers.push("unresolved authenticity concerns");
  }

  // ── Era eligibility ─────────────────────────────────────────────────────────
  //
  // A STRONG photo-derived likely_vintage read now satisfies the ERA portion.
  // Previously only confirmed_vintage qualified, so an item the model was 85%
  // sure was old — from a period print, an older collar and age-consistent wear
  // — was blocked purely by the era field while every other requirement passed.
  //
  // This does NOT loosen anything else. Meaningful-photo count, identity
  // confidence, authenticity and recognition all still apply above and below,
  // and user_confirmed still never counts as a photograph. The threshold is
  // deliberately 80: high enough that a hedged read cannot reach it.
  const STRONG_VISUAL_ERA = 80;
  const strongVisualVintage =
    era.status === "likely_vintage" &&
    era.confidence >= STRONG_VISUAL_ERA &&
    !era.evidence.some(e => e.supports === "modern_broad") &&
    era.evidence.some(e => e.photo_slot !== "user_confirmed" && e.type !== "style_only");

  // Vintage Diamonds. Route A and Enhanced Route B unlock; Standard does not.
  const wantsVintage = era.status === "confirmed_vintage";
  if (wantsVintage) {
    evidence.push(`era confirmed via route ${era.confirmed_vintage_route}`);
    if (!era.vintage_for_unlocks) {
      blockers.push("BROAD_VINTAGE_REQUIRES_ENHANCED_VERIFICATION");
      if (era.enhanced_route_b?.unmet_requirements.length) {
        blockers.push(...era.enhanced_route_b.unmet_requirements
          .filter(r => r !== "BROAD_VINTAGE_REQUIRES_ENHANCED_VERIFICATION"));
      }
    }
  }

  // Recognition-based Diamonds require a CONFIRMED, production-enabled match.
  const candidateId = recognition.specific_item_name ? recognition.recognition_candidates
    .find(c => c.status === "confirmed")?.recognition_id ?? "" : "";
  if (recognition.definitions_in_test_mode.length && !candidateId) {
    blockers.push(`recognition definitions in test mode: ${recognition.definitions_in_test_mode.join(", ")}`);
  }

  const eligible =
    blockers.length === 0 &&
    (wantsVintage ? era.vintage_for_unlocks : true) &&
    // A strong visual vintage read satisfies era on its own terms; it does not
    // set vintage_for_unlocks, which stays reserved for verified routes.
    (era.status === "likely_vintage" ? strongVisualVintage : true) &&
    Boolean(candidateId);

  return {
    brand_match: identityConfidence >= UNLOCK_CONFIDENCE ? ai.identification.canonical_brand : "",
    diamond_candidate_id: candidateId,
    diamond_match_score: recognition.recognition_confidence,
    diamond_unlock_eligible: eligible,
    diamond_unlock_evidence: evidence,
    diamond_unlock_blockers: blockers,
    achievement_signals: identityConfidence >= UNLOCK_CONFIDENCE
      ? [ai.identification.broad_category].filter(Boolean) : [],
    category_signals: [ai.identification.broad_category].filter(Boolean),
  };
}