/**
 * server/comps/taxonomy.ts
 *
 * The vocabulary sold-comp matching is judged on: what KIND of item a title
 * describes, whose brand it carries, which colours it states, and whether it
 * is children's clothing.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 * The matcher used to know 13 garment words. Anything else — sweater, coat,
 * flannel, cardigan, boots — was never checked, so a J.Crew sweater accepted
 * J.Crew chinos, and "coat" was a synonym of "jacket", so a London Fog trench
 * coat comped a casual jacket. Category is the hard requirement in the
 * matching priority, so it gets a real taxonomy: groups of synonyms, plus
 * explicit relations between groups.
 *
 *   same        the same kind of item                  hoodie  ~ hooded sweatshirt
 *   compatible  a vaguer word that fits the item        sweater ~ "quarter zip pullover"
 *   related     close, but a different item to a buyer  jacket  ~ coat, hoodie ~ crewneck
 *   different   not a comp                              sweater ~ pants
 *
 * Related items are never shown as comps (Weak tier); different ones are
 * rejected outright.
 *
 * Everything here is deterministic — no model call, no network.
 */
import { canonicalPhrase } from "./normalize.js";

// ── Text preparation ──────────────────────────────────────────────────────────

/**
 * Canonical form for taxonomy lookups. Aliases first (they need hyphens:
 * "t-shirt" → "tee", "zip-up" → "full zip"), then hyphens become spaces so
 * "Button-Down" and "button down" read the same.
 */
const prepCache = new Map<string, string>();
export function prep(text: string): string {
  const key = text ?? "";
  const hit = prepCache.get(key);
  if (hit !== undefined) return hit;
  const out = canonicalPhrase(key.replace(/([a-z])\/(?=[a-z])/gi, "$1 "))
    .replace(/-/g, " ").replace(/\s+/g, " ").trim();
  // The same phrase lists are prepared for every listing; memoising them is
  // most of the cost of scoring 240 listings.
  if (prepCache.size > 5000) prepCache.clear();
  prepCache.set(key, out);
  return out;
}

const words = (s: string) => s.split(" ").filter(Boolean);

/** Letters and digits only — "AC/DC", "ac dc" and "ACDC" all become "acdc". */
export const squash = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Does `needle` appear in `haystack` as whole words, OR as consecutive words
 * that squash to the same letters? The second form is what makes "ACDC",
 * "AC DC" and "AC/DC" one band, and "J Crew" / "JCrew" / "J.Crew" one brand.
 */
export function looseContains(haystack: string, needle: string): boolean {
  const h = prep(haystack);
  const n = prep(needle);
  if (!n) return false;
  if (` ${h} `.includes(` ${n} `)) return true;
  const target = squash(n);
  if (target.length < 3) return false;          // too short to squash safely
  const hw = words(h).map(squash);
  for (let i = 0; i < hw.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(hw.length, i + 5); j++) {
      acc += hw[j];
      if (acc === target) return true;
      if (acc.length >= target.length) break;
    }
  }
  return false;
}

// ── Category groups ───────────────────────────────────────────────────────────

/**
 * Ordered most-specific first. When a title names two groups ("Hoodie
 * Sweatshirt", "Sweater Dress", "Car Coat Jacket"), the earlier group wins.
 * Compound phrases ("fleece jacket", "polo shirt", "jean shorts") are matched
 * before their parts, so they never split.
 *
 * Phrases are written naturally and canonicalised once at load, so they go
 * through exactly the same aliasing as a listing title.
 */
