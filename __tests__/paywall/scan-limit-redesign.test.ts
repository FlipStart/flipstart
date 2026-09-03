/**
 * __tests__/paywall/scan-limit-redesign.test.ts
 *
 * The scan-limit paywall redesign: what changed visually, and what must not
 * have changed underneath it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { annualMonthlyEquivalent, planCtaLabel } from "@/lib/paywallPricing";
import { resolvePaywallConfig, PAYWALL_SOURCES } from "@/lib/paywallConfig";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
function strip(src: string): string {
  let out = ""; let m: "c"|"l"|"b"|"s"|"d"|"t" = "c"; let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (m === "c") {
      if (c === "/" && n === "/") { m = "l"; i += 2; continue; }
      if (c === "/" && n === "*") { m = "b"; i += 2; continue; }
      if (c === "'") m = "s"; else if (c === '"') m = "d"; else if (c === "`") m = "t";
      out += c; i++; continue;
    }
    if (m === "l") { if (c === "\n") { m = "c"; out += c; } i++; continue; }
    if (m === "b") { if (c === "*" && n === "/") { m = "c"; i += 2; } else i++; continue; }
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((m === "s" && c === "'") || (m === "d" && c === '"') || (m === "t" && c === "`")) m = "c";
    out += c; i++;
  }
  return out;
}
const code = strip;

const HERO   = read("components/monetization/paywall/heroes/ScanLimitHero.tsx");
const CARD   = read("components/monetization/paywall/PlanCard.tsx");
const CTA    = read("components/monetization/paywall/PaywallPurchaseButton.tsx");
const BENEF  = read("components/monetization/paywall/ProBenefits.tsx");
const STORE  = read("components/monetization/paywall/ScanStoreAlternative.tsx");
const MODAL  = read("components/monetization/paywall/ProPaywallModal.tsx");
const SEL    = read("components/monetization/paywall/PlanSelector.tsx");
const USD = (p: number, s: string) => ({ priceString: s, priceAmount: p, currencyCode: "USD" });

describe("pricing on the card and the button", () => {
  it("derives the monthly equivalent from the live annual amount", () => {
    expect(annualMonthlyEquivalent(USD(39.99, "$39.99"))).toBe("$3.33");
    expect(SEL).toMatch(/equivalent=\{annualMonthlyEquivalent\(annualPricing\)\}/);
  });

  it("suppresses the equivalent rather than inventing it", () => {
    expect(annualMonthlyEquivalent({ priceString: "$39.99", priceAmount: null, currencyCode: "USD" })).toBeNull();
    expect(annualMonthlyEquivalent({ priceString: null, priceAmount: 39.99, currencyCode: null })).toBeNull();
    expect(CARD).toMatch(/\{equivalent && \(/);
  });

  it("formats the equivalent in the product currency", () => {
    const y = annualMonthlyEquivalent({ priceString: "¥6,000", priceAmount: 6000, currencyCode: "JPY" });
    expect(y).not.toContain("$");
  });

  it("names the plan and the live price on the CTA", () => {
    expect(planCtaLabel("annual", USD(39.99, "$39.99"))).toBe("Start Annual Pro — $39.99/year");
    expect(planCtaLabel("monthly", USD(7.99, "$7.99"))).toBe("Start Monthly Pro — $7.99/month");
    expect(MODAL).toMatch(/label=\{planCtaLabel\(selected,/);
  });

  it("never falls back to an invented price on the CTA", () => {
    expect(planCtaLabel("annual", { priceString: null, priceAmount: null, currencyCode: null })).toBe("Start Annual Pro");
  });

  it("shows no fake strike-through price anywhere", () => {
    for (const f of [HERO, CARD, CTA, SEL, MODAL]) {
      expect(code(f)).not.toMatch(/59\.99|textDecorationLine: ["']line-through/);
    }
  });
});

describe("hero", () => {
  it("leads with the brand, bracketed by sparks, over a diamond rule", () => {
    expect(HERO).toMatch(/<Spark \/>\s*<Text style=\{s\.brand\}[^>]*>\{config\.eyebrow\}<\/Text>\s*<Spark \/>/);
    expect(HERO).toMatch(/<DiamondRule \/>/);
  });

  it("uses the new headline and a compact count pill, not the 15-mark pass", () => {
    expect(HERO).toContain("Keep Scanning With Pro");
    expect(HERO).toMatch(/\{FREE_LIFETIME_SCANS\} FREE SCANS USED/);
    const c = code(HERO);
    expect(c).not.toMatch(/LIFETIME SCAN PASS|ALLOTMENT USED|TallyGrid|NotchedEdge/);
  });

  it("uses warm brown for support text, never grey", () => {
    expect(HERO).toMatch(/subtitle: \{[^}]*color: PW\.brown/);
    // Hex greys only. (The word "grey" appears in the file's own comments.)
    expect(code(HERO)).not.toMatch(/#(8|9|A|B)[0-9A-F]{5}\b/i);
  });

  it("keeps the source's own eyebrow (FLIPSTART, not FLIPSTART PRO)", () => {
    expect(resolvePaywallConfig("scan_limit").eyebrow).toBe("FLIPSTART");
  });
});

describe("plan cards", () => {
  it("no longer fills the selected card with cream", () => {
    const sel = CARD.slice(CARD.indexOf("cardSelected:"), CARD.indexOf("cardUnavailable:"));
    expect(sel).not.toMatch(/backgroundColor/);
    expect(sel).toMatch(/borderColor: PW\.forest/);
  });

  it("gives the monthly equivalent headline weight, in forest green", () => {
    expect(CARD).toMatch(/equivAmount: \{[^}]*fontSize: 20[^}]*color: PW\.forest/);
  });

  it("animates the check once per selection and honours Reduce Motion", () => {
    expect(CARD).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(CARD).toMatch(/if \(reduceMotion\) \{ check\.value = selected \? 1 : 0; return; \}/);
    expect(code(CARD)).not.toMatch(/withRepeat/);
  });
});

describe("CTA", () => {
  it("sheens only while genuinely pressable, and stops under Reduce Motion", () => {
    expect(CTA).toMatch(/if \(reduceMotion \|\| inert\) \{ sheen\.value = 0; return; \}/);
    expect(CTA).toMatch(/\{!reduceMotion && !inert && \(/);
  });

  it("passes slowly, not constantly", () => {
    expect(CTA).toMatch(/const SHEEN_PERIOD_MS = 7000;/);
  });

  it("keeps press and appearance on the same predicate", () => {
    expect(CTA).toMatch(/onPress=\{inert \? undefined : onPress\}/);
    expect(CTA).toMatch(/disabled=\{inert\}/);
  });
});

describe("benefits strip", () => {
  it("shows the standardized four, in the standardized order", () => {
    expect(BENEF).toMatch(/3-Photo\\nScans[\s\S]*Deep\\nAnalysis[\s\S]*Generate\\nListings[\s\S]*AI\\nContext/);
  });

  it("renders on every paywall except the plaque one", () => {
    // Now multi-line, carrying the per-source emphasis prop. The exclusion of
    // the plaque paywall — which already engraves the same four lines — is the
    // property being pinned, not the JSX shape.
    expect(MODAL).toMatch(/\{config\?\.source !== "settings_upgrade" && \(\s*<ProBenefits emphasize=/);
  });

  it("staggers in once and never loops", () => {
    expect(code(BENEF)).not.toMatch(/withRepeat/);
    expect(BENEF).toMatch(/withDelay\(250, withTiming\(1/);
  });
});

describe("scan store alternative", () => {
  it("is above the footer, inside the first viewport, and only for scan_limit", () => {
    const modal = code(MODAL);
    const alt = modal.indexOf("<ScanStoreAlternative");
    const footer = modal.indexOf("<PaywallFooter");
    expect(alt).toBeGreaterThan(-1);
    expect(alt).toBeLessThan(footer);
    expect(modal).toMatch(/\{!!config\?\.showScanStoreAlternative && \(\s*<ScanStoreAlternative/);
    for (const s of PAYWALL_SOURCES.filter(x => x !== "scan_limit")) {
      expect(resolvePaywallConfig(s).showScanStoreAlternative).toBe(false);
    }
  });

  it("dismisses the paywall before navigating", () => {
    const m = code(MODAL);
    const fn = m.slice(m.indexOf("const goScanStore"), m.indexOf("const goScanStore") + 260);
    expect(fn.indexOf("dismiss(false)")).toBeLessThan(fn.indexOf("onScanStore()"));
  });

  it("is gold-forward but outlined, so it stays second to the Pro CTA", () => {
    expect(STORE).toMatch(/btn: \{[\s\S]*?borderColor: PW\.forest[\s\S]*?backgroundColor: PW\.goldTint/);
  });

  it("gleams on a different cadence from the CTA so they never pulse together", () => {
    expect(STORE).toMatch(/const GLEAM_PERIOD_MS = 9000;/);
    expect(CTA).toMatch(/const SHEEN_PERIOD_MS = 7000;/);
  });

  it("cannot start a purchase", () => {
    expect(code(STORE)).not.toMatch(/purchase\(|mutateAsync|restorePurchases|purchasePackage/);
  });
});

describe("monetization logic is untouched", () => {
  it("keeps the purchase machine, resume, and restore paths as they were", () => {
    expect(MODAL).toMatch(/onPress=\{runPurchase\}/);
    expect(MODAL).toMatch(/consumeUnlock/);
    expect(MODAL).toMatch(/afterActivation/);
    // The machine's own invariant: success reaches "activating", never "unlocked".
    expect(read("lib/paywallMachine.ts")).toMatch(/both move to "activating"/);
  });

  it("keeps ACTIVATING and ACTIVATED distinct", () => {
    expect(MODAL).toMatch(/state\.phase === "activating"/);
    expect(MODAL).toContain("Activating Pro…");
  });

  it("preserves the legal footer", () => {
    const f = read("components/monetization/paywall/PaywallFooter.tsx");
    expect(f).toContain("Secure App Store purchase");
    expect(f).toContain("Privacy Policy");
    expect(f).toContain("Terms of Service");
    expect(f).toMatch(/renew/i);
  });
});