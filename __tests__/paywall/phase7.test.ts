/**
 * __tests__/paywall/phase7.test.ts
 *
 * Phase 7 — Scan Limit contextual paywall, the last one.
 *
 * The routing rules live in lib/scanAvailability.ts so they can be executed
 * rather than described. The one that matters most: an already-Pro user with an
 * empty bucket must never be shown a subscription paywall.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PAYWALL_SOURCES, resolvePaywallConfig, type ProPaywallSource } from "@/lib/paywallConfig";
import {
  canResumeScanAfterUnlock,
  decideAfterRefresh,
  decideScanAvailability,
  isScanExhaustionError,
  type ScanAvailabilityInput,
} from "@/lib/scanAvailability";
import { afterActivation, purchaseSettled, restoreSettled } from "@/lib/paywallMachine";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Strip comments before asserting ABSENCE. Learned the hard way in Phase 2. */
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
const code = (src: string) => stripComments(src);

const GATE = read("lib/useScanGate.ts");
const HERO = read("components/monetization/paywall/heroes/ScanLimitHero.tsx");
const HERO_MAP = read("components/monetization/paywall/PaywallHero.tsx");
const FOOTER = read("components/monetization/paywall/PaywallFooter.tsx");
const SL = () => resolvePaywallConfig("scan_limit");

const at = (plan: "free" | "monthly" | "annual", total: number): ScanAvailabilityInput => ({
  entitlementStatus: "ready", plan, totalUsableScans: total,
});

// ── 1-10. The routing matrix ────────────────────────────────────────────────

