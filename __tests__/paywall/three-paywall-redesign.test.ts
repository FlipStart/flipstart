/**
 * __tests__/paywall/three-paywall-redesign.test.ts
 *
 * The visual pass that brought Generate Listings, Third Photo and AI Context
 * onto the same shell as Deep Analysis: one masthead, one entrance, three
 * teasers.
 *
 * ── What is pinned here ─────────────────────────────────────────────────────
 * The SHARED pieces (masthead, reveal) and the three heroes' use of them, plus
 * the truthfulness rules the redesign must not have loosened. Purchase logic,
 * plan cards, the CTA and the footer are pinned by earlier suites and were not
 * touched; a few assertions below confirm that rather than re-test it.
 *
 * ── Structural, and stated plainly ──────────────────────────────────────────
 * These read source text. They cannot see the screen; they can see that the
 * three heroes import the same masthead, name the right feature, drive no
 * shared value of their own, and never loop.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolvePaywallConfig } from "@/lib/paywallConfig";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; } else { i++; } continue; }
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c; i++;
  }
  return out;
}
const code = (src: string) => stripComments(src);

const MASTHEAD = read("components/monetization/paywall/PaywallMasthead.tsx");
const REVEAL   = read("components/monetization/paywall/HeroReveal.tsx");
const BENEF    = read("components/monetization/paywall/ProBenefits.tsx");
const MODAL    = read("components/monetization/paywall/ProPaywallModal.tsx");
const BTN      = read("components/monetization/paywall/PaywallPurchaseButton.tsx");

const HEROES = {
  generate_listings: { file: read("components/monetization/paywall/heroes/GenerateListingsHero.tsx"), feature: "GENERATE LISTINGS" },
  third_photo:       { file: read("components/monetization/paywall/heroes/ThirdPhotoHero.tsx"),       feature: "THIRD PHOTO" },
  camera_context:    { file: read("components/monetization/paywall/heroes/AiContextHero.tsx"),        feature: "AI CONTEXT" },
} as const;

// ── The shared masthead ─────────────────────────────────────────────────────

describe("PaywallMasthead", () => {
  it("is the Deep Analysis header, extracted: sparks, wordmark, gold rule, feature, diamond", () => {
    expect(MASTHEAD).toMatch(/<Spark size=\{13\} \/>\s*<Text style=\{s\.brand\}[^>]*>FLIPSTART<\/Text>\s*<Spark size=\{13\} \/>/);
    expect(MASTHEAD).toMatch(/<Text style=\{s\.featureLabel\}[^>]*>\{feature\}<\/Text>/);
    expect(MASTHEAD).toMatch(/<Diamond \/>/);
    // Same numbers the approved Deep Analysis hero uses, so the siblings match it.
    expect(MASTHEAD).toMatch(/brand: \{[^}]*fontSize: 19[^}]*letterSpacing: 5[^}]*color: PW\.forest/);
    expect(MASTHEAD).toMatch(/featureLabel: \{[^}]*fontSize: 11[^}]*letterSpacing: 3\.2[^}]*color: PW\.gold/);
  });

  it("glints on the 11s cadence, offset from the CTA's 7s, and can be switched off", () => {
    expect(MASTHEAD).toMatch(/const GLINT_PERIOD_MS = 11000;/);
    expect(BTN).toMatch(/const SHEEN_PERIOD_MS = 7000;/);
    expect(MASTHEAD).toMatch(/glint = true/);
    expect(MASTHEAD).toMatch(/if \(reduceMotion \|\| !glint\) \{ pass\.value = 0; return; \}/);
  });

  it("respects Reduce Motion and uses a per-instance gradient id", () => {
    expect(MASTHEAD).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(MASTHEAD).toMatch(/\{glint && !reduceMotion && \(/);
    // SVG ids are global; a collision renders blank. Ornament.tsx learned this.
    expect(MASTHEAD).toMatch(/useId\(\)/);
    expect(code(MASTHEAD)).not.toMatch(/id="[a-z-]+"/);
  });
});

// ── The shared entrance ─────────────────────────────────────────────────────

describe("HeroReveal", () => {
  it("is one 0 → 1 pass, under a second, and never repeats", () => {
    expect(REVEAL).toMatch(/const REVEAL_DELAY_MS = \d+;/);
    expect(REVEAL).toMatch(/const REVEAL_DURATION_MS = (\d+);/);
    const dur = Number(REVEAL.match(/const REVEAL_DURATION_MS = (\d+);/)![1]);
    const delay = Number(REVEAL.match(/const REVEAL_DELAY_MS = (\d+);/)![1]);
    expect(dur + delay).toBeLessThan(1000);
    expect(code(REVEAL)).not.toMatch(/withRepeat|withSequence|LayoutAnimation/);
  });

  it("renders the finished state under Reduce Motion", () => {
    expect(REVEAL).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(REVEAL).toMatch(/if \(reduceMotion\) \{ progress\.value = 1; return; \}/);
  });

  it("clamps each part to its own window", () => {
    expect(REVEAL).toMatch(/interpolate\(progress\.value, \[at, Math\.min\(1, at \+ span\)\], \[0, 1\], "clamp"\)/);
  });
});

// ── The three heroes, as siblings ───────────────────────────────────────────

describe("the three redesigned heroes", () => {
  for (const [source, { file, feature }] of Object.entries(HEROES)) {
    describe(source, () => {
      it("opens with the shared masthead naming its own feature", () => {
        expect(file).toMatch(/import \{ PaywallMasthead(, Spark)? \} from "\.\.\/PaywallMasthead"/);
        expect(file).toContain(`<PaywallMasthead feature="${feature}"`);
        // The config eyebrow is no longer rendered as a bare label; the masthead
        // is the brand. (The config value itself is untouched and still pinned.)
        expect(code(file)).not.toMatch(/\{config\.eyebrow\}/);
      });

      it("shares the entrance and drives no shared value of its own", () => {
        expect(file).toMatch(/import \{ Reveal, useHeroReveal \} from "\.\.\/HeroReveal"/);
        expect(file).toMatch(/const \{ progress \} = useHeroReveal\(\);/);
        expect(file).toMatch(/<Reveal progress=\{progress\} at=\{0\}/);
        expect(code(file)).not.toMatch(/useSharedValue|withTiming|withRepeat|withDelay|LayoutAnimation/);
      });

      it("sets the headline at the Deep Analysis size so the siblings match", () => {
        expect(file).toMatch(/headline: \{[^}]*fontSize: 30[^}]*lineHeight: 35/);
        expect(file).toMatch(/const COMPACT_BELOW = 740;/);
      });

      it("keeps the teaser decorative and in palette", () => {
        expect(file).toMatch(/accessibilityElementsHidden/);
        expect(file).toMatch(/importantForAccessibility="no-hide-descendants"/);
        expect(file).toMatch(/from "\.\.\/paywallTheme"/);
        expect(code(file)).not.toMatch(/#000000|#0A0A0A|#111111/);
      });

      it("makes no accuracy or outcome claim the product cannot keep", () => {
        expect(code(file).toLowerCase()).not.toMatch(/better identification|guarantee|unlimited|sell faster|higher price/);
      });

      it("never offers the Scan Store — packs cannot unlock this", () => {
        expect(resolvePaywallConfig(source as any).showScanStoreAlternative).toBe(false);
        expect(code(file)).not.toMatch(/ScanStore|scan pack|Scan Pack/);
      });
    });
  }

  it("turns the masthead glint off only where another ambient loop already runs", () => {
    // Third Photo carries the camera's PremiumGlimmer sweep; two loops is the budget.
    expect(HEROES.third_photo.file).toMatch(/<PaywallMasthead feature="THIRD PHOTO"[^>]*glint=\{false\}/);
    expect(HEROES.third_photo.file).toMatch(/<PremiumGlimmer active/);
    expect(HEROES.generate_listings.file).not.toMatch(/glint=\{false\}/);
    expect(HEROES.camera_context.file).not.toMatch(/glint=\{false\}/);
  });
});

// ── Generate Listings specifics ─────────────────────────────────────────────

describe("Generate Listings teaser", () => {
  const HERO = HEROES.generate_listings.file;

  it("forks one find into two drafts, stamped SAMPLE, with no fabricated data", () => {
    expect(HERO).toMatch(/function Fork\(/);
    expect(HERO).toContain(">SAMPLE</Text>");
    expect(HERO).toMatch(/const SAMPLE_TITLES = \{/);
    // A price, size or condition on a draft would be data FlipStart has not produced.
    expect(code(HERO)).not.toMatch(/\$\d|\bSize\b|\bCondition\b|\bSold\b|\bShipping\b/);
  });

  it("arrives in story order: find, thread, eBay, Depop", () => {
    const order = [/at=\{0\}[^>]*>\s*<View style=\{s\.findCard\}/, /at=\{0\.2\}[^>]*>\s*<Fork/, /at=\{0\.38\}[^>]*>\s*<ListingSlip platform="eBay"/, /at=\{0\.52\}[^>]*>\s*<ListingSlip platform="Depop"/];
    let last = -1;
    for (const re of order) {
      const i = HERO.search(re);
      expect(i).toBeGreaterThan(last);
      last = i;
    }
  });
});

// ── Third Photo specifics ───────────────────────────────────────────────────

describe("Third Photo teaser", () => {
  const HERO = HEROES.third_photo.file;

  it("lights the third frame rather than locking it", () => {
    expect(HERO).toMatch(/framePremium: \{[^}]*borderColor: PW\.gold[^}]*backgroundColor: PW\.goldTint/);
    expect(HERO).toMatch(/innerRule: \{[^}]*borderColor: "rgba\(196,163,52,0\.5\)"/);
    expect(HERO).toMatch(/<Spark size=\{10\} \/>/);
    expect(code(HERO)).not.toMatch(/name="lock"|lock-outline|padlock|opacity: 0\.3\d/i);
  });

  it("uses a detail icon on the DETAIL frame, and a hanger and a tag on the two included frames", () => {
    expect(HERO).toMatch(/label="DETAIL" icon="center-focus-strong"[^/]*state="premium"/);
    expect(HERO).toMatch(/label="FRONT" icon="checkroom"[^/]*state="filled"/);
    expect(HERO).toMatch(/label="TAG" icon="local-offer"[^/]*state="filled"/);
  });
});

// ── AI Context specifics ────────────────────────────────────────────────────

describe("AI Context teaser", () => {
  const HERO = HEROES.camera_context.file;

  it("keeps the note card, the SAMPLE NOTE label and the GUIDE THE ANALYSIS chip", () => {
    expect(HERO).toContain("SAMPLE NOTE");
    expect(HERO).toContain("GUIDE THE ANALYSIS");
    expect(HERO).toMatch(/note: \{[^}]*borderColor: PW\.forest/);
    // The selected plan card's hairline, so "the Pro object" is said the same way.
    expect(HERO).toMatch(/innerRule: \{[^}]*borderColor: "rgba\(196,163,52,0\.45\)"/);
  });

  it("is still not a conversation and has no typing effect", () => {
    expect(code(HERO)).not.toMatch(/bubble|avatar|send|chat|message|cursor|typewriter/i);
  });
});

// ── The strip and the shared purchase path ──────────────────────────────────

describe("MORE WITH PRO", () => {
  it("renames the kicker and rings every icon, keeping the gold ring on the emphasized one", () => {
    expect(BENEF).toContain(">MORE WITH PRO</Text>");
    expect(code(BENEF)).not.toMatch(/INCLUDED WITH PRO/);
    expect(BENEF).toMatch(/iconWrap: \{[^}]*borderWidth: 1[^}]*borderColor: "rgba\(33,77,45,0\.22\)"/);
    expect(BENEF).toMatch(/iconWrapEmphasized: \{[^}]*borderColor: PW\.gold/);
  });

  it("no longer repeats the strip's contents in the Generate Listings tagline", () => {
    const line = resolvePaywallConfig("generate_listings").secondaryValueLine ?? "";
    expect(line).toBe("Built from your scan, ready for your edits.");
    expect(line).not.toMatch(/Deep Analysis|AI Context|3-photo/);
  });
});

describe("the shared purchase path is untouched by the visual pass", () => {
  it("still builds the CTA from the selected plan and its live price — never a feature name", () => {
    expect(MODAL).toMatch(/label=\{planCtaLabel\(selected,/);
    for (const feature of ["Unlock Generate Listings", "Unlock Third Photo", "Unlock AI Context"]) {
      expect(code(MODAL)).not.toContain(feature);
      expect(code(BTN)).not.toContain(feature);
    }
  });

  it("still resumes only after authoritative activation, exactly once", () => {
    expect(MODAL).toMatch(/const confirmed = await confirmProWithServer\(\);/);
    expect(MODAL).toMatch(/setState\(afterActivation\(confirmed, target\)\);/);
    expect(MODAL).toMatch(/if \(state\.phase !== "unlocked" \|\| !hasContinuation\) return;/);
    expect(MODAL).toMatch(/const fn = consumeUnlock\(\);/);
  });
});