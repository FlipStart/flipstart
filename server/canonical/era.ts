/**
 * Era validation — the server's judgement over the model's observations.
 *
 * The model proposes evidence and a strength. It does not get to decide what
 * counts. This file re-derives effective strength, resolves a production year,
 * reconciles against a dynamic vintage cutoff, and selects one of three routes
 * to confirmed_vintage.
 *
 * Route A          direct hard manufacturing evidence. Can carry an exact decade.
 * Standard Route B two independent strong manufacturing clues. Broad vintage.
 *                  Title says "Vintage", but no vintage Diamond.
 * Enhanced Route B Standard plus clue-class corroboration, three total clues,
 *                  two meaningful photos, confidence >= 90. Diamond allowed.
 *
 * Enhanced exists because most genuinely old garments carry no printed date.
 * Requiring one would reject the exact items the feature celebrates. The
 * safeguard is corroboration across independent clue CLASSES instead: a modern
 * reproduction copies the graphic, not the seam construction and care-label
 * symbol set.
 */
import type {
  AiEra, AiEraEvidence, EraStatus, EvidenceStrength, ProductionDecade,
  EffectiveEraEvidence, DerivedEraEffective, EnhancedRouteBAssessment,
  PhotoSlot,
} from "../../shared/canonical.types.js";

// ─── Evidence classification ──────────────────────────────────────────────────

const DECADE_BOUNDS: Record<string, [number, number]> = {
  pre_1950s: [1800, 1949], "1950s": [1950, 1959], "1960s": [1960, 1969],
  "1970s": [1970, 1979], "1980s": [1980, 1989], "1990s": [1990, 1999],
  "2000s": [2000, 2009], "2010s": [2010, 2019], "2020s": [2020, 2029],
};

/** Physical tag/label clues. Enhanced Route B needs at least one. */
const LABEL_CLASS = new Set([
  "documented_tag_format", "care_label_format", "union_label", "logo_version",
]);

/** Physical construction clues. Enhanced needs one of these OR a second label clue. */
const CONSTRUCTION_CLASS = new Set([
  "construction", "stitching", "hardware", "material_technology",
]);

/** Never counts toward a required manufacturing clue. May corroborate only. */
const ALWAYS_WEAK = new Set(["style_only", "country_of_manufacture"]);

/**
 * Union names, with the period each actually covers.
 *
 * UNITE is the reason this table exists: it was FORMED in 1995 by the
 * ILGWU/ACTWU merger and ran to 2004, so a UNITE label means 1995 or LATER.
 * Prompt v1.0.0 grouped all three as "pre-1995", which would have dated
 * 1995-2004 items as vintage — a false positive in the direction the era system
 * exists to prevent. Names are matched individually, never as a group.
 */
const UNION_ERAS: Array<{ pattern: RegExp; supports: string; note: string }> = [
  { pattern: /\bilgwu\b/i,      supports: "vintage_broad", note: "ILGWU dissolved 1995" },
  { pattern: /\bactwu\b/i,      supports: "vintage_broad", note: "ACTWU 1976-1995" },
  { pattern: /\bunite\s*here\b/i, supports: "modern_broad", note: "UNITE HERE formed 2004" },
  { pattern: /\bunite!?\b/i,    supports: "unknown",        note: "UNITE 1995-2004 — straddles most cutoffs" },
];

/** Dates the physical object. The only types that can be `hard`. */
const MANUFACTURING_DATE_TYPES = new Set(["manufacturing_date", "model_or_date_code"]);

/** Dates the artwork or licence, NOT the object. Capped at strong_supporting.
 *  A 1994 copyright appears on shirts printed in 2020. */
const ARTWORK_DATE_TYPES = new Set(["copyright_date", "dated_event"]);

/**
 * Types that can only reach `hard` on a trusted-reference match.
 *
 * The registry does not exist yet, so every one of these caps at
 * strong_supporting — which is exactly what Standard and Enhanced Route B
 * consume, so broad vintage detection is unaffected. What it prevents is the
 * model's own recollection of a tag generation setting an exact decade.
 */
