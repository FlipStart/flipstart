/**
 * __tests__/paywall/phase4.structure.test.ts
 *
 * Phase 4 structural assertions.
 *
 * Source-text assertions, not render tests — the same honest limitation as the
 * Phase 3 suite. What they cover is this phase's real risk: Deep Analysis has
 * FOUR entry points and a preview funnel sitting in front of the paywall, and
 * the brief's central warning is that no entry point may silently stay on the
 * old gate while the others move.
 *
 * The visual half — how the dossier looks, how it behaves on an SE, what
 * VoiceOver reads — is the manual acceptance pass in the dev preview.
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

/** The four screens the audit found. */
const ENTRY_POINTS = [
  "app/results.tsx",
  "app/scan-detail.tsx",
  "app/diamonds-in-the-rough.tsx",
  "app/hunt-history.tsx",
] as const;

const GATE = read("lib/useDeepAnalysisGate.ts");
const DECISION = read("lib/deepAnalysisDecision.ts");
const HERO = read("components/monetization/paywall/heroes/DeepAnalysisHero.tsx");
const HERO_MAP = read("components/monetization/paywall/PaywallHero.tsx");
const ANALYSIS_SCREEN = read("app/analysis-details.tsx");
const DEEP_UTIL = read("utils/deepAnalysis.ts");

// ── 1-2. Entry-point audit ──────────────────────────────────────────────────

describe("entry-point coverage", () => {
  /**
   * Requirement 1 and 2, pinned.
   *
   * If a fifth screen ever calls useDeepAnalysisGate — or worse, navigates to
   * analysis-details without it — this fails and names the file.
   */
  it("only the four audited screens use the Deep Analysis gate", () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (code(read(rel)).includes("useDeepAnalysisGate(")) callers.push(rel);
      }
    };
    for (const d of ["app", "components", "hooks"]) walk(d);
    expect(callers.sort()).toEqual([...ENTRY_POINTS].sort());
  });

  /**
   * No screen may navigate to the Deep Analysis route without going through the
   * gate. This is the "silently remain on the old path" failure mode.
   */
  it("nothing routes to analysis-details outside the gate", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (rel === "app/analysis-details.tsx") continue; // the screen itself
        const src = code(read(rel));
        if (!src.includes("'/analysis-details'")) continue;
        if (!src.includes("useDeepAnalysisGate(")) offenders.push(rel);
      }
    };
    for (const d of ["app", "components", "hooks"]) walk(d);
    expect(offenders).toEqual([]);
  });

  it("every entry point passes a live item-identity ref", () => {
    for (const f of ENTRY_POINTS) {
      const src = read(f);
      expect(src).toMatch(/const itemContextRef = useRef<string \| null>\(null\)/);
      expect(src).toMatch(/itemContextRef\.current =/);
      expect(src).toMatch(/contextRef: itemContextRef/);
    }
  });

  /**
   * Rules of hooks.
   *
   * Two of these screens return early when the item is missing. A useRef added
   * below that return changes the hook count between renders — the exact crash
   * that happened on the first attempt in Phase 3.
   */
  it("declares the ref hook above every early return", () => {
    for (const f of ENTRY_POINTS) {
      // \r stripped: these files are CRLF and a `$` anchor never matches "{\r".
      const lines = read(f).split("\n").map(l => l.replace(/\r$/, ""));
      const hook = lines.findIndex(l => /const itemContextRef = useRef/.test(l));
      const early = lines.findIndex(l => /^  if \(![\w.?]+( \|\| ![\w.?()]+)*\) \{$/.test(l));
      expect(hook).toBeGreaterThan(-1);
      if (early > -1) expect(hook).toBeLessThan(early);
    }
  });
});

// ── 3, 11, 35-37. Teasers survive ───────────────────────────────────────────

