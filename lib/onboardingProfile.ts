/**
 * lib/onboardingProfile.ts
 *
 * What the quiz answers MEAN on the result screen. Pure — no React, no
 * storage, no SDK, and deliberately no import of the gamification modules
 * (huntXp pulls AsyncStorage at load; the screen imports RANK_LADDER itself).
 *
 * ── Derived, never stored ───────────────────────────────────────────────────
 * The archetype is a function of `primaryGoal`. It is computed every time it
 * is shown and persisted nowhere, so it can never disagree with the answer it
 * came from. The same goes for the recommended tools.
 *
 * ── Pro is labelled at the source ───────────────────────────────────────────
 * Every tool carries `pro: true | false` from the catalogue below, mirroring
 * canUseFeature() in server/monetization/policy.ts: Deep Analysis, Generate
 * Listings, AI Context and 3-Photo Scans are Pro; scanning, Sold Comps and
 * Hunt Mode are free. The result card renders the PRO seal from this flag, so
 * a Pro tool cannot be recommended without saying so.
 */
import {
  EXPERIENCE_LEVELS, PAIN_POINTS, PRIMARY_GOALS,
  type ExperienceLevel, type PainPoint, type PrimaryGoal,
} from "./onboardingQuiz";

// ── Archetype ───────────────────────────────────────────────────────────────

export type Archetype = "profit_hunter" | "treasure_hunter" | "all_around_flipper";

export const ARCHETYPES: Record<Archetype, { title: string; line: string }> = {
  profit_hunter:      { title: "THE PROFIT HUNTER",      line: "You buy to sell. FlipStart is built to tell you what a find is worth before you pay for it." },
  treasure_hunter:    { title: "THE TREASURE HUNTER",    line: "You buy what you love. FlipStart helps you know what it is, what it\u2019s worth, and what deserves a closer look." },
  all_around_flipper: { title: "THE ALL-AROUND FLIPPER", line: "Some for you, some to sell. FlipStart helps you decide which is which." },
};

export function deriveArchetype(goal: PrimaryGoal): Archetype {
  switch (goal) {
    case "resell_profit":  return "profit_hunter";
    case "personal_finds": return "treasure_hunter";
    case "both":           return "all_around_flipper";
  }
}

// ── Tool catalogue ──────────────────────────────────────────────────────────

export type ToolKey =
  | "scan_finds" | "sold_comps" | "deep_analysis" | "hunt_mode"
  | "demand_sell_speed" | "generate_listings" | "brand_compendium";

export interface RecommendedTool {
  key: ToolKey;
  name: string;
  blurb: string;
  /** Pro-only per canUseFeature(). Rendered as a PRO seal; never implied free. */
  pro: boolean;
  icon: "qr-code-scanner" | "receipt-long" | "insights" | "travel-explore" | "speed" | "sell" | "local-offer";
}

export const TOOLS: Record<ToolKey, RecommendedTool> = {
  scan_finds:        { key: "scan_finds",        name: "Scan Finds",         blurb: "Estimated resale, demand and a buy rating from a photo.", pro: false, icon: "qr-code-scanner" },
  sold_comps:        { key: "sold_comps",        name: "Sold Comps",         blurb: "Real sold listings to check the number against.",       pro: false, icon: "receipt-long" },
  deep_analysis:     { key: "deep_analysis",     name: "Deep Analysis",      blurb: "Buy Under, price logic, risk flags and evidence.",         pro: true,  icon: "insights" },
  hunt_mode:         { key: "hunt_mode",         name: "Hunt Mode",          blurb: "Turn a thrift trip into XP, ranks and discoveries.",      pro: false, icon: "travel-explore" },
  demand_sell_speed: { key: "demand_sell_speed", name: "Demand & Sell Speed", blurb: "See how fast an item tends to move before you buy.",    pro: false, icon: "speed" },
  generate_listings: { key: "generate_listings", name: "Generate Listings",  blurb: "Ready-to-edit eBay and Depop drafts from your scan.",     pro: true,  icon: "sell" },
  brand_compendium:  { key: "brand_compendium",  name: "Brand Compendium",   blurb: "Discover brands as you find them and build your record.", pro: false, icon: "local-offer" },
};

/** What each pain point asks for, most specific first. */
const BY_PAIN: Record<PainPoint, ToolKey[]> = {
  item_identification:   ["scan_finds", "deep_analysis", "brand_compendium"],
  valuation_uncertainty: ["scan_finds", "sold_comps", "deep_analysis"],
  missed_opportunities:  ["scan_finds", "deep_analysis", "hunt_mode"],
  comp_research:         ["sold_comps", "deep_analysis"],
  slow_selling_buys:     ["demand_sell_speed", "deep_analysis"],
  listing_time:          ["generate_listings", "scan_finds"],
};

