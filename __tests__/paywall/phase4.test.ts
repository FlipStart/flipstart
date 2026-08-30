/**
 * __tests__/paywall/phase4.test.ts
 *
 * Phase 4 — Deep Analysis contextual paywall + preview funnel.
 *
 * Pure-module assertions. The decision logic lives in
 * lib/deepAnalysisDecision.ts precisely so the rules that matter — who sees a
 * paywall, when a one-time lifetime preview is spent, whether a Free user
 * reaches paid content — can be executed rather than described.
 */
import { describe, expect, it } from "vitest";

import { PAYWALL_SOURCES, resolvePaywallConfig, type ProPaywallSource } from "@/lib/paywallConfig";
import {
  decideAfterResolve,
  decideDeepAnalysisAction,
  previewConsumeOpens,
  type DeepAnalysisInput,
} from "@/lib/deepAnalysisDecision";
import {
  afterActivation,
  canPurchase,
  purchaseBlockedReason,
  purchaseSettled,
  restoreSettled,
  shouldShowAlreadyPro,
  type PurchaseAvailability,
} from "@/lib/paywallMachine";

const DA = () => resolvePaywallConfig("deep_analysis");

/**
 * Fixtures.
 *
 * There is no scan-balance field to set, so "Free" and "Free + Packs" are the
 * SAME input by construction — requirement 14 and 45 enforced by the type
 * rather than by anyone remembering the rule.
 */
const free = (previewAvailable: boolean): DeepAnalysisInput => ({
  entitlementStatus: "ready",
  canDeepAnalysis: false,
  previewAvailable,
});
const pro = (): DeepAnalysisInput => ({
  entitlementStatus: "ready",
  canDeepAnalysis: true,
  previewAvailable: false,
});

const READY: PurchaseAvailability = {
  phase: "idle",
  productsStatus: "ready",
  selectedProductAvailable: true,
  entitlementStatus: "ready",
  isPro: false,
};

// ── 3-10. Hero / config ─────────────────────────────────────────────────────

describe("deep_analysis configuration", () => {
  /** Requirement 3. */
  it("has its own contextual config, not the generic placeholder", () => {
    const generic = resolvePaywallConfig("third_photo");
    expect(DA().headline).not.toBe(generic.headline);
    expect(DA().ctaLabel).not.toBe(generic.ctaLabel);
    expect(DA().secondaryValueLine).not.toBeNull();
  });

  /** Requirement 4. */
  it("uses the shared eyebrow", () => {
    expect(DA().eyebrow).toBe("FLIPSTART PRO");
  });

  /** Requirement 5. */
  it("uses the exact specified headline", () => {
    expect(DA().headline).toBe("See the Full Picture");
  });

  it("rejects the generic headlines the brief rules out", () => {
    const h = DA().headline.toLowerCase();
    for (const bad of ["unlock premium", "get more analysis", "upgrade to pro", "deep analysis locked"]) {
      expect(h).not.toContain(bad);
    }
  });

  /** Requirement 6. */
  it("names all four dimensions of depth", () => {
    const sub = DA().subtitle.toLowerCase();
    for (const concept of ["pricing", "market", "risk", "resale"]) {
      expect(sub).toContain(concept);
    }
    expect(sub).toContain("beyond the quick scan");
  });

  /**
   * Deep Analysis is reasoning over a scan, not an appraisal. Copy implying
   * certainty would be a claim we cannot stand behind.
   */
  it("promises no guaranteed pricing, profit or authenticity", () => {
    const copy = `${DA().headline} ${DA().subtitle} ${DA().secondaryValueLine ?? ""}`.toLowerCase();
    for (const claim of ["guarantee", "guaranteed", "accurate pricing", "authenticity", "profit"]) {
      expect(copy).not.toContain(claim);
    }
  });

  /** Requirement 7. */
  it("uses the contextual CTA", () => {
    expect(DA().ctaLabel).toBe("Unlock Deep Analysis");
  });

  it("does not fall back to generic CTA wording", () => {
    for (const bad of ["Upgrade", "Unlock Pro", "Continue", "Subscribe", "Unlock FlipStart Pro"]) {
      expect(DA().ctaLabel).not.toBe(bad);
    }
  });

  /** Requirement 8. Packs cannot unlock a capability, at any balance. */
  it("never offers the Scan Store", () => {
    expect(DA().showScanStoreAlternative).toBe(false);
  });

  /** Requirement 10. */
  it("contains no trial language", () => {
    const copy = [DA().eyebrow, DA().headline, DA().subtitle, DA().ctaLabel, DA().secondaryValueLine ?? ""]
      .join(" ")
      .toLowerCase();
    for (const trial of ["free trial", "trial", "days free", "try free"]) {
      expect(copy).not.toContain(trial);
    }
  });

  it("keeps the secondary value line to one short, tick-free sentence", () => {
    const line = DA().secondaryValueLine!;
    expect(line).toBe("Dig deeper before you buy or sell.");
    expect(line.length).toBeLessThan(110);
    expect(line).not.toContain("✓");
  });

  /** Phase 3 must not have moved. */
  it("leaves generate_listings copy untouched", () => {
    const gl = resolvePaywallConfig("generate_listings");
    expect(gl.headline).toBe("Turn Your Find Into a Listing");
    expect(gl.ctaLabel).toBe("Unlock Generate Listings");
  });

  /**
   * Superseded by Phase 7 — every source now has designed copy.
   *
   * GENERIC survives only as the fail-closed fallback for an unrecognised
   * source, which is what this now pins instead.
   */
  it("keeps a generic fallback for an unrecognised source", () => {
    const fallback = resolvePaywallConfig("not_a_real_source" as ProPaywallSource);
    expect(fallback.headline).toBe("Unlock More From Every Find");
    expect(fallback.ctaLabel).toBe("Unlock FlipStart Pro");
    expect(fallback.showScanStoreAlternative).toBe(false);
  });

  /** Requirement 44. */
  it("still offers the Scan Store only on scan_limit", () => {
    for (const s of PAYWALL_SOURCES) {
      expect(resolvePaywallConfig(s).showScanStoreAlternative).toBe(s === "scan_limit");
    }
  });
});

