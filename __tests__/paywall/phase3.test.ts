/**
 * __tests__/paywall/phase3.test.ts
 *
 * Phase 3 — Generate Listings contextual paywall.
 *
 * Pure-module assertions: config, copy, and the shared purchase machine as it
 * behaves for this source. Runs under `pnpm test` with no native modules, for
 * the same reason as the Phase 2 suite.
 *
 * The gate hook itself (lib/useGenerateListingsGate.ts) calls React hooks, so
 * its wiring is asserted structurally in phase3.structure.test.ts. What CAN be
 * proven here — and is — is that no purchase or restore outcome reaches
 * "unlocked" without the server, which is what actually stops a Free user
 * triggering an AI call.
 */
import { describe, expect, it } from "vitest";

import {
  PAYWALL_SOURCES,
  resolvePaywallConfig,
  type ProPaywallSource,
} from "@/lib/paywallConfig";

import {
  afterActivation,
  canPurchase,
  purchaseBlockedReason,
  purchaseSettled,
  restoreSettled,
  shouldShowAlreadyPro,
  type PurchaseAvailability,
} from "@/lib/paywallMachine";

const GL = () => resolvePaywallConfig("generate_listings");

const READY: PurchaseAvailability = {
  phase: "idle",
  productsStatus: "ready",
  selectedProductAvailable: true,
  entitlementStatus: "ready",
  isPro: false,
};

// ── 1-7. Visual / config requirements ───────────────────────────────────────

describe("generate_listings configuration", () => {
  /** Requirement 1. */
  it("has its own contextual config, not the generic placeholder", () => {
    const gl = GL();
    const generic = resolvePaywallConfig("deep_analysis");
    expect(gl.headline).not.toBe(generic.headline);
    expect(gl.subtitle).not.toBe(generic.subtitle);
    expect(gl.ctaLabel).not.toBe(generic.ctaLabel);
  });

  /** Requirement 2. */
  it("uses the exact specified headline", () => {
    expect(GL().headline).toBe("Turn Your Find Into a Listing");
  });

  it("does not use generic upgrade wording as the headline", () => {
    const h = GL().headline.toLowerCase();
    expect(h).not.toContain("upgrade to pro");
    expect(h).not.toContain("unlock premium");
    expect(h).not.toContain("become a pro");
  });

  it("keeps the established eyebrow rather than inventing a brand label", () => {
    expect(GL().eyebrow).toBe("FLIPSTART PRO");
  });

  /** Requirement 3. */
  it("names both marketplaces and the ready-to-edit outcome", () => {
    const sub = GL().subtitle;
    expect(sub).toContain("eBay");
    expect(sub).toContain("Depop");
    expect(sub).toMatch(/titles and descriptions/i);
    expect(sub).toMatch(/ready-to-edit/i);
    // Built from their scan — the thing that makes it theirs, not a template.
    expect(sub).toMatch(/from your scan/i);
  });

  /**
   * The claims FlipStart cannot make.
   *
   * Nothing here controls whether an item sells, for how much, or how fast.
   * A paywall implying otherwise is a refund request with extra steps.
   */
  it("promises no sales, prices, buyers or speed of sale", () => {
    const copy = `${GL().headline} ${GL().subtitle} ${GL().secondaryValueLine ?? ""}`.toLowerCase();
    for (const claim of [
      "guaranteed",
      "sell faster",
      "sells faster",
      "higher price",
      "more money",
      "instant buyer",
      "more sales",
    ]) {
      expect(copy).not.toContain(claim);
    }
  });

  /** Requirement 4. */
  it("uses the contextual CTA", () => {
    expect(GL().ctaLabel).toBe("Unlock Generate Listings");
  });

  it("does not fall back to generic CTA wording", () => {
    for (const generic of ["Unlock FlipStart Pro", "Subscribe Now", "Continue", "Upgrade"]) {
      expect(GL().ctaLabel).not.toBe(generic);
    }
  });

  /**
   * Requirement 5, and the commercial rule behind it.
   *
   * Someone here wants a listing. Scan packs buy quantity and cannot unlock the
   * capability at any balance, so routing them to the Scan Store would be
   * selling something that does not solve their problem.
   */
  it("never offers the Scan Store", () => {
    expect(GL().showScanStoreAlternative).toBe(false);
  });

  /** Requirement 7. The Test Store annual product is the no-trial replacement. */
  it("contains no free-trial language anywhere in its copy", () => {
    const copy = [
      GL().eyebrow,
      GL().headline,
      GL().subtitle,
      GL().ctaLabel,
      GL().secondaryValueLine ?? "",
    ]
      .join(" ")
      .toLowerCase();
    for (const trial of ["free trial", "trial", "7 days free", "try free", "days free"]) {
      expect(copy).not.toContain(trial);
    }
  });

  /**
   * The secondary line exists, and stays a single sentence.
   *
   * The brief allows acknowledging the rest of Pro but forbids a feature
   * checklist. Length is the thing that turns one into the other.
   */
  it("keeps the secondary value line short and tick-free", () => {
    const line = GL().secondaryValueLine;
    expect(line).toBeTruthy();
    expect(line!.length).toBeLessThan(110);
    expect(line!).not.toContain("✓");
    expect(line!.split("\n").length).toBe(1);
  });
});

