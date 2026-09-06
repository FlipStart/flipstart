/**
 * __tests__/onboarding/phase-2-visual.test.ts
 *
 * The Phase 2 visual system: a compact masthead that survives past Welcome,
 * a title hierarchy with question markers, three genuinely different question
 * compositions, and a shell that stops stranding the CTA at the bottom of a
 * half-empty screen.
 *
 * Structural, not pixel-perfect: these check that each screen uses the shared
 * system and that the pieces are wired to the right screens. They cannot see
 * the result — that is what the device checklist is for.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EXPERIENCE_LEVELS, PAIN_POINTS, PRIMARY_GOALS, QUESTION_STAGES } from "@/lib/onboardingQuiz";

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

const SCREEN   = read("app/onboarding.tsx");
const SHELL    = read("components/onboarding/OnboardingShell.tsx");
const MASTHEAD = read("components/onboarding/OnboardingMasthead.tsx");
const CARDS    = read("components/onboarding/QuestionCards.tsx");
const QUIZ     = read("lib/onboardingQuiz.ts");

/** Every `<OnboardingShell …>` opening tag in the screen, one per stage. */
const SHELLS = [...SCREEN.matchAll(/<OnboardingShell[\s\S]*?>/g)].map(m => m[0]);
const shellFor = (marker: string) => {
  const at = SCREEN.indexOf(marker);
  const before = SCREEN.lastIndexOf("<OnboardingShell", at);
  return SCREEN.slice(before, SCREEN.indexOf(">", SCREEN.indexOf("headline", before)));
};

// ── The shared system ───────────────────────────────────────────────────────

describe("shared visual system", () => {
  it("every screen still goes through the one shell", () => {
    expect(SHELLS.length).toBeGreaterThanOrEqual(9);
    // No screen lays itself out.
    expect(code(SCREEN)).not.toMatch(/SafeAreaView|useSafeAreaInsets|position: ['"]absolute['"]/);
  });

  it("has a compact masthead, deliberately lighter than Welcome's", () => {
    expect(MASTHEAD).toMatch(/word: \{[^}]*fontSize: 13[^}]*letterSpacing: 4[^}]*color: PW\.forest/);
    expect(SHELL).toMatch(/brand: \{[^}]*fontSize: 19[^}]*letterSpacing: 5/);
    expect(MASTHEAD).toContain("FLIPSTART");
    expect(MASTHEAD).toMatch(/line = "THRIFT INTELLIGENCE"/);
    expect(MASTHEAD).toMatch(/rule: \{[^}]*backgroundColor: "rgba\(196,163,52,0\.7\)"/);
  });

  it("puts the masthead on every screen past Welcome, and Welcome keeps its own", () => {
    for (const marker of [
      "QUESTION 1 OF 3", "QUESTION 2 OF 3", "QUESTION 3 OF 3",
      "Know the flip before you buy", "Spot what others might miss",
      "Turn every thrift trip into progress", "Building your FlipStart profile",
      "Your FlipStart profile is ready",
    ]) {
      expect(shellFor(marker), marker).toMatch(/\bmasthead\b/);
    }
    // Welcome uses the full brand block, not the compact one.
    const welcome = shellFor("Spot value.");
    expect(welcome).toMatch(/\bbrand\b/);
    expect(welcome).toMatch(/brandLine="THRIFT INTELLIGENCE"/);
  });

  it("numbers the three question screens, and only those", () => {
    expect(QUESTION_STAGES).toHaveLength(3);
    for (const n of [1, 2, 3]) expect(SCREEN).toContain(`eyebrow="QUESTION ${n} OF 3"`);
    expect((SCREEN.match(/eyebrow="QUESTION \d OF 3"/g) ?? [])).toHaveLength(3);
    // The value screens carry no question number.
    expect(shellFor("Know the flip before you buy")).not.toMatch(/QUESTION/);
  });

  it("renders the eyebrow in brown with a gold rule — gold text at 9.5pt is unreadable", () => {
    expect(SHELL).toMatch(/eyebrow: \{[^}]*fontSize: 9\.5[^}]*color: PW\.brown/);
    expect(SHELL).toMatch(/eyebrowRule: \{[^}]*backgroundColor: "rgba\(196,163,52,0\.8\)"/);
  });
});

// ── Titles ──────────────────────────────────────────────────────────────────