// ── 11-17. The three tiers ──────────────────────────────────────────────────

describe("three-tier gate", () => {
  /** Requirements 15-17. */
  it("Pro opens Deep Analysis directly, with no paywall and no preview offer", () => {
    const action = decideDeepAnalysisAction(pro());
    expect(action).toBe("open");
    expect(action).not.toBe("paywall");
    expect(action).not.toBe("offer_preview");
  });

  it("Pro never sees a preview offer even if the flag is somehow set", () => {
    expect(
      decideDeepAnalysisAction({
        entitlementStatus: "ready",
        canDeepAnalysis: true,
        previewAvailable: true,
      }),
    ).toBe("open");
  });

  /**
   * The funnel decision: preview BEFORE paywall.
   *
   * Asking someone to buy a feature they have never seen is the weaker funnel,
   * and they were already promised this look.
   */
  it("Free with an unused preview gets the preview offer, not the paywall", () => {
    expect(decideDeepAnalysisAction(free(true))).toBe("offer_preview");
  });

  /** Requirement 12. */
  it("Free with the preview spent gets the contextual paywall", () => {
    expect(decideDeepAnalysisAction(free(false))).toBe("paywall");
  });

  /** Requirement 14 / 45. */
  it("Free + Packs is indistinguishable from Free", () => {
    const keys = Object.keys(free(true)).sort();
    expect(keys).toEqual(["canDeepAnalysis", "entitlementStatus", "previewAvailable"]);
    for (const k of keys) {
      expect(k.toLowerCase()).not.toContain("pack");
      expect(k.toLowerCase()).not.toContain("scan");
      expect(k.toLowerCase()).not.toContain("balance");
    }
  });

  /**
   * Requirement 13, and the reason the unknown state exists at all.
   *
   * Never assume Free (paywalls a subscriber), never assume Pro (opens paid
   * content), and never assume the preview is available — offering a preview we
   * cannot confirm they hold would spend a lifetime grant on a guess.
   */
  it("resolves before deciding when entitlement is unknown", () => {
    for (const status of ["unresolved", "error"] as const) {
      for (const can of [true, false]) {
        for (const prev of [true, false]) {
          const action = decideDeepAnalysisAction({
            entitlementStatus: status,
            canDeepAnalysis: can,
            previewAvailable: prev,
          });
          expect(action).toBe("resolve_then_decide");
          expect(action).not.toBe("open");
          expect(action).not.toBe("offer_preview");
        }
      }
    }
  });
});

