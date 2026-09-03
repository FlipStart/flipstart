/**
 * __tests__/paywall/settings-upgrade.test.ts
 *
 * The Settings entry point: a voluntary paywall with its own hero, and a
 * restore chooser that routes to the two existing recovery flows.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PAYWALL_SOURCES, resolvePaywallConfig } from "@/lib/paywallConfig";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function stripComments(src: string): string {
  let out = ""; let mode: "code"|"line"|"block"|"sq"|"dq"|"tpl" = "code"; let i = 0;
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

const HERO = read("components/monetization/paywall/heroes/SettingsUpgradeHero.tsx");
const SETTINGS = read("app/(tabs)/settings.tsx");
const SU = () => resolvePaywallConfig("settings_upgrade");

describe("settings_upgrade source", () => {
  it("is a real source with its own copy", () => {
    expect(PAYWALL_SOURCES).toContain("settings_upgrade");
    expect(SU().eyebrow).toBe("FLIPSTART PRO");
    expect(SU().ctaLabel).toBe("Upgrade to Pro");
    /**
     * Pinned exactly. The generic-fallback check below is not enough on its own:
     * it would still pass if the headline drifted to any other wording.
     */
    expect(SU().headline).toBe("Unlock FlipStart Pro");
    // ...and still must not be the unrecognised-source fallback.
    expect(SU().headline).not.toBe("Unlock More From Every Find");
  });

  /** Settings already has its own Scan Store row; the paywall must not repeat it. */
  it("does not offer the Scan Store", () => {
    expect(SU().showScanStoreAlternative).toBe(false);
  });

  it("has a registered hero", () => {
    expect(read("components/monetization/paywall/PaywallHero.tsx"))
      .toMatch(/settings_upgrade:\s+SettingsUpgradeHero,/);
  });

  it("contains no trial or fake-discount language", () => {
    const copy = `${SU().headline} ${SU().subtitle} ${SU().ctaLabel}`.toLowerCase();
    for (const bad of ["trial", "59.99", "was $", "save "]) expect(copy).not.toContain(bad);
  });

  it("is reached from the Settings Upgrade row, not scan_limit", () => {
    expect(SETTINGS).toMatch(/openProPaywall\('settings_upgrade'\)/);
    expect(code(SETTINGS)).not.toMatch(/openProPaywall\('scan_limit'\)/);
  });
});

describe("the plaque hero", () => {
  /** One entrance, then still. A looping animation competes with the decision. */
  it("animates once on mount and never loops", () => {
    const c = code(HERO);
    expect(c).not.toMatch(/withRepeat/);
    expect(c).toMatch(/withSequence/);
    expect(c).toMatch(/withDelay/);
  });

  it("renders the finished state under Reduce Motion", () => {
    expect(HERO).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(HERO).toMatch(/if \(reduceMotion\) \{/);
    // Every animated value is forced to its end state.
    expect(HERO).toMatch(/rise\.value = 1; lines\.value = 1; sealIn\.value = 1; sealScale\.value = 1; sheen\.value = 1;/);
  });

  /** The stamp must settle at exactly 1, not an interpolation artefact. */
  it("lands the seal at scale 1", () => {
    expect(HERO).toMatch(/withTiming\(1,\s+\{ duration: 180/);
    expect(HERO).toMatch(/\{ scale: sealScale\.value \}/);
  });

  /** SVG path data has no calc(); percentage rects offset by an inset overflow. */
  it("draws the frame from measured numbers, not CSS", () => {
    const c = code(HERO);
    expect(c).not.toMatch(/calc\(/);
    expect(c).toMatch(/onLayout=\{e => setPlaqueH\(e\.nativeEvent\.layout\.height\)\}/);
    expect(c).toMatch(/<Frame w=\{plaqueW\} h=\{plaqueH\} \/>/);
  });

  it("uses no image assets or new dependencies", () => {
    const c = code(HERO);
    expect(c).not.toMatch(/require\(|\.png|\.jpg|<Image\b/);
    expect(c).not.toMatch(/expo-linear-gradient|lottie|expo-blur|moti/);
  });

  it("names the four Pro capabilities and both allowances", () => {
    for (const t of ["Three-photo scans", "AI Context", "Deep Analysis", "Generate Listings"]) {
      expect(HERO).toContain(t);
    }
    expect(HERO).toContain("300 scans monthly");
    expect(HERO).toContain("4,000 annually");
  });

  /** The seal carries an FS monogram, drawn as paths — not a typeset letter. */
  it("stamps an FS monogram, joined by a diagonal ligature", () => {
    const c = code(HERO);
    // Both letters present as path geometry.
    expect(c).toMatch(/const F =/);
    expect(c).toMatch(/const FS =/);
    // The ligature: F stem base runs straight into the S's entry point.
    expect(c).toMatch(/M \$\{P\(-0\.31, -0\.14\)\} L \$\{S\(0\.75, 0\.20\)\}/);
    // A proper two-bowl S, from a scaled unit template, not freehand curls.
    expect((c.match(/C \$\{S\(/g) ?? []).length).toBe(3);
    // No leftover P monogram, and no <Text> glyph standing in for the mark.
    expect(c).not.toMatch(/Monogram P|>P<\/Text>/);
  });

  it("is described for screen readers as one object", () => {
    expect(HERO).toMatch(/accessibilityLabel="FlipStart Pro membership:/);
  });

  it("compresses on short screens", () => {
    expect(HERO).toMatch(/const COMPACT_BELOW = \d+;/);
  });
});

describe("restore chooser", () => {
  it("offers both restore paths and a cancel", () => {
    expect(SETTINGS).toContain("What would you like to restore?");
    expect(SETTINGS).toMatch(/text: 'Pro Subscription'/);
    expect(SETTINGS).toMatch(/text: 'Scan Packs'/);
    expect(SETTINGS).toMatch(/text: 'Cancel', style: 'cancel'/);
  });

  /** Each option calls an EXISTING flow. No new recovery logic in Settings. */
  it("routes to the two existing recovery functions", () => {
    expect(SETTINGS).toMatch(/restorePurchases\(uidRef\.current, \(\) => uidRef\.current\)/);
    expect(SETTINGS).toMatch(/await recoverPacksOnServer\(\)/);
    const c = code(SETTINGS);
    expect(c).not.toMatch(/purchase_ledger|rc_purchase_id|grantScanPack|setPackBalance/);
  });

  /**
   * No second confirmation. Both flows are idempotent and non-destructive, so a
   * mis-tap costs a spinner, not money; the chooser itself is the confirmation.
   */
  it("does not add a redundant are-you-sure step", () => {
    const c = code(SETTINGS);
    const chooser = c.slice(c.indexOf("const handleRestore"), c.indexOf("const handleRestore") + 900);
    expect(chooser).not.toMatch(/Are you sure|Confirm restore/i);
  });

  it("reports the server's pack count, never a client number", () => {
    expect(SETTINGS).toMatch(/r\.totalScansGranted > 0/);
    expect(SETTINGS).toContain("Your Scan Packs are already up to date.");
  });

  it("declares the callbacks before the chooser references them", () => {
    const c = code(SETTINGS);
    expect(c.indexOf("const restoreSubscription")).toBeLessThan(c.indexOf("const handleRestore"));
    expect(c.indexOf("const restorePacks")).toBeLessThan(c.indexOf("const handleRestore"));
    expect(c).not.toMatch(/eslint-disable/);
  });
});