const GROUP_DEFS: Array<[string, string[]]> = [
  ["boots",     ["boots", "boot", "chelsea boots", "work boots", "combat boots", "cowboy boots", "hiking boots", "dress boots"]],
  ["sneakers",  ["sneakers", "sneaker", "trainers", "running shoes", "basketball shoes", "skate shoes", "tennis shoes", "athletic shoes"]],
  ["sandals",   ["sandals", "sandal", "slides", "flip flops"]],
  ["heels",     ["heels", "pumps", "stilettos"]],
  ["loafers",   ["loafers", "loafer", "boat shoes", "dress shoes"]],
  ["shoes",     ["shoes", "shoe"]],
  ["overalls",  ["overalls", "overall", "bib overalls", "coveralls", "jumpsuit", "romper"]],
  ["suit",      ["suit", "two piece suit", "2 piece suit", "tuxedo"]],
  ["dress",     ["dress", "sundress", "gown", "sweater dress", "shirt dress", "tee dress"]],
  ["skirt",     ["skirt", "skort"]],
  ["swimwear",  ["swimsuit", "bikini", "swim trunks", "one piece swimsuit", "bathing suit", "swim suit", "one piece bathing suit"]],
  ["blazer",    ["blazer", "sport coat", "sports coat", "suit jacket"]],
  ["vest",      ["vest", "gilet", "puffer vest", "down vest", "fleece vest", "sweater vest", "quilted vest"]],
  ["hoodie",    ["hoodie", "zip hoodie", "pullover hoodie", "hooded pullover", "sweatshirt hooded"]],
  ["fleece",    ["fleece", "fleece jacket", "fleece pullover", "polar fleece", "sherpa fleece", "better sweater", "synchilla"]],
  ["cardigan",  ["cardigan"]],
  ["sweater",   ["sweater", "jumper", "knit sweater", "cable knit", "turtleneck", "crewneck sweater", "crew neck sweater", "v neck sweater", "mock neck sweater", "pullover sweater"]],
  ["sweatshirt",["sweatshirt", "crewneck", "crew neck", "crewneck sweatshirt", "crew neck sweatshirt"]],
  ["coat",      ["coat", "trench", "trench coat", "overcoat", "topcoat", "peacoat", "pea coat", "parka", "raincoat", "rain coat", "duffle coat", "car coat", "wool coat", "puffer coat", "down coat"]],
  ["jacket",    ["jacket", "bomber", "windbreaker", "trucker jacket", "denim jacket", "jean jacket", "varsity jacket", "letterman jacket", "track jacket", "coach jacket", "coaches jacket", "puffer", "puffer jacket", "down jacket", "rain jacket", "anorak", "harrington", "field jacket", "work jacket", "chore coat", "chore jacket", "shacket", "shirt jacket", "overshirt", "shell jacket", "softshell", "moto jacket", "racing jacket", "leather jacket"]],
  ["jersey",    ["jersey"]],
  ["polo_shirt",["polo shirt", "polo", "golf shirt", "pique polo", "rugby shirt", "rugby"]],
  ["tank",      ["tank top", "tank", "camisole", "cami"]],
  ["button_shirt", ["button down", "button up", "button front", "oxford", "oxford shirt", "dress shirt", "flannel", "flannel shirt", "camp shirt", "camp collar shirt", "hawaiian shirt", "western shirt", "pearl snap", "work shirt", "blouse"]],
  ["tee",       ["tee", "tee shirt", "graphic tee", "long sleeve tee", "pocket tee", "band tee", "concert tee", "ringer tee", "baby tee", "henley"]],
  ["shirt",     ["shirt", "long sleeve shirt", "short sleeve shirt"]],
  ["pullover",  ["pullover", "quarter zip", "half zip", "1/2 zip", "quarterzip"]],
  ["sweatpants",["sweatpants", "joggers", "jogger", "track pants"]],
  ["shorts",    ["shorts", "board shorts", "cargo shorts", "jorts", "jean shorts", "denim shorts"]],
  ["jeans",     ["jeans", "jean", "denim jeans"]],
  ["pants",     ["pants", "chinos", "chino", "khakis", "slacks", "cargo pants", "carpenter pants", "work pants", "corduroys", "cords", "dress pants", "leggings"]],
  ["beanie",    ["beanie", "knit hat", "toboggan", "watch cap"]],
  ["hat",       ["hat", "cap", "snapback", "fitted cap", "fitted hat", "trucker hat", "bucket hat", "visor", "dad hat", "baseball cap", "strapback"]],
  ["backpack",  ["backpack", "rucksack", "daypack"]],
  ["bag",       ["bag", "tote", "tote bag", "purse", "handbag", "crossbody", "messenger bag", "duffel", "duffle bag", "fanny pack", "shoulder bag", "clutch"]],
  ["wallet",    ["wallet", "card holder"]],
  ["scarf",     ["scarf"]],
  ["belt",      ["belt"]],
  ["necktie",   ["necktie", "neck tie", "bow tie", "tie"]],
  ["sunglasses",["sunglasses"]],
  ["watch",     ["watch", "wristwatch"]],
  ["record",    ["vinyl", "lp", "record", "vinyl record", "album", "12 inch"]],
];