const REFERENCE_DEPENDENT = new Set([
  ...LABEL_CLASS, ...CONSTRUCTION_CLASS,
]);

/**
 * Generic traits that vary by brand, category, country, market and garment
 * type. They may support a period but can never on their own establish a
 * decade or confirmed vintage, regardless of how the model types them.
 *
 * Matching is on the OBSERVATION text because the model chooses the type: a
 * "Made in USA" reading submitted as documented_tag_format would otherwise
 * inherit strong_supporting and count toward Route B on its own.
 */
const GENERIC_TRAIT_PATTERNS: RegExp[] = [
  // Country of manufacture and styling have their own always-weak types. These
  // patterns catch the same claims submitted under a stronger type, which would
  // otherwise let them count toward Route B.
  /\bmade in\b/i,
  /\bcountry of (manufacture|origin)\b/i,
  /\btag colou?r\b/i,
  /\bfad(ed|ing)\b/i,
  /\bdistress(ed|ing)\b/i,
  /\bboxy\b/i,
  /\boversized\b/i,
  /\blooks? (old|vintage|worn)\b/i,
];

// NOTE ON WHAT IS DELIBERATELY *NOT* HERE:
// woven vs printed tags, tagless printing, stacked labels, care-symbol format,
// single/double stitch. Those are genuine physical manufacturing clues, and
// combining two independent ones is precisely what Standard Route B is for.
// They are already prevented from doing damage alone:
//   - they can never reach `hard` (REFERENCE_DEPENDENT, no registry yet)
//   - they can never set production_decade (that needs hard evidence)
//   - one alone cannot satisfy Route B, which requires two independent clues
// Demoting them to weak would have re-created the system where a printed
// manufacturing date is practically required for any confirmed vintage.

/** Modern markers that must be DIRECTLY visible to support modern_broad. */
const VISIBLE_MODERN_PATTERNS: RegExp[] = [
  /\bqr\b/i, /\brfid\b/i, /\burl\b/i, /https?:\/\//i, /\bscan (me|to)\b/i,
];

/**
 * Whether a `supports` value indicates pre-cutoff production.
 *
 * Computed from the cutoff, never hardcoded. The straddle decade moves every
 * few years, and hardcoding it silently excludes real vintage: with a 2006
 * cutoff a 2001 item IS vintage, even though its decade (2000s) also contains
 * post-cutoff years.
 *
 * The straddle decade is ambiguous alone. It counts as pre-cutoff only when a
 * resolved production year lands on or before the cutoff — the same rule that
 * stops a 2008 item passing as vintage.
 */
function supportsPreCutoff(
  supports: string, cutoffYear: number, resolvedYear: number | null,
): boolean {
  if (supports === "vintage_broad") return true;
  if (supports === "modern_broad" || supports === "unknown") return false;
  const bounds = DECADE_BOUNDS[supports];
  if (!bounds) return false;
  const [lo, hi] = bounds;
  if (hi <= cutoffYear) return true;
  if (lo > cutoffYear) return false;
  return resolvedYear != null && resolvedYear <= cutoffYear;
}

function supportsModern(
  supports: string, cutoffYear: number, resolvedYear: number | null,
): boolean {
  if (supports === "modern_broad") return true;
  if (supports === "vintage_broad" || supports === "unknown") return false;
  const bounds = DECADE_BOUNDS[supports];
  if (!bounds) return false;
  const [lo, hi] = bounds;
  if (lo > cutoffYear) return true;
  if (hi <= cutoffYear) return false;
  return resolvedYear != null && resolvedYear > cutoffYear;
}

export interface EraValidationLog {
  rule_id: string;
  field: string;
  from: string;
  to: string;
  internal_detail: string;
  user_message: string;
  show_to_user: boolean;
}

