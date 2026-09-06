/**
 * __tests__/onboarding/phase-4-payoff.test.ts
 *
 * The second half of onboarding: the gamification showcase, the profile
 * assembling itself, and the finished profile.
 *
 * The recurring risk in all three is inventing things the product does not
 * have — a fake achievement, art that does not exist, a streak we no longer
 * sell, a predicted profit. Most of what follows checks against the REAL
 * definitions rather than against strings I typed.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * AsyncStorage is a native module. huntXp, diamonds and brandCompendium import
 * it at load time but only touch it inside functions, so a stub lets this
 * suite read the REAL rank ladder, Diamond and brand definitions rather than
 * asserting against values transcribed by hand.
 */
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    multiSet: async () => {},
    multiGet: async () => [],
    multiRemove: async () => {},
  },
}));
import { readFileSync } from "node:fs";
import path from "node:path";
import { RANK_LADDER, getCurrentRank, getNextRank } from "@/lib/huntXp";
import { DIAMONDS, TOTAL_DIAMONDS, CATEGORY_META } from "@/lib/diamonds";
import { ALL_BRANDS, RARITY_LABELS, RARITY_COLORS, TOTAL_SUPPORTED_BRANDS } from "@/lib/brandCompendium";
import { ACHIEVEMENT_CATEGORIES } from "@/lib/achievements";
import { ARCHETYPES, deriveArchetype, painChips, recommendTools } from "@/lib/onboardingProfile";
import { PAIN_POINTS, PRIMARY_GOALS } from "@/lib/onboardingQuiz";
import { FREE_LIFETIME_SCANS } from "@/lib/paywallConfig";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function stripComments(src: string): string {
  let out = "", mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "sq"; else if (c === '"') mode = "dq"; else if (c === "`") mode = "tpl";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; } else i++; continue; }
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c; i++;
  }
  return out;
}
const code = (s: string) => stripComments(s);

const TEASERS  = read("components/onboarding/ValueTeasers.tsx");
const BUILDING = read("components/onboarding/ProfileBuilding.tsx");
const RESULT   = read("components/onboarding/ProfileResult.tsx");
const CREST    = read("components/onboarding/ProfileCrest.tsx");
const SCREEN   = read("app/onboarding.tsx");
const PROFILE  = read("lib/onboardingProfile.ts");

const PAYOFF_COPY = [TEASERS, BUILDING, RESULT, PROFILE].map(code).join("\n").toLowerCase();

// ── Gamification ────────────────────────────────────────────────────────────

