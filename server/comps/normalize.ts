/**
 * server/comps/normalize.ts
 *
 * Deterministic token normalisation and synonym handling.
 *
 * The rule that shapes this file: match on WORD BOUNDARIES and alias sets,
 * never on substrings. Naive substring matching produces exactly the failures
 * the spec calls out — "men" matching inside "women", "XL" matching inside
 * arbitrary text, "north face" collapsing to "face".
 */

/** Query-builder version. Bump on any behaviour change — it is part of the
 *  cache key, so old entries invalidate automatically. */
export const QUERY_BUILDER_VERSION = "qb-1";
/** Matching-algorithm version. Same contract. */
export const MATCH_ALGO_VERSION = "match-1";

export function normalizeText(s: string): string {
  return s.toLowerCase()
    .replace(/[''`]/g, "")          // women's -> womens
    .replace(/[^a-z0-9/+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalizeText(s).split(" ").filter(Boolean);
}

/**
 * Alias groups. Every member maps to the group's canonical first entry, so
 * "1/4 zip", "quarter-zip" and "quarter zip" become one token.
 */
const ALIAS_GROUPS: string[][] = [
  ["tee", "t-shirt", "tshirt", "t shirt"],
  ["hoodie", "hooded sweatshirt", "hoody"],
  ["sweatshirt", "crewneck", "crew neck"],
  ["quarter zip", "1/4 zip", "quarter-zip", "qtr zip"],
  ["full zip", "zip-up", "zip up", "fullzip"],
  ["fleece", "fleece jacket"],
  ["xl", "extra large"],
  ["xxl", "2xl", "double extra large"],
  ["xs", "extra small"],
  ["l", "large"], ["m", "medium"], ["s", "small"],
  ["1990s", "90s", "nineties"],
  ["2000s", "00s", "y2k", "early 2000s"],
  ["navy", "navy blue"],
  ["womens", "women", "ladies", "female"],
  ["mens", "men", "male"],
  ["jacket", "coat"],
  ["pants", "trousers"],
];

const ALIAS_MAP = (() => {
  const m = new Map<string, string>();
  for (const g of ALIAS_GROUPS) {
    const canon = g[0];
    for (const v of g) m.set(normalizeText(v), canon);
  }
  return m;
})();

/** Canonicalise a phrase through the alias table. Multi-word aliases are
 *  matched before single words so "quarter zip" is not split into "quarter". */
export function canonicalPhrase(s: string): string {
  const n = normalizeText(s);
  const direct = ALIAS_MAP.get(n);
  if (direct) return direct;
  let out = n;
  for (const [alias, canon] of ALIAS_MAP) {
    if (!alias.includes(" ")) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(alias)}\\b`, "g"), canon);
  }
  return out.split(" ").map(w => ALIAS_MAP.get(w) ?? w).join(" ");
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-phrase containment on word boundaries.
 *
 * `containsPhrase("women's large tee", "men")` is FALSE — the failure a naive
 * `includes()` would produce and the reason this helper exists.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  const h = canonicalPhrase(haystack);
  const n = canonicalPhrase(needle);
  if (!n) return false;
  return new RegExp(`(^|\\s)${escapeRe(n)}(\\s|$)`).test(h);
}

export function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some(n => containsPhrase(haystack, n));
}