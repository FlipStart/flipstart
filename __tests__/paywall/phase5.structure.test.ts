/**
 * __tests__/paywall/phase5.structure.test.ts
 *
 * Phase 5 structural assertions.
 *
 * Source-text assertions, not render tests — the same honest limitation as
 * earlier phases. What they cover is this phase's specific danger: a pending
 * library image that leaks into active photo state would reach the analyze
 * payload and the model. That is a text-level fact about camera.tsx, and a
 * text-level test catches it the moment it changes.
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

const CAMERA = read("app/camera.tsx");
const HERO = read("components/monetization/paywall/heroes/ThirdPhotoHero.tsx");
const HERO_MAP = read("components/monetization/paywall/PaywallHero.tsx");
const DECISION = read("lib/thirdPhotoDecision.ts");
const LAYOUT = read("app/_layout.tsx");

// ── 1-4. Entry points and host ──────────────────────────────────────────────

describe("entry points and host", () => {
  /**
   * Requirements 1-2. Both Third Photo triggers live in camera.tsx, and neither
   * may still reach the temporary gate.
   */
  it("no real Third Photo path still opens ProGate", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (/openProGate\(\s*['"]third_photo['"]/.test(code(read(rel)))) offenders.push(rel);
      }
    };
    for (const d of ["app", "components", "lib", "hooks"]) walk(d);
    expect(offenders).toEqual([]);
  });

  it("both origins open the shared paywall with the third_photo source", () => {
    expect(CAMERA).toMatch(/openProPaywall\('third_photo', \{ onUnlocked: \(\) => \{ void handleCaptureRef\.current\?\.\(\); \} \}\)/);
    expect(CAMERA).toMatch(/openProPaywall\('third_photo', \{ onUnlocked: promotePendingThird \}\)/);
  });

  /** Requirement 3. One engine, reused. */
  it("creates no second provider or purchase engine", () => {
    const c = code(CAMERA);
    // The import PATH legitimately contains the provider's name; what must not
    // exist is a second provider being RENDERED here.
    expect(c).not.toMatch(/<ProPaywallProvider/);
    expect(c).not.toMatch(/react-native-purchases|purchasePackage|restorePurchases/);
    // Exactly one provider in the whole app.
    expect((code(LAYOUT).match(/<ProPaywallProvider>/g) ?? []).length).toBe(1);
  });

  /**
   * Requirement 4. camera.tsx is presentation: 'fullScreenModal', so a
   * root-level RN Modal renders UNDERNEATH it and only surfaces after dismissal.
   */
  it("mounts a local paywall host, because camera is a fullScreenModal", () => {
    expect(LAYOUT).toMatch(/name="camera"[^>]*presentation: "fullScreenModal"/);
    expect(CAMERA).toMatch(/<ProPaywallHost \/>/);
    expect(CAMERA).toMatch(/<ProGateHost \/>/); // the AI Context gate still needs its own
  });

  it("registers the contextual hero for third_photo", () => {
    expect(HERO_MAP).toMatch(/third_photo:\s+ThirdPhotoHero,/);
  });
});

// ── 34-36. The pending image must never be active state ─────────────────────

