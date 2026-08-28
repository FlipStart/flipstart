/**
 * __tests__/paywall/phase3.structure.test.ts
 *
 * Phase 3 structural assertions.
 *
 * ── Honest about what these are ─────────────────────────────────────────────
 * Source-text assertions, not render tests. Nothing here mounts a screen or
 * simulates a tap. Each reads a file and asserts something about its contents.
 *
 * That is weaker than rendering, and it is the right tool for THIS phase's
 * biggest risk. The brief's central warning is "do NOT fix one button while
 * another still uses ProGate or direct mutation" — a text-level fact about
 * three files, caught the moment a fourth entry point appears or one regresses.
 *
 * The visual half — how the hero looks, how it behaves on an SE, what VoiceOver
 * reads — is the manual acceptance pass in the dev preview, and these tests do
 * not pretend to cover it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Strip comments before asserting ABSENCE — prose describing a rule matches a
 *  regex hunting for its violation. Learned the hard way in Phase 2. */
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

/** The three screens the audit found. */
const ENTRY_POINTS = [
  "app/results.tsx",
  "app/scan-detail.tsx",
  "app/analysis-details.tsx",
] as const;

const GATE = read("lib/useGenerateListingsGate.ts");
const HERO = read("components/monetization/paywall/heroes/GenerateListingsHero.tsx");
const HERO_MAP = read("components/monetization/paywall/PaywallHero.tsx");
const MODAL = read("components/monetization/paywall/ProPaywallModal.tsx");
const PROVIDER = read("components/monetization/paywall/ProPaywallProvider.tsx");
const DEV = read("app/dev-monetization.tsx");

// ── Entry-point audit ───────────────────────────────────────────────────────

