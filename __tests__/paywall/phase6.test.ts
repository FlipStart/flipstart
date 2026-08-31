/**
 * __tests__/paywall/phase6.test.ts
 *
 * Phase 6 — AI Context contextual paywall.
 *
 * Behavioural assertions run against the real config and the shared purchase
 * machine. Structural assertions read source text — weaker than rendering, and
 * the right tool for this phase's actual risk: a Free tap must not mount a
 * TextInput, and Free context must never reach the model. Both are facts about
 * specific files, caught the moment they change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PAYWALL_SOURCES, resolvePaywallConfig, type ProPaywallSource } from "@/lib/paywallConfig";
import {
  afterActivation,
  canPurchase,
  purchaseBlockedReason,
  purchaseSettled,
  restoreSettled,
  shouldShowAlreadyPro,
  type PurchaseAvailability,
} from "@/lib/paywallMachine";

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
const INPUT = read("components/camera/ProCameraContextInput.tsx");
const HERO = read("components/monetization/paywall/heroes/AiContextHero.tsx");
const HERO_MAP = read("components/monetization/paywall/PaywallHero.tsx");
const ROUTERS = read("server/routers.ts");
const CC = () => resolvePaywallConfig("camera_context");

const READY: PurchaseAvailability = {
  phase: "idle",
  productsStatus: "ready",
  selectedProductAvailable: true,
  entitlementStatus: "ready",
  isPro: false,
};

// ── 1-5. Audit ──────────────────────────────────────────────────────────────

describe("audit", () => {
  /** Requirements 1-2. One entry point, and it no longer uses ProGate. */
  it("no AI Context path still opens the temporary gate", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (/openProGate\(\s*['"]camera_context['"]/.test(code(read(rel)))) offenders.push(rel);
      }
    };
    for (const d of ["app", "components", "lib", "hooks"]) walk(d);
    expect(offenders).toEqual([]);
  });

  it("opens the shared paywall with the camera_context source", () => {
    expect(CAMERA).toMatch(/openProPaywall\('camera_context', \{/);
  });

  /** Requirements 3-5. The Phase 5 host is reused; no second engine. */
  it("reuses the Phase 5 camera host and adds no provider or engine", () => {
    expect((CAMERA.match(/<ProPaywallHost \/>/g) ?? []).length).toBe(1);
    const c = code(CAMERA);
    expect(c).not.toMatch(/<ProPaywallProvider/);
    expect(c).not.toMatch(/react-native-purchases|purchasePackage|restorePurchases/);
    // Still exactly one provider, app-wide.
    expect((code(read("app/_layout.tsx")).match(/<ProPaywallProvider>/g) ?? []).length).toBe(1);
  });
});

// ── 6-10. Visibility ────────────────────────────────────────────────────────

describe("the control stays visible to everyone", () => {
  /**
   * Requirements 6-10, and the regression the brief cares most about.
   *
   * The control is rendered unconditionally; entitlement only sets `disabled`.
   * Wrapping it in a plan check would make the feature invisible to exactly the
   * users the paywall exists to convert.
   */
  it("renders with no entitlement condition around it", () => {
    const c = code(CAMERA);
    expect(c).toMatch(/<ProCameraContextInput/);

    /**
     * Targeted directly at the mutation, not at "the 200 characters before it".
     *
     * The slice-and-anchor version passed against a file that literally read
     * `{canContext && <ProCameraContextInput` — the mutation run caught it. A
     * regex spanning the guard AND the element cannot be fooled that way.
     */
    expect(c).not.toMatch(/\{[^}]*canContext[^}]*&&\s*<ProCameraContextInput/);
    expect(c).not.toMatch(/canContext\s*\?\s*<ProCameraContextInput/);
    expect(c).not.toMatch(/isPro\s*&&\s*<ProCameraContextInput/);

    // Entitlement reaches the component only as `disabled`, never as mounting.
    expect(c).toMatch(/disabled=\{!canContext\}/);
  });

  /** The idle animation runs for Free too — a still row is a subtler grey-out. */
  it("animates the idle row regardless of entitlement", () => {
    expect(INPUT).toMatch(/const idle = value\.length === 0 && !open;/);
    expect(code(INPUT)).not.toMatch(/const idle = .*!disabled/);
  });

  /** Fails closed while unresolved: disabled, never silently enabled. */
  it("treats an unresolved entitlement as not-entitled", () => {
    expect(CAMERA).toMatch(/const canContext\s*= ent\.status === 'ready' && ent\.can\('camera_context'\)/);
  });
});

// ── 11-18. Hero and config ──────────────────────────────────────────────────

