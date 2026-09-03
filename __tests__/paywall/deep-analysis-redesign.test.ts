/**
 * __tests__/paywall/deep-analysis-redesign.test.ts
 *
 * The Deep Analysis paywall redesign: a truthful teaser, sealed remainder, and
 * no Scan Store.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolvePaywallConfig } from "@/lib/paywallConfig";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
function code(src: string): string {
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

const HERO = read("components/monetization/paywall/heroes/DeepAnalysisHero.tsx");
const SCREEN = read("app/analysis-details.tsx");
const MODAL = read("components/monetization/paywall/ProPaywallModal.tsx");
const BENEF = read("components/monetization/paywall/ProBenefits.tsx");

describe("the teaser is truthful", () => {
  /** Every section it names as sealed must exist on the real screen. */
  it("seals only sections Deep Analysis actually has", () => {
    for (const name of ["Confidence Breakdown", "Where to Sell", "Listing Strategy", "Item Evidence"]) {
      expect(HERO).toContain(name);
      expect(SCREEN).toContain(`title="${name}"`);
    }
  });

  it("opens exactly three insights: verdict, price logic, risk", () => {
    expect(HERO).toContain('title="Why Strong Buy?"');
    expect(HERO).toContain('title="Price Logic"');
    expect(HERO).toContain('title="Risk Flags"');
    expect((code(HERO).match(/<InsightRow /g) ?? []).length).toBe(3);
    // Price Logic and Risk Flags are real section titles.
    expect(SCREEN).toContain('title="Price Logic"');
    expect(SCREEN).toContain('title="Risk Flags"');
  });

  it("uses the app's real verdict vocabulary", () => {
    expect(HERO).toContain('verdict: "STRONG BUY"');
    expect(read("utils/deepAnalysis.ts")).toContain("STRONG BUY");
  });

  /** It opens over a REAL scan — the sample must not read as the user's item. */
  it("is labelled SAMPLE and uses a generic item", () => {
    expect(HERO).toContain("SAMPLE");
    expect(HERO).toMatch(/item: "Vintage Leather Jacket"/);
    expect(code(HERO)).not.toMatch(/flip\.|scan\.|props\.item|route\.params/);
  });

  it("implies more exists, without looking broken", () => {
    expect(HERO).toContain("MORE INSIGHTS WITH PRO");
    expect(HERO).toMatch(/name="lock"/);
    expect(HERO).toMatch(/id="da-fade"/);
    expect(code(HERO)).not.toMatch(/disabled|opacity: 0\.3|Coming soon/i);
  });
});

describe("branding and copy", () => {
  it("leads with FLIPSTART, then DEEP ANALYSIS in gold", () => {
    expect(HERO).toMatch(/<Spark size=\{13\} \/>\s*<Text style=\{s\.brand\}[^>]*>FLIPSTART<\/Text>/);
    expect(HERO).toContain(">DEEP ANALYSIS</Text>");
    expect(HERO).toMatch(/featureLabel: \{[^}]*color: PW\.gold/);
  });

  it("keeps the approved headline and subtitle", () => {
    const c = resolvePaywallConfig("deep_analysis");
    expect(c.headline).toBe("See the Full Picture");
    expect(c.subtitle).toContain("deeper pricing, market, risk, and resale insights");
    expect(HERO).toMatch(/\{config\.headline\}/);
    expect(HERO).toMatch(/\{config\.subtitle\}/);
  });

  it("uses warm brown for supporting text, never a hex grey", () => {
    expect(HERO).toMatch(/subtitle: \{[^}]*color: PW\.brown/);
    expect(code(HERO)).not.toMatch(/#(8|9|A|B)[0-9A-F]{5}\b/i);
  });
});

describe("no Scan Store on this paywall", () => {
  it("is off in config and never rendered", () => {
    expect(resolvePaywallConfig("deep_analysis").showScanStoreAlternative).toBe(false);
    expect(code(HERO)).not.toMatch(/Scan Store|more scans|ScanStoreAlternative/i);
    expect(MODAL).toMatch(/\{!!config\?\.showScanStoreAlternative && \(\s*<ScanStoreAlternative/);
  });
});

describe("benefits emphasis", () => {
  it("quietly rings Deep Analysis when that is what they reached for", () => {
    expect(MODAL).toMatch(/deep_analysis: "deep"/);
    expect(MODAL).toMatch(/<ProBenefits emphasize=\{BENEFIT_FOR_SOURCE\[/);
    expect(BENEF).toMatch(/iconWrapEmphasized: \{[^}]*borderColor: PW\.gold/);
  });

  it("emphasizes nothing on paywalls with no single feature", () => {
    const m = code(MODAL);
    const map = m.slice(m.indexOf("const BENEFIT_FOR_SOURCE"), m.indexOf("};", m.indexOf("const BENEFIT_FOR_SOURCE")));
    expect(map).not.toMatch(/scan_limit|settings_upgrade/);
  });
});

describe("motion", () => {
  it("runs the dossier choreography once, then stays still", () => {
    expect(HERO).toMatch(/stamp\.value = withDelay\(120, withSequence\(/);
    expect(HERO).toMatch(/rows\.value = withDelay\(300, withTiming\(1/);
    expect(HERO).toMatch(/seal\.value = withDelay\(800, withTiming\(1/);
    // The only repeat is the slow eyebrow glint, on its own long cadence.
    expect((code(HERO).match(/withRepeat\(/g) ?? []).length).toBe(1);
    expect(HERO).toMatch(/withDelay\(9800,/);
  });

  it("renders the finished state under Reduce Motion", () => {
    expect(HERO).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(HERO).toMatch(/if \(reduceMotion\) \{ stamp\.value = 1; rows\.value = 1; seal\.value = 1; glint\.value = 0; return; \}/);
    expect(HERO).toMatch(/\{!reduceMotion && \(/);
  });

  it("compresses on short screens", () => {
    expect(HERO).toMatch(/const COMPACT_BELOW = \d+;/);
    expect(HERO).toMatch(/numberOfLines=\{compact \? 1 : 2\}/);
  });
});

describe("monetization is untouched", () => {
  it("keeps the preview funnel and resume-once", () => {
    const gate = read("lib/useDeepAnalysisGate.ts");
    expect(gate).toMatch(/openProPaywall\("deep_analysis", \{ onUnlocked: openOnce \}\)/);
    expect(gate).toMatch(/label: "Try Deep Analysis"/);
    expect(gate).toMatch(/consume\.mutateAsync\(\)/);
  });

  it("never unlocks on StoreKit success alone", () => {
    expect(read("lib/paywallMachine.ts")).toMatch(/both move to "activating"/);
    expect(MODAL).toContain("Activating Pro…");
  });
});