// ── Other sources are untouched ─────────────────────────────────────────────

describe("other sources remain undesigned", () => {
  it("leaves the still-undesigned paywalls on generic copy", () => {
    // deep_analysis moved to contextual copy in Phase 4.
    for (const s of ["third_photo", "camera_context", "scan_limit"] as ProPaywallSource[]) {
      const c = resolvePaywallConfig(s);
      expect(c.headline).toBe("Unlock More From Every Find");
      expect(c.ctaLabel).toBe("Unlock FlipStart Pro");
      expect(c.secondaryValueLine).toBeNull();
    }
  });

  it("still offers the Scan Store only on scan_limit", () => {
    for (const s of PAYWALL_SOURCES) {
      expect(resolvePaywallConfig(s).showScanStoreAlternative).toBe(s === "scan_limit");
    }
  });
});

// ── 16-20, 24-26. Continuation must never precede authoritative Pro ─────────

describe("continuation requires authoritative Pro", () => {
  /**
   * Requirements 16, 17 and 26 — and the API-cost rule.
   *
   * "unlocked" is the ONLY phase the modal continues from. Any purchase outcome
   * that reaches a different phase cannot start a generation, which is what
   * keeps a Free user from ever costing us a model call.
   */
  it("no purchase outcome unlocks without server confirmation", () => {
    for (const status of [
      "success",
      "sync_pending",
      "cancelled",
      "pending",
      "error",
      "unavailable",
      "account_changed",
    ] as const) {
      expect(purchaseSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  /** Requirement 24. Cancelling must not generate, and must not look like a fault. */
  it("cancellation returns to idle silently and cannot continue", () => {
    const s = purchaseSettled({ status: "cancelled", target: "annual" });
    expect(s.phase).toBe("idle");
    expect(s.notice).toBeNull();
  });

  /** Requirement 25. */
  it("a failed purchase cannot continue and keeps the paywall open", () => {
    const s = purchaseSettled({ status: "error", message: "The App Store is unavailable." });
    expect(s.phase).toBe("idle");
    expect(s.notice?.tone).toBe("error");
  });

  /** Requirement 26. Paid but unconfirmed must NOT generate. */
  it("pending activation is terminal but never unlocked", () => {
    const s = afterActivation(false, "annual");
    expect(s.phase).toBe("pending_activation");
    expect(s.phase).not.toBe("unlocked");
  });

  it("only a confirmed server plan reaches the continuing phase", () => {
    expect(afterActivation(true, "annual").phase).toBe("unlocked");
    expect(afterActivation(true, "monthly").phase).toBe("unlocked");
  });

  /** Requirements 21-23. Restore follows the identical rule. */
  it("no restore outcome unlocks without server confirmation", () => {
    for (const status of [
      "restored",
      "nothing_to_restore",
      "error",
      "unavailable",
      "sync_pending",
      "account_changed",
      "owned_by_another_account",
    ] as const) {
      expect(restoreSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  /** Requirement 23. */
  it("a restore that finds nothing cannot continue", () => {
    const s = restoreSettled({ status: "nothing_to_restore" });
    expect(s.phase).toBe("idle");
  });
});

// ── 30-31. Entitlement loading ──────────────────────────────────────────────

describe("unresolved entitlement", () => {
  /** Requirement 30. */
  it("cannot purchase, and shows no Pro state, while unresolved", () => {
    const unresolved = { ...READY, entitlementStatus: "unresolved" as const };
    expect(canPurchase(unresolved)).toBe(false);
    expect(purchaseBlockedReason(unresolved)).toBe("entitlement_unresolved");
    expect(shouldShowAlreadyPro("unresolved", true, "idle")).toBe(false);
  });

  /**
   * Requirement 31.
   *
   * Unresolved is a third state, not a flavour of Free. The gate re-reads on
   * every tap rather than caching a guess — asserted structurally in
   * phase3.structure.test.ts, since it lives inside a hook.
   */
  it("does not treat an errored read as Free or as Pro", () => {
    expect(shouldShowAlreadyPro("error", true, "idle")).toBe(false);
    expect(shouldShowAlreadyPro("error", false, "idle")).toBe(false);
  });
});

// ── 29. Already Pro ─────────────────────────────────────────────────────────

describe("already Pro", () => {
  /** Requirement 29. No duplicate purchase experience. */
  it("blocks purchase and shows the already-member panel", () => {
    const pro = { ...READY, isPro: true };
    expect(canPurchase(pro)).toBe(false);
    expect(purchaseBlockedReason(pro)).toBe("already_pro");
    expect(shouldShowAlreadyPro("ready", true, "idle")).toBe(true);
  });
});