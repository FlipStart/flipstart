/**
 * server/comps/searchPlan.ts
 *
 * Phase 3: WHAT to ask eBay, in order. (Phase 1 fixed how answers are judged.)
 *
 *   A  precise   the full query: model, line, brand, subject, type, closure,
 *                "vintage", colour, technical material
 *   B  relaxed   identity and type only — no closure, era word, colour or
 *                material (titles often omit them). Keeps the product line, or
 *                the model when there is no line ("501 Levi's jeans").
 *   C  broad     merch identity + plain type ("Chicago Bulls jersey"), else
 *                brand + plain type ("Carhartt jacket", "Brahmin bag"). Skipped
 *                for items with a model or product line: "Nike sneakers"
 *                cannot find a Dunk Low.
 *
 * Unbranded items get A only: their comps can never be better than Similar,
 * so a "miss" is guaranteed and a fallback would be paid for nothing.
 *
 * B and C run only on a MISS (fewer than 3 Exact/Strong comps so far), at most
 * three searches per scan in all, each cached and budgeted like the first.
 * Every listing they return is judged by the same matcher, so a broader search
 * can find more of the right comps but cannot lower the bar for what is shown.
 *
 * Also here: the eBay category every search is restricted to, and the optional
 * excluded words.
 *
 * Deterministic. No model call.
 */
import type { CanonicalAnalysisV1 } from "../../shared/canonical.types.js";
import { normalizeText } from "./normalize.js";
import { scanCategory, brandMask, designTokens, searchTypeText, broadTypeNoun, notStyleTag } from "./taxonomy.js";

export type SearchTier = "A" | "B" | "C";

export interface SearchStep {
  tier: SearchTier;
  /** Exactly what is sent as `keyword`, excluded words included. */
  query: string;
  normalizedQuery: string;
  categoryId: string | null;
  categoryName: string | null;
  excluded: string[];
  why: string;
}

/**
 * eBay category ids. ONLY ids confirmed from two sources — a wrong id silently
 * returns nothing. Even so, a categorised search that returns nothing is
 * retried once without its category (index.ts).
 *
 *   11450  Clothing, Shoes & Accessories   (eBay browse URLs /b/.../11450/)
 *   1059   Men's Clothing                  (eBay men's pages; wisepim taxonomy)
 *   15724  Women's Clothing                (wisepim taxonomy; eBay store category pages)
 *
 * Shoes, hats, bags and accessories use 11450: the men's-shoes id differs
 * between sources (93427 / 63850), so it is not used.
 */
const CSA = { id: "11450", name: "Clothing, Shoes & Accessories" };
const MENS = { id: "1059", name: "Men's Clothing" };
const WOMENS = { id: "15724", name: "Women's Clothing" };

const GARMENTS = new Set([
  "tee", "shirt", "button_shirt", "polo_shirt", "jersey", "tank", "hoodie", "sweatshirt", "sweater",
  "cardigan", "fleece", "pullover", "jacket", "coat", "blazer", "vest", "suit", "dress", "skirt",
  "overalls", "jeans", "pants", "shorts", "sweatpants", "swimwear",
]);
/** Sold under Clothing, Shoes & Accessories, but not in the clothing departments. */
const OTHER_CSA = new Set([
  "boots", "sneakers", "sandals", "heels", "loafers", "shoes", "beanie", "hat", "backpack", "bag",
  "wallet", "scarf", "belt", "necktie", "sunglasses",
]);
/** Department confidence (0-100) at which a search is narrowed to it. Below
 *  it — a cut read off a photo — the whole clothing category is searched. */
const DEPT_CONFIDENT_AT = 60;

const flagOn = (name: string, dflt: boolean) => {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "" ? dflt : v === "true";
};

function groupOf(c: CanonicalAnalysisV1): string | null {
  const id = c.ai.identification;
  return scanCategory(
    { itemType: id.item_type ?? "", subtype: id.subtype ?? "", genericName: id.generic_item_name ?? "" },
    brandMask(id.canonical_brand ?? ""),
  );
}

