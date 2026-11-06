/**
 * server/canonical/confidence.ts
 *
 * Computed identity confidence ("levels-v1").
 *
 * ── Why this replaced the old scoring ───────────────────────────────────────
 * The old number was the model's own 0-100 guess, then adjusted by the
 * validator: −15 for every identified field without an evidence object, a 75
 * ceiling on one-photo scans, 70 for non-clothing, 50 with no evidence. The
 * confidence report (Sep 29 – Oct 5, 163 scans) showed both halves failing:
 *
 *   - the model's guesses were coarse and wrong in both directions — almost
 *     everything 80/85/90, yet an AC/DC tee 50 and a McDonald's tee 40;
 *   - the adjustments lowered 30% of all scores, mostly for not citing
 *     evidence that a tee is a tee, and pushed clear photos onto the
 *     low-confidence screens.
 *
 * ── How it works now ────────────────────────────────────────────────────────
 * The model reports FACTS: how far it got (identification_level), whether
 * other items are in frame, and what limited the photo. Code turns those into
 * a score, checking each claim against the validated fields:
 *
 *   level    → band   (the band alone decides which screen the app shows)
 *   evidence → can raise the score inside its band, never lower it
 *   multiple items with a clear main one, photo problems → a few points off,
 *              still inside the band
 *
 * What each level needs from the validated fields:
 *   exact  a product line, model number or title read off the item, or a
 *          confirmed recognition match
 *   brand  a brand, or the team / artist / event / character the item is
 *          official merchandise for, that was SEEN or READ — and an item type.
 *          A printed place, slogan or graphic (the `subject` field) is not a
 *          brand: a Key West souvenir tee is a type-level identification.
 *   type   an item type
 * A level the fields don't support is lowered until they do. The only raises:
 * a brand or licensed name READ off the item lifts type or partial to brand,
 * and a confirmed recognition match lifts to exact.
 *
 * Photo count never sets the score. One clear photo of a legible tag is a
 * brand-level identification; extra photos only count through the evidence
 * they add.
 *
 * ── What users see: a tier, not a number ────────────────────────────────────
 * The level also gives the user-facing tier (shared/confidenceTier.ts):
 * exact / brand → HIGH, type → MEDIUM, partial → LOW, none → no tier (a
 * problem state). The tier comes from the level, so two scores in the same
 * band always show the same tier. One refinement: HIGH needs the identity to
 * be visible in a photo. A brand or model number that rests only on the
 * user's own camera note is used, but shown as MEDIUM — FlipStart didn't
 * confirm it.
 *
 * ── The score is a compatibility number, not a probability ──────────────────
 * The 0-100 score is ordinal: a position that keeps the shipped app working.
 * 86 does not mean "86% likely correct". App 2.1 (app/loading.tsx) shows the
 * very-low screen under 35, the low screen under 55, and results otherwise —
 * and treats exactly 0 as success. Every band sits wholly inside one of those
 * ranges and nothing returns 0, so the App Store build behaves correctly with
 * no EAS build. App 2.1 also prints the number ("86% Confidence") and adds a
 * "verify in person" caveat in Deep Analysis under 70: MEDIUM always gets it,
 * HIGH only when authenticity concerns hold the score at 60.
 *
 * Confidence is identification only. Nothing here reads price confidence,
 * sold comps, profit, demand, sell speed or the Buy / Strong Buy rating, and
 * nothing here decides them. Code that turns this score into a Buy rating, a
 * Diamond or a Hunt rating applies its own thresholds, and those rules live —
 * and are documented — where they run (utils/recommendation.ts,
 * server/recognition/matcher.ts, lib/hunt-context.tsx).
 */
import type {
  AiAnalysis, DerivedConfidence, DerivedRecognition, IdentificationLevel,
  ItemsInFrame, PhotoProblem, ScanIssue,
} from "../../shared/canonical.types.js";
import { tierForLevel } from "../../shared/confidenceTier.js";

export const CONFIDENCE_MODEL = "levels-v1" as const;