/** Phrases that contain a type word but are not a type: consumed and ignored. */
const IGNORE_PHRASES = [
  "cap sleeve", "tie dye", "bootcut", "boot cut", "boot leg", "fleece lined", "sherpa lined",
  "jersey knit", "sweater knit", "hat trick", "polo neck", "shirt collar", "dress code",
  "track suit", "tracksuit", "jump suit", "sweat suit", "tie front", "tie waist",
  // accessories FOR an item are not the item ("Seiko Watch Band")
  "watch band", "watch strap", "replacement band", "shoe laces", "hat clip",
];

export const CATEGORY_GROUPS: readonly string[] = GROUP_DEFS.map(([g]) => g);

/**
 * Pairs that count as the SAME category for tiering. Each pairs a vague word
 * with the specific items it routinely describes on eBay: a quarter-zip
 * sweater is often titled just "Quarter Zip Pullover", and a vintage band tee
 * is very often titled "... Band Shirt".
 */
const COMPATIBLE: Array<[string, string]> = [
  ["pullover", "sweater"], ["pullover", "sweatshirt"], ["pullover", "fleece"],
  ["shirt", "tee"], ["shirt", "button_shirt"], ["shirt", "polo_shirt"], ["shirt", "jersey"],
  ["shoes", "sneakers"], ["shoes", "loafers"],
];

/** Close enough that a buyer would compare them, never the same item. */
const RELATED: Array<[string, string]> = [
  ["hoodie", "sweatshirt"], ["hoodie", "fleece"], ["hoodie", "pullover"],
  ["sweatshirt", "sweater"], ["sweater", "cardigan"], ["sweater", "vest"], ["fleece", "sweater"],
  ["fleece", "jacket"], ["fleece", "sweatshirt"], ["fleece", "vest"],
  ["jacket", "coat"], ["jacket", "blazer"], ["jacket", "vest"], ["coat", "blazer"], ["blazer", "suit"],
  ["tee", "jersey"], ["tee", "tank"], ["tee", "polo_shirt"], ["tee", "button_shirt"],
  ["polo_shirt", "button_shirt"], ["button_shirt", "jacket"],
  ["jeans", "pants"], ["pants", "sweatpants"], ["shorts", "swimwear"],
  ["hat", "beanie"], ["bag", "backpack"], ["bag", "wallet"],
  ["shoes", "boots"], ["shoes", "sandals"], ["shoes", "heels"],
  ["dress", "skirt"], ["overalls", "jeans"],
];

const pairSet = (pairs: Array<[string, string]>) => {
  const s = new Set<string>();
  for (const [a, b] of pairs) { s.add(`${a}|${b}`); s.add(`${b}|${a}`); }
  return s;
};
const COMPATIBLE_SET = pairSet(COMPATIBLE);
const RELATED_SET = pairSet(RELATED);

export type CategoryRelation = "same" | "compatible" | "related" | "different";

export function categoryRelation(scan: string, listing: string): CategoryRelation {
  if (scan === listing) return "same";
  if (COMPATIBLE_SET.has(`${scan}|${listing}`)) return "compatible";
  if (RELATED_SET.has(`${scan}|${listing}`)) return "related";
  return "different";
}

/**
 * Words that can name the FABRIC rather than the garment: "Flannel Pajama
 * Pants", "Fleece Joggers", "Jersey Shorts". When a title names another
 * garment as well, the fabric word gives way.
 */