describe("title hierarchy", () => {
  it("emphasises one phrase in forest, never a second colour", () => {
    expect(SHELL).toMatch(/headlineAccent: \{ color: PW\.forest \}/);
    expect(SHELL).toMatch(/const at = accent \? text\.indexOf\(accent\) : -1;/);
    // A missing accent must render the title unchanged, not crash.
    expect(SHELL).toMatch(/if \(at < 0\) \{[\s\S]*?return <Text[\s\S]*?>\{text\}<\/Text>;/);
  });

  it("every accent actually appears in its own headline", () => {
    const pairs = [...SCREEN.matchAll(/headline=(?:"([^"]+)"|\{'([^']+)'\})\s+accent="([^"]+)"/g)];
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    for (const m of pairs) {
      const headline = (m[1] ?? m[2]).replace(/\\u2026/g, "\u2026");
      expect(headline, `accent "${m[3]}"`).toContain(m[3]);
    }
  });

  it("steps the title size down as it gets longer, so nothing becomes four lines", () => {
    expect(SHELL).toMatch(/text\.length > 44 \? s\.headlineSm : text\.length > 32 \? s\.headlineMd : null/);
    expect(SHELL).toMatch(/headlineMd: \{ fontSize: 25, lineHeight: 31 \}/);
    expect(SHELL).toMatch(/headlineSm: \{ fontSize: 23, lineHeight: 29 \}/);
    // The two long question titles land in the smaller steps.
    expect("What do you want FlipStart to help with?".length).toBeGreaterThan(32);
    expect("How confident are you at spotting value?".length).toBeGreaterThan(32);
    // And Dynamic Type is capped rather than ignored.
    expect(SHELL).toMatch(/maxFontSizeMultiplier=\{1\.4\}/);
  });
});

// ── Per-screen composition ──────────────────────────────────────────────────

describe("three different question compositions", () => {
  it("Motivation uses rich path cards — icon, category eyebrow, title, support", () => {
    expect(SCREEN).toMatch(/<PathCard key=\{o\.value\}/);
    expect(CARDS).toMatch(/export function PathCard\(/);
    expect(CARDS).toMatch(/<Text style=\{p\.eyebrow\}[^>]*>\{eyebrow\}<\/Text>/);
    for (const o of PRIMARY_GOALS) {
      expect(o.eyebrow, o.value).toBeTruthy();
      expect(o.icon, o.value).toBeTruthy();
    }
    expect(PRIMARY_GOALS.map(o => o.eyebrow)).toEqual(["MONEY \u00B7 RESELLING", "IDENTIFY \u00B7 VALUE", "BOTH PATHS"]);
  });

  it("Experience uses a connected ladder, and no rung outranks another", () => {
    expect(SCREEN).toMatch(/<LadderRow key=\{o\.value\}/);
    expect(CARDS).toMatch(/export function LadderRow\(/);
    expect(CARDS).toMatch(/<View style=\{\[l\.rule, first && l\.ruleHidden\]\} \/>/);
    expect(CARDS).toMatch(/<View style=\{\[l\.rule, last && l\.ruleHidden\]\} \/>/);
    // One card style for every rung — no per-index size, weight or colour.
    expect(code(CARDS)).not.toMatch(/index|rank|level \* |i \* |tier/i);
    expect(EXPERIENCE_LEVELS).toHaveLength(4);
  });

  it("Pain points use a two-column field with an icon per option", () => {
    expect(SCREEN).toMatch(/<HelpCard key=\{o\.value\} title=\{o\.title\} icon=\{o\.icon as any\}/);
    expect(SCREEN).toMatch(/grid: \{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 \}/);
    expect(CARDS).toMatch(/width: "48%"/);
    for (const o of PAIN_POINTS) expect(o.icon, o.value).toBeTruthy();
    expect(new Set(PAIN_POINTS.map(o => o.icon)).size).toBe(PAIN_POINTS.length);
  });

  it("keeps presentation metadata out of what gets persisted", () => {
    // Icons and eyebrows live in the catalogue but never reach storage.
    expect(code(read("lib/onboardingAnswers.ts"))).not.toMatch(/icon|eyebrow/);
    expect(code(read("lib/onboarding-storage.ts"))).not.toMatch(/icon|eyebrow/);
  });
});

// ── Layout ──────────────────────────────────────────────────────────────────

describe("CTA placement", () => {
  it("offers both modes and defaults to the anchored one", () => {
    expect(SHELL).toMatch(/ctaPlacement\?: "content" \| "bottom";/);
    expect(SHELL).toMatch(/ctaPlacement = "bottom",/);
    expect(SHELL).toMatch(/const follows = ctaPlacement === "content";/);
  });

  it("puts the CTA inside the scroll when it follows content, pinned when it does not", () => {
    expect(SHELL).toMatch(/\{follows && actions\}/);
    expect(SHELL).toMatch(/\{!follows && \(\s*<View style=\{\[s\.footer/);
    expect(SHELL).toMatch(/actionsFollowing: \{ marginTop: 22 \}/);
  });

  it("uses content-following on the sparse screens and anchors the dense ones", () => {
    for (const marker of ["QUESTION 1 OF 3", "QUESTION 2 OF 3", "Know the flip before you buy", "Spot what others might miss"]) {
      expect(shellFor(marker), marker).toMatch(/ctaPlacement="content"/);
    }
    // The six-tile field and the two payoff screens keep the anchored CTA.
    for (const marker of ["QUESTION 3 OF 3", "Turn every thrift trip into progress", "Your FlipStart profile is ready"]) {
      expect(shellFor(marker), marker).not.toMatch(/ctaPlacement="content"/);
    }
  });

  it("clears the Dynamic Island", () => {
    expect(SHELL).toMatch(/paddingTop: Math\.max\(insets\.top, 12\) \+ 8/);
  });
});

// ── Buttons, motion, accessibility ──────────────────────────────────────────

describe("buttons", () => {
  it("gives the disabled CTA a designed state that still passes contrast", () => {
    expect(SHELL).toMatch(/backgroundColor: "#5F7562"/);
    expect(SHELL).toMatch(/ctaTextDisabled: \{ color: PW\.cream, opacity: 0\.92 \}/);
    // Not the old flat wash.
    expect(code(SHELL)).not.toMatch(/ctaDisabled: \{ opacity: 0\.45/);
    // And the outlined button gets its own muting, not a forest fill.
    expect(SHELL).toMatch(/secondaryDisabled: \{ borderColor: "rgba\(33,77,45,0\.30\)", opacity: 0\.7 \}/);
  });

  it("keeps Welcome's two substantial actions and their first-frame behaviour", () => {
    expect(SCREEN).toMatch(/cta=\{\{ label: 'Get Started', onPress: start, kicker: signedIn \? undefined : 'NEW HERE\?', pulse: true \}\}/);
    expect(SCREEN).toMatch(/secondaryCta=\{signedIn \? undefined : \{\s*label: 'Log In'/);
    expect(code(SCREEN)).not.toMatch(/getCompletedOnboardingVersion|onboardedBefore|const decided = resume/);
    expect(code(SCREEN)).not.toMatch(/Sign In|sign-in/);
  });
});

describe("motion", () => {
  it("is entrance-and-settle only everywhere except the one opt-in Welcome pulse", () => {
    // The masthead, the question cards and the screen never loop.
    for (const f of [MASTHEAD, CARDS, SCREEN]) {
      expect(code(f)).not.toMatch(/withRepeat|withSequence|Infinity|-1,\s*(true|false)/);
    }
    // The shell has exactly one loop, and it lives in the pulse hook.
    expect((code(SHELL).match(/withRepeat\(/g) ?? [])).toHaveLength(1);
    const stripped = code(SHELL);
    const hook = stripped.slice(stripped.indexOf("function useCtaPulse"), stripped.indexOf("function PrimaryCTA"));
    expect(hook.length).toBeGreaterThan(200);
    expect(hook).toMatch(/withRepeat\(/);

    expect(MASTHEAD).toMatch(/FadeIn\.duration\(260\)/);
    expect(SCREEN).toMatch(/FadeInDown\.duration\(240\)/);
    expect(SHELL).toMatch(/const BAR_MS = 320;/);
    expect(CARDS).toMatch(/duration: 200, easing: Easing\.out\(Easing\.quad\)/);
  });

  it("beats slowly, with a long rest, and staggers the two buttons", () => {
    expect(SHELL).toMatch(/const PULSE_RISE_MS = 260;/);
    expect(SHELL).toMatch(/const PULSE_FALL_MS = 440;/);
    expect(SHELL).toMatch(/const PULSE_REST_MS = 2200;/);
    expect(SHELL).toMatch(/const PULSE_STAGGER_MS = 190;/);
    // Roughly one beat every three seconds — breathing, not blinking.
    expect(260 + 440 + 2200).toBeGreaterThan(2500);
    // Small: a lift of a few points and under 3% swell.
    expect(SHELL).toMatch(/const PULSE_LIFT = 3;/);
    expect(SHELL).toMatch(/const PULSE_SWELL = 0\.028;/);
    expect(SHELL).toMatch(/pulseDelay=\{PULSE_STAGGER_MS\}/);
  });

  it("pulses only where a screen opts in — Welcome, and nowhere else", () => {
    expect(SHELL).toMatch(/pulse = false/);
    expect(shellFor("Spot value.")).toMatch(/pulse: true/);
    // No other screen asks for it.
    expect((SCREEN.match(/pulse: true/g) ?? [])).toHaveLength(2);
    for (const marker of ["QUESTION 1 OF 3", "QUESTION 2 OF 3", "QUESTION 3 OF 3",
      "Know the flip before you buy", "Your FlipStart profile is ready"]) {
      expect(shellFor(marker), marker).not.toMatch(/pulse/);
    }
  });

  it("never beats on a disabled button, yields to the finger, and stops for Reduce Motion", () => {
    expect(SHELL).toMatch(/useCtaPulse\(pulse && !disabled, 0\)/);
    expect(SHELL).toMatch(/useCtaPulse\(pulse && !disabled, pulseDelay\)/);
    // BOTH buttons must yield — a toMatch here passes while one of them is broken.
    expect((SHELL.match(/const live = beat\.value \* \(1 - pressed\.value\);/g) ?? [])).toHaveLength(2);
    expect(SHELL).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(SHELL).toMatch(/if \(!active \|\| reduceMotion\) \{ beat\.value = withTiming\(0, \{ duration: 160 \}\); return; \}/);
  });

  it("responds to a press without a bounce", () => {
    expect(SHELL).toMatch(/scale: \(1 \+ live \* PULSE_SWELL\) \* \(1 - pressed\.value \* 0\.02\)/);
    expect(CARDS).toMatch(/pressed && \{ opacity: 0\.9/);
  });
});

describe("accessibility", () => {
  it("never signals selection by colour alone", () => {
    // PathCard: border + seal fill + check. Ladder: marker + check + border.
    expect(CARDS).toMatch(/<MaterialIcons name="check-circle"/);
    expect(CARDS).toMatch(/\{selected && <MaterialIcons name="check" size=\{13\}/);
    expect(CARDS).toMatch(/<MaterialIcons name="check" size=\{12\}/);
    for (const style of ["cardOn", "markerOn", "sealOn"]) expect(CARDS).toContain(style);
  });

  it("keeps the right semantics per question type and caps Dynamic Type rather than ignoring it", () => {
    expect(CARDS).toMatch(/accessibilityRole="radio"[\s\S]*?accessibilityRole="radio"[\s\S]*?accessibilityRole="checkbox"/);
    expect((CARDS.match(/maxFontSizeMultiplier/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(SHELL).toMatch(/accessibilityRole="progressbar"/);
    expect(CARDS).toMatch(/accessibilityLabel=\{`\$\{title\}\. \$\{support\}`\}/);
  });

  it("keeps every tap target at a comfortable size", () => {
    expect(CARDS).toMatch(/minHeight: 92/);            // help tiles
    expect(SHELL).toMatch(/minHeight: 54/);            // primary CTA
    expect(SHELL).toMatch(/minHeight: 52/);            // secondary CTA
  });
});

// ── Nothing functional moved ────────────────────────────────────────────────

describe("logic untouched by the visual pass", () => {
  it("keeps the three-question flow, its keys and its selection behaviour", () => {
    expect(PRIMARY_GOALS.map(o => o.value)).toEqual(["resell_profit", "personal_finds", "both"]);
    expect(EXPERIENCE_LEVELS.map(o => o.value)).toEqual(["beginner", "basic", "experienced", "regular_reseller"]);
    expect(SCREEN).toMatch(/selected=\{answers\.primaryGoal === o\.value\}/);
    expect(SCREEN).toMatch(/selected=\{answers\.experienceLevel === o\.value\}/);
    expect(SCREEN).toMatch(/selected=\{answers\.painPoints\.includes\(o\.value\)\}/);
    expect(SCREEN).toMatch(/painPoints: togglePainPoint\(a\.painPoints, v\)/);
  });

  it("keeps selection and Continue separate", () => {
    for (const setter of ["setGoal", "setExperience", "tapPain"]) {
      const at = SCREEN.indexOf(`const ${setter} `);
      expect(SCREEN.slice(at, SCREEN.indexOf("\n", at))).not.toMatch(/setStage|next\(/);
    }
    expect(SCREEN).toMatch(/const cta = \{ label: 'Continue', onPress: next, disabled: !canContinue \};/);
  });

  it("leaves progress, persistence, auth and the paywall alone", () => {
    expect(QUIZ).toMatch(/return i < 0 \? 0 : \(i \+ 1\) \/ QUIZ_STAGES\.length;/);
    expect(code(SHELL)).not.toMatch(/QUIZ_STAGES|stageProgress|\/ ?[0-9]+\b/);
    expect(read("lib/onboarding-storage.ts")).toMatch(/export const ONBOARDING_VERSION = 3;/);
    expect(code(SCREEN)).not.toMatch(/openProPaywall\('(?!onboarding_offer)/);
    expect(SCREEN).toMatch(/openProPaywall\('onboarding_offer'/);
  });
});