describe("camera_context configuration", () => {
  it("has a contextual hero registered", () => {
    expect(HERO_MAP).toMatch(/camera_context:\s+AiContextHero,/);
  });

  /** Requirements 12-15. */
  it("uses the exact specified copy", () => {
    expect(CC().eyebrow).toBe("FLIPSTART PRO");
    expect(CC().headline).toBe("Tell FlipStart What You See");
    expect(CC().ctaLabel).toBe("Unlock AI Context");
    expect(CC().secondaryValueLine).toBe("Your photos show the item. Your notes add the context.");
  });

  it("rejects the lock-flavoured headlines the brief rules out", () => {
    const h = CC().headline.toLowerCase();
    for (const bad of ["ai context locked", "unlock premium context", "upgrade for text input", "pro feature"]) {
      expect(h).not.toContain(bad);
    }
  });

  /** Requirement 14. Observations, before scanning, directing attention. */
  it("explains user observations before analysis", () => {
    const s = CC().subtitle.toLowerCase();
    expect(s).toContain("observations");
    expect(s).toContain("before scanning");
    expect(s).toContain("attention");
  });

  /**
   * The feature is ONE short note. Promising a conversation would advertise
   * something that does not exist.
   */
  it("promises no chat, accuracy or multi-turn capability", () => {
    const copy = `${CC().headline} ${CC().subtitle} ${CC().secondaryValueLine}`.toLowerCase();
    for (const bad of ["chat", "conversation", "ask ", "guarantee", "accurate", "voice", "annotate"]) {
      expect(copy).not.toContain(bad);
    }
  });

  /** Requirement 16. Packs buy quantity, never capability. */
  it("never offers the Scan Store", () => {
    expect(CC().showScanStoreAlternative).toBe(false);
    for (const s of PAYWALL_SOURCES) {
      expect(resolvePaywallConfig(s).showScanStoreAlternative).toBe(s === "scan_limit");
    }
  });

  /** Requirement 18. */
  it("contains no trial language", () => {
    const copy = [CC().eyebrow, CC().headline, CC().subtitle, CC().ctaLabel, CC().secondaryValueLine]
      .join(" ").toLowerCase();
    for (const t of ["free trial", "trial", "days free", "try free"]) {
      expect(copy).not.toContain(t);
    }
  });

  /** Superseded by Phase 7: scan_limit now has its own CTA too. */
  it("leaves no real source on the generic CTA", () => {
    for (const s of PAYWALL_SOURCES.filter(x => x !== "dev_preview")) {
      expect(resolvePaywallConfig(s).ctaLabel).not.toBe("Unlock FlipStart Pro");
    }
  });
});

