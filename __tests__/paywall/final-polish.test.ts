/**
 * __tests__/paywall/final-polish.test.ts
 *
 * The three-fix polish pass: Annual price hierarchy reversed, the CTA's
 * genuine clipping bug fixed, Scan Store recolored. Nothing else moved.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { annualMonthlyEquivalent, planCtaLabel } from "@/lib/paywallPricing";

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
const USD = (p: number, s: string) => ({ priceString: s, priceAmount: p, currencyCode: "USD" });

const CARD  = read("components/monetization/paywall/PlanCard.tsx");
const CTA   = read("components/monetization/paywall/PaywallPurchaseButton.tsx");
const STORE = read("components/monetization/paywall/ScanStoreAlternative.tsx");
const THEME = read("components/monetization/paywall/paywallTheme.ts");
const SEL   = read("components/monetization/paywall/PlanSelector.tsx");
const PRICING = read("lib/paywallPricing.ts");

// ── 1. Annual price hierarchy ───────────────────────────────────────────────

describe("Annual price hierarchy", () => {
  it("leads with the monthly equivalent, styled at the same size the plain price used to be", () => {
    expect(CARD).toMatch(/const showEquivDominant = Boolean\(equivalent && amount\);/);
    expect(CARD).toMatch(/<Text style=\{\[s\.amount, s\.amountGreen\]\}>\{equivalent\}<\/Text>/);
    expect(CARD).toMatch(/amount: \{ fontFamily: FONTS\.serif, fontSize: 32, fontWeight: "800", color: PW\.ink, lineHeight: 36 \}/);
    expect(CARD).toMatch(/amountGreen: \{ color: PW\.forest \}/);
  });

  it("bills the real annual charge underneath, tight (no spaces around the slash)", () => {
    expect(CARD).toMatch(/const billed = priceLabel \? priceLabel\.replace\(\/\\s\+\/g, ""\) : null;/);
    expect(CARD).toContain('<Text style={s.billedLine}>Billed {billed}</Text>');
    // "$39.99 / year" -> "$39.99/year"
    expect("$39.99 / year".replace(/\s+/g, "")).toBe("$39.99/year");
  });

  it("only leads with the equivalent when BOTH the equivalent and the amount are ready — never a headline the card can't back up", () => {
    expect(CARD).toMatch(/const showEquivDominant = Boolean\(equivalent && amount\);/);
    expect(CARD).toMatch(/\{showEquivDominant \? \(/);
    // The old "equivalent && (...)" second-block form is gone — merged into the branch above.
    expect(code(CARD)).not.toMatch(/equivRow|equivAmount|equivPeriod/);
  });

  it("falls back to the plain price, undecorated, when the equivalent can't be shown honestly", () => {
    expect(CARD).toMatch(/\) : amount \? \(/);
    expect(annualMonthlyEquivalent({ priceString: "$39.99", priceAmount: null, currencyCode: "USD" })).toBeNull();
  });

  it("still derives the equivalent from the live annual amount, never hardcoded", () => {
    expect(SEL).toMatch(/equivalent=\{annualMonthlyEquivalent\(annualPricing\)\}/);
    expect(annualMonthlyEquivalent(USD(39.99, "$39.99"))).toBe("$3.33");
    expect(code(CARD)).not.toMatch(/\$3\.33|\$39\.99/);
  });

  it("leaves Monthly's presentation untouched — plain price, no equivalent, no billed line", () => {
    expect(SEL).toMatch(/name="MONTHLY PRO"[\s\S]{0,200}?footnote="Renews monthly"/);
    expect(SEL).not.toMatch(/name="MONTHLY PRO"[\s\S]{0,300}?equivalent=/);
  });
});

// ── 2. CTA: the actual clipping fix ─────────────────────────────────────────

describe("purchase CTA — the clipping fix", () => {
  it("uses a centered dot, not an em dash, on both plan labels", () => {
    expect(planCtaLabel("annual", USD(39.99, "$39.99"))).toBe("Start Annual Pro \u00B7 $39.99/year");
    expect(planCtaLabel("monthly", USD(7.99, "$7.99"))).toBe("Start Monthly Pro \u00B7 $7.99/month");
    expect(code(PRICING)).not.toMatch(/\\u2014/);
  });

  it("gives the label a bounded box, so adjustsFontSizeToFit can actually engage", () => {
    // This is the real bug: without a bounded flex box, auto-fit sizing has
    // nothing to shrink against and overflow:hidden crops the sparks instead.
    expect(CTA).toMatch(/row: \{ flexDirection: "row", alignItems: "center", gap: 10, width: "100%" \}/);
    expect(CTA).toMatch(/label: \{\s*flex: 1,\s*minWidth: 0,/);
  });

  it("keeps both sparks and shrinks the text first, never removes them", () => {
    expect(CTA).toMatch(/\{!inert && <Spark \/>\}[\s\S]*?<Text[\s\S]*?\{!inert && <Spark \/>\}/);
    expect(CTA).toMatch(/adjustsFontSizeToFit/);
    expect(CTA).toMatch(/minimumFontScale=\{LABEL_MIN_FONT_SCALE\}/);
    expect(CTA).toMatch(/const LABEL_MIN_FONT_SCALE = 0\.82;/);
  });

  it("does not make the text tiny — starts at 17, floors at ~14pt, not smaller", () => {
    expect(CTA).toMatch(/fontFamily: FONTS\.serif, fontSize: 17, fontWeight: "800",/);
    expect(17 * 0.82).toBeGreaterThan(13.9);
  });

  it("gives the sparks a bit more edge padding", () => {
    expect(CTA).toMatch(/paddingHorizontal: 20,/);
  });

  it("keeps the sheen, the trim and the busy/disabled behavior exactly as they were", () => {
    expect(CTA).toMatch(/const SHEEN_PERIOD_MS = 7000;/);
    expect(CTA).toMatch(/onPress=\{inert \? undefined : onPress\}/);
    expect(CTA).toMatch(/disabled=\{inert\}/);
  });
});

// ── 3. Scan Store color ─────────────────────────────────────────────────────

describe("Scan Store button — antique gold", () => {
  it("fills with the richer goldStore token, not the pale goldTint wash", () => {
    expect(THEME).toMatch(/goldStore: "#D4AF37",/);
    expect(STORE).toMatch(/backgroundColor: PW\.goldStore,/);
    expect(code(STORE)).not.toMatch(/backgroundColor: PW\.goldTint/);
  });

  it("is not neon yellow, not orange, and not the old cream", () => {
    // #D4AF37 is a desaturated, low-value gold/brass — nowhere near neon-yellow
    // (#FFFF00-ish) or orange (hue ~30) territory, and distinct from the old
    // #F5EBCB pale wash it replaced.
    expect(THEME).not.toMatch(/goldStore: "#FF[EF][0-9A-F]0?0?"/);
    expect(THEME).toMatch(/goldStore: "#D4AF37"/);
  });

  it("keeps forest-green text and border, moved to forestDeep for contrast on the richer fill", () => {
    expect(STORE).toMatch(/borderColor: PW\.forest,/);
    expect(STORE).toMatch(/label: \{[^}]*color: PW\.forestDeep/);
  });

  it("recolors the spark off gold — gold-on-goldStore is near-invisible", () => {
    expect(STORE).toMatch(/fill=\{PW\.forestDeep\}/);
    expect(code(STORE)).not.toMatch(/fill=\{PW\.gold\}/);
  });

  it("keeps the wording, the gleam cadence, and stays outlined — still second to the Pro CTA", () => {
    expect(STORE).toContain("Go to Scan Store");
    expect(STORE).toMatch(/const GLEAM_PERIOD_MS = 9000;/);
    expect(STORE).toMatch(/borderWidth: 1\.6,/);
    expect(code(STORE)).not.toMatch(/purchase\(|mutateAsync|restorePurchases|purchasePackage/);
  });
});

// ── 4. Nothing else moved ───────────────────────────────────────────────────

describe("scope discipline", () => {
  it("touches no monetization, entitlement, or server logic", () => {
    for (const src of [CARD, CTA, STORE, THEME, SEL, PRICING]) {
      expect(code(src)).not.toMatch(/purchasePackage|restorePurchases|apply_revenuecat_snapshot|entitlement/i);
    }
  });

  it("adds no new color to the PW object outside the one antique-gold token", () => {
    // Scoped to the `export const PW = { ... } as const;` object literal, not
    // the file's prose comments — the header discusses other screens' hex
    // values (e.g. the older #3D5A38 palette) by name, which aren't tokens.
    const start = THEME.indexOf("export const PW = {");
    const end = THEME.indexOf("} as const;", start);
    const pwObject = THEME.slice(start, end);
    const before = ["#FFFFFF", "#FFFEFA", "#FBF4DC", "#F5EBCB", "#2B2118", "#214D2D",
      "#122E1B", "#6F5A3E", "#8A7658", "#C4A334", "#F0DC96", "#DDD2AC",
      "#9E3A2A", "#F7E9E4", "#E3B8B4", "#F4EED8"];
    const hexes = [...pwObject.matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => m[0].toUpperCase());
    const added = hexes.filter(h => !before.includes(h));
    expect(added).toEqual(["#D4AF37"]);
  });
});