describe("pending third photo is not an active photo", () => {
  /**
   * The core safety property of this phase.
   *
   * `slots` is the active photo record: it renders, handleDone reads it, and it
   * becomes the analyze payload. The pending image is held in a ref that is
   * never merged into `slots` except inside promotePendingThird.
   */
  it("is held in a ref, outside slot state", () => {
    expect(CAMERA).toMatch(/const pendingThirdRef = useRef</);
    // Assigned in exactly one place: the gallery handler.
    expect((code(CAMERA).match(/pendingThirdRef\.current = \{/g) ?? []).length).toBe(1);
  });

  /**
   * setSlots must never be called with the pending asset outside the promotion
   * path. This is the assertion that would catch the leak.
   */
  it("reaches slot state only through promotePendingThird", () => {
    const c = code(CAMERA);
    const promoStart = c.indexOf("const promotePendingThird");
    const promoEnd = c.indexOf("const openThirdPhotoPaywallForCamera");
    expect(promoStart).toBeGreaterThan(-1);
    expect(promoEnd).toBeGreaterThan(promoStart);

    // Every mention of the pending asset sits inside the promotion function or
    // the gallery handler that creates it.
    const outside = c.slice(0, promoStart) + c.slice(promoEnd);
    expect(outside).not.toMatch(/pending\.asset/);
  });

  it("is cleared on dismissal paths, account switch and unmount", () => {
    expect(CAMERA).toMatch(/const clearPendingThird = useCallback/);
    // Account switch.
    expect(CAMERA).toMatch(/lastUidRef\.current = uid;/);
    expect(CAMERA).toMatch(/sessionRef\.current \+= 1;/);
    // Unmount.
    expect(CAMERA).toMatch(/useEffect\(\(\) => clearPendingThird, \[clearPendingThird\]\)/);
  });

  it("is consumed exactly once, cleared before any attach", () => {
    const c = code(CAMERA);
    const promo = c.slice(c.indexOf("const promotePendingThird"), c.indexOf("const openThirdPhotoPaywallForCamera"));
    /**
     * Cleared BEFORE the outcome is acted on, so a second unlock finds nothing.
     *
     * Both indices are checked for presence first: indexOf returns -1 when the
     * call is absent, and -1 < anything is true — so the ordering assertion
     * alone would PASS on a version with no clear at all. That is exactly what
     * the mutation run caught.
     */
    const clearAt = promo.indexOf("clearPendingThird()");
    const actAt = promo.indexOf("if (result !== 'promote')");
    expect(clearAt).toBeGreaterThan(-1);
    expect(actAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(actAt);
  });

  it("re-verifies every precondition at promotion time", () => {
    expect(CAMERA).toMatch(/sameUid: \(uidRef\.current \?\? null\) === pending\.uid/);
    expect(CAMERA).toMatch(/sameSession: sessionRef\.current === pending\.session/);
    expect(CAMERA).toMatch(/assetUsable: Boolean\(pending\.asset\?\.uri\)/);
    expect(CAMERA).toMatch(/slotStillEmpty: !slotsNow\[thirdSlot\]/);
  });

  /** A lost asset must never be surfaced as a purchase failure. */
  it("shows no error when the asset is gone", () => {
    const c = code(CAMERA);
    const promo = c.slice(c.indexOf("const promotePendingThird"), c.indexOf("const openThirdPhotoPaywallForCamera"));
    expect(promo).not.toMatch(/Alert\.alert|setError|purchase.*fail/i);
  });
});

// ── The overwrite bug ───────────────────────────────────────────────────────

describe("library selection fills empty slots", () => {
  /**
   * The bug this phase fixes: `picked.slice(0, maxAllowed)` assigned
   * `SLOT_ORDER[i]` from index 0, overwriting an existing front photo and
   * gating on the picker index instead of the active count.
   */
  it("no longer slices the picker array by index", () => {
    const c = code(CAMERA);
    expect(c).not.toMatch(/picked\.slice\(0, maxAllowed\)/);
    expect(c).not.toMatch(/const maxAllowed = canThirdPhoto \? 3 : 2/);
    expect(c).toMatch(/planSelection\(picked, slotsRef\.current, ent\.status, ent\.maxPhotoSlots\)/);
  });

  it("assigns only to the slots planSelection returned", () => {
    expect(CAMERA).toMatch(/for \(const \{ slot, asset \} of plan\.assignments\)/);
  });

  it("the planner never emits an occupied slot", () => {
    expect(DECISION).toMatch(/const empty = SLOT_FILL_ORDER\.filter\(s => !occupied\[s\]\)/);
  });
});

// ── 19. Gate before capture ─────────────────────────────────────────────────

describe("camera gate", () => {
  it("decides before handleCapture runs", () => {
    const c = code(CAMERA);
    const decide = c.indexOf("decideCameraTap(filledCount");
    const capture = c.indexOf("handleCapture();", decide);
    expect(decide).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(decide);
    expect(c).toMatch(/if \(action === 'paywall'\) \{ openThirdPhotoPaywallForCamera\(\); return; \}/);
  });

  /** The continuation opens the capture flow; it never takes a picture. */
  it("continues into the capture flow without auto-shooting", () => {
    expect(CAMERA).toMatch(/void handleCaptureRef\.current\?\.\(\)/);
    expect(code(CAMERA)).not.toMatch(/takePictureAsync\(\)[\s\S]{0,40}onUnlocked/);
  });
});

// ── 14-17. Third slot treatment preserved ───────────────────────────────────

describe("third-slot premium treatment is untouched", () => {
  /** Requirements 14-15. Visible to Free, premium once two are filled. */
  it("still glimmers for everyone once two photos are filled", () => {
    expect(CAMERA).toMatch(
      /const glimmer = filledCount === 2 && !photo && slot === getNextEmptySlot\(slots\)/,
    );
    // No entitlement term — Pro and Free both see it.
    expect(code(CAMERA)).not.toMatch(/glimmer = .*canThirdPhoto/);
  });

  /** Requirements 16-17. Real animation, real Reduce Motion fallback. */
  it("uses the shared PremiumGlimmer with its Reduce Motion fallback", () => {
    expect(CAMERA).toMatch(/<PremiumGlimmer active=\{glimmer\}/);
    const glim = read("components/monetization/PremiumGlimmer.tsx");
    expect(glim).toMatch(/withRepeat/);
    expect(glim).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(glim).toMatch(/if \(!active \|\| reduceMotion\)/);
  });

  /** The hero reuses that same component, so the languages cannot diverge. */
  it("the hero echoes the camera slot with the same component", () => {
    expect(HERO).toMatch(/import \{ PremiumGlimmer \}/);
    expect(HERO).toMatch(/<PremiumGlimmer active/);
  });
});

// ── Hero ────────────────────────────────────────────────────────────────────

describe("contextual hero", () => {
  /**
   * FRONT, TAG, EXTRA PHOTO. The camera currently captions its third slot
   * "Graphic" — right for a printed tee, wrong for a lamp — so the paywall
   * neither repeats it nor invents a different specific word that would
   * mismatch the camera. It says what the feature is. The camera's caption
   * is a separate decision and is unchanged here.
   */
  it("labels the frames FRONT, TAG and EXTRA PHOTO", () => {
    for (const label of ["FRONT", "TAG", "EXTRA PHOTO"]) {
      expect(HERO).toContain(`"${label}"`);
    }
    expect(code(HERO)).not.toMatch(/"GRAPHIC"|"DETAIL"|EXTRA ANGLE/);
    // The camera's own captions are untouched by the paywall redesign.
    expect(CAMERA).toMatch(/front:\s+'Front'/);
    expect(CAMERA).toMatch(/tag:\s+'Tag'/);
    expect(CAMERA).toMatch(/detail: 'Graphic'/);
  });

  it("marks only the third card premium", () => {
    expect(HERO).toMatch(/state="premium"/);
    expect((HERO.match(/state="premium"/g) ?? []).length).toBe(1);
    expect((HERO.match(/state="filled"/g) ?? []).length).toBe(2);
  });

  it("uses no image asset or new dependency", () => {
    expect(code(HERO)).not.toMatch(/require\(|\.png|\.jpg|<Image\b/);
    expect(code(HERO)).not.toMatch(/expo-linear-gradient|lottie|expo-blur/);
  });

  it("uses no padlock or SaaS lock icon", () => {
    expect(code(HERO)).not.toMatch(/name="lock"|lock-outline|padlock/i);
  });

  it("is decorative and hidden from screen readers", () => {
    expect(HERO).toMatch(/accessibilityElementsHidden/);
  });

  it("compresses on short screens", () => {
    expect(HERO).toMatch(/const COMPACT_BELOW = \d+;/);
  });

  it("contains no Pro feature checklist", () => {
    expect(code(HERO)).not.toMatch(/✓|Deep Analysis|Generate Listings|4,000/);
  });

  it("stays inside the FlipStart palette", () => {
    expect(HERO).toMatch(/from "\.\.\/paywallTheme"/);
    expect(code(HERO)).not.toMatch(/#000000|#0A0A0A/);
  });
});

// ── 54-58. Server enforcement ───────────────────────────────────────────────

describe("server enforcement is unweakened", () => {
  it("still bounds photo count by plan before any model work", () => {
    const enforce = read("server/monetization/enforce.ts");
    expect(enforce).toMatch(/photoCount <= maxPhotoSlots\(plan\)/);
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/export function maxPhotoSlots\(plan: PlanState\): 2 \| 3/);
    expect(policy).toMatch(/canUseFeature\(plan, "scan_photo_3"\) \? 3 : 2/);
  });

  /** Requirement 55. Packs are not a parameter of the photo limit. */
  it("derives the photo limit from plan alone", () => {
    const policy = code(read("server/monetization/policy.ts"));
    const start = policy.indexOf("export function maxPhotoSlots");
    // Just the function body, not whatever happens to follow it.
    const fn = policy.slice(start, policy.indexOf("}", policy.indexOf("{", start)) + 1);
    expect(fn).not.toMatch(/pack|balance/i);
    expect(fn).toMatch(/canUseFeature\(plan, "scan_photo_3"\)/);
  });
});

// ── 62-69. Regression ───────────────────────────────────────────────────────

describe("regression", () => {
  /** Requirements 62-63. */
  it("Generate Listings is unchanged", () => {
    const gl = read("lib/useGenerateListingsGate.ts");
    expect(gl).toMatch(/openProPaywall\("generate_listings", \{ onUnlocked: runOnce \}\)/);
    expect(gl).toMatch(/if \(action === "view_existing"\)/);
  });

  /** Requirements 64-65. */
  it("Deep Analysis keeps both the preview funnel and its paywall", () => {
    const da = read("lib/useDeepAnalysisGate.ts");
    expect(da).toMatch(/label: "Try Deep Analysis"/);
    expect(da).toMatch(/openProPaywall\("deep_analysis", \{ onUnlocked: openOnce \}\)/);
    expect((code(da).match(/openProGate\(/g) ?? []).length).toBe(1);
  });

  /** Requirement 66. AI Context is Phase 6, not this one. */
  /** Superseded by Phase 6 — AI Context migrated. */
  it("AI Context migrated to its contextual paywall", () => {
    expect(code(CAMERA)).not.toMatch(/openProGate\(/);
    expect(CAMERA).toMatch(/openProPaywall\('camera_context'/);
  });

  /** Requirements 67-68. */
  it("Sold Comps and Hunt Mode remain Free", () => {
    expect(read("server/monetization/policy.ts")).toMatch(
      /case "sold_comps":\s*\n\s*case "hunt_mode":\s*return true;/,
    );
  });

  /** Requirement 69. */
  it("the Scan Store placeholder is untouched", () => {
    const store = read("app/scan-store.tsx");
    /**
     * Superseded by Phase 8 — the placeholder became the real Scan Store.
     * What still matters is that the store never grants anything itself.
     */
    expect(store).toContain("Scan Store");
    expect(store).toContain("Scan Packs add scan quantity only and do not unlock FlipStart Pro.");
  });

  it("the dev preview can show third_photo and creates no new screen", () => {
    const dev = read("app/dev-monetization.tsx");
    expect(dev).toMatch(/PAYWALL_SOURCES/);
    expect(readdirSync(path.join(root, "app")).filter(f => /^dev-.*paywall/i.test(f))).toEqual([]);
  });
});