/**
 * __tests__/monetization/scan-store-cta.test.ts
 *
 * The shopfront button in the Home scan-balance popup: the hero of that
 * popup, on the paywall's brass, with restrained motion — and it still only
 * navigates.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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

const CTA  = read("components/monetization/ScanStoreCTA.tsx");
const HOME = read("app/(tabs)/index.tsx");
const ALT  = read("components/monetization/paywall/ScanStoreAlternative.tsx");

describe("ScanStoreCTA", () => {
  it("wears the paywall Scan Store button's brass: goldStore fill, forest border, forestDeep ink", () => {
    expect(CTA).toMatch(/backgroundColor: PW\.goldStore,/);
    expect(CTA).toMatch(/borderColor: PW\.forest,/);
    expect(CTA).toMatch(/title: \{[^}]*color: PW\.forestDeep/);
    expect(CTA).toMatch(/<MaterialIcons name="style" size=\{19\} color=\{PW\.forestDeep\} \/>/);
    expect(CTA).toMatch(/<MaterialIcons name="chevron-right" size=\{22\} color=\{PW\.forestDeep\}/);
    // Same brass token the approved paywall button uses.
    expect(ALT).toMatch(/backgroundColor: PW\.goldStore,/);
  });

  it("puts no gold marks on the brass — sparks are ink", () => {
    expect(CTA).toMatch(/function InkSpark\(/);
    expect(code(CTA)).not.toMatch(/fill=\{PW\.gold\}/);
  });

  it("enters once per open, gleams slowly while idle, gives under the finger", () => {
    expect(CTA).toMatch(/const ENTER_MS = 420;/);
    expect(CTA).toMatch(/const GLEAM_PERIOD_MS = 6000;/);
    expect(CTA).toMatch(/if \(!visible\) \{ enter\.value = 0; return; \}/);
    expect(CTA).toMatch(/onPressIn=\{\(\) => \{ pressed\.value = withTiming\(1, \{ duration: 90 \}\); \}\}/);
    expect((code(CTA).match(/withRepeat\(/g) ?? []).length).toBe(1);
  });

  it("honours Reduce Motion: no entrance, no gleam, finished state", () => {
    expect(CTA).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(CTA).toMatch(/if \(reduceMotion\) \{ enter\.value = 1; return; \}/);
    expect(CTA).toMatch(/\{!reduceMotion && !disabled && \(/);
  });

  it("uses a per-instance gradient id", () => {
    expect(CTA).toMatch(/useId\(\)/);
    expect(code(CTA)).not.toMatch(/id="[a-z-]+"/);
  });

  it("only navigates — never purchases, never reads a balance", () => {
    expect(code(CTA)).not.toMatch(/purchase|mutateAsync|useEntitlement|packScansRemaining|restorePurchases/i);
  });
});

describe("Home scan-balance popup", () => {
  it("makes the store CTA the hero and Got it the quiet dismiss beneath it", () => {
    const i = HOME.indexOf("<ScanStoreCTA");
    const j = HOME.indexOf("accessibilityLabel=\"Got it\"");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(HOME).toMatch(/dismissBtn: \{ marginTop: 12, paddingVertical: 8, paddingHorizontal: 20 \},/);
    expect(code(HOME)).not.toMatch(/dismissBtn: \{[^}]*backgroundColor: GREEN/);
  });

  it("keeps the navigation contract byte for byte: dismiss, clear intent, then push", () => {
    expect(HOME).toMatch(/<ScanStoreCTA\s+visible=\{showScanModal\}\s+style=\{sm\.storeBtn\}\s+onPress=\{\(\) => \{\s*setShowScanModal\(false\);[\s\S]*?clearScanStoreIntent\(\);\s*router\.push\('\/scan-store' as any\);\s*\}\}/);
    expect(HOME).toMatch(/sm\.storeBtn/);
  });

  it("drives the CTA's motion from the popup's visibility", () => {
    expect(HOME).toMatch(/visible=\{showScanModal\}/);
  });
});