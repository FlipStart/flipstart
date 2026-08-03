/**
 * Semantic validation.
 *
 * The strict schema guarantees SHAPE. It cannot guarantee TRUTH, and OpenAI
 * rejects the constraint keywords (minimum/maxLength/maxItems) in strict mode,
 * so every bound lives here instead.
 *
 * Governing principle: never silently default. A missing or unsupported value
 * becomes an explicit unknown with a logged downgrade — it is never quietly
 * replaced with "Medium" or 50, which is how the old pipeline made an
 * evidence-free scan look confident.
 */
import type {
  AiAnalysis, AiConditionFinding, PhotoSlot, EvidenceSource, ValidationDowngrade,
  DerivedConditionSummary, PhotoContribution,
} from "../../shared/canonical.types.js";

// ─── Limits (schema cannot enforce these) ─────────────────────────────────────

const LIMITS = {
  generic_item_name: 70,
  entry_chars: 80,
  // Evidence maps: exist to cover every field, so allowed to be long.
  observable_field_evidence: 24,
  identification_evidence: 12,
  era_evidence: 8,
  conflicting_era_evidence: 8,
  condition_findings: 8,
  // Ordinary descriptive arrays.
  descriptive: 6,
} as const;

/** certainty >= 80 AND concrete evidence AND location AND slot AND value-affecting. */
const OBVIOUS_CERTAINTY = 80;

/** Photography artefacts. A finding whose evidence reads like one of these is
 *  demoted regardless of stated certainty — the model cannot reliably tell a
 *  shadow from a stain, and a false damage warning costs more trust than a
 *  missed one costs money. */
const ARTEFACT_PATTERNS = [
  /\bshadow/i, /\bfold(ed|ing|s)?\b/i, /\bwrinkl/i, /\bglare\b/i,
  /\breflect/i, /\blighting\b/i, /\bcompression\b/i, /\bartifact/i,
  /normal (fabric )?texture/i, /intentional(ly)? distress/i,
];

export interface ValidationInput {
  ai: AiAnalysis;
  photoSlotsProvided: PhotoSlot[];
  /** Non-core categories cap identity confidence unless something is legible. */
  coreCategories?: Set<string>;
}

export interface ValidationOutput {
  /** A CLONE. `ai` is never mutated — the original stays auditable. */
  cleaned: AiAnalysis;
  downgrades: ValidationDowngrade[];
  rejectedFields: string[];
  confidenceCaps: string[];
  conditionSummary: DerivedConditionSummary;
  photoContributions: PhotoContribution[];
  identityConfidence: number;
  eraConfidenceCeiling: number;
  meaningfulPhotoCount: number;
}

const CORE_CATEGORIES = new Set(["clothing", "shoes", "bags"]);

const clampInt = (n: unknown, lo = 0, hi = 100): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(lo, Math.min(hi, v));
};

/**
 * Stable identity for one condition finding, used to match a recorded conflict
 * back to the exact fact it disputes.
 *
 * Exported and shared so the validator (which writes conflicts) and the listing
 * path (which reads them) build the key identically. Two hand-rolled key
 * formats drifting apart is the same class of bug this exists to prevent.
 *
 * Normalised because "Left Elbow" and "left elbow" are the same place.
 */
export function conditionFactKey(type: string, location: string): string {
  return `${type.trim().toLowerCase()}@${location.trim().toLowerCase()}`;
}

/**
 * How confident may an era conclusion be, given the evidence behind it?
 *
 * Replaces a flat photo-count ceiling. The governing idea: uncertainty about
 * the DECADE is not uncertainty about whether an item is broadly old or new,
 * and a broad classification should not be punished for lacking exact dating.
 *
 * Style-only evidence stays low on purpose — a faded boxy graphic tee looks old
 * and may be a 2023 reprint, which is exactly the false positive the era system
 * exists to prevent.
 */
