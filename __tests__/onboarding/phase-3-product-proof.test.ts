/**
 * __tests__/onboarding/phase-3-product-proof.test.ts
 *
 * The two product-proof screens: a money decision card and an item dossier.
 *
 * The most important test here is the escaped-Unicode guard. The screens
 * shipped showing the literal text `$45\u2013$60` because a JSX ATTRIBUTE
 * string is not a JavaScript string literal — escapes written there are never
 * processed. That is a whole class of bug, and it is checked structurally
 * below rather than by matching the two strings that happened to break.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import glob from "node:fs";

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

const TEASERS = read("components/onboarding/ValueTeasers.tsx");
const SCREEN  = read("app/onboarding.tsx");
const RESULT  = read("components/onboarding/ProfileResult.tsx");
const SHELL   = read("components/onboarding/OnboardingShell.tsx");

/** Every onboarding file a user actually reads text from. */
const ONBOARDING_TSX = [
  "app/onboarding.tsx",
  "components/onboarding/ValueTeasers.tsx",
  "components/onboarding/ProfileResult.tsx",
  "components/onboarding/ProfileBuilding.tsx",
  "components/onboarding/QuestionCards.tsx",
  "components/onboarding/OnboardingShell.tsx",
  "components/onboarding/OnboardingMasthead.tsx",
];

// ── The escaped-Unicode class of bug ────────────────────────────────────────

describe("escaped Unicode", () => {
  /**
   * Finds any \uXXXX sitting where JS escape processing does NOT apply: a JSX
   * attribute value, or JSX text between tags. Inside a real string literal or
   * a {expression} it is fine, which is why this classifies by context rather
   * than banning the sequence outright.
   */
  function brokenEscapes(rel: string): string[] {
    const src = read(rel);
    const lines = src.split("\n");
    const hits: string[] = [];
    const pat = /\\u[0-9A-Fa-f]{4}/g;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(src))) {
      const lineNo = src.slice(0, m.index).split("\n").length - 1;
      const line = lines[lineNo];
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;              // comments are harmless
      const col = m.index - (src.lastIndexOf("\n", m.index - 1) + 1);
      const before = line.slice(0, col);
      const inAttribute = /\b[a-zA-Z]+="[^"]*$/.test(before);
      /**
       * JSX text, including text that follows a {expression} on the same line.
       * The first version of this required no `{` before the escape, which
       * silently missed `{first} \u2192 {second}` — a real bug that shipped.
       * Now: after the last `>` or `}`, if no quote or backtick has opened,
       * we are in JSX text and the escape will render literally.
       */
      const afterTag = before.slice(Math.max(before.lastIndexOf(">"), before.lastIndexOf("}")) + 1);
      const inJsxText = (before.includes(">") || before.includes("}")) && !/['"`]/.test(afterTag);
      if (inAttribute || inJsxText) hits.push(`${rel}:${lineNo + 1} ${line.trim().slice(0, 80)}`);
    }
    return hits;
  }

  it("never leaves an escape where JSX would render it literally", () => {
    const all = ONBOARDING_TSX.flatMap(brokenEscapes);
    expect(all).toEqual([]);
  });

  it("renders both sample ranges as real en dashes", () => {
    // The literal character, in the source, once — owned by ResaleRange.
    expect(TEASERS).toContain('const EN_DASH = "\u2013";');
    expect(TEASERS).toMatch(/<ResaleRange low="\$45" high="\$60"/);
    expect(TEASERS).toMatch(/<ResaleRange low="\$55" high="\$75"/);
    // The dash is never written into an attribute or as an escape.
    expect(code(TEASERS)).not.toMatch(/value="\$\d+\\u2013/);
    expect(code(TEASERS)).not.toMatch(/\$45.?\$60|\$55.?\$75/);   // no pre-joined string
  });

  it("keeps the two fixes outside this screen", () => {
    expect(SCREEN).toContain("Let\u2019s finish your profile");
    // Phase 4 split that strip in two; the rank now stands alone with a clean 0 XP.
    expect(RESULT).toContain("STARTING RANK");
    expect(RESULT).toContain(">0 XP<");
  });
});

// ── Money ───────────────────────────────────────────────────────────────────