/**
 * A small nudge, not a scoring engine: a reseller sees pricing and selling
 * tools first, a personal thrifter sees identification and discovery first,
 * and "both" leaves the pain points' own order alone. Lower sorts earlier.
 */
const GOAL_BIAS: Record<PrimaryGoal, Partial<Record<ToolKey, number>>> = {
  resell_profit:  { generate_listings: -2, sold_comps: -2, deep_analysis: -1, demand_sell_speed: -1, brand_compendium: 2, hunt_mode: 2 },
  personal_finds: { scan_finds: -2, brand_compendium: -1, hunt_mode: -1, generate_listings: 3, demand_sell_speed: 1 },
  both:           {},
};

/**
 * Two or three tools for the pain points the user actually chose.
 *
 * Deterministic by construction: the selections are read in CATALOGUE order
 * (not tap order), each contributes its tools in a fixed order, duplicates
 * collapse to their FIRST appearance, and the goal bias is applied as a stable
 * sort that keeps original position as the tiebreak. The same answers always
 * produce the same three tools, in the same order.
 *
 * Generate Listings is dropped for a purely personal goal — it is a selling
 * tool — unless it is the only thing they asked for, in which case removing it
 * would answer a question they did not ask.
 */
export function recommendTools(goal: PrimaryGoal, pains: readonly PainPoint[]): RecommendedTool[] {
  const selected = PAIN_POINTS.map(p => p.value).filter(v => pains.includes(v));
  if (selected.length === 0) return [TOOLS.scan_finds, TOOLS.deep_analysis];

  const ordered: ToolKey[] = [];
  for (const p of selected) for (const k of BY_PAIN[p]) if (!ordered.includes(k)) ordered.push(k);

  let keys = ordered;
  if (goal === "personal_finds") {
    // Drop the selling tool ONLY if what's left is still a real recommendation.
    // Someone whose single request was "create listings faster" gets it back:
    // removing it would answer a question they did not ask.
    const withoutSelling = keys.filter(k => k !== "generate_listings");
    if (withoutSelling.length >= 2) keys = withoutSelling;
  }

  const bias = GOAL_BIAS[goal];
  const sorted = keys
    .map((k, i) => ({ k, i, w: bias[k] ?? 0 }))
    .sort((a, b) => (a.w - b.w) || (a.i - b.i))
    .map(e => e.k);

  // Never fewer than two. Every pain point contributes at least two tools, so
  // this only fires if the goal filter took one away.
  const out = sorted.slice(0, 3);
  for (const fallback of ["scan_finds", "deep_analysis"] as ToolKey[]) {
    if (out.length >= 2) break;
    if (!out.includes(fallback)) out.push(fallback);
  }
  return out.map(k => TOOLS[k]);
}

// ── Labels for the result card ──────────────────────────────────────────────

export function goalLabel(goal: PrimaryGoal): string {
  return PRIMARY_GOALS.find(o => o.value === goal)?.title ?? goal;
}
export function experienceLabel(level: ExperienceLevel): string {
  return EXPERIENCE_LEVELS.find(o => o.value === level)?.title ?? level;
}
/**
 * The pain points, turned around into what FlipStart can help with. Reads the
 * selections in catalogue order so the line is stable across sessions, and
 * shows at most two so the card never grows a paragraph.
 */
export function opportunityLabel(pains: readonly PainPoint[]): string {
  const selected = PAIN_POINTS.map(p => p.value).filter(v => pains.includes(v));
  if (selected.length === 0) return "Spot profitable finds faster";
  return selected.slice(0, 2).map(opportunityLabelOne).join(" \u00B7 ");
}

function opportunityLabelOne(pain: PainPoint): string {
  switch (pain) {
    case "item_identification":   return "Know what you\u2019re looking at";
    case "valuation_uncertainty": return "Know what a find is really worth";
    case "missed_opportunities":  return "Spot profitable finds faster";
    case "comp_research":         return "Check comps in seconds";
    case "slow_selling_buys":     return "Buy what actually sells";
    case "listing_time":          return "List finds in a fraction of the time";
  }
}

/**
 * The focus chips: at most two, in catalogue order, plus a count of the rest.
 *
 * A user may select all six. Rendering six chips turns the profile card into a
 * six-line block on both screens, so the overflow becomes "+4 more" rather
 * than being allowed to grow the layout.
 */
export function painChips(pains: readonly PainPoint[], max = 2): { visible: string[]; moreCount: number } {
  const selected = PAIN_POINTS.filter(p => pains.includes(p.value));
  return {
    visible: selected.slice(0, max).map(p => p.title),
    moreCount: Math.max(0, selected.length - max),
  };
}

export function painLabel(pain: PainPoint): string {
  return PAIN_POINTS.find(o => o.value === pain)?.title ?? pain;
}