function deriveEraCeiling(ai: AiAnalysis, photoCount: number): number {
  // A user statement is authoritative; nothing here applies.
  if (ai.era.era_evidence.some(e => e.photo_slot === "user_confirmed" && e.type !== "style_only")) {
    return 100;
  }

  const ev = ai.era.era_evidence;
  const substantive = ev.filter(e => e.type !== "style_only");
  const styleOnly = ev.length > 0 && substantive.length === 0;

  // Independent means separate observations, not one detail restated. Distinct
  // evidence TYPES is the closest proxy the schema gives us.
  const independent = new Set(substantive.map(e => e.type)).size;
  const modernConflict = ai.era.conflicting_era_evidence.some(
    c => /modern|qr|rfid|heat[- ]transfer|tagless|url/i.test(c.observation),
  );

  // Photo count is a modifier, not a gate: a second useful photo genuinely does
  // add corroboration, but its absence no longer collapses the conclusion.
  const photoBonus = photoCount >= 2 ? 8 : 0;

  switch (ai.era.era_status) {
    case "modern": {
      // Contemporary construction, tags and printing are visually obvious in a
      // way that dating an old garment is not.
      if (styleOnly) return 65;
      return Math.min(95, 75 + independent * 5 + photoBonus);
    }
    case "likely_vintage": {
      // The case the 55 ceiling was breaking. Several coherent age signals can
      // support a useful broad judgement with no printed date anywhere.
      if (styleOnly) return 55;              // appearance alone stays weak
      if (independent === 0) return 55;
      if (modernConflict) return 60;         // a modern marker outweighs looks
      const base = independent >= 3 ? 78 : independent === 2 ? 72 : 65;
      return Math.min(90, base + photoBonus);
    }
    case "confirmed_vintage":
      // Route A / B caps in era.ts are stricter and authoritative here; this
      // only prevents an unsupported claim sneaking past them.
      return styleOnly ? 55 : 100;
    case "vintage_inspired":
      return 85;
    default:
      return 100;   // unknown needs no ceiling
  }
}

