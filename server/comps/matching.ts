/**
 * server/comps/matching.ts
 *
 * Filtering and per-listing match scoring.
 *
 * The governing asymmetry: a CONTRADICTION is strong evidence of a mismatch,
 * while ABSENCE is not evidence of anything. A listing that omits the size is
 * still a fine comp; a listing that states a different exact model is not the
 * same product. Rejecting on absence is how you throw away every good comp and
 * conclude an item has no market.
 */
import type { CanonicalAnalysisV1 } from "../../shared/canonical.types.js";
import type { NormalizedSoldComp } from "./types.js";
import {
  canonicalPhrase, containsPhrase, containsAny, detectClosure, detectSpecialty, closureFromEnum,
  MATCH_ALGO_VERSION,
} from "./normalize.js";

export type RejectionReason =
  | "MISSING_TITLE" | "MISSING_SOLD_PRICE" | "WRONG_CURRENCY"
  | "WRONG_BRAND" | "WRONG_ITEM_TYPE" | "WRONG_MODEL" | "WRONG_SUBJECT"
  | "WRONG_TEAM" | "WRONG_DEPARTMENT" | "WRONG_ERA"
  | "MAIN_ITEM_VS_ACCESSORY" | "ACCESSORY_VS_MAIN_ITEM"
  | "BUNDLE_OR_LOT" | "PARTS_ONLY" | "REPRODUCTION_MISMATCH"
  | "CUSTOM_ITEM_MISMATCH" | "CHILD_VS_ADULT_MISMATCH"
  | "SEARCH_SPAM" | "DUPLICATE_RESULT"
  | "VALUE_DRIVING_SUBJECT_MISMATCH" | "CLOSURE_MISMATCH" | "PRODUCT_LINE_MISMATCH"
  | "BELOW_MIN_SCORE";

export interface ScoredComp {
  comp: NormalizedSoldComp;
  /** Passed every hard rule AND cleared MIN_ACCEPT_SCORE. */
  accepted: boolean;
  /** Passed the hard rules but scored below the floor. Debug only — never shown,
   *  never in the median. Kept because "why was nothing accepted" is otherwise
   *  unanswerable. */
  weak: boolean;
  matchClass: MatchClass;
  score: number;
  components: Record<string, number>;
  positives: string[];
  penalties: string[];
  rejection: RejectionReason | null;
  rejectionDetail: string | null;
  /** What the matcher read out of the listing title. */
  detected: {
    closure: string | null;
    specialty: Array<{ kind: string; match: string }>;
  };
}

/**
 * Weights, rebalanced.
 *
 * Brand plus item type was 40 of 100 — enough on its own to produce a score of
 * 50 with every value-driving fact unexamined, which is precisely what put a
 * $100 Yankees hoodie next to a plain one. Brand and type now total 30, and the
 * traits that actually separate products carry the difference.
 */
const W = {
  model: 22,        // exact model dominates jeans, sneakers, technical gear
  subject: 18,      // team / artist / licence often IS the value
  itemType: 16,
  brand: 14,        // necessary, never sufficient
  closure: 12,      // decisive for hoodies and jackets
  material: 8,
  era: 6,
  department: 2,
  size: 2,
};

/**
 * Minimum score to be shown to a user or enter the median.
 *
 * The Polo failure displayed two comps at 50 and called them a median. A score
 * in the fifties means brand and category agreed and little else was checked, so
 * the floor sits above that. Weak candidates are retained for debugging but do
 * not reach the screen.
 */
/**
 * Calibrated from measured scores, not chosen.
 *
 * With the score normalised against achievable weight, legitimate comps land
 * 77-92 and the traits that make a listing genuinely incomparable — team,
 * closure, youth, premium line, wrong model — are HARD REJECTS rather than
 * deductions. So the floor's job is narrow: catch weak survivors, not
 * substitute for the reject rules.
 *
 * 70 passes a good comp whose title omits closure, size and department (77) and
 * fails anything materially looser.
 */
export const MIN_ACCEPT_SCORE = 70;
export const STRONG_SCORE = 85;

export type MatchClass = "strong" | "moderate" | "weak";

const BUNDLE   = ["lot", "bundle", "wholesale", "reseller lot", "job lot", "set of", "bulk", "pallet"];
const PARTS    = ["for parts", "parts only", "not working", "repair", "as is", "damaged", "salvage"];
const ACCESSORY= ["sticker", "decal", "patch", "keychain", "pin", "magnet", "poster", "manual",
                  "brochure", "catalog", "zipper pull", "replacement zipper", "button", "label only",
                  "tag only", "engine", "carburetor", "exhaust", "piston", "brake", "sprocket",
                  "chain", "mirror", "helmet", "gloves", "windshield", "fairing"];