export const LEVELS: readonly IdentificationLevel[] = ["exact", "brand", "type", "partial", "none"];
const ITEMS: readonly ItemsInFrame[] = ["one", "multiple_main_clear", "multiple_unclear"];
const PROBLEMS: readonly PhotoProblem[] = ["blurry", "too_dark", "too_far", "glare", "cut_off", "no_item"];

/**
 * Score bands per level — compatibility positions for the number app 2.1
 * reads. A modifier moves a score inside its band and never out of it, so the
 * screen, the label and the tier all depend on the level alone.
 *
 *   level    band   tier    in app 2.1
 *   exact    85-97  HIGH    results, no "verify" caveat (70+)
 *   brand    74-90  HIGH    results, no "verify" caveat (70+)
 *   type     60-68  MEDIUM  results, with the "verify" caveat (< 70)
 *   partial  36-50  LOW     the low-confidence screen ("Continue anyway")
 *   none     15-25  —       the very-low screen
 *
 * These positions follow app 2.1's display thresholds, not any Buy rule. Where
 * a Buy rating, Diamond or Hunt rating needs a minimum score, that is a rule of
 * that code, stated where it lives.
 */
export const BANDS: Record<IdentificationLevel, { base: number; min: number; max: number }> = {
  exact:   { base: 90, min: 85, max: 97 },
  brand:   { base: 82, min: 74, max: 90 },
  type:    { base: 62, min: 60, max: 68 },
  partial: { base: 44, min: 36, max: 50 },
  none:    { base: 20, min: 15, max: 25 },
};

/** The photo shows no resale item at all. Very-low screen, never 0. */
export const NO_ITEM_SCORE = 10;
/**
 * Authenticity concerns hold the COMPATIBILITY score at 60. They do not change
 * the level or the tier: "what is this?" and "is it genuine?" are separate
 * questions, and a suspected-fake Supreme hoodie is still confidently a
 * Supreme hoodie. Authenticity stays its own signal (ai.risks.
 * authenticity_concerns, shown by the app).
 *
 * The hold stays because app 2.1's Buy rating has no authenticity input. It
 * reads only this number, and 60 is what keeps a suspected fake out of Strong
 * Buy (which needs 70+) and out of brand Diamonds (70+), as the old validator
 * did. Remove it only once every app in use reads authenticity directly.
 */
export const AUTHENTICITY_CAP = 60;
export const MULTIPLE_ITEMS_PENALTY = 5;
export const PHOTO_PROBLEM_PENALTY = 4;

/**
 * Official-merchandise identity. These count like a brand: an AC/DC tour tee
 * on an unknown blank is identified. `subject` — a printed place, slogan or
 * graphic — deliberately does not.
 */
const LICENSED_FIELDS = ["team", "artist", "event", "character_or_license"] as const;
const SPECIFIC_FIELDS = ["product_line", "model_or_product_number"] as const;
type IdField = "canonical_brand" | "item_type" | "subtype" | "subject"
  | typeof LICENSED_FIELDS[number] | typeof SPECIFIC_FIELDS[number];

/** Where a sighting came from, in the words the tier reason uses. */
const SLOT_PHRASE: Record<string, string> = {
  tag: "the tag", front: "the front photo", detail: "the detail photo", user_confirmed: "your note",
};

/** Which evidence can raise the score at each level, and by how much. */
const BONUS: Record<IdentificationLevel, { fields: IdField[]; perSighting: number; maxSightings: number; transcribed: number }> = {
  exact:   { fields: [...SPECIFIC_FIELDS, "canonical_brand", ...LICENSED_FIELDS], perSighting: 2, maxSightings: 3, transcribed: 1 },
  brand:   { fields: ["canonical_brand", ...LICENSED_FIELDS, ...SPECIFIC_FIELDS], perSighting: 2, maxSightings: 3, transcribed: 2 },
  type:    { fields: ["item_type", "subtype"], perSighting: 2, maxSightings: 3, transcribed: 0 },
  partial: { fields: [], perSighting: 0, maxSightings: 0, transcribed: 0 },
  none:    { fields: [], perSighting: 0, maxSightings: 0, transcribed: 0 },
};