describe("money decision card", () => {
  it("ranks the four figures instead of gridding them", () => {
    // Resale is the headline, the limit is next, the footing is smallest.
    expect(TEASERS).toMatch(/heroValue: \{[^}]*fontSize: 36[^}]*color: PW\.forest/);
    expect(TEASERS).toMatch(/limitValue: \{[^}]*fontSize: 27[^}]*color: LIMIT_RED/);
    expect(TEASERS).toMatch(/footValue: \{[^}]*fontSize: 20[^}]*color: PW\.ink/);
    expect(TEASERS).toMatch(/footPositive: \{ color: PW\.forest \}/);
    // The old equal-weight grid is gone.
    expect(code(TEASERS)).not.toMatch(/statValue|m\.grid|<Stat /);
  });

  it("gives Buy Under a limit red that is not the theme's error colour", () => {
    expect(TEASERS).toMatch(/const LIMIT_RED = "#8E3222";/);
    expect(code(TEASERS)).not.toMatch(/PW\.error/);
    // Colour is never the only signal: the words and the label say "limit" too.
    expect(TEASERS).toContain("Stay under this to keep the flip worth it");
    expect(TEASERS).toMatch(/accessibilityLabel="Buy under \$21 — a spending limit, not a target"/);
  });

  it("shows exactly three supporting cues and promises no comp availability", () => {
    expect((TEASERS.match(/<Cue icon=/g) ?? [])).toHaveLength(3);
    expect(TEASERS).toContain("SOLD COMPS");
    expect(TEASERS).toContain("DEMAND");
    expect(TEASERS).toContain("SELL SPEED");
    expect(TEASERS).toMatch(/Comps aren’t available for every item/);
  });

  it("makes no promise it cannot keep", () => {
    expect(code(TEASERS).toLowerCase()).not.toMatch(/guarantee|will sell|max buy|profit is|risk-free/);
    expect(TEASERS).toMatch(/Estimates from sold-listing data, not a promise/);
  });

  it("never sizes a figure by its own text", () => {
    // Equal columns, fixed minimum on the limit, shrink-to-fit everywhere.
    expect(TEASERS).toMatch(/foot: \{ flex: 1, alignItems: "center"/);
    expect(TEASERS).toMatch(/limitValue: \{[^}]*minWidth: 78[^}]*textAlign: "right"/);
    expect(TEASERS).toMatch(/cue: \{\s*flex: 1, minWidth: 0/);
    expect((TEASERS.match(/adjustsFontSizeToFit/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

// ── Intelligence ────────────────────────────────────────────────────────────

describe("intelligence dossier", () => {
  it("leads with identity, then the estimate that follows from it", () => {
    const identity = TEASERS.indexOf("BRAND");
    const estimate = TEASERS.indexOf("EST. RESALE", identity);
    const meters = TEASERS.indexOf("MATCH CONFIDENCE");
    expect(identity).toBeGreaterThan(-1);
    expect(estimate).toBeGreaterThan(identity);
    expect(meters).toBeGreaterThan(estimate);
    expect(TEASERS).toContain("Patagonia");
    expect(TEASERS).toContain("1990s");
    expect(TEASERS).toContain('text="SAMPLE ANALYSIS"');
  });

  it("shows confidence as a partial bar, not a verdict", () => {
    expect(TEASERS).toMatch(/fill: \{ width: "86%"/);
    expect(TEASERS).toMatch(/accessibilityRole="progressbar"/);
    expect(TEASERS).toMatch(/accessibilityValue=\{\{ min: 0, max: 100, now: 86 \}\}/);
  });

  it("treats low risk as calm, not as an error", () => {
    expect(TEASERS).toMatch(/riskPill: \{[\s\S]*?backgroundColor: "rgba\(33,77,45,0\.07\)"/);
    expect(TEASERS).toMatch(/riskText: \{[^}]*color: PW\.forest/);
    expect(code(TEASERS)).not.toMatch(/LIMIT_RED[^;]*risk/i);
  });

  it("claims no certainty", () => {
    expect(code(TEASERS).toLowerCase()).not.toMatch(/verified|guaranteed authentic|exact match|definitely|always identifies/);
    expect(TEASERS).toMatch(/what’s worth verifying yourself/);
  });

  it("keeps the Deep Analysis tease compact and clearly Pro", () => {
    expect(TEASERS).toMatch(/GO DEEPER WITH PRO[\s\S]{0,120}<ProSeal \/>/);
    expect(TEASERS).toContain("Deep Analysis");
    expect((TEASERS.match(/"Confidence breakdown", "Evidence", "Pricing logic", "Risk flags"/g) ?? [])).toHaveLength(1);
  });
});

// ── They must not look like each other ──────────────────────────────────────

describe("the two screens are structurally different", () => {
  it("money is a ledger, intelligence is a dossier — no shared metric grid", () => {
    const money = TEASERS.slice(TEASERS.indexOf("export function MoneyTeaser"), TEASERS.indexOf("export function IntelligenceTeaser"));
    const intel = TEASERS.slice(TEASERS.indexOf("export function IntelligenceTeaser"), TEASERS.indexOf("function ScanFrame"));
    // Money: a centred hero figure, a limit row, a two-column footing.
    expect(money).toMatch(/mn\.heroBlock/);
    expect(money).toMatch(/mn\.limitRow/);
    expect(money).toMatch(/mn\.footRow/);
    // Intelligence: a scan frame, an identity block, meters. None of them in money.
    expect(intel).toMatch(/it\.identity/);
    expect(intel).toMatch(/<ScanFrame \/>/);
    expect(intel).toMatch(/it\.meters/);
    for (const marker of ["it.identity", "ScanFrame", "it.meters", "it.track"]) expect(money).not.toContain(marker);
    for (const marker of ["mn.heroBlock", "mn.limitRow", "mn.footRow", "Cue icon"]) expect(intel).not.toContain(marker);
  });

  it("both still sit in the Phase 2 shell with the masthead and content-following CTA", () => {
    for (const marker of ["Know the flip before you buy", "Spot what others might miss"]) {
      const at = SCREEN.indexOf(marker);
      const shell = SCREEN.slice(SCREEN.lastIndexOf("<OnboardingShell", at), at);
      expect(shell, marker).toMatch(/masthead/);
      expect(shell, marker).toMatch(/ctaPlacement="content"/);
    }
    expect(SHELL).toMatch(/ctaPlacement\?: "content" \| "bottom";/);
  });

  it("leaves the Phase 3 money and intelligence cards untouched by later phases", () => {
    expect(TEASERS).toMatch(/export function MoneyTeaser\(/);
    expect(TEASERS).toMatch(/export function IntelligenceTeaser\(/);
    expect(TEASERS).toMatch(/const LIMIT_RED = "#8E3222";/);
    expect(TEASERS).toMatch(/<ResaleRange low="\$45" high="\$60"/);
    expect(TEASERS).toMatch(/<ResaleRange low="\$55" high="\$75"/);
  });
});