/** The eBay category to restrict searches to, or null. COMPS_CATEGORY_FILTER=false turns it off. */
export function categoryFor(c: CanonicalAnalysisV1): { id: string; name: string } | null {
  if (!flagOn("COMPS_CATEGORY_FILTER", true)) return null;
  // Team jerseys and caps are often listed under Sports Mem, Cards & Fan
  // Shop, not Clothing. Restricting them would silently lose those sales.
  if ((c.ai.identification.team ?? "").trim()) return null;
  const g = groupOf(c);
  if (!g) return null;
  if (OTHER_CSA.has(g)) return CSA;
  if (!GARMENTS.has(g)) return null;
  const va = c.ai.visible_attributes as { target_department?: string; target_department_confidence?: number };
  const conf = typeof va.target_department_confidence === "number" ? va.target_department_confidence : 0;
  if (va.target_department === "mens" && conf >= DEPT_CONFIDENT_AT) return MENS;
  if (va.target_department === "womens" && conf >= DEPT_CONFIDENT_AT) return WOMENS;
  return CSA;
}

/**
 * Words to exclude from every search: "-lot -youth". OFF unless
 * COMPS_EXCLUDE_WORDS=true — eBay's own search accepts the minus operator,
 * but it is not yet confirmed that SoldComps passes it through rather than
 * searching for the literal word. The matcher rejects these listings anyway;
 * excluding them only stops them using up the 240 slots.
 */
export function excludedWords(c: CanonicalAnalysisV1, positiveQuery: string): string[] {
  if (!flagOn("COMPS_EXCLUDE_WORDS", false)) return [];
  const g = groupOf(c);
  const va = c.ai.visible_attributes as { target_department?: string };
  const era = c.derived.era_effective.status;
  // Most specific first: the cap of five drops the generic ones.
  const out: string[] = [];
  if (g === "jacket") out.push("trench");
  if (era === "confirmed_vintage" || era === "likely_vintage") out.push("reprint");
  out.push("lot", "bundle");
  if (va.target_department !== "kids") out.push("youth", "toddler");
  const pos = new Set(normalizeText(positiveQuery).split(" "));
  return out.filter(w => !pos.has(w)).slice(0, 5);
}

/**
 * Feeling words that skew results toward overpriced listings. Stripped from
 * FREE-TEXT fields only (subject, item type) — never from a name: "Fire-King",
 * "Arcade Fire" and the brand "Hype" are names.
 */
export const BANNED = /\b(rare|grail|valuable|authentic|must[- ]have|trendy|hype|fire|insane|stunning|gorgeous|amazing)\b/gi;

/** One query part, made safe: a leading "-" would make eBay EXCLUDE the word. */
export function queryPart(value: string | null | undefined, freeText = false): string {
  let v = (value ?? "").trim();
  if (freeText) v = v.replace(BANNED, " ");
  return v.replace(/(^|\s)-+/g, "$1").replace(/\s+/g, " ").trim();
}
const clean = (parts: string[]) => parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/** Style tags in the product-line or subject field: taxonomy.ts. Re-exported
 *  here because the searches are where they mattered first. */
export { notStyleTag };

/** The item type as searched: a repeated type word dropped ("satchel handbag"
 *  → "satchel"), feeling words stripped. */
export function searchType(c: CanonicalAnalysisV1): string {
  const id = c.ai.identification;
  return queryPart(searchTypeText(id.item_type ?? "", brandMask(id.canonical_brand ?? "")), true);
}

/** A search as shown to the user: without the excluded words. */
export const displayQuery = (q: string) => q.replace(/(^|\s)-\S+/g, "").replace(/\s+/g, " ").trim();

/**
 * Words that genuinely narrow an UNBRANDED search: pattern, material,
 * construction. Generic style tags ("streetwear", "workwear", "heavyweight")
 * and colours are deliberately absent — "black t-shirt" returns every black
 * tee ever sold, and its median means nothing.
 */
