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
import { canonicalPhrase, containsPhrase, containsAny, MATCH_ALGO_VERSION } from "./normalize.js";

export type RejectionReason =
  | "MISSING_TITLE" | "MISSING_SOLD_PRICE" | "WRONG_CURRENCY"
  | "WRONG_BRAND" | "WRONG_ITEM_TYPE" | "WRONG_MODEL" | "WRONG_SUBJECT"
  | "WRONG_TEAM" | "WRONG_DEPARTMENT" | "WRONG_ERA"
  | "MAIN_ITEM_VS_ACCESSORY" | "ACCESSORY_VS_MAIN_ITEM"
  | "BUNDLE_OR_LOT" | "PARTS_ONLY" | "REPRODUCTION_MISMATCH"
  | "CUSTOM_ITEM_MISMATCH" | "CHILD_VS_ADULT_MISMATCH"
  | "SEARCH_SPAM" | "DUPLICATE_RESULT";

export interface ScoredComp {
  comp: NormalizedSoldComp;
  accepted: boolean;
  score: number;
  components: Record<string, number>;
  positives: string[];
  penalties: string[];
  rejection: RejectionReason | null;
}

/** Weights from the spec. Sum 100. */
const W = { model: 25, brand: 20, itemType: 20, subject: 15, era: 10, department: 5, size: 5 };

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
  const positives: string[] = [];
  const penalties: string[] = [];
  const reject = (r: RejectionReason): ScoredComp =>
    ({ comp, accepted: false, score: 0, components: parts, positives, penalties, rejection: r });

  if (seenIds.has(comp.externalId)) return reject("DUPLICATE_RESULT");
  if (!title) return reject("MISSING_TITLE");
  if (!(comp.soldPrice > 0)) return reject("MISSING_SOLD_PRICE");
  if (comp.currency && comp.currency !== "USD") return reject("WRONG_CURRENCY");

  // ── Hard rejects: these are different products, not weaker comps ───────────
  if (containsAny(t, BUNDLE)) return reject("BUNDLE_OR_LOT");
  if (containsAny(t, PARTS))  return reject("PARTS_ONLY");

  const wantAccessory = containsAny(canonicalPhrase(id.item_type), ACCESSORY);
  const isAccessory = containsAny(t, ACCESSORY);
  if (isAccessory && !wantAccessory) return reject("ACCESSORY_VS_MAIN_ITEM");
  if (!isAccessory && wantAccessory) return reject("MAIN_ITEM_VS_ACCESSORY");

  // ── Exact model ────────────────────────────────────────────────────────────
  const model = id.model_or_product_number.trim();
  if (model) {
    if (containsPhrase(t, model)) {
      parts.model = W.model; positives.push(`model ${model}`);
    } else {
      // A stated DIFFERENT model number is a contradiction, not an omission.
      const otherModel = /\b\d{3,4}\b/.test(t) && !containsPhrase(t, model);
      if (otherModel) return reject("WRONG_MODEL");
      parts.model = 0; penalties.push("model not stated");
    }
  }

  // ── Brand ──────────────────────────────────────────────────────────────────
  const brand = id.canonical_brand.trim();
  if (brand) {
    if (containsPhrase(t, brand)) { parts.brand = W.brand; positives.push(`brand ${brand}`); }
    else return reject("WRONG_BRAND");
  }

  // ── Item type ──────────────────────────────────────────────────────────────
  const wantFam = familyOf(id.item_type);
  if (wantFam) {
    const gotFam = familyOf(title);
    if (gotFam === wantFam) { parts.itemType = W.itemType; positives.push(`item type ${wantFam}`); }
    else if (gotFam && gotFam !== wantFam) return reject("WRONG_ITEM_TYPE");
    else { parts.itemType = W.itemType * 0.4; penalties.push("item type not stated"); }
  }

  // ── Subject / team / artist / event / licence ───────────────────────────────
  const subjects = [id.subject, id.team, id.artist, id.event, id.character_or_license]
    .map(s => s.trim()).filter(Boolean);
  if (subjects.length) {
    const hit = subjects.find(s => containsPhrase(t, s) ||
      s.split(" ").filter(w => w.length > 3).some(w => containsPhrase(t, w)));
    if (hit) { parts.subject = W.subject; positives.push(`subject ${hit}`); }
    else { parts.subject = 0; penalties.push("subject not matched"); }
  }

  // ── Era ────────────────────────────────────────────────────────────────────
  const era = c.derived.era_effective.status;
  const titleVintage = containsAny(t, ["vintage", "1990s", "1980s", "2000s", "retro"]);
  const titleRepro = containsAny(t, REPRO);
  if (era === "confirmed_vintage" || era === "likely_vintage") {
    if (titleRepro) return reject("REPRODUCTION_MISMATCH");
    // Absence of the word "vintage" is not a contradiction — plenty of genuine
    // old items are listed without it.
    parts.era = titleVintage ? W.era : W.era * 0.5;
    if (titleVintage) positives.push("era wording matches");
  } else if (era === "modern" && titleVintage) {
    parts.era = 0; penalties.push("listing claims vintage, item is modern");
  } else {
    parts.era = W.era * 0.5;
  }

  // ── Department ─────────────────────────────────────────────────────────────
  const dept = (c.ai.visible_attributes as { target_department?: string }).target_department ?? "unknown";
  const titleKids = containsAny(t, KIDS);
  if (dept === "kids" && !titleKids) return reject("CHILD_VS_ADULT_MISMATCH");
  // A youth listing is rejected unless we KNOW our item is kids — including
  // when our department is unknown.
  //
  // This looks like it violates "absence is not contradiction", and it is a
  // deliberate exception. Youth clothing is a separate market that trades at a
  // fraction of adult prices, so a youth comp in an adult set does not weaken
  // the median, it corrupts it. Most scans are adult items, so defaulting to
  // exclusion is right far more often than it is wrong — and when the item
  // genuinely IS kids, target_department says so and these are kept.
  if (dept !== "kids" && titleKids) return reject("CHILD_VS_ADULT_MISMATCH");
  if (dept === "mens" && containsPhrase(t, "womens")) return reject("WRONG_DEPARTMENT");
  if (dept === "womens" && containsPhrase(t, "mens")) return reject("WRONG_DEPARTMENT");
  parts.department = dept === "unknown" ? W.department * 0.5 : W.department;

  // ── Size: bonus only. Missing size must never sink a strong match ──────────
  const size = c.ai.visible_attributes.size_label.trim();
  parts.size = size && containsPhrase(t, size) ? W.size : W.size * 0.5;

  const score = Math.round(Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0)));
  seenIds.add(comp.externalId);
  return { comp, accepted: true, score, components: parts, positives, penalties, rejection: null };
}

export const MATCH_VERSION = MATCH_ALGO_VERSION;