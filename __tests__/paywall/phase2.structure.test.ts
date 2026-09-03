/**
 * __tests__/paywall/phase2.structure.test.ts
 *
 * Structural assertions, read from source text.
 *
 * ── What these are, honestly ────────────────────────────────────────────────
 * These are NOT render tests. Nothing here mounts a component or inspects a
 * tree. Each one reads a file and asserts something about its contents.
 *
 * That is a genuinely weaker guarantee than rendering, and it is stated plainly
 * so nobody later mistakes a green suite for "the paywall was verified on a
 * device". What they DO catch is the regression that actually happens on a
 * codebase like this one: somebody removes the close button, reorders the plan
 * cards, wires a fifth purchase implementation, connects a feature gate early,
 * or "tidies up" the Scan Store placeholder. Those are text-level changes and a
 * text-level test catches them the moment they land.
 *
 * The visual half — how it looks, how VoiceOver reads it, how it behaves at
 * 375pt — is covered by the manual acceptance pass in the dev preview.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/**
 * Strip comments before asserting that something is ABSENT.
 *
 * Learned the hard way on the first run: five of these tests failed because the
 * doc comments say things like "there is no setIsPro anywhere in this
 * component" and "no money-back guarantee". The prose describing a rule matched
 * the regex looking for a violation of it.
 *
 * Negative assertions therefore run against `code()`, positive ones against the
 * raw file. A small state machine rather than a regex, so that `https://` and
 * apostrophes inside strings survive intact.
 */
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

    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i++; continue;
    }

    if (mode === "block") {
      if (c === "*" && n === "/") { mode = "code"; i += 2; } else { i++; }
      continue;
    }

    // Inside a string of some kind.
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c; i++;
  }

  return out;
}

/** Code only, comments removed. Use for every "must NOT contain" assertion. */
const code = (src: string) => stripComments(src);

const MODAL = read("components/monetization/paywall/ProPaywallModal.tsx");
const SELECTOR = read("components/monetization/paywall/PlanSelector.tsx");
const CARD = read("components/monetization/paywall/PlanCard.tsx");
const FOOTER = read("components/monetization/paywall/PaywallFooter.tsx");
const HERO = read("components/monetization/paywall/PaywallHero.tsx");
const BUTTON = read("components/monetization/paywall/PaywallPurchaseButton.tsx");
const PROVIDER = read("components/monetization/paywall/ProPaywallProvider.tsx");
const LAYOUT = read("app/_layout.tsx");
const DEV = read("app/dev-monetization.tsx");
const SCAN_STORE = read("app/scan-store.tsx");
const THEME = read("components/monetization/paywall/paywallTheme.ts");

// ── Presentation ────────────────────────────────────────────────────────────

