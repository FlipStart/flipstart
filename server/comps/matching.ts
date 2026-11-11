/**
 * server/comps/matching.ts
 *
 * Filtering, relevance tiers and per-listing match scoring.   (match-3)
 *
 * The governing asymmetry: a CONTRADICTION is strong evidence of a mismatch,
 * while ABSENCE is not evidence of anything. A listing that omits the size is
 * still a fine comp; a listing that states a different exact model is not the
 * same product. Rejecting on absence is how you throw away every good comp and
 * conclude an item has no market.
 *
 * ── Tiers, in the founder's priority order ────────────────────────────────────
 * Every listing that survives the hard rules gets a plain relevance tier. The
 * tier decides what is shown and what feeds the median; the numeric score only
 * orders listings WITHIN a tier.
 *
 *   exact    same category + brand (or merch identity) + a specific identity
 *            match (model, product line, team/artist/licence, distinctive
 *            design), no era or colour contradiction
 *   strong   same category + brand (or merch identity), nothing contradicts
 *   similar  same category, but something is off or unknown: the colour
 *            differs, a soft era conflict, an uncertain brand, an unbranded
 *            item with no identity, or a title that never says what it is
 *   weak     a related-but-different category (coat for a jacket, hoodie for a
 *            crewneck), or a score under the floor. Never shown, never in the
 *            median — kept only so "why was nothing shown" has an answer.
 *
 * Hard rejects (wrong category, lots, accessories, parts, kids vs adult,
 * contradicting model, reproduction vs vintage, value-driving subject mismatch)
 * never get a tier.
 *
 * Category, brand, colour and kids vocabulary live in taxonomy.ts.
 */
import type { CanonicalAnalysisV1 } from "../../shared/canonical.types.js";
import type { NormalizedSoldComp } from "./types.js";
import {
  canonicalPhrase, containsPhrase, containsAny, detectClosure, detectSpecialty, closureFromEnum,
  MATCH_ALGO_VERSION,
} from "./normalize.js";
import {
  prep, squash, looseContains, detectCategory, scanCategory, categoryRelation, type CategoryRelation,
  brandInTitle, brandMask, categoryText, colorFamilies, colorRelation, type ColorRelation, isKidsTitle,
  designTokens, designOverlap, titleDecades, decadeStart,
} from "./taxonomy.js";

export type RejectionReason =
  | "MISSING_TITLE" | "MISSING_SOLD_PRICE" | "WRONG_CURRENCY"
  | "WRONG_BRAND" | "WRONG_ITEM_TYPE" | "WRONG_MODEL" | "WRONG_SUBJECT"
  | "WRONG_TEAM" | "WRONG_DEPARTMENT" | "WRONG_ERA"
  | "MAIN_ITEM_VS_ACCESSORY" | "ACCESSORY_VS_MAIN_ITEM"
  | "BUNDLE_OR_LOT" | "PARTS_ONLY" | "REPRODUCTION_MISMATCH"
  | "CUSTOM_ITEM_MISMATCH" | "CHILD_VS_ADULT_MISMATCH"
  | "SEARCH_SPAM" | "DUPLICATE_RESULT"
  | "VALUE_DRIVING_SUBJECT_MISMATCH" | "CLOSURE_MISMATCH" | "PRODUCT_LINE_MISMATCH"
  | "RELATED_ITEM_TYPE" | "BELOW_MIN_SCORE";

export type Tier = "exact" | "strong" | "similar" | "weak";

/** Lower is better. Used for sorting everywhere a tier is ranked. */
export const TIER_RANK: Record<Tier, number> = { exact: 0, strong: 1, similar: 2, weak: 3 };

/** What the matcher concluded about each dimension. Founder debug only. */
export interface CompSignals {
  category: { scan: string | null; listing: string | null; relation: CategoryRelation | "absent" | "unknown" };
  brand: "match" | "absent" | "n/a";
  identity: string | null;
  era: "consistent" | "conflict" | "unknown" | "n/a";
  color: ColorRelation | "n/a";
  design: string[];
}

export interface ScoredComp {
  comp: NormalizedSoldComp;
  /** Has a displayable tier (exact, strong or similar). */
  accepted: boolean;
  /** Passed the hard rules but tiered weak. Debug only — never shown, never
   *  in the median. Kept because "why was nothing accepted" is otherwise
   *  unanswerable. */
  weak: boolean;
  /** Null when hard-rejected. */
  tier: Tier | null;
  matchClass: MatchClass;
  score: number;
  components: Record<string, number>;
  positives: string[];
  penalties: string[];
  rejection: RejectionReason | null;
  rejectionDetail: string | null;
  /** One plain sentence per listing: why it landed where it did. */
  reason: string;
  signals: CompSignals;
  /** What the matcher read out of the listing title. */
  detected: {
    closure: string | null;
    specialty: Array<{ kind: string; match: string }>;
  };
}

