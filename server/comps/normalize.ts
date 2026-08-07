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
export const QUERY_BUILDER_VERSION = "qb-2";
/** Matching-algorithm version. Same contract. */
export const MATCH_ALGO_VERSION = "match-2";

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
  // Team shorthands, so "Yankees" and "New York Yankees" are one token.
  ["new york yankees", "yankees", "ny yankees"],
  ["chicago cubs", "cubs"],
  ["chicago bulls", "bulls"],
  ["polo ralph lauren", "polo by ralph lauren", "ralph lauren polo"],
];

/**
 * Closure families. Mutually exclusive — a garment has one closure.
 *
 * NOT in the alias table above, deliberately. Aliases express equivalence; these
 * need CONTRADICTION detection. "full zip" and "pullover" are not synonyms, and
 * treating them as interchangeable is how a pullover comps a zip-up.
 */
export const CLOSURE_FAMILIES: Record<string, string[]> = {
  full_zip:    ["full zip", "zip up", "zip front", "zipper front", "fullzip", "full zipper"],
  quarter_zip: ["quarter zip", "1/4 zip", "qtr zip", "quarterzip"],
  half_zip:    ["half zip", "1/2 zip"],
  pullover:    ["pullover", "pull over", "crewneck", "crew neck"],
  button:      ["button up", "button front", "buttoned"],
  snap:        ["snap front", "snap button", "snap up"],
};

/**
 * Precompiled once at module load.
 *
 * Building these inside the loop cost ~210ms per 100 listings — 14% overhead on
 * a provider call — because RegExp construction dominates when it runs hundreds
 * of times per scan. Compiling once reduces it to noise.
 */
const CLOSURE_RE: Array<[string, RegExp]> = Object.entries(CLOSURE_FAMILIES).map(
  ([fam, words]) => [fam, new RegExp(`(^|\\s)(?:${words.map(w => escapeRe(normalizeText(w))).join("|")})(\\s|$)`)],
);

/**
 * Canonical closure from the schema's features.closure_type enum.
 *
 * The enum uses zip_full / zip_quarter, while listing titles say "full zip".
 * Without this mapping the SCANNED closure never resolved, so every comparison
 * fell to half credit and closure — the most discriminating trait for a hoodie —
 * did nothing at all.
 */
export function closureFromEnum(v: string): string | null {
  switch (v) {
    case "zip_full":    return "full_zip";
    case "zip_quarter": return "quarter_zip";
    case "zip_half":    return "half_zip";
    case "pullover":    return "pullover";
    case "button":      return "button";
    case "snap":        return "snap";
    default:            return null;
  }
}

/** Which closure a piece of text states, or null when it says nothing. */
export function detectClosure(text: string): string | null {
  // Hyphens become spaces HERE rather than in normalizeText, because model
  // numbers and sizes elsewhere depend on hyphens surviving. Without this,
  // "Zip-Up Hoodie" reads as no closure at all — which is exactly the silent
  // miss that let a pullover comp a zip-up.
  const c = normalizeText(text).replace(/-/g, " ").replace(/\s+/g, " ");
  for (const [fam, re] of CLOSURE_RE) if (re.test(c)) return fam;
  return null;
}

/**
 * Value-driving specialty signals.
 *
 * The Yankees failure in one list: a plain item and a team-branded item share a
 * brand and a garment type, and the team IS the entire price difference. These
 * are the traits that make a listing a different PRODUCT rather than a slightly
 * different one.
 */
export const SPECIALTY_PATTERNS: Array<[string, RegExp]> = [
  ["team",          /\b(yankees|mets|red sox|dodgers|cubs|bulls|lakers|celtics|packers|cowboys|steelers|raiders|knicks|braves|eagles|patriots|49ers|bears|warriors|nets|rangers|blackhawks|penguins)\b/i],
  ["league",        /\b(mlb|nba|nfl|nhl|mls|ncaa|premier league|world cup)\b/i],
  ["college",       /\b(university|college|alumni|varsity)\b/i],
  ["collaboration", /\b(collab|collaboration|supreme|off[- ]white|kith|palace|bape|stussy)\b/i],
  ["limited",       /\b(limited edition|limited ed|numbered|deadstock|sample|prototype)\b/i],
  ["event",         /\b(championship|world series|super bowl|final four|playoffs|commemorative)\b/i],
  ["tour",          /\b(world tour|concert tee|tour dates|band tee)\b/i],
  ["license",       /\b(disney|marvel|star wars|harry potter|pokemon|looney tunes|nintendo|sanrio|hello kitty)\b/i],
  ["premium_line",  /\b(purple label|double rl|rrl|polo sport|rlx|lauren ralph lauren|polo jeans|ralph lauren golf|summit series)\b/i],
];

/** Every specialty signal a piece of text carries. */
export function detectSpecialty(text: string): Array<{ kind: string; match: string }> {
  const out: Array<{ kind: string; match: string }> = [];
  for (const [kind, re] of SPECIALTY_PATTERNS) {
    const m = re.exec(text);
    if (m) out.push({ kind, match: m[0].toLowerCase() });
  }
  return out;
}

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
/** Multi-word aliases, precompiled. Same reason as CLOSURE_RE. */
const MULTI_ALIAS: Array<[RegExp, string]> = [...ALIAS_MAP.entries()]
  .filter(([a]) => a.includes(" "))
  .map(([a, canon]) => [new RegExp(`\\b${escapeRe(a)}\\b`, "g"), canon] as [RegExp, string]);

/** Titles repeat heavily within one result set and the matcher canonicalises the
 *  same title several times, so a small memo pays for itself immediately. */
const phraseCache = new Map<string, string>();

export function canonicalPhrase(s: string): string {
  const n = normalizeText(s);
  const direct = ALIAS_MAP.get(n);
  if (direct) return direct;
  const hit = phraseCache.get(n);
  if (hit !== undefined) return hit;
  let out = n;
  for (const [re, canon] of MULTI_ALIAS) out = out.replace(re, canon);
  out = out.split(" ").map(w => ALIAS_MAP.get(w) ?? w).join(" ");
  if (phraseCache.size > 2000) phraseCache.clear();
  phraseCache.set(n, out);
  return out;
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
const needleCache = new Map<string, RegExp>();

export function containsPhrase(haystack: string, needle: string): boolean {
  const h = canonicalPhrase(haystack);
  const n = canonicalPhrase(needle);
  if (!n) return false;
  let re = needleCache.get(n);
  if (!re) {
    re = new RegExp(`(^|\\s)${escapeRe(n)}(\\s|$)`);
    if (needleCache.size > 1000) needleCache.clear();
    needleCache.set(n, re);
  }
  return re.test(h);
}

export function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some(n => containsPhrase(haystack, n));
}