describe("entry-point coverage", () => {
  /**
   * The audit's central finding, pinned.
   *
   * If a fourth screen ever calls trpc.scan.generateListings, this fails and
   * points straight at it — which is the exact failure mode the brief warns
   * about.
   */
  it("only the three audited screens call the generateListings mutation", () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (code(read(rel)).includes("scan.generateListings")) callers.push(rel);
      }
    };
    for (const d of ["app", "components", "lib", "hooks"]) walk(d);
    expect(callers.sort()).toEqual([...ENTRY_POINTS].sort());
  });

  /** Requirement 32+. Every entry point uses the shared gate. */
  it("every entry point routes through the shared gate hook", () => {
    for (const f of ENTRY_POINTS) {
      const src = read(f);
      expect(src).toMatch(/useGenerateListingsGate/);
      expect(src).toMatch(/openGenerateListings\(\{/);
    }
  });

  /**
   * The "do not fix one button" rule.
   *
   * No entry point may still reach ProGate for this feature — that would leave
   * one screen on the old temporary gate while the others moved on.
   */
  it("no entry point still opens ProGate for generate_listings", () => {
    for (const f of ENTRY_POINTS) {
      expect(code(read(f))).not.toMatch(/openProGate\(\s*['"]generate_listings['"]/);
    }
  });

  /** Requirement 9/11. The mutation is never fired straight from a tap. */
  it("no entry point calls the mutation outside its gated run function", () => {
    for (const f of ENTRY_POINTS) {
      const src = code(read(f));
      // The mutation appears only inside the function the gate invokes.
      expect(src).toMatch(/generateListingsMutation\.mutateAsync/);
      // ...and the press handler goes to the gate, never straight to the work.
      expect(src).not.toMatch(/onPress=\{\s*\(\)\s*=>\s*generateListingsMutation/);
    }
  });

  /**
   * Existing content is ungated at EVERY entry point.
   *
   * The rule lives in the hook, but each screen has to hand it the two pieces
   * only that screen knows: whether listings exist, and how to show them. A
   * screen that forgets is a screen where Free users get paywalled on "View
   * Listings" again.
   */
  it("every entry point supplies the ungated view-existing path", () => {
    for (const f of ENTRY_POINTS) {
      const src = read(f);
      expect(src).toMatch(/hasExisting: \(\) =>/);
      expect(src).toMatch(/viewExisting: \(\) => setListingsOpen\(true\)/);
    }
  });

  /** Requirement 13/28. Item identity travels with the continuation. */
  it("every entry point passes a live item-identity ref", () => {
    for (const f of ENTRY_POINTS) {
      const src = read(f);
      // Name-agnostic: results and scan-detail renamed this to itemContextRef
      // in Phase 4 once Deep Analysis shared the same identity.
      expect(src).toMatch(/const \w*ContextRef = useRef<string \| null>\(null\)/);
      expect(src).toMatch(/\w*ContextRef\.current =/);
      expect(src).toMatch(/contextRef: \w*ContextRef/);
    }
  });

  /**
   * Rules of hooks.
   *
   * Two of these screens return early when the item is missing (deleted
   * mid-view). A useRef added below that return changes the hook count between
   * renders and crashes with "Rendered more hooks than during the previous
   * render" — which is exactly what happened on the first attempt here.
   */
  it("declares the ref hook above every early return", () => {
    for (const f of ENTRY_POINTS) {
      // \r stripped first: these files are CRLF, and a `$` anchor silently
      // never matches a line ending in "{\r". The first version of this test
      // passed against a deliberately broken file for exactly that reason.
      const lines = read(f).split("\n").map(l => l.replace(/\r$/, ""));
      const hook = lines.findIndex(l => /const \w*ContextRef = useRef/.test(l));
      const early = lines.findIndex(l => /^  if \(![\w.?]+( \|\| ![\w.?]+)*\) \{$/.test(l));

      expect(hook).toBeGreaterThan(-1);
      // Every one of these screens HAS an early return, so a miss means the
      // pattern drifted and the test has gone quiet — fail rather than skip.
      expect(early).toBeGreaterThan(-1);
      expect(hook).toBeLessThan(early);
    }
  });
});

// ── The gate's rules ────────────────────────────────────────────────────────

describe("gate behaviour", () => {
  /** Requirement 12/13. Pro goes straight through, no paywall flash. */
  it("runs immediately for a resolved Pro user", () => {
    expect(GATE).toMatch(/decideGenerateListingsAction\(\{/);
    expect(GATE).toMatch(/current\.can\("generate_listings"\)/);
    expect(GATE).toMatch(/if \(action === "run"\)/);
  });

  /**
   * Existing content short-circuits BEFORE anything entitlement-related.
   *
   * Order is the substance of this rule: if the view branch ever moved below
   * the paywall branch, a Free user would be gated on content they already
   * own. Asserted positionally, not just by presence.
   */
  it("returns view_existing before any paywall or run branch", () => {
    const view = GATE.indexOf('if (action === "view_existing")');
    const run = GATE.indexOf('if (action === "run")');
    const pay = GATE.indexOf('if (action === "paywall")');
    expect(view).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(-1);
    expect(pay).toBeGreaterThan(-1);
    expect(view).toBeLessThan(run);
    expect(view).toBeLessThan(pay);
  });

  /** The view path must be a local read — never the mutation. */
  it("the view-existing branch calls only the caller's local viewer", () => {
    const start = GATE.indexOf('if (action === "view_existing")');
    const branch = GATE.slice(start, start + 160);
    expect(branch).toMatch(/viewExisting\?\.\(\);/);
    expect(branch).not.toMatch(/run\(\)|mutateAsync|generateListings\(/);
  });

  /**
   * Requirement 10/11 — Free + Packs.
   *
   * The gate asks can("generate_listings"), which the server computes from PLAN
   * alone. Pack balance is not a parameter anywhere in that path, so a Free
   * account holding thousands of pack scans still lands on the paywall.
   */
  it("decides on capability, never on scan balance", () => {
    expect(code(GATE)).not.toMatch(/packScansRemaining|totalUsableScans|outOfScans/);
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/case "generate_listings":\s*\n\s*case "deep_analysis":\s*return pro;/);
    expect(policy).toMatch(/Pack ownership is not a parameter here/);
  });

  /** Requirement 8. Free opens THIS paywall, with the right source. */
  it("opens the contextual paywall for Free", () => {
    expect(GATE).toMatch(/openProPaywall\("generate_listings", \{ onUnlocked: runOnce \}\)/);
  });

  /**
   * Requirement 30/31.
   *
   * The hook performs the single refetch; the plan rules live in the pure
   * decision module so they can be asserted behaviourally rather than by
   * regex — see phase3.existing-content.test.ts.
   */
  it("resolves an unknown entitlement once, then fails closed", () => {
    expect(GATE).toMatch(/await entRef\.current\.refresh\(\)/);
    expect(GATE).toMatch(/decideAfterResolve\(plan\)/);
    // No loop, no polling, no cached guess.
    expect(code(GATE)).not.toMatch(/while \(|setInterval|for \(/);

    const decision = read("lib/generateListingsDecision.ts");
    expect(decision).toMatch(/plan === "monthly" \|\| plan === "annual"/);
    expect(decision).toMatch(/if \(plan === "free"\) return "paywall";/);
    // Unknown returns null — never a silent "run".
    expect(decision).toMatch(/return null;/);
  });

  /** The decision module must stay importable from a bare test runner. */
  it("the decision module has no imports at all", () => {
    const decision = code(read("lib/generateListingsDecision.ts"));
    expect(decision).not.toMatch(/^\s*import /m);
    expect(decision).not.toMatch(/require\(/);
  });

  /** Requirement 20/22. Exactly once, at the call-site layer. */
  it("guards the continuation with a one-shot flag", () => {
    expect(GATE).toMatch(/let fired = false;/);
    expect(GATE).toMatch(/if \(fired\) return;/);
    expect(GATE).toMatch(/fired = true;/);
  });

  /** Requirement 27/28. Identity and item both checked before continuing. */
  it("verifies user and item identity immediately before continuing", () => {
    expect(GATE).toMatch(/const stillValid = \(\): boolean =>/);
    expect(GATE).toMatch(/if \(\(uidRef\.current \?\? null\) !== openedUid\) return false;/);
    expect(GATE).toMatch(/contextRef && \(contextRef\.current \?\? null\) !== openedContext/);
    expect(GATE).toMatch(/if \(!stillValid\(\)\) return;/);
  });

  it("never grants Pro locally", () => {
    expect(code(GATE)).not.toMatch(/setIsPro|isPro\s*=\s*true|grantPro/);
  });
});

// ── Exactly-once, at the provider layer ─────────────────────────────────────

describe("exactly-once continuation", () => {
  /**
   * Requirement 20. Two independent layers.
   *
   * The provider hands the callback out once per request id; the gate refuses
   * to fire twice. Either alone would do in the common case — a duplicate here
   * is a duplicate AI charge and a duplicate listing, so both are present.
   */
  it("the provider hands out each continuation only once", () => {
    expect(PROVIDER).toMatch(/const consumedRef = useRef<Set<number>>\(new Set\(\)\)/);
    expect(PROVIDER).toMatch(/if \(consumedRef\.current\.has\(req\.id\)\) return null;/);
    expect(PROVIDER).toMatch(/consumedRef\.current\.add\(req\.id\);/);
  });

  it("the modal claims through the provider, never from the request directly", () => {
    expect(MODAL).toMatch(/const fn = consumeUnlock\(\);/);
    // Reading request.onUnlocked to CALL it would bypass the one-shot claim.
    expect(code(MODAL)).not.toMatch(/request\?\.onUnlocked\?\.\(\)/);
    expect(code(MODAL)).not.toMatch(/const fn = request\?\.onUnlocked/);
  });

  /** Requirement 18/19. Dismisses and continues on its own. */
  it("auto-continues from a confirmed unlock only", () => {
    expect(MODAL).toMatch(/if \(state\.phase !== "unlocked" \|\| !hasContinuation\) return;/);
    expect(MODAL).toMatch(/setTimeout\(\(\) => continueUnlocked\(\), AUTO_CONTINUE_MS\)/);
    expect(MODAL).toMatch(/clearTimeout\(t\)/);
  });

  /** Requirement 14. Closing must never continue. */
  it("the close button dismisses without continuing", () => {
    expect(MODAL).toMatch(/const requestClose = useCallback\(\(\) => \{/);
    expect(MODAL).toMatch(/dismiss\(false\);/);
  });
});

// ── Hero ────────────────────────────────────────────────────────────────────

describe("contextual hero", () => {
  it("is registered for generate_listings and nothing else", () => {
    expect(HERO_MAP).toMatch(/generate_listings: GenerateListingsHero,/);
    // deep_analysis gained its own hero in Phase 4; the rest stay commented out.
    for (const s of ["third_photo", "camera_context", "scan_limit"]) {
      expect(HERO_MAP).toMatch(new RegExp(`//\\s*${s}:`));
    }
  });

  it("tells the find → listings story with both marketplaces", () => {
    expect(HERO).toContain("YOUR FIND");
    expect(HERO).toContain('platform="eBay"');
    expect(HERO).toContain('platform="Depop"');
    expect(HERO).toContain("READY TO EDIT");
  });

  it("uses no image, logo or new package", () => {
    expect(code(HERO)).not.toMatch(/require\(|\.png|\.jpg|\.svg['"]|Image\b/);
    expect(code(HERO)).not.toMatch(/expo-linear-gradient|lottie|react-native-reanimated/);
  });

  it("stays inside the FlipStart palette", () => {
    expect(HERO).toMatch(/from "\.\.\/paywallTheme"/);
    expect(code(HERO)).not.toMatch(/#000000|#0A0A0A|#111111|BlurView|backdropFilter/);
  });

  it("is decorative and hidden from screen readers", () => {
    expect(HERO).toMatch(/accessibilityElementsHidden/);
    expect(HERO).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  /** No motion at all, so nothing needs a Reduce Motion branch. */
  it("adds no animation", () => {
    expect(code(HERO)).not.toMatch(/Animated\.|useSharedValue|withTiming|withRepeat|LayoutAnimation/);
  });

  /** Hero compresses rather than pushing the purchase section off screen. */
  it("compresses on short screens instead of crushing the plans", () => {
    expect(HERO).toMatch(/const COMPACT_BELOW = \d+;/);
    expect(HERO).toMatch(/const compact = height < COMPACT_BELOW;/);
  });

  /** The brief's explicit failure mode. */
  it("contains no Pro feature checklist", () => {
    expect(code(HERO)).not.toMatch(/✓/);
    expect(code(HERO)).not.toMatch(/Deep Analysis|AI Context|3-photo|4,000|300 scans/);
  });
});

// ── Dev preview ─────────────────────────────────────────────────────────────

describe("dev preview", () => {
  it("can preview generate_listings through the existing source picker", () => {
    expect(DEV).toMatch(/PAYWALL_SOURCES/);
    expect(DEV).toMatch(/openProPaywall\(previewSource/);
    expect(DEV).toMatch(/<ProPaywallHost \/>/);
  });

  it("stays development-only", () => {
    expect(DEV).toMatch(/if \(!__DEV__ && !MONETIZATION_HARNESS_VISIBLE\)/);
    expect(read("app/_layout.tsx")).toMatch(
      /<Stack\.Protected guard=\{__DEV__ \|\| MONETIZATION_HARNESS_VISIBLE\}>/,
    );
  });

  it("creates no second preview screen", () => {
    const devScreens = readdirSync(path.join(root, "app"))
      .filter(f => /^dev-.*paywall/i.test(f));
    expect(devScreens).toEqual([]);
  });
});

// ── Regression ──────────────────────────────────────────────────────────────

describe("regression", () => {
  /** The three gates that must NOT have moved yet. */
  /**
   * Superseded by Phase 4.
   *
   * Deep Analysis now has its contextual paywall. The ONE surviving ProGate
   * call is the lifetime-preview offer, which is an offer surface rather than a
   * gate — asserted in detail in phase4.structure.test.ts.
   */
  it("Deep Analysis keeps ProGate only for the lifetime preview offer", () => {
    const hook = read("lib/useDeepAnalysisGate.ts");
    expect(hook).toMatch(/openProPaywall\("deep_analysis"/);
    expect(hook).toMatch(/label: "View Preview"/);
  });

  it("Third Photo and AI Context still use the temporary ProGate", () => {
    const camera = read("app/camera.tsx");
    expect(camera).toMatch(/openProGate\(\s*['"]third_photo['"]/);
    expect(camera).toMatch(/openProGate\(\s*['"]camera_context['"]/);
    expect(code(camera)).not.toMatch(/openProPaywall/);
  });

  it("ProGate itself is untouched and still mounted", () => {
    expect(read("app/_layout.tsx")).toMatch(/<ProGateProvider>/);
    expect(read("components/monetization/ProGate.tsx")).toMatch(/generate_listings: 'Generate Listings'/);
  });

  /** Requirement 15. Server enforcement precedes the model call. */
  it("the server still rejects Free before any AI work", () => {
    const routers = read("server/routers.ts");
    const check = routers.indexOf('requireFeature(muid, "generate_listings")');
    const ai = routers.indexOf("generateItemListings({");
    expect(check).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(-1);
    // The entitlement check must come FIRST in the procedure body.
    expect(check).toBeLessThan(ai);
    expect(routers).toMatch(/code: "PRO_REQUIRED"/);
  });

  it("the capability matrix is unchanged", () => {
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/export const FREE_LIFETIME_SCANS = 15;/);
    expect(policy).toMatch(/export const MONTHLY_SCANS = 300;/);
    expect(policy).toMatch(/export const ANNUAL_SCANS = 4_000;/);
  });

  it("Sold Comps and Hunt Mode remain ungated", () => {
    expect(read("server/monetization/policy.ts")).toMatch(
      /case "sold_comps":\s*\n\s*case "hunt_mode":\s*return true;/,
    );
  });

  /** Requirement 17. */
  it("the Scan Store placeholder is untouched", () => {
    const store = read("app/scan-store.tsx");
    expect(store).toContain("Scan Store coming soon.");
    expect(code(store)).not.toMatch(/purchaseScanPack|SCAN_PACK_SKUS|RevenueCat|Restore/);
  });

  it("no scan-pack commerce entered the paywall", () => {
    for (const src of [MODAL, HERO, GATE]) {
      expect(code(src)).not.toMatch(/purchaseScanPack|SCAN_PACK_SKUS|scan_packs/);
    }
  });

  /** Analytics source must survive the whole lifecycle. */
  it("keeps paywall_source on every lifecycle event", () => {
    const analytics = read("lib/paywallAnalytics.ts");
    expect(analytics).toMatch(/paywall_source: source/);
    for (const e of [
      "paywall_opened",
      "paywall_purchase_started",
      "paywall_purchase_completed",
      "paywall_purchase_cancelled",
      "paywall_dismissed",
    ]) {
      expect(analytics).toContain(e);
    }
  });

  it("adds no new analytics SDK", () => {
    expect(read("lib/paywallAnalytics.ts")).toMatch(/from "@\/lib\/analytics"/);
  });
});