/**
 * Weights. Only components that could apply to THIS scan count toward the
 * achievable total, so a plain hoodie is not marked down for having no model
 * number. Colour and design were added in match-3; before that a navy and a
 * black quarter zip scored identically.
 */
const W = {
  model: 22,        // exact model dominates jeans, sneakers, technical gear
  subject: 18,      // team / artist / licence often IS the value
  itemType: 16,
  brand: 14,        // necessary, never sufficient
  closure: 12,      // decisive for hoodies and jackets
  color: 10,        // secondary to category, but real
  design: 8,        // distinctive design words ("cable", "eagle", "pinstripe")
  /**
   * Era. A CONSISTENT comp earns the full weight, so the weight lands in both
   * the numerator and the denominator for it: a matching comp's score is
   * unchanged by the weight, only a conflicting one drops.
   */
  era: 14,
  department: 2,
  size: 2,
};

/**
 * Score floor. A listing can earn a tier from the rules and still be too loose
 * a comparison to show — brand plus category agreeing with nothing else
 * checked is not a comp. Under the floor, the tier drops to weak.
 */
export const MIN_ACCEPT_SCORE = 70;
export const STRONG_SCORE = 85;

export type MatchClass = "strong" | "moderate" | "weak";

/** Brand read confidence (0-100) at which a missing brand rejects a listing.
 *  Below it the brand read itself may be wrong, so the listing is kept and
 *  capped at Similar instead. */
const BRAND_CONFIDENT_AT = 70;
/** Colour confidence (0-100) at which colour is compared at all. */
const COLOR_CONFIDENT_AT = 60;

/**
 * Hard-reject vocabularies. Matched as whole phrases after prep(), so
 * "iron-on patch" and "iron on patch" are one phrase.
 *
 * match-3: "button", "patch", "pin" and "chain" are gone as bare words — they
 * rejected every button-down shirt, button-fly jean, patch jacket and
 * chain-stitch tee. Only phrases that name a stand-alone accessory remain.
 */
const BUNDLE    = ["lot", "bundle", "wholesale", "reseller lot", "job lot", "set of", "bulk", "pallet",
                   "matching set", "2 piece set", "two piece set"];
const PARTS     = ["for parts", "parts only", "not working", "for repair", "needs repair", "as is", "damaged", "salvage"];
const ACCESSORY = ["sticker", "decal", "iron on patch", "sew on patch", "patch only", "keychain", "key chain",
                   "lanyard", "enamel pin", "lapel pin", "pin badge", "pinback", "magnet", "poster", "manual",
                   "brochure", "catalog", "catalogue", "zipper pull", "replacement zipper", "replacement buttons",
                   "buttons only", "label only", "tag only", "sewing pattern", "doll clothes",
                   "watch band", "watch strap", "replacement band", "campaign button", "pinback button", "pin back button",
                   "box only", "empty box", "dust bag only", "engine", "carburetor", "exhaust", "piston",
                   "brake", "sprocket", "drive chain", "mirror", "helmet", "gloves", "windshield", "fairing"];
/** "new with tags" is NOT here: deadstock vintage is real vintage. "bootleg"
 *  is not either — it is a jeans cut, and 90s bootleg tees trade as vintage. */
const REPRO     = ["reprint", "reproduction", "repro", "modern reprint", "custom made"];
/**
 * EXPLICIT era claims in a listing title.
 *
 * Both lists are deliberately short. A weak hint — "made in usa", "single
 * stitch", a copyright year — is evidence an appraiser weighs, not something
 * that should silently reject a comp, so neither list carries any of them.
 * "vtg" and "vntg" are absent because canonicalPhrase() has already turned
 * them into "vintage" before this runs.
 */
const VINTAGE_CLAIM = ["vintage", "antique"];
/** A decade on its own is weaker: "70s Flare Jeans" and "1996 Retro Nuptse"
 *  are modern products. It never rejects a comp, only softens it. "retro" is
 *  gone entirely — it is in the name of most modern Jordans and Dunks. */
const DECADE_CLAIM = ["1960s", "1970s", "1980s", "1990s", "2000s"];
const MODERN_CLAIM  = ["reissue", "reproduction", "retro release", "remake", "modern", "current season", "new release"];
/** Canonical confidence (0-100) at which an era verdict may reject a comp. */
const ERA_CONFIDENT_AT = 70;

/** Words never treated as the "head noun" of a non-clothing item type. */
const HEAD_STOP = new Set(["the", "and", "with", "for", "set", "item", "piece", "vintage", "new", "used"]);

