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
  
  /** Dates the physical object. The only types that can be `hard`. */
  const MANUFACTURING_DATE_TYPES = new Set(["manufacturing_date", "model_or_date_code"]);
  
  /** Dates the artwork or licence, NOT the object. Capped at strong_supporting.
   *  A 1994 copyright appears on shirts printed in 2020. */
  const ARTWORK_DATE_TYPES = new Set(["copyright_date", "dated_event"]);
  
  /** `hard` only on a trusted-registry match, which does not exist yet, so these
   *  currently cap at strong_supporting. That is exactly what Route B consumes. */
  const REFERENCE_DEPENDENT = new Set([
    ...LABEL_CLASS, ...CONSTRUCTION_CLASS,
  ]);
  
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
  
    if (REFERENCE_DEPENDENT.has(ev.type)) {
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
    const slotFiltered = era.era_evidence.filter(e => {
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
    const conflicts = [...era.conflicting_era_evidence].filter(c => slots.has(c.photo_slot));
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
  
    if (wantsVintage) {
      if (unresolvedModern || hardConflict) {
        status = "likely_vintage";
        log("ERA_MODERN_CONFLICT", "era.era_status", "confirmed_vintage", "likely_vintage",
            unresolvedModern
              ? `modern evidence present: ${modernEvidence.map(e => e.type).join(", ")}`
              : "unresolved hard era conflict",
            "We could not confirm this as vintage because some details look modern.", true);
        cap = Math.min(cap, 60);
      } else if (hardMfg.length >= 1 && mfgClues.length >= 2) {
        route = "A";
        vintageForUnlocks = true;
        cap = Math.min(cap, 100);
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
      if (!supported) {
        log("DECADE_NO_HARD_EVIDENCE", "era.production_decade", decade, "unknown",
            "no hard manufacturing evidence supports this decade");
        decade = "unknown";
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
    return e.status === "confirmed_vintage" &&
           e.production_year_effective != null &&
           e.production_year_effective >= 1998 &&
           e.production_year_effective <= 2004 &&
           (e.production_year_source === "verified_manufacturing_date" ||
            e.production_year_source === "verified_date_code" ||
            e.production_year_source === "agreed_multiple");
  }