export interface EraValidationInput {
  era: AiEra;
  photoSlotsProvided: PhotoSlot[];
  /** Slots that produced evidence supporting an actual requirement. */
  meaningfulPhotoCount: number;
  vintageCutoffYear: number;
  /** Ceiling from photo count. Applied AFTER route selection — see below. */
  eraConfidenceCeiling: number;
}

export interface EraValidationResult {
  effective: DerivedEraEffective;
  logs: EraValidationLog[];
}

// ─── Effective strength ───────────────────────────────────────────────────────

/**
 * Server-owned. The model's proposed_strength is a suggestion; this is the
 * verdict. Without it, a model could route around every decade rule simply by
 * labelling a styling observation `hard`.
 */
function deriveEffectiveStrength(
  ev: AiEraEvidence,
  referenceMatched: boolean,
): { strength: EvidenceStrength; reason: string | null } {
  // A directly visible modern marker is real evidence of recency.
  if (ev.supports === "modern_broad" &&
      VISIBLE_MODERN_PATTERNS.some(p => p.test(ev.observation))) {
    return {
      strength: ev.proposed_strength === "hard" ? "strong_supporting" : ev.proposed_strength,
      reason: ev.proposed_strength === "hard"
        ? "a visible modern marker supports modern_broad but is not hard dating evidence"
        : null,
    };
  }

  if (ALWAYS_WEAK.has(ev.type)) {
    return ev.proposed_strength === "weak_supporting"
      ? { strength: "weak_supporting", reason: null }
      : { strength: "weak_supporting", reason: `${ev.type} is always weak_supporting` };
  }

  if (ARTWORK_DATE_TYPES.has(ev.type)) {
    if (ev.proposed_strength === "hard") {
      return {
        strength: "strong_supporting",
        reason: `${ev.type} dates the artwork or event, not the physical item`,
      };
    }
    return { strength: ev.proposed_strength, reason: null };
  }

  if (MANUFACTURING_DATE_TYPES.has(ev.type)) {
    // Only these can be hard, and only with a readable year.
    if (ev.proposed_strength === "hard" && ev.observed_year == null) {
      return {
        strength: "strong_supporting",
        reason: "hard manufacturing evidence requires a legible observed_year",
      };
    }
    return { strength: ev.proposed_strength, reason: null };
  }

  // Union labels: each name covers a different period, so the claimed `supports`
  // is reconciled against the name actually transcribed. A UNITE label claimed
  // as vintage_broad is corrected, not trusted.
  if (ev.type === "union_label") {
    const hit = UNION_ERAS.find(u => u.pattern.test(ev.observation));
    if (!hit) {
      return {
        strength: "weak_supporting",
        reason: "union label with no legible union name — cannot date",
      };
    }
    if (hit.supports === "unknown") {
      return {
        strength: "weak_supporting",
        reason: `${hit.note}; period is ambiguous on its own`,
      };
    }
    if (ev.supports !== hit.supports && ev.supports !== "unknown") {
      return {
        strength: "weak_supporting",
        reason: `claimed ${ev.supports} but ${hit.note}`,
      };
    }
    return {
      strength: ev.proposed_strength === "hard" ? "strong_supporting" : ev.proposed_strength,
      reason: ev.proposed_strength === "hard"
        ? "a union mark supports a period but is not hard dating evidence" : null,
    };
  }

  if (REFERENCE_DEPENDENT.has(ev.type)) {
    // A generic trait cannot carry a specific type's weight. This is checked
    // before the registry rule because the model picks the type, and a generic
    // observation typed as documented_tag_format would otherwise count toward
    // Route B on its own.
    if (GENERIC_TRAIT_PATTERNS.some(p => p.test(ev.observation))) {
      return ev.proposed_strength === "weak_supporting"
        ? { strength: "weak_supporting", reason: null }
        : {
            strength: "weak_supporting",
            reason: "generic tag or construction trait — varies by brand, category and country",
          };
    }
    if (ev.proposed_strength === "hard" && !referenceMatched) {
      return {
        strength: "strong_supporting",
        reason: `${ev.type} is hard only on a trusted reference match; registry not populated`,
      };
    }
    return { strength: ev.proposed_strength, reason: null };
  }

  // "other" and anything unlisted: never hard.
  if (ev.proposed_strength === "hard") {
    return { strength: "strong_supporting", reason: `${ev.type} cannot be hard evidence` };
  }
  return { strength: ev.proposed_strength, reason: null };
}