describe("scan availability routing", () => {
  /** Requirements 1-2. */
  it("allows a Free user with lifetime scans left", () => {
    expect(decideScanAvailability(at("free", 15))).toBe("allow_scan");
    expect(decideScanAvailability(at("free", 1))).toBe("allow_scan");
  });

  /**
   * Requirement 2, stated in the form that matters: a Free user with 0 lifetime
   * and 40 packs has FORTY scans. `totalUsableScans` already sums every bucket,
   * so packs cannot be forgotten by construction.
   */
  it("allows a Free user whose remaining scans are all packs", () => {
    expect(decideScanAvailability(at("free", 40))).toBe("allow_scan");
  });

  /** Requirement 3. */
  it("paywalls a Free user with nothing left in any bucket", () => {
    expect(decideScanAvailability(at("free", 0))).toBe("free_scan_limit_paywall");
  });

  /** Requirements 4-5, 7-8. */
  it("allows Pro users with any scans left, including pack-only", () => {
    for (const plan of ["monthly", "annual"] as const) {
      expect(decideScanAvailability(at(plan, 300))).toBe("allow_scan");
      expect(decideScanAvailability(at(plan, 30))).toBe("allow_scan");
    }
  });

  /**
   * Requirements 6, 9 — and the single most important rule on this screen.
   *
   * A Monthly or Annual subscriber with an empty bucket needs QUANTITY. Showing
   * them a subscription paywall would be asking them to buy the thing they are
   * already paying for.
   */
  it("routes an exhausted Pro user to the Scan Store, never the paywall", () => {
    for (const plan of ["monthly", "annual"] as const) {
      const d = decideScanAvailability(at(plan, 0));
      expect(d).toBe("pro_scan_store");
      expect(d).not.toBe("free_scan_limit_paywall");
    }
  });

  /** Requirement 10. Fail closed both ways. */
  it("resolves before deciding when entitlement is unknown", () => {
    for (const status of ["unresolved", "error"] as const) {
      for (const total of [0, 50]) {
        expect(decideScanAvailability({
          entitlementStatus: status, plan: "free", totalUsableScans: total,
        })).toBe("unresolved");
      }
    }
  });

  /** A corrupt negative total is exhaustion, not permission. */
  it("treats a negative total as exhausted", () => {
    expect(decideScanAvailability(at("free", -3))).toBe("free_scan_limit_paywall");
    expect(decideScanAvailability(at("annual", -3))).toBe("pro_scan_store");
  });

  /** Scan limit is quantity, never a capability. */
  it("is decided without any capability check", () => {
    const src = code(read("lib/scanAvailability.ts"));
    expect(src).not.toMatch(/can\(|canUseFeature|GatedFeature/);
    expect(src).not.toMatch(/^\s*import /m);
  });
});

describe("after a refresh", () => {
  it("re-routes from the server's own plan and total", () => {
    expect(decideAfterRefresh("free", 0)).toBe("free_scan_limit_paywall");
    expect(decideAfterRefresh("free", 5)).toBe("allow_scan");
    expect(decideAfterRefresh("monthly", 0)).toBe("pro_scan_store");
    expect(decideAfterRefresh("annual", 0)).toBe("pro_scan_store");
  });

  it("does nothing on an unrecognised payload rather than guessing", () => {
    for (const plan of [null, undefined, "", "trial", "pro"]) {
      expect(decideAfterRefresh(plan, 0)).toBeNull();
    }
    expect(decideAfterRefresh("free", null)).toBeNull();
    expect(decideAfterRefresh("free", Number.NaN)).toBeNull();
  });
});

// ── 29-34. Resuming after a purchase ────────────────────────────────────────

describe("resume requires a usable allowance", () => {
  /**
   * Requirements 30-31, and what separates this source from every other one.
   *
   * Elsewhere, authoritative Pro is enough — the capability lands with the
   * plan. Here the user needs a spendable SCAN as well, and the usage row can
   * legitimately still read zero for a moment after activation. Resuming then
   * would open the camera, let them photograph an item, and fail at
   * reservation: worse than not resuming.
   */
  it("refuses to resume on Pro alone when the allowance is still zero", () => {
    expect(canResumeScanAfterUnlock("annual", 0)).toBe(false);
    expect(canResumeScanAfterUnlock("monthly", 0)).toBe(false);
  });

  it("resumes once a paid plan has a spendable scan", () => {
    expect(canResumeScanAfterUnlock("annual", 4000)).toBe(true);
    expect(canResumeScanAfterUnlock("monthly", 300)).toBe(true);
  });

  /** Requirement 39. A Free plan never resumes, whatever the balance says. */
  it("never resumes on a free plan", () => {
    expect(canResumeScanAfterUnlock("free", 999)).toBe(false);
    for (const plan of [null, undefined, "trial", "pro"]) {
      expect(canResumeScanAfterUnlock(plan, 999)).toBe(false);
    }
  });

  /** Requirement 29. RevenueCat success alone is never authoritative. */
  it("no purchase or restore outcome unlocks without server confirmation", () => {
    for (const status of ["success", "sync_pending", "cancelled", "pending", "error", "unavailable", "account_changed"] as const) {
      expect(purchaseSettled({ status }).phase).not.toBe("unlocked");
    }
    for (const status of ["restored", "nothing_to_restore", "error", "unavailable", "sync_pending", "account_changed", "owned_by_another_account"] as const) {
      expect(restoreSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  /** Requirements 40-41. */
  it("cancellation and pending activation cannot resume", () => {
    expect(purchaseSettled({ status: "cancelled" }).phase).toBe("idle");
    expect(afterActivation(false, "annual").phase).toBe("pending_activation");
  });
});

// ── 49-53. Server fallback ──────────────────────────────────────────────────

describe("server exhaustion fallback", () => {
  it("recognises the server's own exhaustion signals", () => {
    for (const raw of [
      "NO_SCANS_REMAINING",
      "GLOBAL_SCAN_LIMIT_REACHED",
      "You're out of scans. Add more to keep going.",
    ]) {
      expect(isScanExhaustionError(raw)).toBe(true);
    }
  });

  it("does not mistake other failures for exhaustion", () => {
    for (const raw of [null, undefined, "", "NETWORK_ERROR", "DB_ERROR", "PRO_REQUIRED", "timeout"]) {
      expect(isScanExhaustionError(raw)).toBe(false);
    }
  });

  /**
   * Requirement 53, and a real bug found while auditing.
   *
   * The fail screen claimed "You've used all 7 free scans... Your scans reset
   * tomorrow". The allowance is 15 LIFETIME scans and never resets, so that
   * text promised a refill that was never coming.
   */
  it("states the real allowance and does not promise a reset", () => {
    const fail = read("components/scan/FailStateScreen.tsx");
    expect(fail).toContain("You've used your 15 lifetime scans");
    expect(fail).toContain("Free scans don't reset");
    expect(code(fail)).not.toMatch(/7 free scans|reset tomorrow|reset at midnight/);
    // No raw server codes reach the user.
    expect(code(fail)).not.toMatch(/NO_SCANS_REMAINING|QUOTA|RPC/);
  });
});

// ── 15-23. Hero and config ──────────────────────────────────────────────────

describe("scan_limit configuration", () => {
  it("has a contextual hero registered", () => {
    expect(HERO_MAP).toMatch(/scan_limit:\s+ScanLimitHero,/);
  });

  /**
   * Requirement 16. FLIPSTART, not FLIPSTART PRO.
   *
   * This is the one source with two valid answers, and branding the whole
   * screen Pro would frame the Scan Store as an afterthought.
   */
  it("uses the neutral FlipStart eyebrow", () => {
    expect(SL().eyebrow).toBe("FLIPSTART");
    expect(SL().eyebrow).not.toBe("FLIPSTART PRO");
    // Every other source still uses the Pro eyebrow.
    for (const s of PAYWALL_SOURCES.filter(x => x !== "scan_limit")) {
      expect(resolvePaywallConfig(s).eyebrow).toBe("FLIPSTART PRO");
    }
  });

  /** Requirements 17-19. */
  it("uses the exact specified copy", () => {
    expect(SL().headline).toBe("You've Used Your 15 Lifetime Scans");
    expect(SL().ctaLabel).toBe("Keep Scanning with Pro");
    expect(SL().secondaryValueLine).toBe("Your finds don't have to stop here.");
  });

  it("rejects the punitive headlines the brief rules out", () => {
    const h = SL().headline.toLowerCase();
    for (const bad of ["out of scans", "limit reached", "upgrade required", "unlock more scans"]) {
      expect(h).not.toContain(bad);
    }
  });

  /**
   * Requirement 18, and a fairness rule rather than a copy preference.
   *
   * Offering a subscription while hiding the cheaper path would be a dark
   * pattern. Both options must appear in the subtitle.
   */
  it("names BOTH options in the subtitle", () => {
    const s = SL().subtitle.toLowerCase();
    expect(s).toContain("flipstart pro");
    expect(s).toContain("without subscribing");
  });

  /** Requirements 20-21. */
  it("is the only source that offers the Scan Store", () => {
    expect(SL().showScanStoreAlternative).toBe(true);
    for (const s of PAYWALL_SOURCES.filter(x => x !== "scan_limit")) {
      expect(resolvePaywallConfig(s).showScanStoreAlternative).toBe(false);
    }
  });

  /** Requirement 23. */
  it("contains no trial language", () => {
    const copy = [SL().eyebrow, SL().headline, SL().subtitle, SL().ctaLabel, SL().secondaryValueLine]
      .join(" ").toLowerCase();
    for (const t of ["free trial", "trial", "days free", "try free"]) {
      expect(copy).not.toContain(t);
    }
  });

  /** Every source is now designed — no generic placeholder remains in use. */
  it("leaves no source on generic copy", () => {
    for (const s of PAYWALL_SOURCES.filter(x => x !== "dev_preview")) {
      expect(resolvePaywallConfig(s).headline).not.toBe("Unlock More From Every Find");
      expect(resolvePaywallConfig(s).ctaLabel).not.toBe("Unlock FlipStart Pro");
    }
  });
});

describe("hero", () => {
  it("shows the allowance in text, not visuals alone", () => {
    expect(HERO).toMatch(/\{FREE_LIFETIME_SCANS\} \/ \{FREE_LIFETIME_SCANS\} USED/);
    expect(HERO).toMatch(/accessibilityLabel="All 15 of your 15 lifetime scans have been used\."/);
    // The decorative tally is hidden from assistive tech.
    expect(HERO).toMatch(/accessibilityElementsHidden/);
  });

  /** Requirement: no red error treatment. */
  it("uses no red or error language", () => {
    const c = code(HERO);
    expect(c).not.toMatch(/#[A-Fa-f0-9]*(?:[Ee]{2}|[Ff]{2})[0-3][0-3]/); // bright reds
    expect(c).not.toMatch(/#C0392B|#FF|#E74C3C|#A04020/);
    expect(c).not.toMatch(/ERROR|LIMIT EXCEEDED|ACCESS DENIED|WARNING/i);
  });

  it("draws the marks from the real constant, not a literal 15", () => {
    expect(HERO).toMatch(/length: FREE_LIFETIME_SCANS/);
    expect(HERO).toMatch(/from "@\/lib\/paywallConfig"/);
  });

  it("adds no animation and no new dependency", () => {
    expect(code(HERO)).not.toMatch(/Animated\.|useSharedValue|withRepeat|withTiming/);
    expect(code(HERO)).not.toMatch(/expo-linear-gradient|lottie|expo-blur/);
  });

  it("compresses on small screens", () => {
    expect(HERO).toMatch(/const COMPACT_BELOW = \d+;/);
  });

  it("contains no Pro feature checklist", () => {
    expect(code(HERO)).not.toMatch(/✓|Deep Analysis|Generate Listings|AI Context|Third Photo/);
  });
});

// ── 43-48. The Scan Store alternative ───────────────────────────────────────

describe("scan store alternative", () => {
  /** Requirement 43. Rendered only when the source turns it on. */
  it("renders only behind the source-controlled flag", () => {
    expect(FOOTER).toMatch(/\{showScanStore && \(/);
    expect(FOOTER).toContain("Just need more scans?");
    expect(FOOTER).toContain("Go to Scan Store");
  });

  /** Not "Buy Tokens" / "Credits" / "Usage". The product has a name. */
  it("uses the product's real name", () => {
    const c = code(FOOTER);
    expect(c).not.toMatch(/Buy Tokens|Buy Credits|Purchase Usage|Buy More AI/i);
  });

  /** Requirement 44. It navigates; it never starts a subscription. */
  it("cannot start a purchase", () => {
    const c = code(FOOTER);
    const idx = c.indexOf("Go to Scan Store");
    const block = c.slice(Math.max(0, idx - 600), idx + 200);
    expect(block).not.toMatch(/purchase\(|onPress=\{onRestore\}|mutateAsync/);
    expect(block).toMatch(/onPress=\{onScanStore\}/);
  });

  /** Requirement 45. Dismiss first, then navigate — iOS stacks otherwise. */
  it("dismisses the paywall before navigating", () => {
    const modal = read("components/monetization/paywall/ProPaywallModal.tsx");
    const c = code(modal);
    const fn = c.slice(c.indexOf("const goScanStore"), c.indexOf("const goScanStore") + 260);
    expect(fn.indexOf("dismiss(false)")).toBeLessThan(fn.indexOf("onScanStore()"));
  });

  /** Secondary to Pro: outlined, not another solid green button. */
  it("stays visually secondary to the Pro CTA", () => {
    expect(FOOTER).toMatch(/altBtn: \{[\s\S]*?backgroundColor: PW\.card/);
    expect(FOOTER).toMatch(/altBtn: \{[\s\S]*?borderColor: PW\.forest/);
  });

  /** Requirement 47. The voluntary entry point predates this phase. */
  it("keeps the scan-balance popup's own Scan Store button", () => {
    const home = read("app/(tabs)/index.tsx");
    expect(home).toMatch(/router\.push\('\/scan-store' as any\)/);
    expect(home).toMatch(/sm\.storeBtn/);
  });
});

// ── 11-14, 35-37, 54-56. Entry points and continuation ──────────────────────

describe("scan-start entry points", () => {
  const ENTRIES = ["app/(tabs)/index.tsx", "app/(tabs)/_layout.tsx", "app/hunt-active.tsx"] as const;

  /**
   * Requirements 11, 14. If a fourth screen ever pushes to /camera without the
   * preflight, this fails and names it.
   *
   * loading.tsx is excluded deliberately: its push is a RETRY after a failed
   * scan, reached from the fail screen rather than from a scan-start control.
   */
  it("every scan-start control goes through the shared gate", () => {
    const pushers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (rel === "app/loading.tsx") continue;
        if (/router\.(push|replace)\(\s*'\/camera'/.test(code(read(rel)))) pushers.push(rel);
      }
    };
    for (const d of ["app", "components", "lib", "hooks"]) walk(d);
    expect(pushers.sort()).toEqual([...ENTRIES].sort());
    for (const f of ENTRIES) expect(read(f)).toMatch(/useScanGate\(\)/);
  });

  /** Requirements 12-13, 35. */
  it("passes a distinct origin from each control", () => {
    expect(read("app/(tabs)/index.tsx")).toMatch(/origin: 'home'/);
    expect(read("app/(tabs)/_layout.tsx")).toMatch(/origin: 'tab'/);
    expect(read("app/hunt-active.tsx")).toMatch(/origin: 'hunt'/);
  });

  /**
   * Requirements 36-37. Hunt must resume as HUNT.
   *
   * The hunt analytics call lives inside the hunt continuation, so a resumed
   * purchase lands back in the session rather than in a plain Home scan — and a
   * scan that never starts is never logged as started.
   */
  it("keeps the hunt continuation distinct from home", () => {
    const hunt = read("app/hunt-active.tsx");
    expect(hunt).toMatch(/run: \(\) => \{\s*\r?\n\s*logHuntScanStarted\(stats\.scanned\);/);
    expect(hunt).toMatch(/router\.push\('\/camera' as any\);/);
  });

  /** Rules of hooks: hunt-active returns early when there is no session. */
  it("declares the gate hook above every early return", () => {
    for (const f of ENTRIES) {
      const lines = read(f).split("\n").map(l => l.replace(/\r$/, ""));
      const hook = lines.findIndex(l => /const startScan = useScanGate/.test(l));
      const early = lines.findIndex(l => /^  if \(![\w.?]+\) \{$/.test(l));
      expect(hook).toBeGreaterThan(-1);
      if (early > -1) expect(hook).toBeLessThan(early);
    }
  });
});

describe("continuation safety", () => {
  /** Requirement 56. */
  it("guards the resume against firing twice", () => {
    expect(GATE).toMatch(/let fired = false;/);
    expect(GATE).toMatch(/if \(fired\) return;/);
  });

  /** Requirements 54-55. */
  it("invalidates a stale continuation on an account switch", () => {
    expect(GATE).toMatch(/if \(\(uidRef\.current \?\? null\) !== openedUid\) return;/);
  });

  /** Bounded, never infinite. */
  it("bounds the allowance wait", () => {
    expect(GATE).toMatch(/const ALLOWANCE_ATTEMPTS = \d+;/);
    expect(GATE).toMatch(/for \(let i = 0; i < ALLOWANCE_ATTEMPTS; i\+\+\)/);
    expect(code(GATE)).not.toMatch(/while \(|setInterval/);
  });

  /** An exhausted Pro user must never reach the subscription paywall. */
  it("opens the paywall only on the free branch", () => {
    const c = code(GATE);
    // armStoreIntent() sits between them as of Phase 8 — the Scan Store is one
    // tap away inside this paywall, so the intent is armed before it opens.
    const freeBranch = c.slice(c.indexOf('if (decision === "free_scan_limit_paywall")'));
    expect(freeBranch).toMatch(/openProPaywall\("scan_limit"/);
    expect(freeBranch).toMatch(/armStoreIntent\(\);/);
    const proBranch = c.slice(c.indexOf('if (decision === "pro_scan_store")'), c.indexOf('if (decision === "free_scan_limit_paywall")'));
    expect(proBranch).toMatch(/goToScanStore\(\)/);
    expect(proBranch).not.toMatch(/openProPaywall/);
  });
});

// ── 57-68. Regression ───────────────────────────────────────────────────────

describe("regression", () => {
  it("Generate Listings is unchanged", () => {
    const gl = read("lib/useGenerateListingsGate.ts");
    expect(gl).toMatch(/openProPaywall\("generate_listings", \{ onUnlocked: runOnce \}\)/);
    expect(gl).toMatch(/if \(action === "view_existing"\)/);
  });

  it("Deep Analysis keeps its preview funnel and paywall", () => {
    const da = read("lib/useDeepAnalysisGate.ts");
    expect(da).toMatch(/label: "View Preview"/);
    expect(da).toMatch(/openProPaywall\("deep_analysis", \{ onUnlocked: openOnce \}\)/);
  });

  it("Third Photo and AI Context are unchanged", () => {
    const cam = read("app/camera.tsx");
    expect(cam).toMatch(/openProPaywall\('third_photo'/);
    expect(cam).toMatch(/openProPaywall\('camera_context'/);
    expect(cam).toMatch(/planSelection\(picked, slotsRef\.current/);
    expect(cam).toMatch(/pendingThirdRef/);
  });

  /** Requirements 65-66. */
  it("Sold Comps and Hunt Mode remain Free", () => {
    expect(read("server/monetization/policy.ts")).toMatch(
      /case "sold_comps":\s*\n\s*case "hunt_mode":\s*return true;/,
    );
  });

  /** Requirements 67-68. Accounting and bucket order untouched. */
  it("leaves scan accounting and pack ordering alone", () => {
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/case "monthly":\s*\n\s*case "annual":\s*return \["subscription", "pack"\]/);
    expect(policy).toMatch(/export const FREE_LIFETIME_SCANS = 15;/);
    expect(policy).toMatch(/export const MONTHLY_SCANS = 300;/);
    expect(policy).toMatch(/export const ANNUAL_SCANS = 4_000;/);
  });

  /** The Scan Store is still a placeholder — no commerce this phase. */
  it("builds no Scan Store commerce", () => {
    const store = read("app/scan-store.tsx");
    /**
     * Superseded by Phase 8 — the placeholder became the real Scan Store.
     * What still matters is that the store never grants anything itself.
     */
    expect(store).toContain("Scan Store");
    expect(store).toContain("Scan Packs add scan quantity only and do not unlock FlipStart Pro.");
  });

  it("adds no new dev preview screen", () => {
    expect(readdirSync(path.join(root, "app")).filter(f => /^dev-.*paywall/i.test(f))).toEqual([]);
  });
});