/**
 * __tests__/onboarding/offer-short-screen.test.ts
 *
 * The onboarding offer on short screens: both decisions — Start Pro and
 * Continue with N Free Scans — on the first frame, without hiding anything.
 *
 * The trigger is a pure function, so the threshold itself is tested with
 * real device geometries. The layout side is pinned structurally: which
 * pieces honour `compact`, that it is opt-in to one source, and that nothing
 * the offer promises has gone missing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { offerNeedsCompactHeight, OFFER_STACK_NORMAL_PT, OFFER_BREATHING_PT } from "@/lib/paywallLayout";
import { resolvePaywallConfig, PAYWALL_SOURCES, FREE_LIFETIME_SCANS } from "@/lib/paywallConfig";

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

const MODAL    = read("components/monetization/paywall/ProPaywallModal.tsx");
const HERO     = read("components/monetization/paywall/PaywallHero.tsx");
const SELECTOR = read("components/monetization/paywall/PlanSelector.tsx");
const CARD     = read("components/monetization/paywall/PlanCard.tsx");
const CONFIG   = read("lib/paywallConfig.ts");

// ── The trigger ─────────────────────────────────────────────────────────────

describe("offerNeedsCompactHeight", () => {
  // window height, top inset, bottom inset — real logical geometries.
  const SE_3        = [667, 20, 0]  as const;   // iPhone SE (2022) — usable 629
  const PLUS_8      = [736, 20, 0]  as const;   // iPhone 8 Plus    — usable 698
  const MINI_13     = [812, 50, 34] as const;   // iPhone 13 mini   — usable 714
  const X_11PRO     = [812, 44, 34] as const;   // iPhone X/XS/11 Pro — usable 720
  const IPHONE_14   = [844, 47, 34] as const;   // usable 749
  const IPHONE_15   = [852, 59, 34] as const;   // usable 745
  const PRO_MAX_15  = [932, 59, 34] as const;   // usable 825

  it("engages ONLY where the normal stack genuinely cannot fit", () => {
    expect(offerNeedsCompactHeight(...SE_3)).toBe(true);      // 65pt short
    expect(offerNeedsCompactHeight(...PLUS_8)).toBe(true);    // clears by 4pt — flush against the edge
  });

  it("leaves every phone that fits on the approved spacing", () => {
    // The blast radius is deliberately small: these clear by 20pt or more, and
    // the threshold is an estimate, so they are not made to pay for it.
    expect(offerNeedsCompactHeight(...MINI_13)).toBe(false);   // +20pt
    expect(offerNeedsCompactHeight(...X_11PRO)).toBe(false);   // +26pt
    expect(offerNeedsCompactHeight(...IPHONE_14)).toBe(false);
    expect(offerNeedsCompactHeight(...IPHONE_15)).toBe(false);
    expect(offerNeedsCompactHeight(...PRO_MAX_15)).toBe(false);
  });

  it("is decided by usable height after both safe areas, not raw device height", () => {
    // Same raw height; a taller bottom inset can tip it over.
    expect(offerNeedsCompactHeight(800, 47, 0)).toBe(false);
    expect(offerNeedsCompactHeight(800, 47, 34)).toBe(true);
    // The threshold is exactly the stack plus its breathing room.
    const topPad = Math.max(59, 24) + 14;
    const exact = OFFER_STACK_NORMAL_PT + OFFER_BREATHING_PT + topPad + 34;
    expect(offerNeedsCompactHeight(exact, 59, 34)).toBe(false);
    expect(offerNeedsCompactHeight(exact - 1, 59, 34)).toBe(true);
  });

  it("sits between the 8 Plus and the 812pt devices, and nowhere else", () => {
    // The whole point of the narrow bar: 698 compacts, 714 does not.
    const threshold = OFFER_STACK_NORMAL_PT + OFFER_BREATHING_PT;
    expect(threshold).toBeGreaterThan(698);
    expect(threshold).toBeLessThanOrEqual(714);
    // Both constants mean what they say: 694 is the measured stack.
    expect(OFFER_STACK_NORMAL_PT).toBe(694);
  });

  it("never detects by device name", () => {
    // Word-bounded: "SE" would otherwise match inside offerNeedsCompactHeight.
    expect(code(read("lib/paywallLayout.ts"))).not.toMatch(/\bSE\b|iphone|\bmodel|Platform|DeviceInfo/i);
    expect(code(MODAL)).not.toMatch(/isIphoneSE|deviceName|modelName|DeviceInfo/i);
  });
});

// ── Opt-in, one source ──────────────────────────────────────────────────────

describe("compact mode is the onboarding offer's alone", () => {
  it("only onboarding_offer sets the flag", () => {
    expect(resolvePaywallConfig("onboarding_offer").compactAboveFoldActions).toBe(true);
    for (const s of PAYWALL_SOURCES.filter(x => x !== "onboarding_offer")) {
      expect(resolvePaywallConfig(s).compactAboveFoldActions ?? false, s).toBe(false);
    }
  });

  it("the modal gates compact on the flag AND the height", () => {
    expect(MODAL).toMatch(/const compact = !!config\?\.compactAboveFoldActions\s*&& offerNeedsCompactHeight\(windowHeight, insets\.top, insets\.bottom\);/);
    expect(MODAL).toMatch(/const \{ height: windowHeight \} = useWindowDimensions\(\);/);
  });

  it("every compact style is inert unless compact is true", () => {
    for (const [file, styles] of [
      [MODAL, ["columnCompact", "plansBlockCompact"]],
      [HERO, ["heroCompact", "emblemCompact"]],
      [SELECTOR, ["groupCompact"]],
      [CARD, ["cardCompact", "priceRowCompact", "allowanceCompact"]],
    ] as const) {
      for (const st of styles) {
        expect(file, st).toMatch(new RegExp(`compact && s\\.${st}`));
      }
    }
    // Defaults are false, so untouched callers render exactly as before.
    expect(HERO).toMatch(/compact = false/);
    expect(SELECTOR).toMatch(/compact = false/);
    expect(CARD).toMatch(/compact = false/);
  });
});

// ── What compaction is, and is not ──────────────────────────────────────────

describe("what is compressed", () => {
  it("tightens spacing only — the listed values", () => {
    expect(MODAL).toMatch(/dismissible \? 46 : compact \? 6 : 14/);          // top pad 14 → 6
    expect(MODAL).toMatch(/columnCompact: \{ gap: 12 \}/);                  // 20 → 12
    expect(MODAL).toMatch(/plansBlockCompact: \{ gap: 9 \}/);               // 12 → 9
    expect(HERO).toMatch(/heroCompact: \{ gap: 6 \}/);                      // 10 → 6
    expect(HERO).toMatch(/emblemCompact: \{ width: 48, height: 48, borderRadius: 24, marginBottom: 0 \}/); // 66 → 48
    expect(SELECTOR).toMatch(/groupCompact: \{ gap: 7 \}/);                  // 10 → 7
    expect(CARD).toMatch(/cardCompact: \{ paddingTop: 8, paddingBottom: 9 \}/); // 12/13 → 8/9
    expect(CARD).toMatch(/priceRowCompact: \{ marginTop: 3 \}/);
    expect(CARD).toMatch(/allowanceCompact: \{ marginTop: 3 \}/);
  });

  it("shrinks no text and no button", () => {
    // No compact style touches a fontSize, lineHeight or a button's minHeight.
    for (const file of [MODAL, HERO, SELECTOR, CARD]) {
      const compactStyles = [...file.matchAll(/\w+Compact: \{([^}]*)\}/g)].map(m => m[1]);
      for (const body of compactStyles) expect(body).not.toMatch(/fontSize|lineHeight|minHeight/);
    }
    expect(MODAL).toMatch(/freeBtn: \{[\s\S]*?minHeight: 50/);
    expect(read("components/monetization/paywall/PaywallPurchaseButton.tsx")).toMatch(/minHeight: 56/);
  });

  it("removes nothing the offer promises", () => {
    // Annual + Monthly, the equivalent, the billed line, allowances, savings — all still rendered.
    expect(SELECTOR).toMatch(/name="ANNUAL PRO"/);
    expect(SELECTOR).toMatch(/name="MONTHLY PRO"/);
    expect(SELECTOR).toMatch(/equivalent=\{annualMonthlyEquivalent\(annualPricing\)\}/);
    expect(CARD).toMatch(/<Text style=\{s\.billedLine\}>Billed \{billed\}<\/Text>/);
    expect(CARD).toMatch(/<Text style=\{\[s\.allowance, compact && s\.allowanceCompact\]\}>\{allowance\}<\/Text>/);
    expect(SELECTOR).toMatch(/ANNUAL_SCANS|MONTHLY_SCANS/);
    // The two decisions, Restore, and the footer.
    expect(MODAL).toMatch(/<PaywallPurchaseButton/);
    expect(MODAL).toMatch(/onPress=\{continueFree\}/);
    expect(MODAL).toMatch(/onRestore=\{runRestore\}/);
    expect(MODAL).toMatch(/<PaywallFooter/);
    expect(MODAL).toMatch(/<ProBenefits emphasize/);
  });

  it("keeps the offer contract: label from the constant, no X, no Scan Store, not dismissible", () => {
    const cfg = resolvePaywallConfig("onboarding_offer");
    expect(cfg.freeContinueLabel).toBe(`Continue with ${FREE_LIFETIME_SCANS} Free Scans`);
    expect(cfg.dismissible).toBe(false);
    expect(cfg.showScanStoreAlternative).toBe(false);
    expect(MODAL).toMatch(/\{dismissible && \(\s*<Pressable\s*onPress=\{requestClose\}/);
    expect(CONFIG.indexOf("export const FREE_LIFETIME_SCANS")).toBeLessThan(CONFIG.indexOf("const ONBOARDING_OFFER"));
  });

  it("changes no purchase, restore, or activation logic", () => {
    for (const f of ["lib/paywallMachine.ts", "lib/purchases.ts", "lib/revenuecat.ts", "lib/useEntitlement.ts"]) {
      expect(code(read(f))).not.toMatch(/compact/i);
    }
    expect(MODAL).toMatch(/const confirmed = await confirmProWithServer\(\);/);
    expect(MODAL).toMatch(/if \(state\.phase !== "unlocked" \|\| !hasContinuation\) return;/);
    expect(read("lib/onboarding-storage.ts")).toMatch(/export const ONBOARDING_VERSION = 3;/);
  });
});