// ─── Production year ──────────────────────────────────────────────────────────

/** Years that merely reference a patent, technology, or label origin. These lose
 *  to a directly verified manufacturing date — and crucially they are
 *  systematically OLDER than manufacture, so an earliest-wins rule would bias
 *  every scan toward false vintage. */
const REFERENCE_YEAR_TYPES = new Set([
  "material_technology", "logo_version", "documented_tag_format",
  "union_label", "care_label_format",
]);

function resolveProductionYear(
  evidence: EffectiveEraEvidence[],
): {
  year: number | null;
  source: DerivedEraEffective["production_year_source"];
  conflict: { a: EffectiveEraEvidence; b: EffectiveEraEvidence } | null;
} {
  const qualifying = evidence.filter(
    e => e.effective_strength === "hard" &&
         MANUFACTURING_DATE_TYPES.has(e.type) &&
         typeof e.observed_year === "number",
  );
  if (qualifying.length === 0) return { year: null, source: "none", conflict: null };

  // Deterministic priority: a verified manufacturing date or date code beats a
  // year that only references something older.
  const direct = qualifying.filter(e => !REFERENCE_YEAR_TYPES.has(e.type));
  const pool = direct.length > 0 ? direct : qualifying;

  const years = [...new Set(pool.map(e => e.observed_year as number))];
  if (years.length === 1) {
    return {
      year: years[0],
      source: pool.length > 1
        ? "agreed_multiple"
        : (pool[0].type === "manufacturing_date"
            ? "verified_manufacturing_date"
            : "verified_date_code"),
      conflict: null,
    };
  }

  // Conflicting years with no winner. NOT the earliest — null.
  return {
    year: null,
    source: "conflict_unresolved",
    conflict: { a: pool[0], b: pool[1] },
  };
}

// ─── Cutoff ───────────────────────────────────────────────────────────────────

/** The decade containing the cutoff. Computed, never hardcoded, so the rule
 *  survives every year rolling forward. */