describe("hero", () => {
  it("labels the example so it cannot read as the user's own note", () => {
    expect(HERO).toContain("SAMPLE NOTE");
    expect(HERO).toMatch(/const SAMPLE_NOTE = "/);
    // Fixed constant — never bound to live context state.
    expect(code(HERO)).not.toMatch(/contextText|value=\{|props\.value/);
  });

  /**
   * Nothing has been added while a Free user is looking at this. Wording that
   * says otherwise would describe a state they have not reached.
   */
  it("explains the outcome without claiming context was already added", () => {
    expect(HERO).toContain("GUIDE THE ANALYSIS");
    expect(code(HERO)).not.toMatch(/CONTEXT ADDED|ADDED TO SCAN/);
  });

  it("is not a chat UI", () => {
    expect(code(HERO)).not.toMatch(/bubble|avatar|send|chat|message/i);
  });

  it("adds no animation and no new dependency", () => {
    expect(code(HERO)).not.toMatch(/Animated\.|useSharedValue|withRepeat|withTiming/);
    expect(code(HERO)).not.toMatch(/expo-linear-gradient|lottie|expo-blur/);
  });

  it("is decorative, compresses on small screens, and stays in palette", () => {
    expect(HERO).toMatch(/accessibilityElementsHidden/);
    expect(HERO).toMatch(/const COMPACT_BELOW = \d+;/);
    expect(HERO).toMatch(/from "\.\.\/paywallTheme"/);
    expect(code(HERO)).not.toMatch(/#000000|#0A0A0A/);
  });

  it("contains no Pro feature checklist", () => {
    expect(code(HERO)).not.toMatch(/✓|Deep Analysis|Generate Listings|Third Photo|4,000/);
  });
});

// ── 19-25. Free behaviour ───────────────────────────────────────────────────

describe("free behaviour", () => {
  /**
   * Requirements 20-22, and the core safety property of this phase.
   *
   * The entitlement check happens BEFORE setOpen, so a Free tap mounts no
   * TextInput, opens no keyboard and seeds no draft. Asserted positionally, not
   * just by presence.
   */
  it("gates before the editor opens, so no input is ever mounted", () => {
    const c = code(INPUT);
    const fn = c.slice(c.indexOf("const openEditor = () =>"), c.indexOf("const cancel ="));
    const gate = fn.indexOf("if (disabled)");
    const setDraft = fn.indexOf("setDraft(value)");
    const setOpen = fn.indexOf("setOpen(true)");
    expect(gate).toBeGreaterThan(-1);
    expect(setDraft).toBeGreaterThan(-1);
    expect(setOpen).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(setDraft);
    expect(gate).toBeLessThan(setOpen);
    // The gated branch returns; it does not fall through.
    expect(fn).toMatch(/if \(disabled\) \{ onUpgradePress\?\.\(\); return; \}/);
  });

  /** Requirements 22-24. Opening the paywall mutates no context state. */
  it("the upgrade handler touches no context state", () => {
    const c = code(CAMERA);
    const fn = c.slice(c.indexOf("const openAiContextPaywall"), c.indexOf("}, [openProPaywall]);"));
    expect(fn).not.toMatch(/setContextText|setContextConfirmed/);
  });

  /** The editor is only ever mounted by the component's own open state. */
  it("the camera cannot mount the editor directly", () => {
    expect(code(CAMERA)).not.toMatch(/autoFocus|\.focus\(\)/);
  });
});

// ── 31-42. Continuation ─────────────────────────────────────────────────────

describe("purchase continuation", () => {
  /** Requirements 31-32. RevenueCat success alone is never enough. */
  it("no purchase outcome unlocks without server confirmation", () => {
    for (const status of [
      "success", "sync_pending", "cancelled", "pending", "error", "unavailable", "account_changed",
    ] as const) {
      expect(purchaseSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  /** Requirement 42. */
  it("activation pending is terminal but never unlocked", () => {
    expect(afterActivation(true, "annual").phase).toBe("unlocked");
    expect(afterActivation(false, "annual").phase).toBe("pending_activation");
  });

  /** Requirements 38-39. */
  it("no restore outcome unlocks without server confirmation", () => {
    for (const status of [
      "restored", "nothing_to_restore", "error", "unavailable",
      "sync_pending", "account_changed", "owned_by_another_account",
    ] as const) {
      expect(restoreSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  /** Requirement 40. */
  it("cancellation returns silently and cannot continue", () => {
    const s = purchaseSettled({ status: "cancelled" });
    expect(s.phase).toBe("idle");
    expect(s.notice).toBeNull();
  });

  /**
   * Requirements 34-36, and the modal timing the brief flags.
   *
   * The editor is itself a Modal with an autoFocus TextInput, so opening it
   * while the paywall is still dismissing means two modals in transition — a
   * lost focus or a keyboard that never appears. InteractionManager waits for
   * the dismissal, and no arbitrary setTimeout is used.
   */
  it("defers the resume until the paywall has finished dismissing", () => {
    expect(CAMERA).toMatch(/InteractionManager\.runAfterInteractions\(\(\) => \{/);
    expect(CAMERA).toMatch(/contextInputRef\.current\?\.openEditor\(\)/);
    const c = code(CAMERA);
    const fn = c.slice(c.indexOf("const openAiContextPaywall"), c.indexOf("}, [openProPaywall]);"));
    expect(fn).not.toMatch(/setTimeout/);
  });

  /** Requirement 37. */
  it("guards the continuation against firing twice", () => {
    const c = code(CAMERA);
    const fn = c.slice(c.indexOf("const openAiContextPaywall"), c.indexOf("}, [openProPaywall]);"));
    expect(fn).toMatch(/let fired = false;/);
    expect(fn).toMatch(/if \(fired\) return;/);
    expect(fn).toMatch(/fired = true;/);
  });

  /** Requirements 43-45. */
  it("re-checks identity and session at resume time, and again after the wait", () => {
    const c = code(CAMERA);
    const fn = c.slice(c.indexOf("const openAiContextPaywall"), c.indexOf("}, [openProPaywall]);"));
    expect((fn.match(/uidRef\.current \?\? null\) !== openedUid/g) ?? []).length).toBe(2);
    expect((fn.match(/sessionRef\.current !== openedSession/g) ?? []).length).toBe(2);
  });

  /** Requirement 46. */
  it("shows the already-member panel rather than selling twice", () => {
    const pro = { ...READY, isPro: true };
    expect(canPurchase(pro)).toBe(false);
    expect(purchaseBlockedReason(pro)).toBe("already_pro");
    expect(shouldShowAlreadyPro("ready", true, "idle")).toBe(true);
    expect(shouldShowAlreadyPro("unresolved", true, "idle")).toBe(false);
  });
});

// ── 47-55. Server enforcement and payload ───────────────────────────────────

describe("server enforcement", () => {
  /**
   * Requirements 48-49, 52-53, and the invariant that matters most:
   * Free context must never influence the model.
   *
   * The server REJECTS rather than strips, and does so before the scan is
   * reserved and before the model runs — so a modified Free client spends
   * neither our money nor the user's scan.
   */
  it("rejects premium context before reserving a scan or calling the model", () => {
    const c = code(ROUTERS);
    const ctxCheck = c.indexOf('requireFeature(muid, "camera_context")');
    const reserve = c.indexOf("reserveScan(muid as string");
    expect(ctxCheck).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(-1);
    expect(ctxCheck).toBeLessThan(reserve);
    expect(ROUTERS).toMatch(/code: "PRO_REQUIRED"/);
  });

  /** Requirement 47. An empty context must not break an ordinary Free scan. */
  it("only gates a non-empty context", () => {
    expect(ROUTERS).toMatch(/\.trim\(\)\.length > 0/);
  });

  /** Requirements 50-51. Plan-derived, so packs cannot unlock it. */
  it("derives the capability from plan alone", () => {
    // The `case` is code; the pack rule is stated in a comment. Asserting both
    // against the comment-stripped copy silently dropped the second check.
    const policyRaw = read("server/monetization/policy.ts");
    expect(code(policyRaw)).toMatch(/case "camera_context":/);
    expect(policyRaw).toMatch(/Pack ownership is not a parameter here/);
  });

  /** Requirements 54-55. Only CONFIRMED context is sent. */
  it("sends context only when the user confirmed it", () => {
    expect(CAMERA).toMatch(/const ctx = contextConfirmed \? normalizeUserContext\(contextText\) : '';/);
    expect(CAMERA).toMatch(/\.\.\.\(ctx \? \{ userContext: ctx \} : \{\}\)/);
  });
});

// ── 56-65. Regression ───────────────────────────────────────────────────────

describe("regression", () => {
  /** Requirements 56-58. */
  it("Third Photo is unchanged", () => {
    expect(CAMERA).toMatch(/openProPaywall\('third_photo'/);
    expect(CAMERA).toMatch(/planSelection\(picked, slotsRef\.current/);
    expect(CAMERA).toMatch(/const glimmer = filledCount === 2 && !photo && slot === getNextEmptySlot\(slots\)/);
    expect(CAMERA).toMatch(/pendingThirdRef/);
  });

  /** Requirements 59-60. */
  it("Generate Listings is unchanged", () => {
    const gl = read("lib/useGenerateListingsGate.ts");
    expect(gl).toMatch(/openProPaywall\("generate_listings", \{ onUnlocked: runOnce \}\)/);
    expect(gl).toMatch(/if \(action === "view_existing"\)/);
  });

  /** Requirements 61-62. */
  it("Deep Analysis keeps both the preview funnel and its paywall", () => {
    const da = read("lib/useDeepAnalysisGate.ts");
    expect(da).toMatch(/label: "Try Deep Analysis"/);
    expect(da).toMatch(/openProPaywall\("deep_analysis", \{ onUnlocked: openOnce \}\)/);
  });

  /** Requirements 63-64. */
  it("Sold Comps and Hunt Mode remain Free", () => {
    expect(read("server/monetization/policy.ts")).toMatch(
      /case "sold_comps":\s*\n\s*case "hunt_mode":\s*return true;/,
    );
  });

  /** Requirement 65. */
  it("the Scan Store placeholder is untouched", () => {
    /**
     * Superseded by Phase 8 — the placeholder became the real Scan Store.
     * What still matters is that the store never grants anything itself.
     */
    const store = read("app/scan-store.tsx");
    expect(store).toContain("Scan Store");
    expect(store).toContain("Scan Packs add scan quantity only and do not unlock FlipStart Pro.");
  });

  it("the dev preview can show camera_context and creates no new screen", () => {
    const dev = read("app/dev-monetization.tsx");
    expect(dev).toMatch(/PAYWALL_SOURCES/);
    expect(readdirSync(path.join(root, "app")).filter(f => /^dev-.*paywall/i.test(f))).toEqual([]);
  });

  /** Context limits are not a monetization lever. */
  it("does not change context length or validation", () => {
    expect(INPUT).toMatch(/maxLength=\{MAX_LEN\}/);
    expect(INPUT).toMatch(/t\.slice\(0, MAX_LEN\)/);
  });
});