const FABRIC_PHRASES = new Set(["flannel", "fleece", "polar fleece", "sherpa fleece", "jersey", "oxford"]);
/** …except where the fabric IS the garment: "Fleece Full Zip Jacket" is a
 *  fleece, not a jacket made of fleece. */
const FABRIC_KEEPS: Record<string, string[]> = { fleece: ["jacket", "pullover", "sweatshirt"] };

/** One phrase table, longest first, so compounds win over their parts. */
interface PhraseEntry { words: string[]; group: string | null /* null = ignore */; fabric: boolean }
const PHRASES: PhraseEntry[] = (() => {
  // Ignore-phrases first, so at equal length they claim the words before a
  // garment phrase does ("track suit" before "suit jacket"). The sort is stable.
  const out: PhraseEntry[] = IGNORE_PHRASES.map(p => ({ words: words(prep(p)), group: null, fabric: false }));
  for (const [group, list] of GROUP_DEFS) {
    for (const p of list) out.push({ words: words(prep(p)), group, fabric: FABRIC_PHRASES.has(p) });
  }
  return out.filter(e => e.words.length > 0).sort((a, b) => b.words.length - a.words.length);
})();

const GROUP_ORDER = new Map(CATEGORY_GROUPS.map((g, i) => [g, i]));

export interface CategoryRead {
  /** The group that decides, or null when the text names no known type. */
  group: string | null;
  /** Every group the text names, in precedence order. */
  all: string[];
}

/**
 * What kind of item a piece of text describes.
 *
 * `masked` words (a brand's own words — "Polo" in "Polo Ralph Lauren") are
 * removed first so a brand can never be read as a garment type.
 */
export function detectCategory(text: string, masked: string[] = []): CategoryRead {
  const w = words(maskPhrases(prep(text), masked));
  const used = new Array(w.length).fill(false);
  /** group → named by a garment word (true) or only by a fabric word (false) */
  const found = new Map<string, boolean>();
  for (const e of PHRASES) {
    const n = e.words.length;
    for (let i = 0; i + n <= w.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      let ok = true;
      for (let k = 0; k < n; k++) if (w[i + k] !== e.words[k]) { ok = false; break; }
      if (!ok) continue;
      for (let k = 0; k < n; k++) used[i + k] = true;
      if (e.group) found.set(e.group, (found.get(e.group) ?? false) || !e.fabric);
    }
  }
  const garments = [...found.keys()].filter(g => found.get(g));
  const all = [...found.keys()].filter(g =>
    garments.length === 0 || found.get(g) ||
    (FABRIC_KEEPS[g] ?? []).some(k => garments.includes(k)) && garments.every(k => (FABRIC_KEEPS[g] ?? []).includes(k)),
  ).sort((a, b) => (GROUP_ORDER.get(a) ?? 99) - (GROUP_ORDER.get(b) ?? 99));
  return { group: all[0] ?? null, all };
}

/** Groups that are vague on their own; a more specific read of the scan wins. */
const VAGUE_GROUPS = new Set(["shirt", "shoes", "pullover"]);

/**
 * The scanned item's category: from item_type, refined by the subtype and the
 * generic name when item_type alone is vague or names no group at all.
 */
export function scanCategory(fields: { itemType: string; subtype: string; genericName: string },
                             masked: string[] = []): string | null {
  const primary = detectCategory(fields.itemType, masked).group;
  const refine = detectCategory(`${fields.subtype} ${fields.genericName}`, masked).group;
  if (!primary) return refine;
  if (refine && VAGUE_GROUPS.has(primary) && refine !== primary &&
      categoryRelation(primary, refine) !== "different") return refine;
  return primary;
}