describe("teasers remain visible to Free users", () => {
  /**
   * Requirements 11 and 35-37, and the single most important UX rule of this
   * phase. A teaser rendered only for Pro would make Deep Analysis invisible to
   * exactly the people the paywall is meant to convert.
   *
   * Asserted as ABSENCE of any entitlement condition on the teaser state: the
   * coach-mark visibility is driven purely by AsyncStorage scan-streak state.
   */
  it("the results coach-mark has no entitlement condition", () => {
    const src = code(read("app/results.tsx"));
    const decl = src.match(/const \[showDeepTip, setShowDeepTip\] = useState\(([^)]*)\)/);
    expect(decl).not.toBeNull();
    expect(decl![1]).not.toMatch(/ent|isPro|can\(|plan/);
    // The render condition is the bare flag, not a plan check.
    expect(src).toMatch(/\{showDeepTip && \(/);
    expect(src).not.toMatch(/showDeepTip && (ent|isPro|canDeep)/);
  });

  it("the scan-detail coach-mark has no entitlement condition", () => {
    const src = code(read("app/scan-detail.tsx"));
    expect(src).toMatch(/showDeepTip/);
    expect(src).not.toMatch(/showDeepTip && (ent|isPro|canDeep)/);
  });

  /** The doorway card and title arrow are unconditional Pressables. */
  it("the Deep Analysis doorway renders for everyone", () => {
    const src = code(read("app/scan-detail.tsx"));
    expect(src).toMatch(/<Pressable onPress=\{handleOpenDeepAnalysis\} style=\{\(\{ pressed \}\) => \[s\.deepCard/);
    // Not wrapped in a plan check.
    expect(src).not.toMatch(/(isPro|ent\.can\('deep_analysis'\)) && [\s\S]{0,80}s\.deepCard/);
  });

  it("no entry point hides its Deep Analysis action behind an entitlement check", () => {
    for (const f of ENTRY_POINTS) {
      // The gate decides; the screen never pre-filters the control away.
      expect(code(read(f))).not.toMatch(/ent\.can\(\s*['"]deep_analysis['"]\s*\)/);
    }
  });
});

// ── 4, 12-14. Gate behaviour ────────────────────────────────────────────────

describe("gate behaviour", () => {
  /** Requirement 4. The paywall replaced the exhausted-preview branch. */
  it("exhausted-preview Free users reach the contextual paywall", () => {
    expect(GATE).toMatch(/openProPaywall\("deep_analysis", \{ onUnlocked: openOnce \}\)/);
    expect(GATE).toMatch(/if \(action === "paywall"\) \{ openPaywall\(\); return; \}/);
  });

  /**
   * The agreed exception: ONE ProGate call survives, and only for the preview
   * offer. Asserted narrowly so a future edit cannot quietly reintroduce the
   * old plain gate.
   */
  it("keeps exactly one ProGate call, and only for the preview offer", () => {
    const c = code(GATE);
    const calls = c.match(/openProGate\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(c).toMatch(/openProGate\("deep_analysis", \{[\s\S]*?label: "Try Deep Analysis"/);
    // The old unconditional fallback gate must be gone.
    expect(c).not.toMatch(/openProGate\(\s*['"]deep_analysis['"]\s*\)\s*;/);
  });

  it("Pro bypasses both the preview offer and the paywall", () => {
    expect(GATE).toMatch(/if \(action === "open"\) \{ openOnce\(\); return; \}/);
    expect(DECISION).toMatch(/if \(i\.canDeepAnalysis\) return "open";/);
  });

  /** Requirement 13. No Deep Analysis before unlock. */
  it("opening is funnelled through a single guarded call", () => {
    expect(GATE).toMatch(/let fired = false;/);
    expect(GATE).toMatch(/if \(fired\) return;/);
    expect(GATE).toMatch(/if \(!stillValid\(\)\) return;/);
    // `open()` is invoked in exactly one place: inside openOnce.
    const c = code(GATE);
    const bare = c.match(/(?<!\w)open\(\);/g) ?? [];
    expect(bare.length).toBe(1);
  });

  /** Requirements 32-33. */
  it("verifies user and item identity immediately before opening", () => {
    expect(GATE).toMatch(/if \(\(uidRef\.current \?\? null\) !== openedUid\) return false;/);
    expect(GATE).toMatch(/contextRef && \(contextRef\.current \?\? null\) !== openedContext/);
  });

  /**
   * The preview path is guarded too.
   *
   * A preview is a one-time lifetime grant. Spending A's preview to show B
   * something is worse than either mistake alone, so openOnce — with its
   * identity check — is what the consume callback calls.
   */
  it("routes the preview grant through the same identity guard", () => {
    // Shape changed when the already_used branch was added; the guard did not.
    expect(GATE).toMatch(/if \(previewConsumeOpens\(res\)\) \{ openOnce\(\); return; \}/);
  });

  /**
   * The already_used branch must never return silently.
   *
   * It used to: the user tapped, the server said the lifetime preview was
   * spent, and nothing happened. The server response is authoritative, so it
   * now suppresses the stale offer and routes the attempt to the paywall.
   */
  it("never leaves already_used as a silent no-op", () => {
    const c = code(GATE);
    const accept = c.slice(c.indexOf("onAccept:"), c.indexOf("const openThird") + 1 || undefined);
    expect(GATE).toMatch(/previewRefusedRef\.current = true;/);
    expect(GATE).toMatch(/previewRefusedRef\.current = true;[\s\S]{0,80}openPaywall\(\);/);
    expect(accept).toBeTruthy();
  });

  /** The session guard only ever SUPPRESSES an offer — it can never grant one. */
  it("uses the refusal guard to narrow availability, never to widen it", () => {
    expect(GATE).toMatch(/&& !previewRefusedRef\.current,/);
    // Declared as a ref, not persisted — the server stays the durable truth.
    expect(GATE).toMatch(/const previewRefusedRef = useRef\(false\);/);
    expect(code(GATE)).not.toMatch(/AsyncStorage|SecureStore/);
  });

  /** openPaywall must be declared before offerPreview references it. */
  it("declares openPaywall before the accept handler uses it", () => {
    const c = code(GATE);
    expect(c.indexOf("const openPaywall")).toBeLessThan(c.indexOf("const offerPreview"));
  });

  /** Requirement: dismissing the offer consumes nothing. */
  it("never consumes the preview outside the accept handler", () => {
    const c = code(GATE);
    const consumeCalls = c.match(/consume\.mutateAsync\(\)/g) ?? [];
    expect(consumeCalls.length).toBe(1);
    const acceptStart = c.indexOf("onAccept:");
    expect(c.indexOf("consume.mutateAsync()")).toBeGreaterThan(acceptStart);
  });

  it("a failed consume opens nothing", () => {
    expect(DECISION).toMatch(/return \(response as \{ granted\?: unknown \}\)\.granted === true;/);
  });

  it("resolves an unknown entitlement once, then fails closed", () => {
    expect(GATE).toMatch(/await entRef\.current\.refresh\(\)/);
    expect(GATE).toMatch(/decideAfterResolve\(plan, previewAvailable\)/);
    expect(code(GATE)).not.toMatch(/while \(|setInterval/);
  });

  it("the decision module has no imports at all", () => {
    expect(code(DECISION)).not.toMatch(/^\s*import /m);
    expect(code(DECISION)).not.toMatch(/require\(/);
  });

  /** Packs cannot reach the decision. */
  it("decides on capability, never on scan balance", () => {
    expect(code(GATE)).not.toMatch(/packScansRemaining|totalUsableScans|outOfScans/);
    expect(code(DECISION)).not.toMatch(/pack|balance/i);
  });
});

// ── 5. Hero ─────────────────────────────────────────────────────────────────

describe("contextual hero", () => {
  it("is registered for deep_analysis", () => {
    expect(HERO_MAP).toMatch(/deep_analysis:\s+DeepAnalysisHero,/);
  });

  /**
   * The dossier rows must name sections the REAL feature ships. Inventing
   * plausible metrics would promise a feature that does not exist.
   */
  it("uses row labels that exist in the real Deep Analysis screen", () => {
    for (const label of ["PRICE LOGIC", "RISK FLAGS", "WHERE TO SELL", "CONFIDENCE BREAKDOWN"]) {
      expect(HERO).toContain(label);
      // Title-cased equivalent is a real DeepHead title on the screen.
      const title = label.split(" ").map(w => w[0] + w.slice(1).toLowerCase()).join(" ");
      expect(ANALYSIS_SCREEN.toLowerCase()).toContain(title.toLowerCase());
    }
  });

  /**
   * The values are illustrative and must be labelled as such — the paywall can
   * appear over any scan, and convincing numbers would be a fabricated
   * analysis of the user's actual item.
   */
  it("marks the dossier as a sample and shows no fabricated valuations", () => {
    expect(HERO).toContain("SAMPLE");
    /**
     * Asserted on the DISPLAYED value strings only.
     *
     * Two earlier attempts were wrong in an instructive way: a whole-file regex
     * matched `width: "100%"`, and a ROWS-block regex matched the opacity
     * `reveal: 0.42`. Neither is a valuation. What actually matters is that no
     * row shows money or a percentage, because those would read as a real
     * appraisal of the user's own item.
     */
    const rows = HERO.slice(HERO.indexOf("const ROWS"), HERO.indexOf("export function DeepAnalysisHero"));
    const values = [...rows.matchAll(/value: "([^"]+)"/g)].map(m => m[1]);
    expect(values.length).toBeGreaterThanOrEqual(4);
    for (const v of values) {
      expect(v).not.toMatch(/[$£€]/);
      expect(v).not.toMatch(/%/);
      expect(v).not.toMatch(/\d+\.\d/);
    }
  });

  it("fades rather than blurs, with no new dependency", () => {
    expect(HERO).toMatch(/reveal: 0\./);
    expect(code(HERO)).not.toMatch(/BlurView|blurRadius|backdropFilter|expo-blur/);
    expect(code(HERO)).not.toMatch(/expo-linear-gradient|lottie/);
  });

  it("uses a small vintage seal, not a modern padlock", () => {
    expect(HERO).toMatch(/function WaxSeal/);
    expect(code(HERO)).not.toMatch(/name="lock"|name="lock-outline"|padlock/i);
  });

  it("is decorative and hidden from screen readers", () => {
    expect(HERO).toMatch(/accessibilityElementsHidden/);
    expect(HERO).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it("adds no animation", () => {
    expect(code(HERO)).not.toMatch(/Animated\.|useSharedValue|withTiming|withRepeat/);
  });

  it("compresses on short screens instead of crushing the plans", () => {
    expect(HERO).toMatch(/const COMPACT_BELOW = \d+;/);
    expect(HERO).toMatch(/const compact = height < COMPACT_BELOW;/);
  });

  it("contains no Pro feature checklist", () => {
    expect(code(HERO)).not.toMatch(/✓/);
    expect(code(HERO)).not.toMatch(/Generate Listings|3-photo|AI Context|4,000/);
  });

  it("stays inside the FlipStart palette", () => {
    expect(HERO).toMatch(/from "\.\.\/paywallTheme"/);
    expect(code(HERO)).not.toMatch(/#000000|#0A0A0A|#111111/);
  });
});

// ── 15-16. Architecture / cost ──────────────────────────────────────────────

describe("Deep Analysis remains client-derived", () => {
  /**
   * Re-verified rather than trusted from the earlier audit.
   *
   * utils/deepAnalysis.ts imports only a type and a local util. No fetch, no
   * tRPC, no Supabase — so opening Deep Analysis costs no model call and
   * consumes no scan, for anyone.
   */
  it("the derivation util makes no network or model call", () => {
    const c = code(DEEP_UTIL);
    expect(c).not.toMatch(/fetch\(|axios|supabase|trpc|mutateAsync|openai/i);
    const imports = c.match(/^import .*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const imp of imports) {
      expect(imp).toMatch(/@\/types\/flip|@\/utils\/recommendation/);
    }
  });

  it("the Deep Analysis screen issues no request to render analysis", () => {
    const c = code(ANALYSIS_SCREEN);
    // The only mutation on this screen is Generate Listings (Phase 3).
    const muts = c.match(/trpc\.[\w.]+\.use(Mutation|Query)/g) ?? [];
    expect(muts).toEqual(["trpc.scan.generateListings.useMutation"]);
  });

  /** The one server call in the gate is the preview counter, not AI. */
  it("the gate's only server call is the atomic preview consume", () => {
    const c = code(GATE);
    const calls = c.match(/trpc\.[\w.]+\.use(Mutation|Query)/g) ?? [];
    expect(calls).toEqual(["trpc.monetization.useDeepAnalysisPreview.useMutation"]);
  });
});

// ── 17-21, 38-45. Regression ────────────────────────────────────────────────

describe("regression", () => {
  /** Requirements 17, 38, 39. */
  it("Generate Listings is untouched", () => {
    const gl = read("lib/useGenerateListingsGate.ts");
    expect(gl).toMatch(/openProPaywall\("generate_listings", \{ onUnlocked: runOnce \}\)/);
    expect(gl).toMatch(/if \(action === "view_existing"\)/);
    expect(code(gl)).not.toMatch(/deep_analysis/);
    const dec = read("lib/generateListingsDecision.ts");
    expect(dec).toMatch(/if \(i\.hasExisting\) return "view_existing";/);
  });

  /** Requirement 40. */
  /** Superseded by Phase 5 — Third Photo now has its contextual paywall. */
  it("Third Photo migrated to its contextual paywall", () => {
    const camera = code(read("app/camera.tsx"));
    expect(camera).not.toMatch(/openProGate\(\s*['"]third_photo['"]/);
    expect(camera).toMatch(/openProPaywall\('third_photo'/);
  });

  /** Requirement 41. */
  /** Superseded by Phase 6 — AI Context migrated. */
  it("AI Context migrated to its contextual paywall", () => {
    const camera = code(read("app/camera.tsx"));
    expect(camera).not.toMatch(/openProGate\(/);
    expect(camera).toMatch(/openProPaywall\('camera_context'/);
  });

  /** Requirements 42-43. */
  it("Sold Comps and Hunt Mode remain Free", () => {
    expect(read("server/monetization/policy.ts")).toMatch(
      /case "sold_comps":\s*\n\s*case "hunt_mode":\s*return true;/,
    );
  });

  /** Requirement 45, at the server. */
  it("the capability matrix and pack rule are unchanged", () => {
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/case "generate_listings":\s*\n\s*case "deep_analysis":\s*return pro;/);
    expect(policy).toMatch(/Pack ownership is not a parameter here/);
    expect(policy).toMatch(/export const FREE_LIFETIME_SCANS = 15;/);
    expect(policy).toMatch(/export const MONTHLY_SCANS = 300;/);
    expect(policy).toMatch(/export const ANNUAL_SCANS = 4_000;/);
  });

  /** Requirement 44. */
  it("the Scan Store placeholder is untouched", () => {
    const store = read("app/scan-store.tsx");
    /**
     * Superseded by Phase 8 — the placeholder became the real Scan Store.
     * What still matters is that the store never grants anything itself.
     */
    expect(store).toContain("Scan Store");
    expect(store).toContain("Scan Packs add scan quantity only and do not unlock FlipStart Pro.");
  });

  /** The atomic preview consume must not have been touched. */
  it("the server preview RPC is unchanged", () => {
    const routers = read("server/routers.ts");
    expect(routers).toMatch(/rpc\("consume_deep_analysis_preview", \{ p_user_id: uid \}\)/);
  });

  it("ProGate itself is still mounted and intact", () => {
    expect(read("app/_layout.tsx")).toMatch(/<ProGateProvider>/);
    expect(read("components/monetization/ProGate.tsx")).toMatch(/generate_listings: 'Generate Listings'/);
  });

  /** Requirement 22. Dev preview reuses the existing picker. */
  it("the dev preview can show deep_analysis and creates no new screen", () => {
    const dev = read("app/dev-monetization.tsx");
    expect(dev).toMatch(/PAYWALL_SOURCES/);
    expect(dev).toMatch(/openProPaywall\(previewSource/);
    expect(dev).toMatch(/<ProPaywallHost \/>/);
    const extra = readdirSync(path.join(root, "app")).filter(f => /^dev-.*paywall/i.test(f));
    expect(extra).toEqual([]);
  });
});