const hasAny = (text: string, phrases: string[]): boolean => {
  const h = ` ${prep(text)} `;
  return phrases.some(p => h.includes(` ${prep(p)} `));
};

/** Last meaningful word of an item type: "coffee mug" → "mug". */
function headNoun(itemType: string): string | null {
  const w = prep(itemType).split(" ").filter(x => x.length >= 3 && !HEAD_STOP.has(x));
  return w.length ? w[w.length - 1] : null;
}

/** "550" in "Levis 550 Jeans" and in "501XX"; "DD1391-100" in "DD1391 100". */
function modelInTitle(model: string, title: string): boolean {
  if (looseContains(title, model)) return true;
  const m = squash(model);
  if (/^\d{3,4}$/.test(m)) return new RegExp(`(^| )${m}[a-z]{0,3}( |$)`).test(prep(title));
  return false;
}

/**
 * Does the title state a DIFFERENT model number? Only meaningful when our
 * model is itself a short number (501, 550, 990). Years (1940-2039) and
 * numbers after "size" / "waist" / "inseam" are not model numbers — "Levi's
 * Jeans 2019" used to be rejected as the wrong model.
 */
function otherModelNumber(title: string, model: string): boolean {
  const w = prep(title).split(" ");
  for (let i = 0; i < w.length; i++) {
    const m = /^(\d{3,4})[a-z]{0,3}$/.exec(w[i]);
    if (!m || m[1] === model) continue;
    const n = Number(m[1]);
    if (m[1].length === 4 && n >= 1940 && n <= 2039) continue;
    if (/^(size|sz|waist|inseam|w|l)$/.test(w[i - 1] ?? "")) continue;
    return true;
  }
  return false;
}

/** A style code like ours ("DD1391-103", "555088 063") but not ours. */
function otherStyleCode(title: string, ours: string): boolean {
  const re = /(^| )([a-z]{0,3}\d{4,6})[ -](\d{3})(?= |$)/g;
  const p = prep(title);
  for (const m of p.matchAll(re)) {
    const code = squash(`${m[2]}${m[3]}`);
    if (code !== ours && code.length === ours.length) return true;
  }
  return false;
}

/**
 * Is a merch identity (team, artist, event, licence) in the title?
 * Punctuation-blind ("ACDC" = "AC/DC"); a team counts by its nickname
 * ("Bears" for "Chicago Bears"); a licence by its most distinctive word
 * ("Mickey" for "Mickey Mouse"); an artist or event needs all its words.
 */
function identityInTitle(kind: string, value: string, title: string): boolean {
  if (looseContains(title, value)) return true;
  const sig = prep(value).split(" ").filter(x => x.length >= 3 && !["the", "and", "official", "band", "team"].includes(x));
  if (sig.length === 0) return false;
  const tw = new Set(prep(title).split(" "));
  if (kind === "team") return tw.has(sig[sig.length - 1]);
  if (kind === "license") return tw.has([...sig].sort((a, b) => b.length - a.length)[0]);
  return sig.every(x => tw.has(x));
}

function softSubjectInTitle(subject: string, title: string): boolean {
  if (looseContains(title, subject)) return true;
  const sig = prep(subject).split(" ").filter(x => x.length >= 3);
  if (sig.length === 0) return false;
  const tw = new Set(prep(title).split(" "));
  return sig.filter(x => tw.has(x)).length >= Math.ceil(sig.length / 2);
}