// ── Post-resolution ─────────────────────────────────────────────────────────

describe("after a single entitlement refetch", () => {
  it("opens only for a confirmed paid plan", () => {
    expect(decideAfterResolve("monthly", false)).toBe("open");
    expect(decideAfterResolve("annual", false)).toBe("open");
  });

  it("routes a confirmed Free user to their preview first, then the paywall", () => {
    expect(decideAfterResolve("free", true)).toBe("offer_preview");
    expect(decideAfterResolve("free", false)).toBe("paywall");
  });

  it("does nothing on an unknown plan rather than guessing", () => {
    for (const plan of [null, undefined, "", "trial", "pro", "unknown"]) {
      expect(decideAfterResolve(plan, true)).toBeNull();
      expect(decideAfterResolve(plan, false)).toBeNull();
    }
  });
});

// ── Preview consume ─────────────────────────────────────────────────────────

describe("preview consume", () => {
  it("opens only on an explicit granted:true", () => {
    expect(previewConsumeOpens({ granted: true })).toBe(true);
  });

  /**
   * Everything else opens NOTHING. An unverified grant for a paid-tier feature
   * is worse than making the user tap again — and the preview is not consumed,
   * so nothing is lost.
   */
  it("opens nothing for any other response", () => {
    for (const res of [
      null,
      undefined,
      {},
      { granted: false },
      { granted: "true" },
      { granted: 1 },
      "granted",
      0,
      [],
    ]) {
      expect(previewConsumeOpens(res)).toBe(false);
    }
  });
});

// ── 21-31. Purchase continuation ────────────────────────────────────────────

describe("continuation requires authoritative Pro", () => {
  /** Requirements 21-23. RevenueCat success alone must not navigate. */
  it("no purchase outcome unlocks without server confirmation", () => {
    for (const status of [
      "success", "sync_pending", "cancelled", "pending", "error", "unavailable", "account_changed",
    ] as const) {
      expect(purchaseSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  /** Requirement 24. */
  it("only a confirmed server plan reaches the continuing phase", () => {
    expect(afterActivation(true, "annual").phase).toBe("unlocked");
    expect(afterActivation(true, "monthly").phase).toBe("unlocked");
  });

  /** Requirement 31. */
  it("pending activation is terminal but never unlocked", () => {
    const s = afterActivation(false, "annual");
    expect(s.phase).toBe("pending_activation");
    expect(s.phase).not.toBe("unlocked");
    expect(s.notice?.tone).toBe("info");
  });

  /** Requirement 29. */
  it("cancellation returns silently and cannot continue", () => {
    const s = purchaseSettled({ status: "cancelled", target: "annual" });
    expect(s.phase).toBe("idle");
    expect(s.notice).toBeNull();
  });

  /** Requirement 30. */
  it("a failed purchase cannot continue and keeps the paywall open", () => {
    const s = purchaseSettled({ status: "error", message: "The App Store is unavailable." });
    expect(s.phase).toBe("idle");
    expect(s.notice?.tone).toBe("error");
  });

  /** Requirements 27-28. */
  it("no restore outcome unlocks without server confirmation", () => {
    for (const status of [
      "restored", "nothing_to_restore", "error", "unavailable",
      "sync_pending", "account_changed", "owned_by_another_account",
    ] as const) {
      expect(restoreSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  it("a restore that finds nothing cannot continue", () => {
    expect(restoreSettled({ status: "nothing_to_restore" }).phase).toBe("idle");
  });
});

// ── 34. Already Pro ─────────────────────────────────────────────────────────

describe("already Pro", () => {
  it("blocks a second purchase and shows the member panel", () => {
    const proAvail = { ...READY, isPro: true };
    expect(canPurchase(proAvail)).toBe(false);
    expect(purchaseBlockedReason(proAvail)).toBe("already_pro");
    expect(shouldShowAlreadyPro("ready", true, "idle")).toBe(true);
  });

  it("shows no Pro state while entitlement is unresolved", () => {
    expect(shouldShowAlreadyPro("unresolved", true, "idle")).toBe(false);
  });
});