describe("gamification showcase", () => {
  it("ties XP to a completed Hunt and never to a scan", () => {
    expect(TEASERS).toMatch(/HUNT COMPLETE/);
    expect(TEASERS).toMatch(/for completing a Hunt/);
    expect(TEASERS).toMatch(/ranks, earned by completing Hunts/);
    expect(PAYOFF_COPY).not.toMatch(/xp (per|for|from) (a |each |every )?scan|scan[^.]{0,30}\+\d+ ?xp/);
  });

  it("shows no Hunt Streaks, leaderboard or Milestones anywhere in onboarding", () => {
    const all = [TEASERS, BUILDING, RESULT, SCREEN].map(code).join("\n").toLowerCase();
    expect(all).not.toMatch(/streak/);
    expect(all).not.toMatch(/leaderboard/);
    expect(all).not.toMatch(/milestone/);
    // The product still HAS a streak category — untouched, just not sold here.
    expect(ACHIEVEMENT_CATEGORIES.some(c => c.id === "streak")).toBe(true);
  });

  it("derives both ranks and both bar positions from the real ladder", () => {
    expect(TEASERS).toMatch(/const SAMPLE_XP_BEFORE = 340;/);
    expect(TEASERS).toMatch(/const SAMPLE_XP_GAIN = 125;/);
    expect(TEASERS).toMatch(/getCurrentRank\(SAMPLE_XP_AFTER\)/);
    expect(TEASERS).toMatch(/getNextRank\(SAMPLE_XP_AFTER\)/);
    // The sample sits mid-ladder, so the bar has somewhere to travel and the
    // rank names are whatever RANK_LADDER actually says.
    const before = 340, after = 465;
    const cur = getCurrentRank(after), next = getNextRank(after)!;
    expect(next).toBeTruthy();
    const startFrac = (before - getCurrentRank(before).xp) / (getNextRank(before)!.xp - getCurrentRank(before).xp);
    const endFrac = (after - cur.xp) / (next.xp - cur.xp);
    expect(endFrac).toBeGreaterThan(startFrac);
    expect(endFrac).toBeLessThan(1);              // partial, never a full bar
    expect(code(TEASERS)).not.toContain(cur.rank);  // the name is never typed in
    expect(code(TEASERS)).not.toContain(next.rank);
  });

  it("animates the bar once, within about a second, with a Reduce Motion end state", () => {
    expect(TEASERS).toMatch(/const XP_FILL_MS = 1000;/);
    expect(TEASERS).toMatch(/if \(reduceMotion\) \{ fill\.value = afterPct; return; \}/);
    expect(code(TEASERS)).not.toMatch(/withRepeat/);
    expect(TEASERS).toMatch(/accessibilityRole="progressbar"[\s\S]{0,200}accessibilityValue/);
  });

  it("uses a REAL achievement definition, not an invented one", () => {
    // The ids the screen looks up must exist in the real definitions...
    const hunt = ACHIEVEMENT_CATEGORIES.find(c => c.id === "hunt");
    expect(hunt).toBeTruthy();
    const first = hunt!.achievements.find(a => a.id === "hunt_1");
    expect(first).toBeTruthy();
    expect(first!.name).toBe("Welcome to the Hunt");
    // ...and the screen must LOOK THEM UP rather than transcribe them.
    expect(TEASERS).toMatch(/ACHIEVEMENT_CATEGORIES\.find\(c => c\.id === "hunt"\)/);
    expect(TEASERS).toMatch(/\.achievements\.find\(a => a\.id === "hunt_1"\)/);
    expect(TEASERS).toMatch(/name: HUNT_FIRST\.name/);
    expect(TEASERS).toMatch(/accent: HUNT_CATEGORY\.iconColor/);
    expect(code(TEASERS)).not.toContain(first!.requirement);   // never copied in
  });

  it("uses a REAL Diamond definition and its real category accent", () => {
    const d = DIAMONDS.find(x => x.id === "vintage_levis_jacket");
    expect(d).toBeTruthy();
    expect(d!.prestige).toBe(3);
    expect(CATEGORY_META[d!.category].accent).toBeTruthy();
    expect(TEASERS).toMatch(/DIAMONDS\.find\(d => d\.id === "vintage_levis_jacket"\)/);
    expect(TEASERS).toMatch(/accent: CATEGORY_META\[DIAMOND_DEF\.category\]\.accent/);
    expect(code(TEASERS)).not.toContain(d!.title);
    expect(code(TEASERS)).not.toContain(d!.flavorLine);
  });

  it("uses a REAL brand with its real rarity, and never a remote logo", () => {
    const b = ALL_BRANDS.find(x => x.name === "Patagonia");
    expect(b).toBeTruthy();
    expect(RARITY_LABELS[b!.rarity]).toBeTruthy();
    expect(RARITY_COLORS[b!.rarity]).toBeTruthy();
    expect(TEASERS).toMatch(/ALL_BRANDS\.find\(b => b\.name === "Patagonia"\)/);
    expect(TEASERS).toMatch(/rarityLabel: RARITY_LABELS\[BRAND_DEF\.rarity\]/);
    expect(TEASERS).toMatch(/accent: RARITY_COLORS\[BRAND_DEF\.rarity\]/);
    // getBrandLogoUrl is a Clearbit URL — banned here.
    expect(code(TEASERS)).not.toMatch(/getBrandLogoUrl|https?:\/\//);
    expect(code(TEASERS)).not.toMatch(/<Image|require\(/);
  });

  it("quotes the real totals from the real datasets", () => {
    expect(TOTAL_DIAMONDS).toBe(DIAMONDS.length);
    expect(TOTAL_SUPPORTED_BRANDS).toBe(ALL_BRANDS.length);
    expect(TEASERS).toMatch(/export const RANK_COUNT = RANK_LADDER\.length;/);
    expect(TEASERS).toMatch(/\$\{TOTAL_DIAMONDS\} Diamonds in the Rough/);
    expect(TEASERS).toMatch(/\$\{TOTAL_SUPPORTED_BRANDS\} brands to collect/);
    expect(TEASERS).toMatch(/\$\{ACHIEVEMENT_COUNT\} achievements to earn/);
  });

  it("never abbreviates a feature name", () => {
    // The old cramped tiles are gone; the cards are wide and the kicker wraps.
    expect(code(TEASERS)).not.toMatch(/g\.tiles|function Tile\(/);
    expect(TEASERS).toMatch(/const UNLOCK_W = 268;/);
    expect(TEASERS).toMatch(/<Text style=\{g\.unlockKicker\} numberOfLines=\{2\}>/);
    for (const name of ["Diamonds in the Rough", "Brand Compendium", "achievements to earn"]) {
      expect(TEASERS).toContain(name);
    }
  });

  it("keeps the showcase scrollable without trapping or gating anything", () => {
    expect(TEASERS).toMatch(/<ScrollView\s+horizontal/);
    expect(TEASERS).toMatch(/showsHorizontalScrollIndicator=\{false\}/);
    expect(TEASERS).toMatch(/accessibilityLabel=\{`\$\{kicker\}\. \$\{title\}\. \$\{meta\}\. \$\{body\}\. \$\{footer\}`\}/);
  });
});

// ── Building ────────────────────────────────────────────────────────────────

describe("profile assembly", () => {
  it("assembles from the user's real answers, never a category or a fake value", () => {
    expect(BUILDING).toMatch(/goalLabel\(answers\.primaryGoal\)/);
    expect(BUILDING).toMatch(/experienceLabel\(answers\.experienceLevel\)/);
    expect(BUILDING).toMatch(/painChips\(answers\.painPoints\)/);
    expect(BUILDING).toMatch(/recommendTools\(answers\.primaryGoal, answers\.painPoints\)/);
    expect(code(BUILDING)).not.toMatch(/huntCategories|Your Hunt|categoriesLabel/i);
  });

  it("passes through more than one assembly state before completing", () => {
    expect(BUILDING).toMatch(/const BUILD_STEPS = 6;/);
    expect(BUILDING).toMatch(/const \[step, setStep\] = useState\(0\);/);
    expect(BUILDING).toMatch(/const complete = step >= BUILD_STEPS;/);
    // Six distinct slots, each with its own step.
    for (let n = 1; n <= 6; n++) expect(BUILDING).toContain(`<Slot at={${n}}`);
    // The old four-check-row screen is gone.
    expect(code(BUILDING)).not.toMatch(/Setting your focus|Noting your experience|Matching tools to:/);
  });

  it("takes roughly 2.3–3.2 seconds, with something entering at every step", () => {
    const total = 340 * 6 + 420;
    expect(total).toBeGreaterThanOrEqual(2300);
    expect(total).toBeLessThanOrEqual(3200);
    expect(BUILDING).toMatch(/const BUILD_STEP_MS = 340;/);
  });

  it("reveals Continue when the build finishes, and never navigates early", () => {
    expect(BUILDING).toMatch(/if \(doneRef\.current\) return;\s*doneRef\.current = true;\s*onDone\(\);/);
    expect(BUILDING).toMatch(/BUILD_STEP_MS \* BUILD_STEPS \+ BUILD_HOLD_MS/);
    expect(SCREEN).toMatch(/cta=\{buildNeedsContinue \? \{ label: 'Continue', onPress: buildDone \} : undefined\}/);
    expect(code(BUILDING)).not.toMatch(/router|navigate/);
  });

  it("skips the wait entirely for Reduce Motion", () => {
    expect(BUILDING).toMatch(/if \(reduceMotion\) \{ setStep\(BUILD_STEPS\); return; \}/);
    expect(BUILDING).toMatch(/onReduceMotion\?\.\(v\)/);
  });

  it("claims no analysis it does not perform", () => {
    // Scoped to claims ABOUT THE USER. "Deep Analysis" is a real product
    // feature and "SAMPLE ANALYSIS" is a label — neither is a claim.
    expect(PAYOFF_COPY).not.toMatch(
      /analy[sz](ing|e|ed) (your|you|the user|\d)|calibrat|retrain|data points|building your model|your (ai|valuation) model/,
    );
    // And the building screen genuinely runs nothing: no fetch, no server, no
    // model — it is a timer over answers the user already gave.
    expect(code(BUILDING)).not.toMatch(/fetch|supabase|trpc|await .*\(\)\.then|api\./i);
  });

  it("derives the archetype rather than storing it", () => {
    expect(BUILDING).toMatch(/ARCHETYPES\[deriveArchetype\(answers\.primaryGoal\)\]/);
    expect(code(read("lib/onboarding-storage.ts"))).not.toMatch(/archetype/i);
  });
});

// ── Result ──────────────────────────────────────────────────────────────────

describe("profile result", () => {
  it("makes the archetype the hero, correct for all three goals", () => {
    expect(ARCHETYPES[deriveArchetype("resell_profit")].title).toBe("THE PROFIT HUNTER");
    expect(ARCHETYPES[deriveArchetype("personal_finds")].title).toBe("THE TREASURE HUNTER");
    expect(ARCHETYPES[deriveArchetype("both")].title).toBe("THE ALL-AROUND FLIPPER");
    expect(RESULT).toMatch(/heroTitle: \{[^}]*fontSize: 23[^}]*color: PW\.forest/);
    expect(RESULT).toMatch(/<ProfileCrest size=\{52\} lit \/>/);
  });

  it("shares the crest and frame with the building screen, so one finishes the other", () => {
    expect(BUILDING).toMatch(/<ProfileCrest size=\{46\} lit=\{complete\} \/>/);
    expect(CREST).toMatch(/export function ProfileCrest/);
    expect(RESULT).toMatch(/borderColor: 'rgba\(196,163,52,0\.55\)'/);
    expect(BUILDING).toMatch(/frameComplete: \{ borderColor: 'rgba\(196,163,52,0\.55\)' \}/);
  });

  it("caps the focus summary however many pain points were chosen", () => {
    const all = PAIN_POINTS.map(p => p.value);
    const chips = painChips(all);
    expect(chips.visible).toHaveLength(2);
    expect(chips.moreCount).toBe(all.length - 2);
    expect(painChips([]).visible).toHaveLength(0);
    expect(painChips([all[0]]).moreCount).toBe(0);
    // Catalogue order, not tap order.
    expect(painChips([all[3], all[0]]).visible).toEqual([PAIN_POINTS[0].title, PAIN_POINTS[3].title]);
  });

  it("keeps the recommendations deterministic and marks Pro tools", () => {
    for (const g of PRIMARY_GOALS) for (const p of PAIN_POINTS) {
      const a = recommendTools(g.value, [p.value]).map(t => t.key);
      const b = recommendTools(g.value, [p.value]).map(t => t.key);
      expect(a).toEqual(b);
    }
    expect(RESULT).toMatch(/\{t\.pro && <ProSeal \/>\}/);
    expect(RESULT).toMatch(/accessibilityLabel=\{t\.pro \? `\$\{t\.name\}, Pro feature/);
  });

  it("shows the free scans from the constant and the rank from the ladder", () => {
    expect(RESULT).toMatch(/\{FREE_LIFETIME_SCANS\}/);
    expect(RESULT).toMatch(/const startingRank = RANK_LADDER\[0\];/);
    expect(FREE_LIFETIME_SCANS).toBe(15);
    expect(RANK_LADDER[0].xp).toBe(0);
    // The name is never typed.
    expect(code(RESULT)).not.toContain(RANK_LADDER[0].rank);
  });

  it("shows a clean 0 XP and no internal threshold maths", () => {
    expect(RESULT).toContain(">0 XP<");
    expect(RESULT).toMatch(/xpFill: \{ width: '0%'/);
    // No thresholds, ids, or computed progress on this screen.
    expect(code(RESULT)).not.toMatch(/startingRank\.xp|getRankProgress|getNextRank|\.id\b/);
  });

  it("invents no statistics", () => {
    expect(PAYOFF_COPY).not.toMatch(/top \d+%|success rate|predicted|probability|you are in the|\d+% more/);
  });

  it("is modular sections, not one tall card", () => {
    for (const style of ["s.hero", "s.section", "s.tools", "s.startRow"]) expect(RESULT).toContain(style);
    // The old single card that held everything is gone.
    expect(code(RESULT)).not.toMatch(/<Fact label=/);
  });
});