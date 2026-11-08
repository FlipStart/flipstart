/**
 * server/compat/categoryLabel.ts
 *
 * The short label in the category pill on the results screen
 * (identification.category): what the item IS — "Hoodie", "Denim Jacket",
 * "Graphic Tee" — not the broad bucket "clothing".
 *
 * Built from the AI's own item_type and subtype. Kept short enough for the
 * pill: a long type keeps its last words (English puts the noun last, so
 * "denim trucker jacket" → "Trucker Jacket"), and only when even that won't
 * fit, or there is no type at all, does it fall back to the broad category
 * ("Clothing", "Sporting Goods").
 *
 * Never includes the brand (it has its own pill), the era, or filler like
 * "vintage" — those are elsewhere on the screen.
 */

/** Longest label the pill shows without stretching. */
export const CATEGORY_LABEL_MAX = 16;

const BROAD_LABEL: Record<string, string> = {
  clothing: "Clothing", shoes: "Shoes", bags: "Bag", accessories: "Accessory",
  jewelry: "Jewelry", watches: "Watch", electronics: "Electronics", housewares: "Housewares",
  media: "Media", toys: "Toy", sporting_goods: "Sporting Goods", furniture: "Furniture",
  collectibles: "Collectible", other: "Other", unknown: "Other",
};

/** Words that describe age, condition or hype, never the item itself. */
const FILLER = new Set([
  "vintage", "retro", "classic", "rare", "authentic", "genuine", "original", "new", "used",
  "old", "antique", "y2k", "deadstock", "nwt", "item", "piece", "unknown", "n/a", "na", "none", "other",
]);
const ERA = /^(?:(?:19|20)?\d0'?s|\d{4}s?|mid|late|early)$/i;

/** Small words that stay lowercase inside a label. */
const SMALL = new Set(["and", "or", "of", "with", "for", "the", "a", "on", "in"]);
/** Spellings that title-casing would get wrong. */
const FIXED: Record<string, string> = { "t-shirt": "T-Shirt", "tshirt": "T-Shirt", "tee-shirt": "T-Shirt", "vhs": "VHS", "cd": "CD", "dvd": "DVD", "lp": "LP", "mlb": "MLB", "nfl": "NFL", "nba": "NBA", "nhl": "NHL" };

function words(s: unknown): string[] {
  if (typeof s !== "string") return [];
  return s.toLowerCase().replace(/[_/]+/g, " ").replace(/[^a-z0-9'\- ]+/g, " ").split(/\s+/).filter(Boolean);
}

function titleWord(w: string, first: boolean): string {
  if (FIXED[w]) return FIXED[w];
  if (!first && SMALL.has(w)) return w;
  return w.split("-").map(p => (p ? p[0].toUpperCase() + p.slice(1) : p)).join("-");
}

const label = (ws: string[]) => ws.map((w, i) => titleWord(w, i === 0)).join(" ");

/**
 * What thrifters actually call these. Checked against the subtype + type
 * together and the type alone, after filler and the brand are removed.
 */
const SHORT_NAME: Record<string, string> = {
  "crewneck sweatshirt": "Crewneck",
  "crew neck sweatshirt": "Crewneck",
  "crew-neck sweatshirt": "Crewneck",
  "crewneck": "Crewneck",
  "crew neck": "Crewneck",
  "hooded sweatshirt": "Hoodie",
};

function shortName(ws: string[]): string | null {
  const phrase = ws.join(" ");
  return SHORT_NAME[phrase] ?? null;
}

/** Drop filler, eras and the brand's own words. */
function clean(ws: string[], brandWords: Set<string>): string[] {
  // Single letters are debris ("n/a" → "n", "a").
  const out = ws.filter(w => w.length > 1 && !FILLER.has(w) && !ERA.test(w) && !brandWords.has(w));
  // A leftover small word at either end ("of", "with") means nothing.
  while (out.length && SMALL.has(out[0])) out.shift();
  while (out.length && SMALL.has(out[out.length - 1])) out.pop();
  return out;
}

/** Keep the last words that fit (the noun is last). Null if not even one does. */
function fit(ws: string[]): string | null {
  for (let i = 0; i < ws.length; i++) {
    const l = label(ws.slice(i));
    if (l.length <= CATEGORY_LABEL_MAX) return l;
  }
  return null;
}

export function categoryLabel(i: {
  item_type?: unknown; subtype?: unknown; broad_category?: unknown; brand?: unknown;
}): string {
  const brandWords = new Set(words(i.brand).filter(w => w.length > 1));
  const type = clean(words(i.item_type), brandWords);
  const sub = clean(words(i.subtype), brandWords);
  const broad = BROAD_LABEL[typeof i.broad_category === "string" ? i.broad_category : ""] ?? "Other";

  if (type.length) {
    // "crewneck" + "sweatshirt", or "crewneck sweatshirt" → "Crewneck".
    const named = (sub.length && shortName([...sub, ...type])) || shortName(type);
    if (named) return named;
    // "pocket" + "tee" → "Pocket Tee"; "zip-up" + "hoodie" → "Zip-Up Hoodie".
    // Only a short subtype the type doesn't already say, and only if it fits.
    if (sub.length && sub.length <= 2 && !sub.some(w => type.includes(w))) {
      const both = label([...sub, ...type]);
      if (both.length <= CATEGORY_LABEL_MAX) return both;
    }
    const t = fit(type);
    if (t) return t;
  }
  return broad;
}

/**
 * The older AI route writes its category as free text ("Vintage Denim
 * Jacket", "Nike Hoodie"). Same rules: drop filler and the brand, keep it
 * short, and fall back to "Other".
 */
export function legacyCategoryLabel(category: unknown, brand: unknown): string {
  const brandWords = new Set(words(brand).filter(w => w.length > 1));
  const ws = clean(words(category), brandWords);
  return (ws.length && (shortName(ws) || fit(ws))) || "Other";
}