const KIDS     = ["youth", "kids", "toddler", "infant", "baby", "boys", "girls", "junior"];
const REPRO    = ["reprint", "reproduction", "repro", "modern reprint", "new with tags", "nwt", "custom made", "bootleg"];

/** Item-type families. A hoodie is not a fleece jacket, and treating them as
 *  interchangeable is how a $12 comp lands against a $60 item. */
const TYPE_FAMILY: Record<string, string[]> = {
  tee: ["tee"], hoodie: ["hoodie"], sweatshirt: ["sweatshirt"],
  fleece: ["fleece"], jacket: ["jacket"], "quarter zip": ["quarter zip"],
  jeans: ["jeans"], pants: ["pants"], shorts: ["shorts"],
  polo: ["polo"], vest: ["vest"], hat: ["hat", "cap"], bag: ["bag"],
};

function familyOf(itemType: string): string | null {
  const c = canonicalPhrase(itemType);
  for (const [fam, words] of Object.entries(TYPE_FAMILY)) {
    if (words.some(w => containsPhrase(c, w))) return fam;
  }
  return null;
}

export function scoreComp(
  c: CanonicalAnalysisV1,
  comp: NormalizedSoldComp,
  seenIds: Set<string>,
): ScoredComp {
  const id = c.ai.identification;
  const title = comp.title;
  const t = canonicalPhrase(title);
  const parts: Record<string, number> = {};
  /**
   * Which components could have scored at all.
   *
   * The score must be a percentage of what was ACHIEVABLE, not of a theoretical
   * 100. A plain hoodie has no model number and no technical material, so those
   * weights are unearnable — leaving them in the denominator capped every
   * clothing comp in the fifties regardless of how well it actually matched.
   */
  const applicable: Record<string, number> = {};
  const canScore = (k: keyof typeof W) => { applicable[k] = W[k]; };
  const positives: string[] = [];
  const penalties: string[] = [];
  let specDetectedRef: Array<{ kind: string; match: string }> = [];
  let listClosureRef: string | null = null;
  const reject = (r: RejectionReason, detail = ""): ScoredComp => ({
    comp, accepted: false, weak: false, matchClass: "weak", score: 0,
    components: parts, positives, penalties, rejection: r, rejectionDetail: detail || null,
    detected: { closure: listClosureRef, specialty: specDetectedRef },
  });

  if (seenIds.has(comp.externalId)) return reject("DUPLICATE_RESULT", "");
  if (!title) return reject("MISSING_TITLE", "");
  if (!(comp.soldPrice > 0)) return reject("MISSING_SOLD_PRICE", "");
  if (comp.currency && comp.currency !== "USD") return reject("WRONG_CURRENCY", "");

  // ── Hard rejects: these are different products, not weaker comps ───────────
  if (containsAny(t, BUNDLE)) return reject("BUNDLE_OR_LOT", "title indicates a multi-item lot");
  if (containsAny(t, PARTS))  return reject("PARTS_ONLY", "title indicates parts or damaged");

  const wantAccessory = containsAny(canonicalPhrase(id.item_type), ACCESSORY);
  const isAccessory = containsAny(t, ACCESSORY);
  if (isAccessory && !wantAccessory) return reject("ACCESSORY_VS_MAIN_ITEM", "listing is an accessory, scan is the main item");
  if (!isAccessory && wantAccessory) return reject("MAIN_ITEM_VS_ACCESSORY", "scan is an accessory, listing is the main item");

  // ── Product line, checked BEFORE brand ─────────────────────────────────────
  //
  // Purple Label IS Ralph Lauren, so a brand check would reject it as "wrong
  // brand" — technically excluding it, but for a misleading reason that would
  // send anyone debugging in the wrong direction. The real problem is that
  // Purple Label trades in a different market entirely.
  const scanSpecialtyEarly = detectSpecialty(
    [id.generic_item_name, id.product_line, id.subject, id.team].join(" "),
  );
  const listSpecialtyEarly = detectSpecialty(title);
  specDetectedRef = listSpecialtyEarly;
  const scanPremium = scanSpecialtyEarly.find(s => s.kind === "premium_line");
  const listPremium = listSpecialtyEarly.find(s => s.kind === "premium_line");
  if ((listPremium?.match ?? null) !== (scanPremium?.match ?? null)) {
    return reject("PRODUCT_LINE_MISMATCH",
      `listing line "${listPremium?.match ?? "none"}" vs scan "${scanPremium?.match ?? "none"}"`);
  }

  // ── Exact model ────────────────────────────────────────────────────────────
  const model = id.model_or_product_number.trim();
  if (model) {
    canScore("model");
    if (containsPhrase(t, model)) {
      parts.model = W.model; positives.push(`model ${model}`);
    } else {
      // A stated DIFFERENT model number is a contradiction, not an omission.
      const otherModel = /\b\d{3,4}\b/.test(t) && !containsPhrase(t, model);
      if (otherModel) return reject("WRONG_MODEL", `listing states a different model than ${model}`);
      parts.model = 0; penalties.push("model not stated");
    }
  }

  // ── Brand ──────────────────────────────────────────────────────────────────
  const brand = id.canonical_brand.trim();
  if (brand) {
    canScore("brand");
    if (containsPhrase(t, brand)) { parts.brand = W.brand; positives.push(`brand ${brand}`); }
    else return reject("WRONG_BRAND", `brand "${brand}" absent from listing`);
  }

  // ── Item type ──────────────────────────────────────────────────────────────
  const wantFam = familyOf(id.item_type);
  if (wantFam) {
    canScore("itemType");
    const gotFam = familyOf(title);
    if (gotFam === wantFam) { parts.itemType = W.itemType; positives.push(`item type ${wantFam}`); }
    else if (gotFam && gotFam !== wantFam) return reject("WRONG_ITEM_TYPE", "");
    else { parts.itemType = W.itemType * 0.35; penalties.push("item type not stated"); }
  }

  // ── Subject / specialty — checked in BOTH directions ────────────────────────
  //
  // THE ROOT CAUSE of the Yankees failure. The old code only ran this when the
  // SCANNED item had a subject, so a plain Polo hoodie skipped it entirely and a
  // team-branded listing was never examined for the team it carried. A
  // contradiction that only one side can trigger is not a contradiction check.
  //
  // A specialty trait on the listing that the scanned item lacks is a hard
  // reject: the team, the collab or the premium line IS the price difference, so
  // the two are different products rather than imperfect comps.
  const scanSubjects = [id.subject, id.team, id.artist, id.event, id.character_or_license]
    .map(s => s.trim()).filter(Boolean);
  const scanSpecialty = scanSpecialtyEarly;
  const listingSpecialty = listSpecialtyEarly;

  canScore("subject");
  const valueDriving = listingSpecialty.filter(s => s.kind !== "premium_line");
  if (valueDriving.length > 0) {
    // Does the scanned item share it? Compared on the matched phrase so
    // "Yankees" and "New York Yankees" count as the same thing.
    const shared = valueDriving.filter(ls =>
      scanSubjects.some(ss => containsPhrase(ss, ls.match) || containsPhrase(ls.match, ss)) ||
      scanSpecialty.some(ss => ss.match === ls.match),
    );
    if (shared.length === 0) {
      return reject("VALUE_DRIVING_SUBJECT_MISMATCH",
        `listing has ${valueDriving.map(s => `${s.kind}:${s.match}`).join(", ")}; scanned item has none`);
    }
    parts.subject = W.subject;
    positives.push(`shared ${shared.map(s => s.match).join(", ")}`);
  } else if (scanSubjects.length) {
    // Scanned item HAS a subject; the listing must mention it.
    const hit = scanSubjects.find(s => containsPhrase(t, s) ||
      s.split(" ").filter(w => w.length > 3).some(w => containsPhrase(t, w)));
    if (hit) { parts.subject = W.subject; positives.push(`subject ${hit}`); }
    else {
      return reject("WRONG_SUBJECT", `scanned subject "${scanSubjects[0]}" absent from listing`);
    }
  } else {
    // Neither side has a subject — a plain item matching a plain item.
    // Both plain is genuine compatibility, but it is the ABSENCE of a
    // differentiator rather than a positive identity match, so it earns less
    // than a shared team or licence would.
    parts.subject = W.subject * 0.7;
    positives.push("both plain, no specialty");
  }

  // ── Closure ────────────────────────────────────────────────────────────────
  // Decisive for hoodies and jackets. Absence in the listing is neutral; a
  // stated DIFFERENT closure is a different garment.
  // The enum value is authoritative; the prose is a fallback for when features
  // is omitted (recognition disabled).
  const scanClosure = closureFromEnum(c.ai.features?.closure_type ?? "")
    ?? detectClosure([id.item_type, id.subtype, id.generic_item_name].join(" "));
  if (scanClosure) canScore("closure");
  const listClosure = detectClosure(title);
  listClosureRef = listClosure;
  if (scanClosure && listClosure && scanClosure !== listClosure) {
    return reject("CLOSURE_MISMATCH", `scan ${scanClosure} vs listing ${listClosure}`);
  }
  if (scanClosure && listClosure === scanClosure) {
    parts.closure = W.closure; positives.push(`closure ${scanClosure}`);
  } else {
    // 25%, not 50%. Absence is not a contradiction, but it is not evidence of a
    // match either — and at half credit a listing that stated nothing scored the
    // same as one that stated everything, which is how every comp landed at 59.
    parts.closure = W.closure * 0.25;
    if (scanClosure) penalties.push("closure not stated in listing");
  }

  // ── Era ────────────────────────────────────────────────────────────────────
  const era = c.derived.era_effective.status;
  const titleVintage = containsAny(t, ["vintage", "1990s", "1980s", "2000s", "retro"]);
  const titleRepro = containsAny(t, REPRO);
  if (era === "confirmed_vintage" || era === "likely_vintage") {
    if (titleRepro) return reject("REPRODUCTION_MISMATCH", "");
    // Absence of the word "vintage" is not a contradiction — plenty of genuine
    // old items are listed without it.
    parts.era = titleVintage ? W.era : W.era * 0.25;
    if (titleVintage) positives.push("era wording matches");
  } else if (era === "modern" && titleVintage) {
    parts.era = 0; penalties.push("listing claims vintage, item is modern");
  } else {
    // Modern scan, no vintage claim in the title: genuinely consistent, not
    // merely unknown. Full credit.
    parts.era = W.era;
    positives.push("era consistent");
  }
  canScore("era");

  // ── Department ─────────────────────────────────────────────────────────────
  const dept = (c.ai.visible_attributes as { target_department?: string }).target_department ?? "unknown";
  const titleKids = containsAny(t, KIDS);
  if (dept === "kids" && !titleKids) return reject("CHILD_VS_ADULT_MISMATCH", "");
  // A youth listing is rejected unless we KNOW our item is kids — including
  // when our department is unknown.
  //
  // This looks like it violates "absence is not contradiction", and it is a
  // deliberate exception. Youth clothing is a separate market that trades at a
  // fraction of adult prices, so a youth comp in an adult set does not weaken
  // the median, it corrupts it. Most scans are adult items, so defaulting to
  // exclusion is right far more often than it is wrong — and when the item
  // genuinely IS kids, target_department says so and these are kept.
  if (dept !== "kids" && titleKids) return reject("CHILD_VS_ADULT_MISMATCH", "");
  if (dept === "mens" && containsPhrase(t, "womens")) return reject("WRONG_DEPARTMENT", "");
  if (dept === "womens" && containsPhrase(t, "mens")) return reject("WRONG_DEPARTMENT", "");
  canScore("department");
  parts.department = dept === "unknown" ? W.department * 0.25 : W.department;

  // ── Size: bonus only. Missing size must never sink a strong match ──────────
  const size = c.ai.visible_attributes.size_label.trim();
  if (size) canScore("size");
  parts.size = size && containsPhrase(t, size) ? W.size : W.size * 0.25;

  const earned = Object.entries(parts)
    .filter(([k]) => applicable[k] !== undefined)
    .reduce((a, [, v]) => a + v, 0);
  const possible = Object.values(applicable).reduce((a, b) => a + b, 0);
  const score = possible > 0 ? Math.round(Math.min(100, (earned / possible) * 100)) : 0;
  seenIds.add(comp.externalId);

  // The floor. A listing can clear every hard rule and still be too loose a
  // comparison to show someone — brand plus category agreeing is not a comp.
  const matchClass: MatchClass =
    score >= STRONG_SCORE ? "strong" : score >= MIN_ACCEPT_SCORE ? "moderate" : "weak";
  const accepted = score >= MIN_ACCEPT_SCORE;

  return {
    comp, accepted, weak: !accepted, matchClass, score,
    components: parts, positives, penalties,
    rejection: accepted ? null : "BELOW_MIN_SCORE",
    rejectionDetail: accepted ? null : `score ${score} below floor ${MIN_ACCEPT_SCORE}`,
    detected: { closure: listClosureRef, specialty: specDetectedRef },
  };
}

export const MATCH_VERSION = MATCH_ALGO_VERSION;