export function scoreComp(
  c: CanonicalAnalysisV1,
  comp: NormalizedSoldComp,
  seenIds: Set<string>,
): ScoredComp {
  const id = c.ai.identification;
  const va = c.ai.visible_attributes;
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
  const signals: CompSignals = {
    category: { scan: null, listing: null, relation: "unknown" },
    brand: "n/a", identity: null, era: "n/a", color: "n/a", design: [],
  };
  let specDetectedRef: Array<{ kind: string; match: string }> = [];
  let listClosureRef: string | null = null;
  const reject = (r: RejectionReason, detail = ""): ScoredComp => ({
    comp, accepted: false, weak: false, tier: null, matchClass: "weak", score: 0,
    components: parts, positives, penalties, rejection: r, rejectionDetail: detail || null,
    reason: `Rejected: ${detail || r.toLowerCase().replace(/_/g, " ")}`,
    signals, detected: { closure: listClosureRef, specialty: specDetectedRef },
  });

  if (seenIds.has(comp.externalId)) return reject("DUPLICATE_RESULT", "same listing returned twice");
  if (!title) return reject("MISSING_TITLE", "");
  if (!(comp.soldPrice > 0)) return reject("MISSING_SOLD_PRICE", "");
  if (comp.currency && comp.currency !== "USD") return reject("WRONG_CURRENCY", "");

  const brand = (id.canonical_brand ?? "").trim();
  const hardIds: Array<[string, string]> = ([
    ["team", id.team], ["artist", id.artist], ["event", id.event], ["license", id.character_or_license],
  ] as Array<[string, string | undefined]>)
    .map(([k, v]) => [k, (v ?? "").trim()] as [string, string])
    .filter(([, v]) => v);
  const softSubject = (id.subject ?? "").trim();
  const scanSubjects = [softSubject, ...hardIds.map(([, v]) => v)].filter(Boolean);
  /** Words in a title that belong to the scanned brand or subject, and so can't
   *  be read as a garment type, a colour or a kids marker ("Beach Boys"). */
  const masks = [...brandMask(brand), ...scanSubjects.flatMap(s => [s, s.replace(/^the\s+/i, "")])];

  // ── Hard rejects: these are different products, not weaker comps ───────────
  // Levi's "Lot 501" names a model, not a lot.
  if (hasAny(title.replace(/\blot\s*#?\s*\d{2,4}\b/gi, " "), BUNDLE)) return reject("BUNDLE_OR_LOT", "title indicates a multi-item lot");
  if (hasAny(title, PARTS))  return reject("PARTS_ONLY", "title indicates parts or damaged");

  const scanGroup = scanCategory(
    { itemType: id.item_type ?? "", subtype: id.subtype ?? "", genericName: id.generic_item_name ?? "" },
    brandMask(brand),
  );
  const listRead = detectCategory(categoryText(brand, title), masks);

  // An accessory word only makes a listing an accessory when it names no
  // garment: "Vintage Ford V8 Engine Tee" and "Racing Helmet Graphic Tee" are
  // tees. Likewise the scan is an accessory only when it isn't a garment.
  const wantAccessory = !scanGroup && hasAny([id.item_type, id.subtype, id.generic_item_name].join(" "), ACCESSORY);
  const isAccessory = !listRead.group && hasAny(title, ACCESSORY);
  if (isAccessory && !wantAccessory) return reject("ACCESSORY_VS_MAIN_ITEM", "listing is an accessory, scan is the main item");
  if (wantAccessory && !isAccessory && listRead.group) return reject("MAIN_ITEM_VS_ACCESSORY", "scan is an accessory, listing is the main item");

  // ── Category: the hard requirement ─────────────────────────────────────────
  let catRel: CategoryRelation | "absent" | "unknown" = "unknown";
  if (scanGroup) {
    canScore("itemType");
    if (!listRead.group) {
      catRel = "absent";
      parts.itemType = W.itemType * 0.35;
      penalties.push("item type not stated");
    } else {
      catRel = categoryRelation(scanGroup, listRead.group);
      if (catRel === "different") {
        signals.category = { scan: scanGroup, listing: listRead.group, relation: catRel };
        return reject("WRONG_ITEM_TYPE", `different item type (${listRead.group.replace(/_/g, " ")} vs ${scanGroup.replace(/_/g, " ")})`);
      }
      if (catRel === "related") {
        parts.itemType = W.itemType * 0.35;
        penalties.push(`related but different item: ${listRead.group.replace(/_/g, " ")}`);
      } else {
        parts.itemType = W.itemType;
        positives.push(`item type ${scanGroup.replace(/_/g, " ")}`);
      }
    }
  } else {
    // The scan names no known group — a mug, a lamp, a record. Its own head
    // noun is the best available check.
    const head = headNoun(id.item_type ?? "");
    if (head) {
      canScore("itemType");
      if (looseContains(title, head)) {
        catRel = "same"; parts.itemType = W.itemType; positives.push(`item type ${head}`);
      } else if (listRead.group) {
        // A garment listing for a non-garment scan is a different product.
        return reject("WRONG_ITEM_TYPE", `different item type (${listRead.group.replace(/_/g, " ")} vs ${head})`);
      } else {
        catRel = "absent"; parts.itemType = W.itemType * 0.35; penalties.push("item type not stated");
      }
    }
  }
  signals.category = { scan: scanGroup, listing: listRead.group, relation: catRel };

  // ── Product line, checked BEFORE brand ─────────────────────────────────────
  //
  // Purple Label IS Ralph Lauren, so a brand check would accept it — but Purple
  // Label trades in a different market entirely. Brand is included on the scan
  // side so a Lauren Ralph Lauren scan matches its own line.
  const scanSpecialtyEarly = detectSpecialty(
    [id.generic_item_name, id.product_line, id.subject, id.team, brand].join(" "),
  );
  const listSpecialtyEarly = detectSpecialty(title);
  specDetectedRef = listSpecialtyEarly;
  const scanPremium = scanSpecialtyEarly.find(s => s.kind === "premium_line");
  const listPremium = listSpecialtyEarly.find(s => s.kind === "premium_line");
  if ((listPremium?.match ?? null) !== (scanPremium?.match ?? null)) {
    return reject("PRODUCT_LINE_MISMATCH",
      `listing line "${listPremium?.match ?? "none"}" vs scan "${scanPremium?.match ?? "none"}"`);
  }

  const productLine = (id.product_line ?? "").trim();
  const lineHit = Boolean(productLine) && looseContains(title, productLine);
  if (lineHit) positives.push(`product line ${productLine}`);

  // ── Exact model ────────────────────────────────────────────────────────────
  const model = (id.model_or_product_number ?? "").trim();
  let modelHit = false;
  let modelConflict = false;
  if (model) {
    canScore("model");
    if (modelInTitle(model, title)) {
      parts.model = W.model; positives.push(`model ${model}`); modelHit = true;
    } else {
      // A stated DIFFERENT model number is a contradiction, not an omission.
      const m = squash(model);
      if (/^\d{3,4}$/.test(m) && otherModelNumber(title, m)) {
        return reject("WRONG_MODEL", `listing states a different model than ${model}`);
      }
      /*
       * Silence about the model. A short model number (501, 550) is how buyers
       * search, so its absence counts fully against the listing. A long style
       * code (DD1391-100) is almost never in a title; when the product line
       * ("Dunk Low") is there, the listing is most likely the same product.
       */
      parts.model = lineHit ? W.model * 0.6 : m.length >= 6 ? W.model * 0.25 : 0;
      // A DIFFERENT style code of the same shape (DD1391-103 for DD1391-100)
      // is another colourway: kept, never above Similar.
      if (m.length >= 6 && otherStyleCode(title, m)) {
        modelConflict = true; parts.model = 0;
        penalties.push(`listing states a different style code than ${model}`);
      } else penalties.push("model not stated");
    }
  }

  // ── Brand ──────────────────────────────────────────────────────────────────
  let brandHit = false;
  if (brand) {
    canScore("brand");
    if (brandInTitle(brand, title)) {
      parts.brand = W.brand; positives.push(`brand ${brand}`); brandHit = true; signals.brand = "match";
    } else {
      const conf = typeof id.brand_confidence === "number" ? id.brand_confidence : 100;
      // An exact style code (555088-101) identifies the product on its own.
      const skuHit = modelHit && squash(model).length >= 6;
      if (skuHit) {
        parts.brand = W.brand; brandHit = true; signals.brand = "match";
        positives.push("brand implied by exact style code");
      } else if (conf >= BRAND_CONFIDENT_AT) return reject("WRONG_BRAND", `brand "${brand}" absent from listing`);
      else {
      parts.brand = 0; signals.brand = "absent";
      penalties.push(`brand ${brand} not in listing (brand read was uncertain)`);
      }
    }
  }

  // ── Subject / specialty — checked in BOTH directions ────────────────────────
  //
  // A specialty trait on the listing that the scanned item lacks (a team, a
  // licence, a collab) is a hard reject: it IS the price difference, so the two
  // are different products rather than imperfect comps.
  const scanSpecialty = scanSpecialtyEarly;
  const valueDriving = listSpecialtyEarly.filter(s => s.kind !== "premium_line");
  let hardIdentityHit = false;
  let softSubjectHit = false;
  canScore("subject");
  if (valueDriving.length > 0) {
    /*
     * EVERY value-driving word on the listing must belong to the scanned item —
     * one shared word must not excuse another: "NFL Green Bay Packers" is not a
     * Bears comp because both say NFL, and "Bears Super Bowl XX" is not a plain
     * Bears tee.
     *
     * Umbrella words are implied by a specific identity the scan carries (an
     * NFL listing for a team scan, a Disney listing for a character scan), but
     * they never stand in for it: the identity itself is checked below.
     */
    const hasTeam = hardIds.some(([k]) => k === "team");
    const hasLicence = hardIds.some(([k]) => k === "license");
    const isShared = (ls: { kind: string; match: string }) =>
      scanSubjects.some(ss => looseContains(ss, ls.match) || looseContains(ls.match, ss)) ||
      scanSpecialty.some(ss => ss.match === ls.match) ||
      (ls.kind === "league" && hasTeam) || (ls.kind === "license" && hasLicence);
    const unshared = valueDriving.filter(ls => !isShared(ls));
    if (unshared.length > 0) {
      return reject("VALUE_DRIVING_SUBJECT_MISMATCH",
        `listing has ${unshared.map(s => `${s.kind}:${s.match}`).join(", ")}; scanned item doesn't`);
    }
    parts.subject = W.subject;
    if (hardIds.length === 0) hardIdentityHit = true;
    positives.push(`shared ${valueDriving.map(s => s.match).join(", ")}`);
    signals.identity = valueDriving.map(s => s.match).join(", ");
  }
  // Merch identities the scan carries must ALL be on the listing.
  for (const [kind, value] of hardIds) {
    if (!identityInTitle(kind, value, title)) {
      return reject("WRONG_SUBJECT", `${kind} "${value}" absent from listing`);
    }
    hardIdentityHit = true;
    if (!positives.some(p => p.startsWith(`${kind} `))) positives.push(`${kind} ${value}`);
    signals.identity = value;
  }
  if (softSubject) {
    softSubjectHit = softSubjectInTitle(softSubject, title);
    if (softSubjectHit) { positives.push(`subject ${softSubject}`); signals.identity = signals.identity ?? softSubject; }
  }
  if (parts.subject == null) {
    if (hardIdentityHit || softSubjectHit) parts.subject = W.subject;
    else if (scanSubjects.length) {
      // A descriptive subject ("eagle and flag") the listing words differently
      // is not a contradiction.
      parts.subject = W.subject * 0.35; penalties.push("subject not stated");
    } else {
      // Neither side has a subject — a plain item matching a plain item. Genuine
      // compatibility, but the ABSENCE of a differentiator rather than a
      // positive identity match, so it earns less than a shared team would.
      parts.subject = W.subject * 0.7;
      positives.push("both plain, no specialty");
    }
  }

  // ── Closure ────────────────────────────────────────────────────────────────
  // Decisive for hoodies and jackets. Absence in the listing is neutral; a
  // stated DIFFERENT closure is a different garment. The enum value is
  // authoritative; the prose is a fallback.
  const scanClosure = closureFromEnum(c.ai.features?.closure_type ?? "")
    ?? detectClosure([id.item_type, id.subtype, id.generic_item_name].join(" "));
  if (scanClosure) canScore("closure");
  const listClosure = detectClosure(title);
  listClosureRef = listClosure;
  // A listing that only says "pullover" doesn't contradict a quarter or half
  // zip — those ARE pullovers ("Synchilla Snap-T Pullover", "R1 Pullover").
  const pulloverOnly = listClosure === "pullover" && (scanClosure === "quarter_zip" || scanClosure === "half_zip");
  if (scanClosure && listClosure && scanClosure !== listClosure && !pulloverOnly) {
    return reject("CLOSURE_MISMATCH", `scan ${scanClosure} vs listing ${listClosure}`);
  }
  if (scanClosure && listClosure === scanClosure) {
    parts.closure = W.closure; positives.push(`closure ${scanClosure}`);
  } else {
    // 25%: absence is not a contradiction, but it is not evidence of a match.
    parts.closure = W.closure * 0.25;
    if (scanClosure) penalties.push("closure not stated in listing");
  }

  /**
   * ── Era ────────────────────────────────────────────────────────────────────
   *
   * Graded by the scan's OWN era confidence, because the cost of being wrong
   * runs both ways: too lax and a 1990s listing anchors the median for a modern
   * fleece; too strict and a confident-looking guess throws away the only real
   * comps in the set.
   *
   *   confident scan + explicit opposite-era claim  → hard reject
   *   unsure scan    + explicit opposite-era claim  → scored to zero, kept
   *   consistent                                    → full credit
   *
   * Only EXPLICIT claims count on the listing side. Silence earns partial
   * credit, never a conflict. A vintage listing from a clearly different
   * decade ("1970s" for a 1990s item) is a soft conflict: kept, never Strong.
   */
  const eraEff = c.derived.era_effective;
  const era = eraEff.status;
  const titleVintageWord = containsAny(t, VINTAGE_CLAIM);
  const titleVintage = titleVintageWord || containsAny(t, DECADE_CLAIM) || titleDecades(title).length > 0;
  const titleModern  = containsAny(t, MODERN_CLAIM);
  const titleRepro = hasAny(title, REPRO);
  /**
   * Confident enough to reject on. `confidence` is 0-100 on the canonical
   * analysis; `confirmed_vintage` is a routed verdict and stands on its own.
   */
  const eraConfident = era === "confirmed_vintage" || (eraEff.confidence ?? 0) >= ERA_CONFIDENT_AT;
  let eraConflict = false;
  /** A confidently vintage item against a listing that never says vintage:
   *  kept, but never above Similar — modern reprints of the same graphic are
   *  listed exactly that way. */
  let eraUnconfirmed = false;

  if (era === "confirmed_vintage" || era === "likely_vintage") {
    if (titleRepro) return reject("REPRODUCTION_MISMATCH", "listing is a reprint, item is vintage");
    if (titleModern && !titleVintage) {
      if (eraConfident) return reject("WRONG_ERA", "listing claims modern/reissue, item is vintage");
      parts.era = 0; eraConflict = true; penalties.push("listing claims modern, item may be vintage");
    } else {
      parts.era = titleVintage ? W.era : W.era * 0.25;
      if (titleVintage) positives.push("era wording matches");
      else if (eraConfident) { eraUnconfirmed = true; penalties.push("listing doesn't say vintage"); }
      // Decade, when both sides state one and we are sure of ours.
      const ours = decadeStart(eraEff.production_decade_effective);
      const theirs = titleDecades(title);
      if (ours != null && eraConfident && theirs.length > 0 &&
          !theirs.some(d => Math.abs(d - ours) <= 10)) {
        parts.era = W.era * 0.25; eraConflict = true;
        penalties.push(`listing says the ${theirs.map(d => `${d}s`).join("/")}, item is the ${ours}s`);
      }
    }
  } else if (era === "modern" && titleVintage) {
    // Only the word "vintage" rejects; a bare decade only softens.
    if (eraConfident && titleVintageWord) return reject("WRONG_ERA", "listing claims vintage, item is modern");
    parts.era = 0; eraConflict = true;
    penalties.push(titleVintageWord ? "listing claims vintage, item is modern" : "listing names a past decade, item is modern");
  } else if (era === "vintage_inspired" && titleVintage) {
    // Vintage-STYLED is not vintage. Never a reject — the scan itself is a
    // statement about styling, not about age — but no credit either.
    parts.era = 0; eraConflict = true; penalties.push("listing claims vintage, item is vintage-inspired");
  } else if (era === "unknown") {
    // Nothing known about our item's era, so nothing about the listing's era
    // can agree or disagree with it. Not scored (left out of `applicable`).
    parts.era = 0;
  } else {
    // Modern scan, no vintage claim in the title: genuinely consistent.
    parts.era = W.era;
    positives.push("era consistent");
  }
  if (era !== "unknown") canScore("era");
  signals.era = era === "unknown" ? "unknown" : eraConflict ? "conflict" : "consistent";

  // ── Department ─────────────────────────────────────────────────────────────
  const dept = (va as { target_department?: string }).target_department ?? "unknown";
  const titleKids = isKidsTitle(title, masks);
  if (dept === "kids" && !titleKids) return reject("CHILD_VS_ADULT_MISMATCH", "item is kids, listing is adult");
  // A youth listing is rejected unless we KNOW our item is kids — including
  // when our department is unknown. Youth clothing trades at a fraction of
  // adult prices, so a youth comp in an adult set corrupts the median.
  if (dept !== "kids" && titleKids) return reject("CHILD_VS_ADULT_MISMATCH", "listing is kids' sizing");
  // "Unisex", or a title naming both ("Women's 28, fits like Men's 26"), is
  // not a contradiction.
  const bothDepts = containsPhrase(t, "unisex") || (containsPhrase(t, "mens") && containsPhrase(t, "womens"));
  if (!bothDepts && dept === "mens" && containsPhrase(t, "womens")) return reject("WRONG_DEPARTMENT", "listing is women's");
  if (!bothDepts && dept === "womens" && containsPhrase(t, "mens")) return reject("WRONG_DEPARTMENT", "listing is men's");
  canScore("department");
  parts.department = dept === "unknown" ? W.department * 0.25 : W.department;

  // ── Size: bonus only. Missing size must never sink a strong match ──────────
  const size = (va.size_label ?? "").trim();
  if (size) canScore("size");
  parts.size = size && containsPhrase(t, size) ? W.size : W.size * 0.25;

  // ── Colour: secondary, but a stated different colour is a real difference ──
  let colorConflict = false;
  const colorConf = typeof va.color_confidence === "number" ? va.color_confidence : 0;
  const scanColors = colorConf >= COLOR_CONFIDENT_AT
    ? [...new Set([va.primary_color ?? "", ...(va.secondary_colors ?? [])].flatMap(x => colorFamilies(x)))]
    : [];
  if (scanColors.length) {
    canScore("color");
    const listColors = colorFamilies(title, masks);
    const rel = colorRelation(scanColors, listColors);
    signals.color = rel;
    if (rel === "match") { parts.color = W.color; positives.push(`colour ${listColors.filter(f => scanColors.includes(f)).join("/")}`); }
    // Half credit: most titles never name the colour, and silence is not a
    // contradiction.
    else if (rel === "absent") parts.color = W.color * 0.5;
    else {
      parts.color = 0; colorConflict = true;
      penalties.push(`listing is ${listColors.join("/")}, item is ${scanColors.join("/")}`);
    }
  }

  // ── Design words ───────────────────────────────────────────────────────────
  const tokens = designTokens(
    // style_labels are left out: "workwear", "streetwear" are generic tags,
    // and matching them must not lift a brand-only comp to Exact.
    // Product-line words are masked too: the line is judged on its own above,
    // and must not reach Exact a second time through the design words.
    [id.generic_item_name ?? "", id.subtype ?? "", ...(c.ai.features?.logo_identity ?? [])],
    [...masks, id.item_type ?? "", productLine],
  );
  let designStrong = false;
  if (tokens.length >= 2) {
    canScore("design");
    const hit = designOverlap(tokens, title);
    const frac = Math.min(1, hit.length / Math.min(tokens.length, 3));
    parts.design = W.design * frac;
    signals.design = hit;
    if (hit.length) positives.push(`design ${hit.join(", ")}`);
    designStrong = hit.length >= 2 && frac >= 0.66;
  }

  // A matched model or product line already says what the item is.
  if (catRel === "absent" && (modelHit || lineHit)) {
    parts.itemType = W.itemType;
    const i = penalties.indexOf("item type not stated");
    if (i >= 0) penalties.splice(i, 1);
  }

  const earned = Object.entries(parts)
    .filter(([k]) => applicable[k] !== undefined)
    .reduce((a, [, v]) => a + v, 0);
  const possible = Object.values(applicable).reduce((a, b) => a + b, 0);
  const score = possible > 0 ? Math.round(Math.min(100, (earned / possible) * 100)) : 0;
  seenIds.add(comp.externalId);

  // ── Tier ───────────────────────────────────────────────────────────────────
  // A matched model or product line says what the item is ("Nike Dunk Low
  // Panda Size 10" is a sneaker without saying so).
  const typeCertain = catRel === "same" || catRel === "compatible" || catRel === "unknown" ||
                      (catRel === "absent" && (modelHit || lineHit));
  // When the scan has a model, only that model makes a listing Exact — a
  // product line alone ("Air Jordan 1") spans colourways at very different prices.
  const identityHit = modelHit || (!model && lineHit) || hardIdentityHit || softSubjectHit || designStrong;
  /** Brand identity, or merch identity for an unbranded band / team item.
   *  Brand alone is never enough for Exact. */
  const anchored = brandHit || hardIdentityHit;
  let tier: Tier;
  let why: string;
  if (catRel === "related") {
    tier = "weak"; why = `related but different item (${listRead.group?.replace(/_/g, " ")})`;
  } else if (!typeCertain) {
    tier = "similar"; why = "listing doesn't say what kind of item it is";
  } else if (brand && !brandHit) {
    tier = "similar"; why = "brand not confirmed in listing";
  } else if ((model || productLine) && !modelHit && !lineHit && !hardIdentityHit) {
    // The scan names a specific product (Dunk Low, 501, Better Sweater) and the
    // listing names neither it nor anything else that pins it down: same brand
    // and type, but possibly a different product ("Nike Air Max" for a Dunk).
    tier = "similar"; why = "listing doesn't name the model or product line";
  } else if (eraConflict || colorConflict || eraUnconfirmed || modelConflict) {
    tier = "similar"; why = eraConflict ? "era differs" : colorConflict ? "colour differs"
      : modelConflict ? "different style code" : "listing doesn't say it's vintage";
  } else if (anchored && identityHit) {
    tier = "exact"; why = modelHit ? `model ${model} matches` : (!model && lineHit) ? `product line ${productLine} matches`
      : hardIdentityHit ? `${signals.identity} matches` : softSubjectHit ? `subject matches` : "design matches";
  } else if (anchored) {
    tier = "strong"; why = brandHit ? "same item type and brand" : "same item type and identity";
  } else {
    tier = "similar"; why = "same item type, no brand or identity to confirm";
  }
  if (tier !== "weak" && score < MIN_ACCEPT_SCORE) {
    tier = "weak"; why = `score ${score} below floor ${MIN_ACCEPT_SCORE}`;
  }

  const matchClass: MatchClass = tier === "exact" || tier === "strong" ? "strong"
    : tier === "similar" ? "moderate" : "weak";
  const accepted = tier !== "weak";
  const label = tier[0].toUpperCase() + tier.slice(1);

  return {
    comp, accepted, weak: !accepted, tier, matchClass, score,
    components: parts, positives, penalties,
    rejection: accepted ? null : catRel === "related" ? "RELATED_ITEM_TYPE" : "BELOW_MIN_SCORE",
    rejectionDetail: accepted ? null : why,
    reason: `${label}: ${why}`,
    signals,
    detected: { closure: listClosureRef, specialty: specDetectedRef },
  };
}

export const MATCH_VERSION = MATCH_ALGO_VERSION;