/** Replace whole-word occurrences of any masked phrase with a blank. */
function maskPhrases(prepped: string, masked: string[]): string {
  let out = ` ${prepped} `;
  for (const m of [...masked].sort((a, b) => b.length - a.length)) {
    const p = prep(m);
    if (!p) continue;
    while (out.includes(` ${p} `)) out = out.replace(` ${p} `, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

// ── Brands ────────────────────────────────────────────────────────────────────

/**
 * Brand spellings that squashing alone cannot reconcile. Squashing already
 * makes "J.Crew" = "J Crew" = "JCrew", "Levi's" = "Levis" and drops "The".
 * These cover different WORDS for one brand.
 */
const BRAND_FAMILIES: string[][] = [
  ["ralph lauren", "polo ralph lauren", "polo by ralph lauren", "lauren ralph lauren", "ralph lauren polo"],
  ["levis", "levi strauss", "levi strauss and co", "levi"],
  ["north face", "tnf"],
  ["harley davidson", "harley"],
  ["dr martens", "doc martens"],
  ["ll bean"],
  ["under armour", "under armor"],
  ["abercrombie and fitch", "abercrombie fitch", "abercrombie"],
  ["american eagle", "american eagle outfitters"],
  ["tommy hilfiger", "hilfiger", "tommy jeans"],
  ["calvin klein"],
  ["carhartt", "carhartt wip"],
  ["adidas", "adidas originals"],
  ["nike", "air jordan", "jordan", "nike sb", "nike acg"],
  ["bape", "a bathing ape"],
  ["lululemon", "lululemon athletica"],
  ["columbia", "columbia sportswear"],
  ["guess", "guess jeans"],
];

/** Lowercase, apostrophes and dots gone, & → and, other punctuation → space. */
export function brandNorm(s: string): string {
  return (s ?? "").toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const stripBrandNoise = (b: string) =>
  b.replace(/^the /, "").replace(/ (co|company|inc|usa|clothing|apparel)$/, "").trim();

/** Every accepted spelling of the scanned brand, normalised. */
export function brandVariants(brand: string): string[] {
  const b = stripBrandNoise(brandNorm(brand));
  if (!b) return [];
  const fam = BRAND_FAMILIES.find(f => f.some(v => v === b || squash(v) === squash(b)));
  return [...new Set([b, ...(fam ?? [])])];
}

export function isRalphLauren(brand: string): boolean {
  return brandVariants(brand).includes("ralph lauren");
}

/**
 * Text to read a listing's CATEGORY from. For a Ralph Lauren scan a bare
 * "Polo" is the brand ("Polo 1/4 Zip Pullover"), so it is blanked — unless it
 * is "Polo Shirt", which is the garment.
 */
export function categoryText(brand: string, title: string): string {
  if (!isRalphLauren(brand)) return title;
  return prep(title).replace(/(^| )polo(?= |$)(?! shirt)/g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * Does the listing title carry the scanned brand?
 *
 * Whole-word or squashed match against every variant. For Ralph Lauren a bare
 * "Polo" also counts — "Polo Quarter Zip Navy" is how many of them are listed.
 */
export function brandInTitle(brand: string, title: string): boolean {
  const t = brandNorm(title);
  const variants = brandVariants(brand);
  if (variants.some(v => looseContains(t, v))) return true;
  if (isRalphLauren(brand) && /(^| )polo( |$)/.test(t)) return true;
  return false;
}

/** Phrases to mask before reading a title's category or colours: the
 *  scanned brand's own words can't be a garment ("Polo") or a colour ("Old
 *  Navy"). Bare "polo" is NOT masked — "Polo Shirt" must still read as one. */
export function brandMask(brand: string): string[] {
  return brandVariants(brand).filter(v => v !== "polo");
}

// ── Colours ───────────────────────────────────────────────────────────────────

const COLOR_FAMILIES: Array<[string, string[]]> = [
  ["black",    ["black", "jet black", "onyx"]],
  ["white",    ["white", "off white", "ivory", "cream", "ecru", "bone"]],
  ["grey",     ["grey", "gray", "charcoal", "heather grey", "heather gray", "heather", "silver", "ash", "slate"]],
  ["blue",     ["blue", "navy", "royal blue", "light blue", "sky blue", "baby blue", "indigo", "cobalt", "powder blue", "teal"]],
  ["red",      ["red", "crimson", "scarlet", "cardinal"]],
  ["burgundy", ["burgundy", "maroon", "wine", "oxblood", "cranberry"]],
  ["green",    ["green", "olive", "forest green", "army green", "sage", "hunter green", "kelly green", "mint"]],
  ["yellow",   ["yellow", "mustard", "gold"]],
  ["orange",   ["orange", "rust", "burnt orange"]],
  ["purple",   ["purple", "violet", "lavender", "plum", "lilac"]],
  ["pink",     ["pink", "rose", "magenta", "fuchsia", "blush", "salmon"]],
  ["brown",    ["brown", "tan", "khaki", "camel", "beige", "chocolate", "mocha", "coffee", "taupe", "sand"]],
];
/** Neighbouring shades: a burgundy item listed as "red" is not a contradiction. */
const COLOR_NEIGHBOURS = pairSet([["red", "burgundy"], ["white", "grey"], ["brown", "yellow"], ["blue", "grey"]]);

/** Names that contain a colour word but are not a colour. */
const COLOR_FALSE_FRIENDS = [
  "old navy", "red sox", "white sox", "blue jays", "green bay", "golden state", "red wings", "red wing",
  "black label", "purple label", "blue label", "red label", "white label", "gold label", "orange label",
  "black diamond", "white stag", "brown university", "navy seals", "black sabbath", "pink floyd",
  "green day", "deep purple", "white stripes", "black flag", "black keys", "blue oyster cult",
  "red hot chili peppers", "pink panther", "green lantern", "black panther", "silver tab", "red tab", "orange tab",
];

const COLOR_PHRASES: Array<{ words: string[]; family: string }> = COLOR_FAMILIES
  .flatMap(([family, list]) => list.map(p => ({ words: words(prep(p)), family })))
  .sort((a, b) => b.words.length - a.words.length);

/** Which colour families a text states, after masking names that aren't colours. */
export function colorFamilies(text: string, masked: string[] = []): string[] {
  const w = words(maskPhrases(prep(text), [...COLOR_FALSE_FRIENDS, ...masked]));
  const used = new Array(w.length).fill(false);
  const out = new Set<string>();
  for (const e of COLOR_PHRASES) {
    const n = e.words.length;
    for (let i = 0; i + n <= w.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      let ok = true;
      for (let k = 0; k < n; k++) if (w[i + k] !== e.words[k]) { ok = false; break; }
      if (!ok) continue;
      for (let k = 0; k < n; k++) used[i + k] = true;
      out.add(e.family);
    }
  }
  return [...out];
}

export type ColorRelation = "match" | "absent" | "conflict";

/**
 * Listing colours against the scanned item's.
 *
 * A listing that names the item's colour anywhere matches ("Black Hoodie Red
 * Logo" matches a black hoodie). Silence is absence, not a contradiction.
 * Only a listing that names colours and none of ours conflicts.
 */
export function colorRelation(scanFamilies: string[], listingFamilies: string[]): ColorRelation {
  if (listingFamilies.length === 0) return "absent";
  if (listingFamilies.some(f => scanFamilies.includes(f))) return "match";
  if (listingFamilies.every(f => scanFamilies.some(s => COLOR_NEIGHBOURS.has(`${s}|${f}`)))) return "absent";
  return "conflict";
}

// ── Children's clothing ──────────────────────────────────────────────────────

/**
 * Children's sizing and department words.
 *
 * "boys" and "girls" alone are NOT here — that rejected every Beach Boys,
 * Spice Girls and Backstreet Boys tee. They count only beside a size or a
 * "big/little" qualifier. "junior(s)" is a teen women's department, not kids.
 * Runs on prep()'d text, where "small" has become "s".
 */
const KIDS_RE = new RegExp(
  "(^| )(youth|kids|kid|toddler|infant|newborn|baby boy|baby girl|boys size|girls size|" +
  "big boys|big girls|little boys|little girls|grade school|preschool|gs|ps|td|" +
  // sizes: 4T, 6.5Y, 13C (kids' shoes), 12 months, 18-24M, "size 12m"
  "\\d{1,2}t|\\d{1,2}(\\.5)?[yc]|\\d{1,2} months|\\d{1,2} \\d{1,2} ?(months|m)|size \\d{1,2}m)( |$)",
);
/** "Boys" / "Girls" right beside a size ("Boys M", "Girls 10/12"), or with a
 *  numeric "size N" later in the title ("Boys Hoodie Size 8"). A slogan like
 *  "Girls Night Out Tee M" is not kids' sizing. Band names are masked first. */
const KIDS_ADJ_RE = /(^| )(boys|girls) (size )?(xxs|xs|s|m|l|xl|xxl|\d{1,2}(\/\d{1,2})?)( |$)/;
const KIDS_LATER_RE = /(^| )(boys|girls) (.* )?size \d{1,2}(\/\d{1,2})?( |$)/;

export function isKidsTitle(text: string, masked: string[] = []): boolean {
  const t = ` ${maskPhrases(prep(text), masked)} `;
  if (KIDS_RE.test(t)) return true;
  return KIDS_ADJ_RE.test(t) || KIDS_LATER_RE.test(t);
}

// ── Design words ─────────────────────────────────────────────────────────────

/** Too generic to say anything about which design an item is. */
const DESIGN_STOP = new Set([
  "the", "a", "an", "and", "or", "of", "with", "for", "in", "on", "by", "to", "from",
  "mens", "womens", "unisex", "adult", "adults", "size", "vintage", "retro", "classic", "casual",
  "basic", "plain", "solid", "logo", "graphic", "print", "printed", "style", "new", "used", "item",
  "long", "short", "sleeve", "sleeves", "full", "zip", "front", "pocket", "pockets", "regular",
  "fit", "slim", "relaxed", "loose", "oversized", "cotton", "polyester", "blend", "made", "usa",
  "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s", "xs", "s", "m", "l", "xl", "xxl",
]);
const TYPE_WORDS = new Set(PHRASES.flatMap(e => e.words));
const COLOR_WORDS = new Set(COLOR_PHRASES.flatMap(e => e.words));

/**
 * Distinctive design words from the scanned item ("cable", "mountain",
 * "eagle", "embroidered", "pinstripe"), with brand, type, colour, size and
 * filler words removed. Empty when the scan carries nothing distinctive.
 */
export function designTokens(parts: string[], masked: string[] = []): string[] {
  const masks = masked.flatMap(m => words(prep(m)));
  const out = new Set<string>();
  for (const p of parts) {
    for (const w of words(prep(p))) {
      if (w.length < 3 || /^\d+$/.test(w)) continue;
      if (DESIGN_STOP.has(w) || TYPE_WORDS.has(w) || COLOR_WORDS.has(w) || masks.includes(w)) continue;
      out.add(w);
    }
  }
  return [...out].slice(0, 8);
}

export function designOverlap(tokens: string[], title: string): string[] {
  if (tokens.length === 0) return [];
  const tw = new Set(words(prep(title)));
  return tokens.filter(t => tw.has(t));
}

// ── Decades ──────────────────────────────────────────────────────────────────

const DECADE_START: Record<string, number> = {
  "1950s": 1950, "1960s": 1960, "1970s": 1970, "1980s": 1980, "1990s": 1990,
  "2000s": 2000, "2010s": 2010, "2020s": 2020,
};

/** Decades a title claims: "90s", "1990s", "Y2K", or a year like 1994. */
export function titleDecades(title: string): number[] {
  const out = new Set<number>();
  for (const w of words(prep(title))) {
    if (DECADE_START[w] != null) out.add(DECADE_START[w]);
    else if (/^(19[4-9]\d|200\d)$/.test(w)) out.add(Math.floor(Number(w) / 10) * 10);
  }
  return [...out];
}

export function decadeStart(decade: string | null | undefined): number | null {
  return decade && DECADE_START[decade] != null ? DECADE_START[decade] : null;
}