const STYLE_VOCAB = [
  "plaid", "tartan", "flannel", "buffalo check", "cable knit", "cable", "fair isle", "argyle", "houndstooth",
  "herringbone", "tweed", "leather", "suede", "denim", "corduroy", "wool", "cashmere", "mohair", "sherpa",
  "fleece", "camo", "camouflage", "tie dye", "striped", "floral", "paisley", "hawaiian", "aloha", "western",
  "pearl snap", "varsity", "letterman", "chore", "quilted", "puffer", "waxed", "canvas", "chambray", "linen",
  "silk", "velvet", "velour", "satin", "patchwork", "embroidered", "sequin", "crochet", "racing", "souvenir",
  "military", "bomber", "trucker", "peacoat",
];

/** The style words for an unbranded search, in the item's own order. Empty
 *  when there is nothing that narrows it. */
export function styleWords(c: CanonicalAnalysisV1): string[] {
  const id = c.ai.identification;
  const text = ` ${normalizeText([id.generic_item_name, id.subtype, id.item_type].filter(Boolean).join(" ")).replace(/-/g, " ")} `;
  const type = ` ${normalizeText(id.item_type ?? "").replace(/-/g, " ")} `;
  const found: Array<[number, string]> = [];
  for (const w of [...STYLE_VOCAB].sort((a, b) => b.length - a.length)) {
    const at = text.indexOf(` ${w} `);
    if (at < 0 || type.includes(` ${w} `)) continue;           // already in the item type
    if (found.some(([, f]) => f.includes(w))) continue;        // "cable" inside "cable knit"
    found.push([at, w]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, w]) => w).slice(0, 2);
}

/** True when the item type itself carries a style word ("wool peacoat",
 *  "leather jacket", "hawaiian shirt") — narrow enough to search on alone. */
export function typeIsStyled(c: CanonicalAnalysisV1): boolean {
  const type = ` ${normalizeText(c.ai.identification.item_type ?? "").replace(/-/g, " ")} `;
  return STYLE_VOCAB.some(w => type.includes(` ${w} `)) && type.trim().split(" ").length >= 2;
}

/**
 * The ordered searches for an eligible item. `precise` is the query
 * buildCompsQuery already produced; B and C are added only when they differ
 * from what came before and are still at least two words.
 */
export function buildSearchPlan(c: CanonicalAnalysisV1, precise: string, opts: { unbranded?: boolean } = {}): SearchStep[] {
  const id = c.ai.identification;
  const cat = categoryFor(c);
  const steps: SearchStep[] = [];
  const add = (tier: SearchTier, base: string, why: string) => {
    const q = clean([base]);
    if (q.split(" ").length < 2) return;
    const norm = normalizeText(q);
    if (steps.some(s => normalizeText(displayQuery(s.query)) === norm)) return;
    const excluded = excludedWords(c, q);
    const query = excluded.length ? `${q} ${excluded.map(w => `-${w}`).join(" ")}` : q;
    steps.push({ tier, query, normalizedQuery: normalizeText(query), categoryId: cat?.id ?? null,
                 categoryName: cat?.name ?? null, excluded, why });
  };
  const type = searchType(c);
  const model = queryPart(id.model_or_product_number);
  const line = queryPart(notStyleTag(id.product_line));

  add("A", precise, "precise: every confident detail");
  if (opts.unbranded) return steps;

  add("B", clean([line || model, queryPart(id.canonical_brand), queryPart(notStyleTag(id.subject), true), queryPart(id.team),
                  queryPart(id.artist), queryPart(id.event), queryPart(id.character_or_license), type]),
      "relaxed: identity and type only — titles often omit closure, era and colour");
  if (!model && !line) {
    // Merch identity before the brand: a Bulls jersey's brand is the blank's
    // maker ("Nike", "Starter"), and "Nike jersey" finds every Nike jersey.
    const anchor = queryPart(id.team) || queryPart(id.artist) || queryPart(id.character_or_license) ||
                   queryPart(id.canonical_brand) || queryPart(notStyleTag(id.subject), true);
    // The plain noun ("Brahmin bag", "Carhartt jacket"), not the exact style:
    // it still finds the item when the style name is off ("chore coat" for a
    // work jacket) or rarely written. The matcher decides what is shown.
    const broad = broadTypeNoun(groupOf(c)) ?? type;
    if (anchor) add("C", clean([anchor, broad]), "broad: identity + plain type");
  }
  return steps;
}