/**
 * __tests__/onboarding/unlock-card-typography.test.ts
 *
 * The gamification showcase cards, after the microtype cleanup.
 *
 * The failure this guards against is specific: on device the achievement
 * title rendered SMALLER than its own description, because the card was too
 * narrow and every size had been shaved to fit. So the checks here are about
 * relative hierarchy and absolute floors, not about any one number.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const TEASERS = read("components/onboarding/ValueTeasers.tsx");

/** Comments legitimately NAME the things we ban, to explain their absence. */
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
const CODE = stripComments(TEASERS);

/** Pull a numeric property out of a named style block. */
function styleNum(style: string, prop: string): number {
  const block = TEASERS.match(new RegExp(`\\b${style}: \\{([\\s\\S]*?)\\},`));
  if (!block) throw new Error(`style ${style} not found`);
  const m = block[1].match(new RegExp(`${prop}: ([\\d.]+)`));
  if (!m) throw new Error(`${style}.${prop} not found`);
  return Number(m[1]);
}

describe("unlock card hierarchy", () => {
  it("makes the title the loudest line on the card", () => {
    const title = styleNum("unlockTitle", "fontSize");
    expect(title).toBeGreaterThanOrEqual(18);
    // Bigger than everything else on the card, by a clear margin.
    for (const other of ["unlockKicker", "unlockMetaText", "unlockBody", "unlockFooterText"]) {
      expect(title, `title vs ${other}`).toBeGreaterThan(styleNum(other, "fontSize") + 3);
    }
  });

  it("never lets a title come out smaller than its own description", () => {
    // The exact regression seen on device.
    expect(styleNum("unlockTitle", "fontSize")).toBeGreaterThan(styleNum("unlockBody", "fontSize"));
  });

  it("has no microtype: every content style clears a readable floor", () => {
    // 12pt floor for content; the eyebrow is a tracked label and gets 11.
    for (const style of ["unlockMetaText", "unlockBody", "unlockFooterText"]) {
      expect(styleNum(style, "fontSize"), style).toBeGreaterThanOrEqual(12);
    }
    expect(styleNum("unlockKicker", "fontSize")).toBeGreaterThanOrEqual(11);
    // Nothing in the showcase sits in single digits any more.
    const showcase = TEASERS.slice(TEASERS.indexOf("unlockBar:"), TEASERS.indexOf("unlockFooterText:") + 200);
    const sizes = [...showcase.matchAll(/fontSize: ([\d.]+)/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });

  it("wraps long titles instead of shrinking or truncating them", () => {
    // Three lines available, and no auto-shrink anywhere on the card.
    expect(TEASERS).toMatch(/<Text style=\{g\.unlockTitle\} numberOfLines=\{3\}/);
    const cardFn = TEASERS.slice(TEASERS.indexOf("function UnlockCard"), TEASERS.indexOf("const c = StyleSheet"));
    expect(cardFn).not.toMatch(/adjustsFontSizeToFit|minimumFontScale|ellipsizeMode/);
    // The real Diamond name is the reason: it cannot fit on one line at 19pt.
    expect(TEASERS).toMatch(/title: DIAMOND_DEF\.title/);
  });

  it("reserves height so the three cards align and the footer never drifts", () => {
    expect(styleNum("unlockTitle", "minHeight")).toBe(48);   // two title lines
    expect(styleNum("unlockBody", "minHeight")).toBe(58);    // three body lines
  });

  it("keeps the peek: a wider card that still shows the next one", () => {
    expect(TEASERS).toMatch(/const UNLOCK_W = 268;/);
    expect(TEASERS).toMatch(/const UNLOCK_GAP = 10;/);
    expect(TEASERS).toMatch(/snapToInterval=\{UNLOCK_W \+ UNLOCK_GAP\}/);
    expect(TEASERS).toMatch(/showcase: \{ gap: UNLOCK_GAP/);
    // 393pt phone → 353 of content; 268 + 10 leaves 75pt of the next card.
    expect(353 - (268 + 10)).toBeGreaterThanOrEqual(60);
    // And still a real peek on a 375pt phone.
    expect(335 - (268 + 10)).toBeGreaterThanOrEqual(40);
  });

  it("announces the whole card as one label, footer included", () => {
    expect(TEASERS).toMatch(/accessibilityLabel=\{`\$\{kicker\}\. \$\{title\}\. \$\{meta\}\. \$\{body\}\. \$\{footer\}`\}/);
    expect((TEASERS.match(/maxFontSizeMultiplier=\{1\.2\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("changes no gamification content or truth", () => {
    expect(TEASERS).toMatch(/ACHIEVEMENT_CATEGORIES\.find\(c => c\.id === "hunt"\)/);
    expect(TEASERS).toMatch(/DIAMONDS\.find\(d => d\.id === "vintage_levis_jacket"\)/);
    expect(TEASERS).toMatch(/ALL_BRANDS\.find\(b => b\.name === "Patagonia"\)/);
    expect(TEASERS).toMatch(/for completing a Hunt/);
    // Checked on stripped code: the file's comments explain why streaks and
    // leaderboards are absent, and must stay free to say so.
    expect(CODE.toLowerCase()).not.toMatch(/leaderboard|milestone|streak/);
  });
});