const LEVEL_TEXT: Record<IdentificationLevel, string> = {
  exact: "Specific product identified",
  brand: "Brand or licensed name identified",
  type: "Item type identified, no brand visible",
  partial: "Only partly identified",
  none: "Couldn't identify the item",
};

const PROBLEM_TEXT: Record<PhotoProblem, string> = {
  blurry: "blurry", too_dark: "too dark", too_far: "too far away",
  glare: "glare", cut_off: "item cut off", no_item: "no item in the photo",
};

export interface ConfidenceInput {
  /** The VALIDATED analysis: unevidenced brands and untranscribed model
   *  numbers are already cleared, so "populated" means "survived validation". */
  ai: AiAnalysis;
  /** The model's own identity_confidence, clamped to 0-100. */
  aiSelfScore: number;
  recognition?: Pick<DerivedRecognition, "recognition_status"> | null;
}

export interface ConfidenceResult extends DerivedConfidence {
  /** Normalised values to write back onto the validated analysis. */
  normalized: {
    identification_level: IdentificationLevel;
    items_in_frame: ItemsInFrame;
    photo_problems: PhotoProblem[];
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function normalizeLevel(v: unknown): IdentificationLevel | null {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v) ? (v as IdentificationLevel) : null;
}
export function normalizeItems(v: unknown): ItemsInFrame {
  return typeof v === "string" && (ITEMS as readonly string[]).includes(v) ? (v as ItemsInFrame) : "one";
}
export function normalizeProblems(v: unknown): PhotoProblem[] {
  if (!Array.isArray(v)) return [];
  const out: PhotoProblem[] = [];
  for (const p of v) {
    if (typeof p === "string" && (PROBLEMS as readonly string[]).includes(p) && !out.includes(p as PhotoProblem)) {
      out.push(p as PhotoProblem);
    }
  }
  return out;
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { ai } = input;
  const id = ai.identification;
  const evidence = Array.isArray(id.identification_evidence) ? id.identification_evidence : [];
  const reasons: string[] = [];

  const populated = (f: IdField) => String((id as unknown as Record<string, unknown>)[f] ?? "").trim().length > 0;
  /**
   * Backed = SEEN or READ. An evidence object whose mode is "inference" means
   * the model concluded it from other things — a brand guessed from styling
   * survives validation (it has an evidence object) but is not an
   * identification, so it can neither hold the brand level nor add points.
   */
  const backed = (f: IdField) =>
    evidence.some(e => e.field === f && e.evidence_mode !== "inference");
  const transcribed = (f: IdField) =>
    evidence.some(e => e.field === f && e.evidence_mode === "direct_transcription");

  // Facts the level is checked against. A product line / model number only
  // survives validation when it was read off the item, so "populated" already
  // means "read" for those.
  const recognised = input.recognition?.recognition_status === "confirmed";
  const hasSpecific = SPECIFIC_FIELDS.some(populated) || recognised;
  const licensedBacked = LICENSED_FIELDS.filter(f => populated(f) && backed(f));
  const brandish = (populated("canonical_brand") && backed("canonical_brand")) || licensedBacked.length > 0;
  const brandishRead = (populated("canonical_brand") && transcribed("canonical_brand")) ||
    licensedBacked.some(f => transcribed(f));
  const hasType = populated("item_type");

  // ── Level ─────────────────────────────────────────────────────────────────
  const reported = normalizeLevel(id.identification_level);
  let level: IdentificationLevel;
  if (reported == null) {
    level = hasSpecific ? "exact"
      : brandish && hasType ? "brand"
      : hasType ? "type"
      : brandish ? "partial"
      : "none";
    reasons.push("No identification level reported — worked out from the identified fields");
  } else {
    // Lower a claim the validated fields don't support, one rung at a time.
    level = reported;
    const why: string[] = [];
    if (level === "exact" && !hasSpecific) {
      why.push("no product line, model number or title recorded");
      level = "brand";
    }
    if (level === "brand" && !brandish) {
      why.push("no brand or licensed name that was seen or read");
      level = "type";
    }
    if ((level === "brand" || level === "type") && !hasType) {
      why.push("no item type given");
      level = "partial";
    }
    if (level !== reported) reasons.push(`Lowered from ${reported} to ${level}: ${why.join("; ")}`);

    // Raises. A brand or licensed name READ off the item is an identified
    // brand even when the model didn't recognise it or undersold its answer.
    if ((reported === "type" || reported === "partial") && hasType && brandishRead) {
      reasons.push(`Raised from ${level} to brand: a brand or licensed name was read off the item`);
      level = "brand";
    }
    if (recognised && (level === "brand" || level === "type" || level === "partial")) {
      reasons.push(`Raised from ${level} to exact: matched a known product`);
      level = "exact";
    }
  }

  // ── Overrides ─────────────────────────────────────────────────────────────
  const items = normalizeItems(ai.photo_evidence?.items_in_frame);
  const problems = normalizeProblems(ai.photo_evidence?.photo_problems);
  const visualProblems = problems.filter(p => p !== "no_item");
  let issue: ScanIssue | null = null;

  if (problems.includes("no_item")) {
    level = "none";
    issue = "no_item";
  } else if (items === "multiple_unclear") {
    level = "none";
    issue = "multiple_items";
    reasons.push("Several items in the photo and none stands out");
  }

  reasons.unshift(LEVEL_TEXT[level]);

  // ── Score ─────────────────────────────────────────────────────────────────
  let score: number;
  if (issue === "no_item") {
    score = NO_ITEM_SCORE;
    reasons.push("The photo shows no item to identify");
  } else {
    const band = BANDS[level];
    score = band.base;

    const b = BONUS[level];
    if (b.fields.length) {
      const sightings = new Set(
        evidence
          .filter(e => (b.fields as string[]).includes(e.field) && populated(e.field as IdField) &&
                       e.evidence_mode !== "inference")
          .map(e => `${e.field}@${e.photo_slot}`),
      ).size;
      const counted = Math.min(sightings, b.maxSightings);
      if (counted > 0) {
        score += counted * b.perSighting;
        reasons.push(`+${counted * b.perSighting}: ${counted} supporting observation${counted === 1 ? "" : "s"}`);
      }
      const anyRead = b.transcribed > 0 && b.fields.some(f => populated(f) && transcribed(f));
      if (anyRead) {
        score += b.transcribed;
        reasons.push(`+${b.transcribed}: identifying text read directly off the item`);
      }
    }

    const scored = level === "exact" || level === "brand" || level === "type";
    if (scored && items === "multiple_main_clear") {
      score -= MULTIPLE_ITEMS_PENALTY;
      reasons.push(`−${MULTIPLE_ITEMS_PENALTY}: other items in the photo (analyzed the main one)`);
    }
    if (scored && visualProblems.length) {
      score -= PHOTO_PROBLEM_PENALTY;
      reasons.push(`−${PHOTO_PROBLEM_PENALTY}: photo ${visualProblems.map(p => PROBLEM_TEXT[p]).join(", ")}`);
    }

    const raw = score;
    score = clamp(score, band.min, band.max);
    if (score > raw) reasons.push(`Held at ${band.min}, the lowest score for ${level}`);
    if (score < raw) reasons.push(`Held at ${band.max}, the highest score for ${level}`);

    if (scored && Array.isArray(ai.risks?.authenticity_concerns) &&
        ai.risks.authenticity_concerns.length && score > AUTHENTICITY_CAP) {
      score = AUTHENTICITY_CAP;
      reasons.push(`Score held at ${AUTHENTICITY_CAP} for app 2.1: authenticity concerns (tier unaffected)`);
    }
  }

  if (!issue && (level === "partial" || level === "none")) {
    issue = visualProblems.length ? "photo_problem" : "cannot_identify";
    if (visualProblems.length) reasons.push(`Photo ${visualProblems.map(p => PROBLEM_TEXT[p]).join(", ")}`);
  }

  // ── User-facing tier and its one-line reason ──────────────────────────────
  // From the level: the score, the photo count, authenticity and every
  // non-identification signal play no part. HIGH also needs the identity to be
  // visible in a PHOTO — the brief defines it as identified "from visible
  // evidence" — so an identity resting only on the user's note shows MEDIUM.
  const inPhoto = (f: IdField) => populated(f) && evidence.some(e =>
    e.field === f && e.evidence_mode !== "inference" && e.photo_slot !== "user_confirmed");
  const identityInPhoto = recognised || SPECIFIC_FIELDS.some(inPhoto) ||
    inPhoto("canonical_brand") || LICENSED_FIELDS.some(inPhoto);
  let tier = tierForLevel(level);
  const noteOnly = tier === "high" && !identityInPhoto;
  if (noteOnly) tier = "medium";
  const clip = (s: string) => (s.length > 48 ? `${s.slice(0, 47).trimEnd()}…` : s);
  const value = (f: IdField) => String((id as unknown as Record<string, unknown>)[f] ?? "").trim();
  /** The strongest sighting of a field: a photo beats the user's note, read
   *  beats seen; inference never counts. */
  const sighting = (f: IdField) => {
    const seen = evidence.filter(e => e.field === f && e.evidence_mode !== "inference");
    const photo = seen.filter(e => e.photo_slot !== "user_confirmed");
    return photo.find(e => e.evidence_mode === "direct_transcription") ?? photo[0]
      ?? seen.find(e => e.evidence_mode === "direct_transcription") ?? seen[0];
  };
  const from = (f: IdField) => SLOT_PHRASE[String(sighting(f)?.photo_slot ?? "")] ?? "the photos";
  const problemNote = visualProblems.length
    ? ` (photo ${visualProblems.map(p => PROBLEM_TEXT[p]).join(", ")})` : "";

  let tierReason: string;
  if (issue === "no_item") {
    tierReason = "No item found in the photo";
  } else if (issue === "multiple_items") {
    tierReason = "Several items in the photo and none stands out";
  } else if (level === "exact") {
    const f = SPECIFIC_FIELDS.find(inPhoto) ?? SPECIFIC_FIELDS.find(populated);
    if (f) {
      const brand = populated("canonical_brand") && backed("canonical_brand") ? value("canonical_brand") : "";
      const name = brand && !value(f).toLowerCase().startsWith(brand.toLowerCase())
        ? `${brand} ${value(f)}` : value(f);
      tierReason = noteOnly ? `${clip(name)} from your note — not confirmed in the photos`
        : from(f) === SLOT_PHRASE.user_confirmed ? `${clip(name)} from your note`
        : `${clip(name)} read off ${from(f)}`;
    } else {
      tierReason = "Matched a known product from its details";
    }
  } else if (level === "brand") {
    // Name the identity a photo actually shows, when there is one.
    const f: IdField = inPhoto("canonical_brand") ? "canonical_brand"
      : LICENSED_FIELDS.find(inPhoto)
      ?? (populated("canonical_brand") && backed("canonical_brand") ? "canonical_brand"
        : (licensedBacked[0] ?? "canonical_brand"));
    tierReason = noteOnly ? `${clip(value(f))} from your note — not confirmed in the photos`
      : `${clip(value(f))} confirmed from ${from(f)}`;
  } else if (level === "type") {
    tierReason = populated("canonical_brand")
      ? "Item type identified, but the brand couldn't be confirmed"
      : "Item type identified, but no brand was visible";
  } else if (level === "partial") {
    tierReason = `Only part of the item could be identified${problemNote}`;
  } else {
    tierReason = `Couldn't tell what the item is${problemNote}`;
  }

  return {
    model: CONFIDENCE_MODEL,
    level_reported: reported ?? level,
    level,
    tier,
    tier_reason: tierReason,
    items_in_frame: items,
    photo_problems: problems,
    ai_self_score: clamp(Math.round(Number(input.aiSelfScore) || 0), 0, 100),
    score: Math.round(score),
    reasons,
    issue,
    normalized: {
      identification_level: reported ?? level,
      items_in_frame: items,
      photo_problems: problems,
    },
  };
}