describe("presentation", () => {
  /** Requirement 1. Full-screen overlay, not an alert or a half sheet. */
  it("presents as a full-screen modal that keeps the screen beneath mounted", () => {
    expect(MODAL).toMatch(/<Modal/);
    expect(MODAL).toMatch(/transparent/);
    expect(MODAL).toMatch(/statusBarTranslucent/);
    // Full-bleed parchment page, painted by the modal's own root view.
    expect(MODAL).toMatch(/page:\s*\{\s*flex:\s*1,\s*backgroundColor:\s*PW\.parchment/);
  });

  it("slides up, and falls back to a plain fade under Reduce Motion", () => {
    expect(MODAL).toMatch(/animationType=\{reduceMotion \? "fade" : "slide"\}/);
  });

  /** Requirement 2 and 4. Dismissal is always available and never buried. */
  it("keeps the close control outside the ScrollView and inside the safe area", () => {
    const closeIdx = MODAL.indexOf('accessibilityLabel="Close"');
    const scrollIdx = MODAL.indexOf("<ScrollView");
    expect(closeIdx).toBeGreaterThan(-1);
    // Rendered BEFORE the scroll container, so scrolling can never hide it.
    expect(closeIdx).toBeLessThan(scrollIdx);
    expect(MODAL).toMatch(/top: topPad \+ 2/);
    expect(MODAL).toMatch(/const topPad = Math\.max\(insets\.top,/);
  });

  it("hands hardware back to the same dismissal path", () => {
    expect(MODAL).toMatch(/onRequestClose=\{requestClose\}/);
  });

  it("keeps the CTA clear of the home indicator", () => {
    expect(MODAL).toMatch(/const bottomPad = Math\.max\(insets\.bottom,/);
    expect(MODAL).toMatch(/paddingBottom: bottomPad \+/);
  });

  /** Requirement 3. */
  it("renders a generic hero that is isolated for replacement", () => {
    expect(HERO).toMatch(/export function GenericHero/);
    // The copy lives in the config, not the component — which is exactly the
    // split that lets Phase 3 swap heroes without touching wording.
    const cfg = read("lib/paywallConfig.ts");
    expect(cfg).toContain("Unlock More From Every Find");
    expect(cfg).toContain("FLIPSTART PRO");
    expect(HERO).toMatch(/\{config\.headline\}/);
    expect(HERO).toMatch(/\{config\.eyebrow\}/);
    // The source→hero map exists so Phase 3 is an addition, not a refactor.
    expect(HERO).toMatch(/const HEROES/);
  });

  it("puts no feature checklist in the foundation", () => {
    // The explicit failure condition from the brief.
    expect(code(HERO)).not.toMatch(/✓|checkmark|FEATURES INCLUDED/i);
    expect(code(MODAL)).not.toMatch(/✓/);
  });
});

// ── Plan selection ──────────────────────────────────────────────────────────

describe("plan selection", () => {
  /** Requirements 5 and 6. Order is literal JSX, not a sorted array. */
  it("renders Annual before Monthly", () => {
    const annual = SELECTOR.indexOf('name="ANNUAL PRO"');
    const monthly = SELECTOR.indexOf('name="MONTHLY PRO"');
    expect(annual).toBeGreaterThan(-1);
    expect(monthly).toBeGreaterThan(-1);
    expect(annual).toBeLessThan(monthly);
  });

  /** Requirement 7. */
  it("selects Annual by default, on every open", () => {
    expect(MODAL).toMatch(/useState<PurchaseTarget>\("annual"\)/);
    expect(MODAL).toMatch(/setSelected\("annual"\); \/\/ Annual is the default/);
  });

  /** Requirement 9. One selected plan, derived from a single value. */
  it("derives both cards' selection from one piece of state", () => {
    expect(SELECTOR).toMatch(/selected=\{selected === "annual"\}/);
    expect(SELECTOR).toMatch(/selected=\{selected === "monthly"\}/);
  });

  /** Requirement 10. */
  it("puts the Best Value seal on Annual only", () => {
    const annualBlock = SELECTOR.slice(
      SELECTOR.indexOf('name="ANNUAL PRO"'),
      SELECTOR.indexOf('name="MONTHLY PRO"'),
    );
    expect(annualBlock).toMatch(/\bpreferred\b/);
    const monthlyBlock = SELECTOR.slice(SELECTOR.indexOf('name="MONTHLY PRO"'));
    expect(monthlyBlock).not.toMatch(/\bpreferred\b/);
    // The badge is inline now, still gated on `preferred` — Annual only.
    expect(CARD).toMatch(/\{preferred && \(\s*<View style=\{s\.badge\}>/);
    expect(CARD).toContain('BEST VALUE');
  });

  /** Requirement 29. Selectable controls, not coloured rectangles. */
  it("exposes plan cards as accessible radios inside a radiogroup", () => {
    expect(CARD).toMatch(/accessibilityRole="radio"/);
    expect(CARD).toMatch(/accessibilityState=\{\{ selected/);
    expect(CARD).toMatch(/accessibilityLabel=\{a11y\}/);
    expect(SELECTOR).toMatch(/accessibilityRole="radiogroup"/);
  });

  it("does not put a purchase button on either card", () => {
    expect(code(CARD)).not.toMatch(/Subscribe|Buy now|purchasePackage/i);
  });

  it("locks plan switching while a transaction is in flight", () => {
    expect(SELECTOR).toMatch(/locked=\{busy\}|locked:\s*boolean/);
    expect(MODAL).toMatch(/locked=\{busy\}/);
    expect(MODAL).toMatch(/if \(busy \|\| !config\) return;/);
  });
});

// ── Pricing presentation ────────────────────────────────────────────────────

describe("pricing presentation", () => {
  /** Requirements 11 and 12. */
  it("shows a skeleton rather than a placeholder price", () => {
    expect(CARD).toMatch(/priceLabel \?/);
    expect(CARD).toMatch(/<Skeleton/);
    // No hardcoded production prices anywhere in the rendering path.
    for (const src of [CARD, SELECTOR, MODAL, BUTTON, FOOTER, HERO]) {
      expect(code(src)).not.toMatch(/\$7\.99|\$39\.99/);
    }
  });

  it("reserves the price row's height so resolving prices does not reflow", () => {
    expect(CARD).toMatch(/priceSkeleton/);
  });
});

// ── Purchase engine ─────────────────────────────────────────────────────────

describe("purchase engine", () => {
  /** Requirements 14, 15 and the "do not write a second implementation" rule. */
  it("routes purchase and restore through the centralized service only", () => {
    expect(MODAL).toMatch(
      /import \{[\s\S]*?purchase,[\s\S]*?restorePurchases,[\s\S]*?\} from "@\/lib\/purchases"/,
    );
    // No direct SDK access anywhere in the paywall.
    for (const src of [MODAL, PROVIDER, CARD, SELECTOR, BUTTON, FOOTER, HERO]) {
      expect(code(src)).not.toMatch(/react-native-purchases/);
      expect(code(src)).not.toMatch(/Purchases\.(purchasePackage|restorePurchases|logIn|logOut)/);
    }
  });

  it("passes the captured uid and a live getter for the re-check", () => {
    expect(MODAL).toMatch(/const startedUid = user\?\.id \?\? null;/);
    expect(MODAL).toMatch(/purchase\(target, startedUid, \(\) => user\?\.id \?\? null\)/);
    expect(MODAL).toMatch(/restorePurchases\(startedUid, \(\) => user\?\.id \?\? null\)/);
  });

  /** Requirement 19. The rule the whole engine exists to protect. */
  it("never grants Pro from a client response", () => {
    expect(code(MODAL)).not.toMatch(/setIsPro|isPro\s*=\s*true|grantPro/);
    // Only the server's plan resolves the paywall.
    expect(MODAL).toMatch(/plan === "monthly" \|\| plan === "annual"/);
  });

  /** Requirement 18 and 20. Bounded, never infinite. */
  it("bounds the activation wait", () => {
    expect(MODAL).toMatch(/const ACTIVATION_ATTEMPTS = \d+;/);
    expect(MODAL).toMatch(/for \(let i = 0; i < ACTIVATION_ATTEMPTS; i\+\+\)/);
    expect(code(MODAL)).not.toMatch(/while \(true\)|setInterval/);
  });

  /** Requirement 16, second layer — the first is canPurchase(). */
  it("keeps the module-level in-flight guard as the outer defence", () => {
    const purchases = read("lib/purchases.ts");
    expect(purchases).toMatch(/let inFlight = false;/);
    expect(purchases).toMatch(/if \(inFlight\)/);
  });

  it("invalidates entitlement for every other consumer after a transaction", () => {
    expect(MODAL).toMatch(/useRefreshEntitlement/);
    expect(MODAL).toMatch(/await invalidateEntitlement\(\)/);
  });

  /** Requirement 25. */
  it("resets the visible state if the account changes mid-session", () => {
    expect(MODAL).toMatch(/uidRef/);
    expect(MODAL).toMatch(/setState\(INITIAL_STATE\)/);
  });
});

// ── Restore & footer ────────────────────────────────────────────────────────

describe("restore and footer", () => {
  /** Requirement 21. Text action, not a competing button. */
  it("offers Restore Purchases as a text action near the bottom", () => {
    expect(FOOTER).toContain("Restore Purchases");
    expect(FOOTER).toMatch(/restoreBtn/);
    expect(code(FOOTER)).not.toMatch(/backgroundColor: PW\.forest/);
  });

  it("prevents repeated restore taps", () => {
    expect(FOOTER).toMatch(/disabled=\{restoreDisabled \|\| restoreBusy\}/);
    expect(FOOTER).toMatch(/restoreBusy \? "Restoring…"/);
  });

  it("makes only claims that are true", () => {
    expect(code(FOOTER)).not.toMatch(/money.?back|risk.?free|guarantee/i);
    expect(FOOTER).toContain("Secure App Store purchase");
    expect(FOOTER).toContain("Cancel anytime");
  });

  it("reuses the app's existing legal URLs rather than inventing pages", () => {
    const settings = read("app/(tabs)/settings.tsx");
    expect(settings).toContain("https://flipstartapp.com/privacy");
    expect(settings).toContain("https://flipstartapp.com/terms");
    expect(FOOTER).toContain("https://flipstartapp.com/privacy");
    expect(FOOTER).toContain("https://flipstartapp.com/terms");
  });

  it("builds the disclosure from the selected plan's live price", () => {
    expect(MODAL).toMatch(/renewalDisclosure\(selectedProduct\.pricing/);
  });
});

// ── Accessibility ───────────────────────────────────────────────────────────

describe("accessibility", () => {
  /** Requirement 28. */
  it("follows the project's Reduce Motion convention", () => {
    expect(MODAL).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
    expect(MODAL).toMatch(/addEventListener\("reduceMotionChanged", setReduceMotion\)/);
    expect(MODAL).toMatch(/sub\?\.remove\?\.\(\)/);
  });

  /** Requirement 30. */
  it("labels every control and gives text actions a real target", () => {
    expect(MODAL).toMatch(/accessibilityLabel="Close"/);
    expect(BUTTON).toMatch(/accessibilityRole="button"/);
    expect(BUTTON).toMatch(/accessibilityState=\{\{ disabled: inert, busy \}\}/);
    expect(FOOTER).toMatch(/accessibilityLabel="Restore purchases"/);
    expect(FOOTER).toMatch(/hitSlop=\{12\}/);
    // 44pt-class targets on the primary action.
    // Raised to 56 in the redesign — still well above the 44pt minimum.
    expect(BUTTON).toMatch(/minHeight: 56/);
  });

  it("announces state changes rather than silently swapping copy", () => {
    expect(MODAL).toMatch(/accessibilityLiveRegion="polite"/);
  });
});

// ── Visual identity ─────────────────────────────────────────────────────────

describe("visual identity", () => {
  it("uses the shipped FlipStart palette, not a new one", () => {
    // Read out of app/(tabs)/index.tsx.
    expect(THEME).toContain("#F4EED8"); // parchment
    expect(THEME).toContain("#214D2D"); // forest
    expect(THEME).toContain("#C4A334"); // gold
    expect(THEME).toContain("#6F5A3E"); // brown
    expect(THEME).toContain("#FFFEFA"); // card
  });

  it("avoids the black-and-gold SaaS failure mode", () => {
    for (const src of [THEME, CARD, MODAL, BUTTON, HERO]) {
      expect(code(src)).not.toMatch(/#000000|#0A0A0A|#111111/);
      expect(code(src)).not.toMatch(/blurRadius|BlurView|backdropFilter/);
    }
  });

  it("adds no gradient dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["expo-linear-gradient"]).toBeUndefined();
    for (const src of [MODAL, CARD, BUTTON, HERO]) {
      expect(code(src)).not.toMatch(/expo-linear-gradient/);
    }
  });

  it("uses the app's serif for headings and plan names", () => {
    for (const src of [HERO, CARD, BUTTON, SELECTOR]) {
      expect(src).toMatch(/FONTS\.serif/);
    }
  });
});

// ── Regression ──────────────────────────────────────────────────────────────

describe("regression", () => {
  /** Requirement 31. ProGate stays wired at all four gates. */
  /**
   * Superseded by Phases 3-6: every gate has migrated.
   *
   * ProGate itself remains mounted and is still the Deep Analysis lifetime
   * preview OFFER, so the provider must stay — that is what this now pins.
   */
  it("keeps ProGate mounted for the Deep Analysis preview offer", () => {
    expect(LAYOUT).toMatch(/<ProGateProvider>/);
    expect(read("lib/useDeepAnalysisGate.ts")).toMatch(/openProGate\("deep_analysis", \{/);
    expect(read("app/results.tsx")).toMatch(/useDeepAnalysisGate/);
  });

  /**
   * Superseded by Phases 3-5, and replaced with the stronger claim.
   *
   * When this was written, no gate had migrated. All of them now have, so
   * asserting absence is meaningless. What IS worth pinning is the inverse:
   * the only ProGate calls left anywhere are the two that legitimately remain —
   * the Deep Analysis lifetime-preview OFFER, and AI Context, which is Phase 6.
   */
  it("leaves ProGate only where it legitimately belongs", () => {
    const allowed = new Map<string, string[]>([
      // The Deep Analysis lifetime-preview OFFER. Every other gate has migrated
      // to its contextual paywall as of Phase 6.
      ["lib/useDeepAnalysisGate.ts", ["deep_analysis"]],
    ]);

    const found = new Map<string, string[]>();
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (rel === "components/monetization/ProGate.tsx") continue; // the component
        const hits = [...code(read(rel)).matchAll(/openProGate\(\s*['"]([a-z_]+)['"]/g)].map(m => m[1]);
        if (hits.length) found.set(rel, hits.sort());
      }
    };
    for (const d of ["app", "components", "lib", "hooks"]) walk(d);

    expect([...found.keys()].sort()).toEqual([...allowed.keys()].sort());
    for (const [file, features] of found) {
      expect(features).toEqual(allowed.get(file));
    }
  });

  /** Requirement 32. */
  /**
   * Superseded by Phase 8 — the placeholder became the real Scan Store.
   *
   * What still matters is that the store never grants anything itself: the
   * server resolves quantity from the canonical RevenueCat V2 purchase.
   */
  it("keeps the Scan Store free of client-side granting", () => {
    const store = read("app/scan-store.tsx");
    expect(store).toContain("Scan Store");
    expect(code(store)).not.toMatch(/purchase_ledger|rc_purchase_id|setPackBalance|balance\s*\+=/);
  });

  /** Requirement 33. */
  it("adds no scan-pack purchasing to the paywall", () => {
    for (const src of [MODAL, CARD, SELECTOR, FOOTER, HERO, BUTTON]) {
      expect(code(src)).not.toMatch(/purchaseScanPack|SCAN_PACK_SKUS|scan_packs/);
    }
  });

  /** Requirement 34. Nothing server-side moved. */
  it("changes no server monetization code", () => {
    const policy = read("server/monetization/policy.ts");
    expect(code(policy)).not.toMatch(/paywall/i);
  });

  /**
   * Regression: isTerminal must stay a TYPE PREDICATE.
   *
   * It shipped as `: boolean` and compiled fine in isolation, then failed at
   * the call site — `<ResolutionPanel phase={state.phase} />` cannot narrow
   * PaywallPhase to the two terminal phases unless the guard tells the compiler
   * what it proved. Reverting it to boolean would break the build again, so it
   * is pinned here.
   */
  it("keeps isTerminal a type predicate so the modal narrows", () => {
    const machine = read("lib/paywallMachine.ts");
    expect(machine).toMatch(
      /export function isTerminal\(phase: PaywallPhase\): phase is TerminalPhase/,
    );
    expect(machine).toMatch(/export type TerminalPhase = Extract<PaywallPhase/);
    // And the panel consumes the exported type rather than repeating the union.
    expect(MODAL).toMatch(/phase: TerminalPhase;/);
    expect(code(MODAL)).not.toMatch(/phase: "unlocked" \| "pending_activation"/);
  });

  it("mounts the paywall provider inside the tRPC tree", () => {
    const trpcIdx = LAYOUT.indexOf("<trpc.Provider");
    const paywallIdx = LAYOUT.indexOf("<ProPaywallProvider>");
    expect(trpcIdx).toBeGreaterThan(-1);
    expect(paywallIdx).toBeGreaterThan(trpcIdx);
  });

  /** The dev preview must not be reachable in production navigation. */
  it("keeps the preview behind the existing harness guard", () => {
    expect(DEV).toMatch(/openProPaywall/);
    expect(DEV).toMatch(/<ProPaywallHost \/>/);
    expect(LAYOUT).toMatch(
      /<Stack\.Protected guard=\{__DEV__ \|\| MONETIZATION_HARNESS_VISIBLE\}>/,
    );
    expect(DEV).toMatch(/if \(!__DEV__ && !MONETIZATION_HARNESS_VISIBLE\)/);
  });

  it("never simulates a purchase in the preview", () => {
    expect(code(DEV)).not.toMatch(/fakePurchase|simulatePro|mockEntitlement/i);
  });
});