export function straddleDecade(cutoffYear: number): ProductionDecade {
  for (const [dec, [lo, hi]] of Object.entries(DECADE_BOUNDS)) {
    if (cutoffYear >= lo && cutoffYear <= hi) return dec as ProductionDecade;
  }
  return "unknown";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function validateEra(input: EraValidationInput): EraValidationResult {
  const { era, meaningfulPhotoCount, vintageCutoffYear, eraConfidenceCeiling } = input;
  const logs: EraValidationLog[] = [];
  const slots = new Set(input.photoSlotsProvided);

  const log = (
    rule_id: string, field: string, from: string, to: string,
    internal: string, user = "", show = false,
  ) => logs.push({
    rule_id, field, from, to,
    internal_detail: internal, user_message: user, show_to_user: show,
  });

  // 1. Discard evidence citing a slot that was never supplied.
  //    user_confirmed is exempt: the user read the tag in their hand, so there
  //    is no photo to cite. It still passes through the normal evidence
  //    hierarchy below — a user reading "Made in USA" is a real tag fact but
  //    still cannot alone establish an exact decade or confirmed vintage.
  const slotFiltered = era.era_evidence.filter(e => {
    if (e.photo_slot === "user_confirmed") return true;
    if (!slots.has(e.photo_slot)) {
      log("ERA_PHANTOM_SLOT", "era.era_evidence", e.photo_slot, "discarded",
          `evidence cited ${e.photo_slot}, supplied slots: ${[...slots].join(",")}`);
      return false;
    }
    return true;
  });

  // 2. De-duplicate. Two phrasings of one observation is ONE clue.
  const seen = new Set<string>();
  const deduped = slotFiltered.filter(e => {
    const key = e.observation.trim().toLowerCase();
    if (seen.has(key)) {
      log("ERA_DUPLICATE_EVIDENCE", "era.era_evidence", e.observation, "merged",
          "duplicate observation counted once");
      return false;
    }
    seen.add(key);
    return true;
  });

  // 3. Server-owned effective strength.
  const effective: EffectiveEraEvidence[] = deduped.map(e => {
    const referenceMatched = false; // registry not populated — see module header
    const { strength, reason } = deriveEffectiveStrength(e, referenceMatched);
    if (reason) {
      log("ERA_STRENGTH_DOWNGRADE", "era_evidence.effective_strength",
          e.proposed_strength, strength, `${e.type}: ${reason}`);
    }
    return { ...e, effective_strength: strength, downgrade_reason: reason, reference_matched: referenceMatched };
  });

  // 4. Production year.
  const yearRes = resolveProductionYear(effective);
  const conflicts = [...era.conflicting_era_evidence]
    .filter(c => c.photo_slot === "user_confirmed" || slots.has(c.photo_slot));
  if (yearRes.conflict) {
    conflicts.push({
      observation: `Manufacturing year ${yearRes.conflict.a.observed_year} (${yearRes.conflict.a.type})`,
      conflicts_with: `Manufacturing year ${yearRes.conflict.b.observed_year} (${yearRes.conflict.b.type})`,
      proposed_strength: "hard",
      photo_slot: yearRes.conflict.a.photo_slot,
    });
    log("ERA_YEAR_CONFLICT", "production_year_effective", "conflicting", "null",
        "qualifying manufacturing years disagree with no deterministic winner");
  }

  const hardConflict = conflicts.some(c => c.proposed_strength === "hard");
  const modernEvidence = effective.filter(
    e => supportsModern(e.supports, vintageCutoffYear, yearRes.year) &&
         e.effective_strength !== "weak_supporting",
  );
  const unresolvedModern = modernEvidence.length > 0;

  // 5. Manufacturing clues supporting pre-cutoff production.
  const mfgClues = effective.filter(
    e => !ALWAYS_WEAK.has(e.type) &&
         !ARTWORK_DATE_TYPES.has(e.type) &&
         supportsPreCutoff(e.supports, vintageCutoffYear, yearRes.year) &&
         (e.effective_strength === "hard" || e.effective_strength === "strong_supporting"),
  );
  const hardMfg = mfgClues.filter(e => e.effective_strength === "hard");

  // 6. Route selection — BEFORE any confidence cap, because Enhanced requires
  //    >= 90 while Standard caps at 85. Capping first makes Enhanced unreachable.
  let status: EraStatus = era.era_status;
  let route: DerivedEraEffective["confirmed_vintage_route"] = null;
  let cap = eraConfidenceCeiling;
  let enhanced: EnhancedRouteBAssessment | null = null;
  let vintageForUnlocks = false;

  const wantsVintage = era.era_status === "confirmed_vintage";

  // User-confirmed era evidence that speaks to PRODUCTION, not styling. A
  // style_only claim is excluded on purpose: "this is Y2K style" describes the
  // look, not when it was made, and must never confirm vintage.
  // Independent corroborating age observations — everything pointing older that
  // is NOT itself one of the strong manufacturing clues. Style is permitted
  // here and only here.
  const corroborating = effective.filter(
    e => e.supports !== "modern_broad" &&
         !mfgClues.includes(e) &&
         !ARTWORK_DATE_TYPES.has(e.type),
  );

  // Route U selector: user statements that could CONFIRM VINTAGE. Excludes
  // modern_broad on purpose — "this is modern" must not open a vintage route.
  const userEra = effective.filter(
    e => e.photo_slot === "user_confirmed" &&
         e.type !== "style_only" &&
         e.supports !== "modern_broad",
  );

  // Confidence selector: ANY user era statement, including "this is modern".
  // Separate from the above because the two questions differ — Route U asks
  // "can this confirm vintage", this asks "did the user state the era". A user
  // saying the item is modern is exactly as authoritative as one saying it is
  // vintage, and using the Route U list left "Modern" stuck at the model's own
  // number while every other phrasing reached 100.
  const userEraAny = effective.filter(
    e => e.photo_slot === "user_confirmed" && e.type !== "style_only",
  );

  if (wantsVintage) {
    if (unresolvedModern || hardConflict) {
      status = "likely_vintage";
      log("ERA_MODERN_CONFLICT", "era.era_status", "confirmed_vintage", "likely_vintage",
          unresolvedModern
            ? `modern evidence present: ${modernEvidence.map(e => e.type).join(", ")}`
            : "unresolved hard era conflict",
          "We could not confirm this as vintage because some details look modern.", true);
      cap = Math.min(cap, 60);
    } else if (userEra.length > 0) {
      // ── Route U: the user told us, while holding the item ─────────────────
      //
      // Checked BEFORE A and B because it answers a different question. A and B
      // ask "did the photos prove age?"; U asks "did a person who can see the
      // item say so?" Requiring photo proof before accepting the user's own
      // statement made the feature pointless — "this is vintage" came back as
      // likely_vintage with the decade discarded.
      //
      // vintageForUnlocks stays FALSE. Analysis truth and reward eligibility
      // are separate: the item is vintage, and a typed sentence still cannot
      // unlock a Diamond.
      route = "U";
      vintageForUnlocks = false;
      // 100, not 95. FlipStart is fully confident about what the user
      // explicitly reported — that is a statement about the REPORT, not an
      // independent authentication. Capping at 95 was a hedge with no meaning:
      // there is no residual doubt about what someone typed.
      cap = Math.min(cap, 100);
      log("ERA_USER_CONFIRMED", "confirmed_vintage_route", "none", "U",
          `user-confirmed era: ${userEra.map(e => e.type).join(", ")}`,
          "", false);
    } else if (hardMfg.length >= 1 && mfgClues.length >= 2) {
      route = "A";
      vintageForUnlocks = true;
      cap = Math.min(cap, 100);
    } else if (mfgClues.length === 1 && corroborating.length >= 2) {
      // ── Route B-corroborated ────────────────────────────────────────────────
      //
      // One strong manufacturing clue plus two independent corroborating age
      // observations. Added because genuine vintage without a printed date was
      // coming back unknown constantly: most old garments have exactly one
      // readable manufacturing signal, and demanding two meant the common case
      // failed.
      //
      // Style may be ONE corroborator but can never be the strong clue, and at
      // least one corroborator must come from a different part of the item —
      // three observations of the same tag are one piece of evidence described
      // three ways, not three pieces of evidence.
      const strong = mfgClues[0];
      const differentArea = corroborating.some(
        c => c.photo_slot !== strong.photo_slot ||
             (!LABEL_CLASS.has(c.type) && LABEL_CLASS.has(strong.type)),
      );
      if (differentArea) {
        route = "B_standard";
        vintageForUnlocks = false;
        cap = Math.min(cap, 85);
        log("ERA_ROUTE_B_CORROBORATED", "confirmed_vintage_route", "none", "B_standard",
            `1 strong clue (${strong.type}) + ${corroborating.length} corroborating`,
            "", false);
      }
    } else if (mfgClues.length >= 2) {
      // Standard reached. Test Enhanced.
      const labelClue = mfgClues.find(e => LABEL_CLASS.has(e.type)) ?? null;
      const constrClue = mfgClues.find(
        e => (CONSTRUCTION_CLASS.has(e.type) || LABEL_CLASS.has(e.type)) &&
             e.observation !== labelClue?.observation,
      ) ?? null;
      const usedObs = new Set([labelClue?.observation, constrClue?.observation].filter(Boolean));
      const thirdClue = effective.find(e => !usedObs.has(e.observation)) ?? null;
      const totalUseful = effective.length;

      const unmet: string[] = [];
      if (meaningfulPhotoCount < 2) unmet.push(`needs 2 meaningful photos, found ${meaningfulPhotoCount}`);
      if (!labelClue) unmet.push("needs a tag/label manufacturing clue");
      if (!constrClue) unmet.push("needs a construction clue or a second independent label clue");
      if (totalUseful < 3) unmet.push(`needs 3 useful era clues, found ${totalUseful}`);

      enhanced = {
        qualified: unmet.length === 0,
        label_class_clue: labelClue?.type ?? null,
        construction_class_clue: constrClue?.type ?? null,
        third_clue: thirdClue?.type ?? null,
        total_useful_clues: totalUseful,
        meaningful_photo_count: meaningfulPhotoCount,
        unmet_requirements: unmet,
      };

      if (unmet.length === 0) {
        route = "B_enhanced";
        cap = Math.min(cap, 95);
        vintageForUnlocks = true;
      } else {
        route = "B_standard";
        cap = Math.min(cap, 85);
        vintageForUnlocks = false;
        unmet.push("BROAD_VINTAGE_REQUIRES_ENHANCED_VERIFICATION");
      }
    } else {
      status = "likely_vintage";
      log("ERA_INSUFFICIENT_MFG", "era.era_status", "confirmed_vintage", "likely_vintage",
          `needs 2 independent strong manufacturing clues, found ${mfgClues.length}`,
          "We lowered this from confirmed vintage because there was not enough physical age evidence.", true);
    }
  }

  // 7. Apply cap, then re-check the Enhanced confidence floor. A photo-slot
  //    ceiling can bite after route selection and drag confidence under 90.
  let confidence = Math.max(0, Math.min(100, Math.round(era.era_confidence)));

  // ── User-confirmed era is a FLOOR, not a ceiling ────────────────────────────
  //
  // Every other control here caps. Raising the cap for user-confirmed era did
  // nothing, because the model's own number passes straight through: it was
  // returning era_confidence 55 for a fact the user had stated outright, and 55
  // survived a ceiling of 100 untouched.
  //
  // There is no residual doubt about what somebody typed. 100 is a statement
  // about the REPORT — FlipStart is certain what the user said — not an
  // independent authentication of the item.
  //
  // Requires a non-style user_confirmed evidence entry, so "Y2K style" cannot
  // buy authoritative confidence for a production claim. A real contradiction
  // still wins: the conflict cap below is applied after this.
  const hasUserEra = userEraAny.length > 0;
  if (hasUserEra && confidence < 100) {
    log("ERA_CONFIDENCE_USER_AUTHORITATIVE", "era.era_confidence",
        String(confidence), "100",
        "era stated by the user; confidence reflects certainty about the statement",
        "", false);
    confidence = 100;
  }

  if (conflicts.length > 0) cap = Math.min(cap, 60);
  confidence = Math.min(confidence, cap);

  if (route === "B_enhanced" && confidence < 90) {
    route = "B_standard";
    cap = Math.min(cap, 85);
    confidence = Math.min(confidence, cap);
    vintageForUnlocks = false;
    if (enhanced) {
      enhanced.qualified = false;
      enhanced.unmet_requirements.push(
        `era_confidence ${confidence} below the 90 required for enhanced verification`,
        "BROAD_VINTAGE_REQUIRES_ENHANCED_VERIFICATION",
      );
    }
    log("ERA_ENHANCED_DEMOTED", "confirmed_vintage_route", "B_enhanced", "B_standard",
        "confidence fell below 90 after applying the photo-slot ceiling");
  }

  // 8. Production decade — needs hard manufacturing evidence for THAT decade.
  let decade: ProductionDecade = era.production_decade;
  if (decade !== "unknown") {
    const supported = effective.some(
      e => e.effective_strength === "hard" &&
           MANUFACTURING_DATE_TYPES.has(e.type) &&
           e.supports === decade,
    );
    // A user stating the decade is direct testimony from someone holding the
    // item — it does not need photographic corroboration to be recorded. The
    // hard-evidence rule exists to stop the MODEL inferring a decade from
    // styling; it was never meant to discard what the user actually said.
    // Excludes style_only: "Y2K styling" is not a production claim.
    const userStated = effective.some(
      e => e.photo_slot === "user_confirmed" &&
           e.type !== "style_only" &&
           e.supports === decade,
    );
    if (!supported && !userStated) {
      log("DECADE_NO_HARD_EVIDENCE", "era.production_decade", decade, "unknown",
          "no hard manufacturing evidence supports this decade");
      decade = "unknown";
    } else if (!supported && userStated) {
      log("DECADE_USER_CONFIRMED", "era.production_decade", decade, decade,
          "decade reported by the user, not photo-verified", "", false);
    }
  }

  // 9. Cutoff reconciliation.
  const straddle = straddleDecade(vintageCutoffYear);
  if (yearRes.year != null) {
    if (yearRes.year > vintageCutoffYear && status === "confirmed_vintage") {
      status = "modern";
      route = null;
      vintageForUnlocks = false;
      log("ERA_YEAR_AFTER_CUTOFF", "era.era_status", "confirmed_vintage", "modern",
          `production year ${yearRes.year} is after the cutoff ${vintageCutoffYear}`);
    }
  } else if (decade === straddle && route === "A") {
    // Decade-only evidence inside the straddle decade cannot confirm.
    route = "B_standard";
    vintageForUnlocks = false;
    cap = Math.min(cap, 85);
    confidence = Math.min(confidence, cap);
    log("ERA_STRADDLE_AMBIGUOUS", "confirmed_vintage_route", "A", "B_standard",
        `${decade} straddles the cutoff ${vintageCutoffYear} and no year-level evidence resolves it`);
  }

  if (status !== "confirmed_vintage") {
    route = null;
    vintageForUnlocks = false;
  }

  return {
    effective: {
      status,
      confidence,
      production_decade_effective: decade,
      straddle_decade: straddle,
      production_year_effective: yearRes.year,
      production_year_source: yearRes.source,
      cutoff_applied: vintageCutoffYear,
      confirmed_vintage_route: route,
      vintage_for_unlocks: vintageForUnlocks,
      enhanced_route_b: enhanced,
      evidence: effective,
    },
    logs,
  };
}

/** Y2K title eligibility. Requires a validated MANUFACTURING year in the window —
 *  style_era y2k alone never qualifies, and Route B cannot produce a year. */
export function qualifiesForY2kPrefix(e: DerivedEraEffective): boolean {
  // Photo-derived path: an exact year from a verified manufacturing source.
  // Unchanged — a Y2K prefix inferred from styling is exactly what this bars.
  const photoVerified =
    e.status === "confirmed_vintage" &&
    e.production_year_effective != null &&
    e.production_year_effective >= 1998 &&
    e.production_year_effective <= 2004 &&
    (e.production_year_source === "verified_manufacturing_date" ||
     e.production_year_source === "verified_date_code" ||
     e.production_year_source === "agreed_multiple");
  if (photoVerified) return true;

  // User-confirmed path.
  //
  // "Y2K" from someone holding the item IS a production-era claim. It spans
  // 1998-2004, so it yields no single year and no verified year source — which
  // meant the photo rule above could never pass and the prefix never appeared,
  // even with era_status already confirmed_vintage.
  //
  // Requires a user_confirmed evidence entry that actually names Y2K or the
  // millennium, and is NOT style_only: "Y2K style" describes the look and must
  // not produce a Y2K production prefix.
  const userY2k = e.evidence.some(
    ev => ev.photo_slot === "user_confirmed" &&
          ev.type !== "style_only" &&
          /\by2\s?k\b|\bmillennium\b/i.test(ev.observation),
  );
  return e.status === "confirmed_vintage" && userY2k;
}