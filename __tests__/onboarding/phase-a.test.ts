/**
 * __tests__/onboarding/phase-a.test.ts
 *
 * Onboarding Phase A: the shared shell, Welcome, and the four quiz
 * questions. Pure-function tests on the quiz model, structural pins on the
 * screen, and guards that the things Phase A must NOT touch stayed untouched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  EMPTY_ANSWERS, EXPERIENCE_LEVELS, PAIN_POINTS, PRIMARY_GOALS, QUESTION_STAGES, QUIZ_STAGES,
  isExperienceLevel, isHuntCategory, isPainPoint, isPrimaryGoal,
  stageIsComplete, stageProgress, togglePainPoint,
  type OnboardingAnswers, type PainPoint,
} from "@/lib/onboardingQuiz";
// onboarding-storage imports AsyncStorage (a native module) at load time, so the
// version is pinned from source text rather than by importing the constant.

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

const SCREEN  = read("app/onboarding.tsx");
const SHELL   = read("components/onboarding/OnboardingShell.tsx");
const OPTION  = read("components/onboarding/OptionCard.tsx");
const CARDS   = read("components/onboarding/QuestionCards.tsx");
const QUIZ    = read("lib/onboardingQuiz.ts");
const LAYOUT  = read("app/_layout.tsx");
const STORAGE = read("lib/onboarding-storage.ts");

// ── Quiz model ──────────────────────────────────────────────────────────────

describe("primary goal", () => {
  it("has exactly the three coded values, in order, with the value-forward copy", () => {
    expect(PRIMARY_GOALS.map(o => o.value)).toEqual(["resell_profit", "personal_finds", "both"]);
    expect(PRIMARY_GOALS[0].title).toBe("Make more money reselling");
    expect(PRIMARY_GOALS[1].title).toBe("Identify items & know what\u2019s worth buying");
    expect(PRIMARY_GOALS[2].title).toBe("A little of both");
  });
  it("only accepts known values", () => {
    expect(isPrimaryGoal("resell_profit")).toBe(true);
    expect(isPrimaryGoal("resell")).toBe(false);
    expect(isPrimaryGoal("personal")).toBe(false);
    expect(isPrimaryGoal(null)).toBe(false);
  });
  it("never maps to the old UserMode", () => {
    // The quiz model does not know onboarding-storage exists.
    expect(code(QUIZ)).not.toMatch(/onboarding-storage|UserMode|setUserMode/);
    // The screen never derives a mode from the answer and never sets one.
    expect(code(SCREEN)).not.toMatch(/setUserMode|ModeToggle|completeOnboarding\('personal'\)|completeOnboarding\(answers/);
    expect(SCREEN).toMatch(/completeOnboarding\('resell'\)/);
    // The header comment explains why that mode is NOT used; the check is on code.
    expect(code(SCREEN)).not.toMatch(/Buy for Yourself/);
  });
});

describe("hunt categories — removed from the flow", () => {
  it("is no longer a stage and cannot be reached", () => {
    expect(QUIZ_STAGES).not.toContain("categories");
    expect(QUESTION_STAGES).not.toContain("categories");
    expect(code(SCREEN)).not.toMatch(/HUNT_CATEGORIES|toggleHuntCategory|CategoryChip|huntCategories/);
    expect(code(SCREEN)).not.toMatch(/What do you usually hunt for/);
  });

  it("keeps only the type and its validator, for reading data the old build wrote", () => {
    expect(isHuntCategory("sneakers")).toBe(true);
    expect(isHuntCategory("Sneakers")).toBe(false);
    // The catalogue and the toggle went with the screen they served.
    expect(code(QUIZ)).not.toMatch(/export const HUNT_CATEGORIES|export function toggleHuntCategory|export const EVERYTHING/);
  });

  it("never invents a category for anyone who was not asked", () => {
    expect(code(SCREEN)).not.toMatch(/'everything'|"everything"/);
    expect(EMPTY_ANSWERS).not.toHaveProperty("huntCategories");
  });
});

describe("pain points — multi-select", () => {
  it("has the six coded values with the positive user-facing copy", () => {
    expect(PAIN_POINTS.map(o => o.value)).toEqual([
      "item_identification", "valuation_uncertainty", "missed_opportunities",
      "comp_research", "slow_selling_buys", "listing_time",
    ]);
    expect(PAIN_POINTS[0].title).toBe("Identify unfamiliar items");
    expect(PAIN_POINTS[5].title).toBe("Create listings faster");
  });

  it("toggles independently — no exclusive option, more than one allowed", () => {
    let sel: PainPoint[] = [];
    sel = togglePainPoint(sel, "listing_time");
    sel = togglePainPoint(sel, "item_identification");
    expect(sel).toEqual(["item_identification", "listing_time"]);   // catalogue order, not tap order
    sel = togglePainPoint(sel, "comp_research");
    expect(sel).toEqual(["item_identification", "comp_research", "listing_time"]);
    sel = togglePainPoint(sel, "comp_research");
    expect(sel).toEqual(["item_identification", "listing_time"]);
  });

  it("never duplicates, whatever the tap sequence", () => {
    const all = PAIN_POINTS.map(o => o.value);
    let sel: PainPoint[] = [];
    for (const v of [...all, ...all.slice().reverse()]) sel = togglePainPoint(sel, v);
    expect(new Set(sel).size).toBe(sel.length);
  });

  it("stores coded values, never the display labels", () => {
    for (const o of PAIN_POINTS) {
      expect(o.value).toMatch(/^[a-z_]+$/);
      expect(togglePainPoint([], o.value)).toEqual([o.value]);
    }
    expect(isPainPoint("Identify unfamiliar items")).toBe(false);
  });
});

describe("experience and pain point", () => {
  it("experience has the four coded levels", () => {
    expect(EXPERIENCE_LEVELS.map(o => o.value)).toEqual(["beginner", "basic", "experienced", "regular_reseller"]);
    expect(isExperienceLevel("basic")).toBe(true);
    expect(isExperienceLevel("expert")).toBe(false);
  });
  it("pain point values validate", () => {
    expect(isPainPoint("comp_research")).toBe(true);
    expect(isPainPoint("comps")).toBe(false);
  });
});

describe("stages and Continue gating", () => {
  it("opens with exactly three question stages, then value, build, result and offer", () => {
    expect(QUESTION_STAGES).toEqual(["motivation", "experience", "pain_points"]);
    expect(QUIZ_STAGES.slice(0, 3)).toEqual(["motivation", "experience", "pain_points"]);
    expect(QUIZ_STAGES).toEqual([
      "motivation", "experience", "pain_points",
      "money", "intelligence", "gamification", "building", "result", "offer",
    ]);
    // Money follows pain points directly; nothing sits between them.
    expect(QUIZ_STAGES.indexOf("money")).toBe(QUIZ_STAGES.indexOf("pain_points") + 1);
  });
  it("Continue is disabled until the required selection exists, then enabled", () => {
    const a: OnboardingAnswers = { ...EMPTY_ANSWERS };
    expect(stageIsComplete("motivation", a)).toBe(false);
    expect(stageIsComplete("motivation", { ...a, primaryGoal: "both" })).toBe(true);
    expect(stageIsComplete("experience", a)).toBe(false);
    expect(stageIsComplete("experience", { ...a, experienceLevel: "beginner" })).toBe(true);
    // Multi-select: zero disables, one enables, several stay enabled.
    expect(stageIsComplete("pain_points", a)).toBe(false);
    expect(stageIsComplete("pain_points", { ...a, painPoints: ["listing_time"] })).toBe(true);
    expect(stageIsComplete("pain_points", { ...a, painPoints: ["listing_time", "comp_research"] })).toBe(true);
  });
  it("progress is stage/N and grows with the array, never a hardcoded count", () => {
    const n = QUIZ_STAGES.length;
    QUIZ_STAGES.forEach((s, i) => expect(stageProgress(s)).toBeCloseTo((i + 1) / n));
    expect(code(QUIZ)).not.toMatch(/\/ ?5\b|\/ ?12\b/);
    expect(SHELL).toMatch(/progress: number \| null;/);
    expect(code(SHELL)).not.toMatch(/stepCount|totalSteps|\/ ?5\b/);
  });
});

// ── Screen wiring ───────────────────────────────────────────────────────────

describe("Welcome", () => {
  it("carries the three-pillar headline and the money message", () => {
    expect(SCREEN).toContain("Spot value.\\nFind profitable flips.\\nThrift smarter.");
    expect(SCREEN).toContain("make smarter buy decisions");
    expect(SCREEN).toMatch(/Smarter, more profitable buys/);
    expect(SCREEN).toMatch(/Identify and understand your finds/);
    expect(SCREEN).toMatch(/Every thrift trip becomes progress/);
  });
  it("Get Started enters the first quiz stage without completing onboarding", () => {
    expect(SCREEN).toMatch(/const start = useCallback\(\(\) => \{[\s\S]*?setStage\(QUIZ_STAGES\[0\]\);[\s\S]*?\}, \[\]\);/);
    const startBody = SCREEN.slice(SCREEN.indexOf("const start = useCallback"), SCREEN.indexOf("const back = useCallback"));
    expect(startBody).not.toMatch(/completeOnboarding|router\./);
  });
  it("Sign In uses the existing login-only route with onboarding entry context", () => {
    expect(SCREEN).toMatch(/pathname: '\/auth', params: \{ mode: 'login', authEntryPoint: 'onboarding' \}/);
  });
  it("renders both actions on the first frame — no async read gates the CTA area", () => {
    expect(SCREEN).toMatch(/cta=\{\{ label: 'Get Started', onPress: start, kicker: signedIn \? undefined : 'NEW HERE\?', pulse: true \}\}/);
    expect(SCREEN).toMatch(/secondaryCta=\{signedIn \? undefined : \{\s*label: 'Log In', onPress: logIn, kicker: 'ALREADY HAVE A FLIPSTART ACCOUNT\?', pulse: true,\s*\}\}/);
    // The completed-version read that used to decide which button dominated is gone.
    expect(code(SCREEN)).not.toMatch(/getCompletedOnboardingVersion|onboardedBefore|const returning/);
    // And the resume decision no longer gates them either.
    expect(code(SCREEN)).not.toMatch(/const decided = resume === 'none'/);
  });

  it("gives both actions real weight — neither is a text link", () => {
    expect(SHELL).toMatch(/secondaryCta\?: \{/);
    expect(SHELL).toMatch(/<SecondaryCTA label=\{secondaryCta\.label\}/);
    expect(SHELL).toMatch(/secondaryCta: \{[^}]*minHeight: 52/);
    expect(SHELL).toMatch(/cta: \{[^}]*minHeight: 54/);
    expect(SHELL).toMatch(/secondaryCtaText: \{[^}]*fontSize: 16\.5[^}]*color: PW\.forest/);
    expect(SHELL).toMatch(/ctaText: \{[^}]*fontSize: 17[^}]*color: PW\.cream/);
  });

  it("says Log In, never Sign In, on this surface", () => {
    expect(code(SCREEN)).not.toMatch(/Sign In|sign-in|Sign in/);
    expect(SCREEN).toContain("'Log In'");
  });

  it("shows no Log In for an already-authenticated user and never signs them out", () => {
    expect(SCREEN).toMatch(/secondaryCta=\{signedIn \? undefined :/);
    expect(code(SCREEN)).not.toMatch(/signOut/);
  });
  it("keeps the new-account bounce notice", () => {
    expect(SCREEN).toMatch(/params\.notice === 'no_existing_account'/);
  });
});

describe("questions", () => {
  it("renders each stage from the coded option lists, not inline strings", () => {
    expect(SCREEN).toMatch(/PRIMARY_GOALS\.map\(/);
    expect(SCREEN).toMatch(/EXPERIENCE_LEVELS\.map\(/);
    expect(SCREEN).toMatch(/PAIN_POINTS\.map\(/);
  });

  it("marks the pain-point cards as multi-select", () => {
    // The multi-select semantics live in HelpCard now — see the Phase 2 suite.
    expect(SCREEN).toMatch(/<HelpCard key=\{o\.value\} title=\{o\.title\}/);
    expect(CARDS).toMatch(/accessibilityRole="checkbox"/);
    expect(CARDS).toMatch(/accessibilityState=\{\{ checked: selected \}\}/);
  });
  it("selecting an option never auto-advances — Continue is a separate tap", () => {
    for (const setter of ["setGoal", "setExperience", "tapPain"]) {
      const def = SCREEN.slice(SCREEN.indexOf(`const ${setter} `), SCREEN.indexOf("\n", SCREEN.indexOf(`const ${setter} `)));
      expect(def).not.toMatch(/setStage|next\(/);
    }
    expect(SCREEN).toMatch(/const cta = \{ label: 'Continue', onPress: next, disabled: !canContinue \};/);
    expect(SCREEN).toMatch(/const canContinue = stage !== 'welcome' && stageIsComplete\(stage, answers\);/);
  });
  it("Back walks to the previous stage and Welcome, and answers are never cleared on the way", () => {
    expect(SCREEN).toMatch(/setStage\(stageIndex <= 0 \? 'welcome' : QUIZ_STAGES\[stageIndex - 1\]\);/);
    expect(code(SCREEN)).not.toMatch(/setAnswers\(EMPTY_ANSWERS\)/);
    // Welcome has no back button.
    expect(SCREEN).toMatch(/<OnboardingShell\s+progress=\{null\}\s+brand/);
  });
  it("the pain-point toggle goes through the pure reducer", () => {
    expect(SCREEN).toMatch(/painPoints: togglePainPoint\(a\.painPoints, v\)/);
  });
});

describe("answer state is session-only in Phase A", () => {
  it("lives in useState and is written nowhere", () => {
    expect(SCREEN).toMatch(/useState<OnboardingAnswers>\(\(\) => \(\{ \.\.\.EMPTY_ANSWERS, painPoints: \[\] \}\)\)/);
    expect(code(SCREEN)).not.toMatch(/AsyncStorage|setOnboardingInterests|updateUser|user_metadata|supabase|from\(['"]profiles/);
  });
  it("AuthProvider knows nothing about onboarding answers", () => {
    expect(code(read("lib/auth-context.tsx"))).not.toMatch(/onboardingQuiz|onboardingAnswers|primaryGoal|huntCategories/);
  });
});

describe("result-stage terminal", () => {
  it("hands a signed-out user to the existing account-creation route, and a signed-in one into the app", () => {
    expect(SCREEN).toMatch(/pathname: '\/auth', params: \{ mode: 'signup', authEntryPoint: 'onboarding' \}/);
    expect(SCREEN).toMatch(/if \(signedIn\) void finishExisting\('signed_in_quiz'\);\s*else void saveProfileAndCreateAccount\(\);/);
    expect(SCREEN).toMatch(/await completeOnboarding\('resell'\)\.catch\(\(\) => \{\}\);\s*router\.replace\('\/\(tabs\)' as any\);/);
  });
  it("no longer inlines its own social-auth handlers", () => {
    expect(code(SCREEN)).not.toMatch(/signInWithOAuth|signInWithIdToken|expo-apple-authentication|WebBrowser|handleGoogleSignIn|handleAppleSignIn/);
  });
});

// ── Shell and option components ─────────────────────────────────────────────

describe("shared shell", () => {
  it("uses the paywall tokens and the same hairline gold CTA trim, with disabled semantics", () => {
    expect(SHELL).toMatch(/import \{ PW, PW_RADIUS \} from "@\/components\/monetization\/paywall\/paywallTheme";/);
    expect(SHELL).toMatch(/ctaTrim: \{[^}]*borderColor: "rgba\(212,180,84,0\.55\)"/);
    expect(SHELL).toMatch(/accessibilityState=\{\{ disabled \}\}/);
    expect(SHELL).toMatch(/onPress=\{disabled \? undefined : onPress\}/);
  });
  it("animates the bar in ~320ms and labels it as a progressbar", () => {
    expect(SHELL).toMatch(/const BAR_MS = 320;/);
    expect(SHELL).toMatch(/accessibilityRole="progressbar"/);
    // The bar itself never loops; the shell's one withRepeat is the Welcome
    // pulse. Sliced on a CODE landmark — code() strips comments, so a comment
    // marker here would resolve to -1 and silently swallow the whole file.
    const stripped = code(SHELL);
    const bar = stripped.slice(stripped.indexOf("function ProgressBar"), stripped.indexOf("function useCtaPulse"));
    expect(bar.length).toBeGreaterThan(200);
    expect(bar).not.toMatch(/withRepeat/);
  });
  it("uses no private palette", () => {
    for (const f of [SHELL, OPTION, SCREEN]) {
      expect(code(f)).not.toMatch(/#2A4A2A|#152815|#EDE0C4|#DDD0B0|#BE9C2C|#5A3A1A/);
    }
  });
});

describe("option components", () => {
  it("carry selected state structurally, not by colour alone", () => {
    expect(OPTION).toMatch(/accessibilityRole=\{multi \? "checkbox" : "radio"\}/);
    expect(OPTION).toMatch(/accessibilityState=\{multi \? \{ checked: selected \} : \{ selected \}\}/);
    expect(OPTION).toMatch(/<MaterialIcons name="check"/);
    expect(OPTION).toMatch(/\{selected && <View pointerEvents="none" style=\{s\.innerRule\} \/>\}/);
    expect(CARDS).toMatch(/accessibilityRole="radio"/);
    expect(CARDS).toMatch(/accessibilityState=\{\{ selected \}\}/);
  });
});

// ── What Phase A must not touch ─────────────────────────────────────────────

describe("untouched", () => {
  it("bumps the onboarding version exactly once, to 3, for the completed journey", () => {
    // Phase A held this at 2 until the whole flow existed; Phase B is that flow.
    expect(STORAGE).toMatch(/export const ONBOARDING_VERSION = 3;/);
    expect((STORAGE.match(/ONBOARDING_VERSION = \d+/g) ?? []).length).toBe(1);
  });
  it("keeps the root gesture protection on both screens", () => {
    expect(LAYOUT).toMatch(/<Stack\.Screen name="\(tabs\)" options=\{\{ gestureEnabled: false \}\} \/>/);
    expect(LAYOUT).toMatch(/<Stack\.Screen name="onboarding" options=\{\{ animation: "fade", headerShown: false, gestureEnabled: false \}\} \/>/);
  });
  it("leaves the auth files' load-bearing lines in place", () => {
    const auth = read("app/auth.tsx");
    expect(auth).toMatch(/const bounceIfNewAccountOnLoginOnly = async \(\): Promise<boolean> =>/);
    expect(auth).toMatch(/const loginOnly = entryPoint === 'onboarding' && params\.mode === 'login' && !cameFromLanding;/);
    expect(auth).toMatch(/const dest = takeAuthReturnDest\(\) \?\? '\/\(tabs\)';/);
    expect(read("app/username-setup.tsx")).toMatch(/onboarding_complete: true \},\s*\{ onConflict: 'id' \}/);
    expect(read("lib/authReturn.ts")).toMatch(/export function takeAuthReturnDest\(\): string \| null/);
    expect(read("lib/authErrors.ts")).toMatch(/export function sanitizeAuthError/);
    expect(code(read("app/auth/callback.tsx"))).toMatch(/exchangeCodeForSession|verifyOtp/);
  });
});