export function validateAnalysis(input: ValidationInput): ValidationOutput {
  const ai = structuredClone(input.ai);
  const slots = new Set(input.photoSlotsProvided);
  const core = input.coreCategories ?? CORE_CATEGORIES;

  const downgrades: ValidationDowngrade[] = [];
  const rejectedFields: string[] = [];
  const confidenceCaps: string[] = [];

  const down = (
    rule_id: string, field: string, from: string, to: string,
    internal: string, user = "", show = false,
  ) => downgrades.push({
    rule_id, field, from, to, internal_detail: internal,
    user_message: user, show_to_user: show,
  });

  const cap = (label: string) => confidenceCaps.push(label);

  // ── A. Confidence bounds ────────────────────────────────────────────────────
  ai.identification.brand_confidence   = clampInt(ai.identification.brand_confidence);
  ai.identification.identity_confidence = clampInt(ai.identification.identity_confidence);
  ai.visible_attributes.color_confidence    = clampInt(ai.visible_attributes.color_confidence);
  ai.visible_attributes.material_confidence = clampInt(ai.visible_attributes.material_confidence);
  ai.condition.condition_confidence         = clampInt(ai.condition.condition_confidence);
  ai.marketability.marketability_confidence = clampInt(ai.marketability.marketability_confidence);
  ai.pricing.price_confidence               = clampInt(ai.pricing.price_confidence);
  ai.era.era_confidence                     = clampInt(ai.era.era_confidence);

  // ── B. Phantom-slot rejection (runs BEFORE trimming so a discarded entry
  //      cannot displace a real one) ─────────────────────────────────────────
  const dropPhantom = <T extends { photo_slot: EvidenceSource }>(arr: T[], field: string): T[] =>
    arr.filter(e => {
      // user_confirmed is a legitimate source, not a phantom slot. The user held
      // the item; there is no photograph to cite and none should be invented.
      if (e.photo_slot === "user_confirmed") return true;
      if (!slots.has(e.photo_slot)) {
        down("EVIDENCE_PHANTOM_SLOT", field, e.photo_slot, "discarded",
             `cited ${e.photo_slot}; supplied: ${[...slots].join(",") || "none"}`);
        return false;
      }
      return true;
    });

  ai.identification.identification_evidence =
    dropPhantom(ai.identification.identification_evidence, "identification_evidence");
  ai.photo_evidence.observable_field_evidence =
    dropPhantom(ai.photo_evidence.observable_field_evidence, "observable_field_evidence");
  ai.condition.condition_findings =
    dropPhantom(ai.condition.condition_findings, "condition_findings");

  // ── C. Trimming, with priority ──────────────────────────────────────────────
  const trim = <T>(arr: T[], max: number, field: string, keepFirst?: (a: T, b: T) => number): T[] => {
    if (arr.length <= max) return arr;
    const sorted = keepFirst ? [...arr].sort(keepFirst) : arr;
    down("ARRAY_TRIMMED", field, String(arr.length), String(max),
         `kept ${max} highest-value entries`);
    return sorted.slice(0, max);
  };

  ai.identification.identification_evidence = trim(
    ai.identification.identification_evidence, LIMITS.identification_evidence,
    "identification_evidence",
    (a, b) => (a.evidence_mode === "direct_transcription" ? -1 : 0) -
              (b.evidence_mode === "direct_transcription" ? -1 : 0),
  );
  ai.photo_evidence.observable_field_evidence = trim(
    ai.photo_evidence.observable_field_evidence, LIMITS.observable_field_evidence,
    "observable_field_evidence");
  ai.era.era_evidence = trim(
    ai.era.era_evidence, LIMITS.era_evidence, "era_evidence",
    (a, b) => rankStrength(a.proposed_strength) - rankStrength(b.proposed_strength));
  ai.era.conflicting_era_evidence = trim(
    ai.era.conflicting_era_evidence, LIMITS.conflicting_era_evidence, "conflicting_era_evidence");
  ai.condition.condition_findings = trim(
    ai.condition.condition_findings, LIMITS.condition_findings, "condition_findings",
    (a, b) => b.certainty - a.certainty);

  const descriptive: Array<[string[], string]> = [
    [ai.visible_attributes.secondary_colors, "secondary_colors"],
    [ai.visible_attributes.material_composition, "material_composition"],
    [ai.visible_attributes.style_labels, "style_labels"],
    [ai.photo_evidence.missing_or_unreadable_evidence, "missing_or_unreadable_evidence"],
    [ai.condition.visible_condition_observations, "visible_condition_observations"],
    [ai.condition.condition_unknowns, "condition_unknowns"],
    [ai.marketability.marketability_reasons, "marketability_reasons"],
    [ai.pricing.pricing_basis, "pricing_basis"],
    [ai.pricing.pricing_unknowns, "pricing_unknowns"],
    [ai.risks.risk_flags, "risk_flags"],
    [ai.risks.authenticity_concerns, "authenticity_concerns"],
    [ai.risks.escalation_signals, "escalation_signals"],
  ];
  for (const [arr, field] of descriptive) {
    if (arr.length > LIMITS.descriptive) {
      down("ARRAY_TRIMMED", field, String(arr.length), String(LIMITS.descriptive), "descriptive array");
      arr.length = LIMITS.descriptive;
    }
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].length > LIMITS.entry_chars) arr[i] = arr[i].slice(0, LIMITS.entry_chars).trimEnd();
    }
  }

  if (ai.identification.generic_item_name.length > LIMITS.generic_item_name) {
    const from = ai.identification.generic_item_name;
    ai.identification.generic_item_name =
      from.slice(0, LIMITS.generic_item_name).replace(/\s+\S*$/, "");
    down("NAME_TRUNCATED", "generic_item_name", from, ai.identification.generic_item_name,
         "exceeded 70 characters");
  }

  // ── D. Era words must not survive in the base name ───────────────────────────
  const eraWord = /^\s*(vintage|y2k|retro|antique)\b[\s-]*/i;
  if (eraWord.test(ai.identification.generic_item_name)) {
    const from = ai.identification.generic_item_name;
    ai.identification.generic_item_name = from.replace(eraWord, "").trim();
    down("NAME_ERA_WORD_IN_BASE", "generic_item_name", from, ai.identification.generic_item_name,
         "base name must stay era-neutral; validated prefixes are applied in derived");
  }

  // ── E. Identification evidence ──────────────────────────────────────────────
  const evForField = (f: string) =>
    ai.identification.identification_evidence.filter(e => e.field === f);

  if (ai.identification.canonical_brand.trim() && evForField("canonical_brand").length === 0) {
    down("BRAND_NO_EVIDENCE", "canonical_brand", ai.identification.canonical_brand, "",
         "brand claimed with no supporting evidence object",
         "We could not confirm the brand from the photos.", true);
    ai.identification.canonical_brand = "";
    ai.identification.brand_confidence = 0;
    rejectedFields.push("canonical_brand");
  }

  // Transcription is a declared mode now, not a guess from prose.
  for (const f of ["product_line", "model_or_product_number"] as const) {
    const value = ai.identification[f];
    if (!value.trim()) continue;
    const transcribed = evForField(f).some(e => e.evidence_mode === "direct_transcription");
    if (!transcribed) {
      down("MODEL_NOT_TRANSCRIBED", f, value, "",
           "requires evidence_mode=direct_transcription; inference cannot populate it");
      ai.identification[f] = "";
      rejectedFields.push(f);
    }
  }

  let identityConfidence = ai.identification.identity_confidence;
  const populated = (["item_type", "subtype", "subject", "team", "artist", "event",
                      "character_or_license"] as const)
    .filter(f => ai.identification[f].trim());
  const unevidenced = populated.filter(f => evForField(f).length === 0);
  if (unevidenced.length) {
    const from = identityConfidence;
    identityConfidence = Math.max(0, identityConfidence - 15 * unevidenced.length);
    down("IDENTITY_UNEVIDENCED_FIELDS", "identity_confidence", String(from), String(identityConfidence),
         `unevidenced: ${unevidenced.join(", ")}`);
  }

  // ── F. Observable-field evidence ────────────────────────────────────────────
  const obsFields = new Set(ai.photo_evidence.observable_field_evidence.map(e => e.field));
  // ── Consequential vs incidental fields ──────────────────────────────────
  // Evidence is required for anything that dates the item, identifies a
  // specific product, or moves its value. Plainly visible descriptive facts
  // (colour, hood, logo placement) do not need a prose evidence object — the
  // photo settles them, and demanding one spent output tokens for no gain.
  //
  // The exception that matters: an incidental field becomes consequential the
  // moment a recognition definition reads it. That check lives in the matcher,
  // which already excludes unevidenced features from scoring.
  if (ai.visible_attributes.size_label.trim() && !obsFields.has("size_label")) {
    down("ATTR_NO_EVIDENCE", "visible_attributes.size_label",
         ai.visible_attributes.size_label, "", "populated attribute with no observable_field_evidence");
    ai.visible_attributes.size_label = "";
    ai.visible_attributes.size_system = "unknown";
    rejectedFields.push("visible_attributes.size_label");
  }
  if (ai.visible_attributes.primary_color.trim() && !obsFields.has("primary_color")) {
    down("ATTR_NO_EVIDENCE", "visible_attributes.primary_color",
         ai.visible_attributes.primary_color, "", "populated attribute with no observable_field_evidence");
    ai.visible_attributes.primary_color = "";
    ai.visible_attributes.color_confidence = 0;
    rejectedFields.push("visible_attributes.primary_color");
  }
  if (ai.visible_attributes.material_composition.length &&
      !obsFields.has("material_composition")) {
    down("ATTR_NO_EVIDENCE", "visible_attributes.material_composition",
         ai.visible_attributes.material_composition.join(","), "", "no supporting evidence");
    ai.visible_attributes.material_composition = [];
    ai.visible_attributes.material_confidence = 0;
  }
  // Material composition is consequential: it changes value and can date an
  // item. Required regardless of how it was obtained.
  // A visual guess must score lower than a legible tag reading.
  if (ai.visible_attributes.material_source === "visual_estimate" &&
      ai.visible_attributes.material_confidence > 60) {
    cap("material_confidence -> 60 (visual estimate, not read from a tag)");
    ai.visible_attributes.material_confidence = 60;
  }
  // ── Target department ───────────────────────────────────────────────────────
  //
  // Historical scans have no such field, so a missing value defaults to unknown
  // rather than failing validation.
  //
  // The confidence cap is the point of this block: visual cut alone is weak
  // evidence, and a confident "womens" derived from a silhouette is both often
  // wrong and the kind of wrong that reads badly. Tag wording or user
  // confirmation may go high; anything else is capped.
  const dept = (ai.visible_attributes as any).target_department ?? "unknown";
  const deptConf = (ai.visible_attributes as any).target_department_confidence ?? 0;
  if (dept !== "unknown" && dept !== "unisex") {
    const deptEvidence = ai.photo_evidence.observable_field_evidence.some(
      e => e.field === "target_department",
    );
    const fromTagOrUser =
      ai.visible_attributes.size_source === "tag_legible" ||
      ai.visible_attributes.size_source === "user_confirmed" ||
      deptEvidence;
    if (!fromTagOrUser && deptConf > 55) {
      down("DEPARTMENT_VISUAL_ONLY", "visible_attributes.target_department_confidence",
           String(deptConf), "55",
           "department inferred from appearance only; capped");
      (ai.visible_attributes as any).target_department_confidence = 55;
    }
  }

  // Size is transcription-only. Never inferred from appearance.
  //
  // user_confirmed passes: the user read the tag in their hand, which is a
  // transcription — just not one the camera performed. Without this exemption a
  // user typing "Size XL" had it silently deleted, which is exactly the failure
  // this feature exists to prevent.
  if (ai.visible_attributes.size_label.trim() &&
      ai.visible_attributes.size_source !== "tag_legible" &&
      ai.visible_attributes.size_source !== "user_confirmed") {
    down("SIZE_NOT_TRANSCRIBED", "visible_attributes.size_label",
         ai.visible_attributes.size_label, "", "size requires size_source=tag_legible");
    ai.visible_attributes.size_label = "";
    ai.visible_attributes.size_system = "unknown";
  }

  // ── G. Condition ────────────────────────────────────────────────────────────
  const isObvious = (f: AiConditionFinding): boolean => {
    if (!f.location.trim() || !f.evidence.trim()) return false;

    // Checked BEFORE the certainty floor, not after.
    //
    // A user-confirmed flaw is obvious by construction: someone was holding the
    // item. `certainty` is the MODEL's confidence in its own reading, which is
    // meaningless for a fact it did not observe — and gating on it meant a
    // user-reported tear the model scored below 80 was silently dropped before
    // the exemption could apply, so it never reached pricing.
    //
    // The photo-artefact test below exists because the model cannot tell a
    // shadow from a stain. A person can, so it does not apply here either.
    if (f.photo_slot === "user_confirmed") return true;

    if (f.certainty < OBVIOUS_CERTAINTY) return false;
    if (!slots.has(f.photo_slot)) return false;
    if (ARTEFACT_PATTERNS.some(p => p.test(f.evidence) || p.test(f.location))) return false;
    return true;
  };
  const obvious: AiConditionFinding[] = [];
  const informational: AiConditionFinding[] = [];
  for (const f of ai.condition.condition_findings) {
    if (isObvious(f)) obvious.push(f);
    else {
      informational.push(f);
      if (f.certainty >= OBVIOUS_CERTAINTY) {
        down("CONDITION_ARTEFACT_DEMOTED", "condition_findings", `${f.type}@${f.certainty}`,
             "informational", `evidence reads as a photography artefact: "${f.evidence.slice(0, 60)}"`);
      }
    }
  }
  const severityRank = { none: 0, minor: 1, moderate: 2, major: 3 } as const;
  const maxSeverity = obvious.reduce<DerivedConditionSummary["max_obvious_severity"]>(
    (acc, f) => {
      const s = (f.severity === "unknown" ? "minor" : f.severity) as keyof typeof severityRank;
      return severityRank[s] > severityRank[acc] ? s : acc;
    }, "none");

  const conditionSummary: DerivedConditionSummary = {
    obvious_findings: obvious,
    informational_findings: informational,
    has_obvious_damage: obvious.length > 0,
    max_obvious_severity: maxSeverity,
    assessment_limited: ai.condition.condition_unknowns.length > 0,
  };

  // ── H. Pricing ──────────────────────────────────────────────────────────────
  const range = ai.pricing.ai_estimated_resale_range;
  const bad = (why: string) => {
    down("PRICE_INVALID", "ai_estimated_resale_range",
         `${range.low}-${range.high}`, "null", why);
    range.low = null; range.high = null;
    ai.pricing.price_confidence = Math.min(ai.pricing.price_confidence, 30);
  };
  const finite = (n: number | null) => n != null && Number.isFinite(n);
  if (finite(range.low) !== finite(range.high)) bad("low and high must be null together");
  else if (finite(range.low) && finite(range.high)) {
    if ((range.low as number) < 0 || (range.high as number) < 0) bad("negative price");
    else {
      if ((range.low as number) > (range.high as number)) {
        const t = range.low; range.low = range.high; range.high = t;
        down("PRICE_SWAPPED", "ai_estimated_resale_range", "low>high", "swapped", "");
      }
      if ((range.high as number) > 50000 ||
          ((range.low as number) > 0 && (range.high as number) > (range.low as number) * 200)) {
        bad("implausible range");
      } else if ((range.low as number) > 0 &&
                 (range.high as number) > (range.low as number) * 6) {
        cap("price_confidence -> 40 (range wider than 6x)");
        ai.pricing.price_confidence = Math.min(ai.pricing.price_confidence, 40);
      }
    }
  }
  if (!ai.pricing.pricing_basis.length) {
    cap("price_confidence -> 40 (no stated basis)");
    ai.pricing.price_confidence = Math.min(ai.pricing.price_confidence, 40);
  }

  // ── I. Authenticity ─────────────────────────────────────────────────────────
  if (ai.risks.authenticity_concerns.length) {
    cap("identity_confidence -> 60 (authenticity concerns present)");
    identityConfidence = Math.min(identityConfidence, 60);
  }

  // ── J. Meaningful photos ────────────────────────────────────────────────────
  // A slot is meaningful only when it contributed evidence to an actual
  // requirement. A tag photo showing only a size supports nothing.
  const contributions: PhotoContribution[] = [];
  for (const slot of input.photoSlotsProvided) {
    const reqs = new Set<PhotoContribution["requirements_supported"][number]>();
    const refs: string[] = [];
    // Only real photographs contribute. user_confirmed evidence is authoritative
    // but it is not a photo, and letting it satisfy the two-meaningful-photo
    // rule would let a typed note unlock a Diamond.
    for (const e of ai.identification.identification_evidence) {
      if (e.photo_slot !== slot) continue;
      if (e.field === "canonical_brand") { reqs.add("brand_identity"); refs.push(e.observation); }
      if (e.field === "product_line" || e.field === "model_or_product_number") {
        reqs.add("specific_product_identity"); refs.push(e.observation);
      }
    }
    for (const e of ai.era.era_evidence) {
      if (e.photo_slot === slot && e.type !== "style_only" && e.type !== "country_of_manufacture") {
        reqs.add("era_qualification"); refs.push(e.observation);
      }
    }
    for (const f of ai.condition.condition_findings) {
      if (f.photo_slot === slot && f.certainty >= OBVIOUS_CERTAINTY) {
        reqs.add("condition_requirement"); refs.push(f.evidence);
      }
    }
    for (const e of ai.photo_evidence.observable_field_evidence) {
      if (e.photo_slot === slot &&
          ["closure_type","collar_type","hood_present","logo_identity","logo_placement",
           "logo_scale","construction_signals","stitching_signals","tag_characteristics",
           "material_signals"].includes(e.field)) {
        reqs.add("diamond_definition_requirement"); refs.push(e.observation);
      }
    }
    contributions.push({
      slot,
      requirements_supported: [...reqs],
      evidence_refs: refs.slice(0, 6),
    });
  }
  const meaningfulPhotoCount = contributions.filter(c => c.requirements_supported.length > 0).length;

  // ── Source conflict: user-confirmed vs photo-derived ────────────────────────
  //
  // Both are kept. Neither silently wins. The user held the item so their fact
  // stands, but a photo showing the opposite is real information the user
  // deserves to see — a note typed about the wrong item is a common mistake and
  // silently deferring to it would hide the one signal that reveals it.
  //
  // Recorded as a downgrade so it appears in derived.validation and can surface
  // in the UI without inventing a second channel.
  const userFindings = ai.condition.condition_findings.filter(f => f.photo_slot === "user_confirmed");
  const photoFindings = ai.condition.condition_findings.filter(f => f.photo_slot !== "user_confirmed");
  for (const uf of userFindings) {
    const contradicting = photoFindings.find(pf =>
      pf.location.trim().toLowerCase() === uf.location.trim().toLowerCase() &&
      pf.type !== uf.type,
    );
    if (contradicting) {
      // `from` carries the exact fact key, not just the category. Recording the
      // category alone meant one disputed finding suppressed EVERY
      // user-confirmed condition fact from the listing — so a note reading
      // "hole in elbow, zipper broken" lost the undisputed broken zipper too,
      // shipping a listing with an undisclosed defect.
      down("SOURCE_CONFLICT", "condition.condition_findings",
           conditionFactKey(uf.type, uf.location), `photo:${contradicting.type}`,
           `user-confirmed and photo-derived findings disagree at ${uf.location}; both retained`,
           `You reported ${uf.type.replace(/_/g, " ")} at the ${uf.location}, but the photos show ${contradicting.type.replace(/_/g, " ")} there. Both are kept — worth a second look.`,
           true);
    }
  }

  // ── K. Confidence ceilings ──────────────────────────────────────────────────
  const n = input.photoSlotsProvided.length;
  const identityCeiling = n <= 1 ? 75 : 100;

  // ── Era ceiling: evidence-based, not photo-count-based ──────────────────────
  //
  // The old rule was `n <= 1 ? 55 : 100` — a flat 55% ceiling on any one-photo
  // era read. That treated photo COUNT as the measure of era certainty, which
  // it is not: one clear photo of a tee showing an older print, a period collar
  // and age-consistent wear carries three independent signals, while two blurry
  // photos of a blank hoodie carry none.
  //
  // The 55 ceiling was the reason genuine vintage kept surfacing as unknown —
  // the model would reach a reasonable likely_vintage conclusion and the
  // validator would cap it below the threshold where anything downstream
  // treated it as real.
  //
  // Confidence now scales with what the evidence actually supports. Photo count
  // still contributes, but as one input rather than a hard gate.
  const eraCeiling = deriveEraCeiling(ai, n);
  if (identityConfidence > identityCeiling) {
    cap(`identity_confidence ${identityConfidence} -> ${identityCeiling} (${n} photo${n === 1 ? "" : "s"})`);
    identityConfidence = identityCeiling;
  }
  // Non-core categories cap at 70 unless something identifying is legible.
  const legible = Boolean(ai.identification.model_or_product_number.trim() ||
                          ai.identification.product_line.trim());
  if (!core.has(ai.identification.broad_category) && !legible && identityConfidence > 70) {
    cap(`identity_confidence -> 70 (non-core category, no legible identification)`);
    identityConfidence = 70;
  }
  if (!ai.identification.identification_evidence.length && identityConfidence > 50) {
    cap("identity_confidence -> 50 (no identification evidence)");
    identityConfidence = 50;
  }

  ai.identification.identity_confidence = identityConfidence;

  return {
    cleaned: ai,
    downgrades,
    rejectedFields,
    confidenceCaps,
    conditionSummary,
    photoContributions: contributions,
    identityConfidence,
    eraConfidenceCeiling: eraCeiling,
    meaningfulPhotoCount,
  };
}

function rankStrength(s: string): number {
  return s === "hard" ? 0 : s === "strong_supporting" ? 1 : 2;
}