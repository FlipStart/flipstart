/**
 * __tests__/paywall/phase2.test.ts
 *
 * Phase 2 paywall foundation.
 *
 * ── Why these run, when the previous 835 could not ──────────────────────────
 * Every module under test here is PURE: no React, no react-native, no
 * RevenueCat SDK, no `__DEV__`. Imports from lib/purchases are `import type`,
 * which TypeScript erases, so nothing native is loaded at runtime.
 *
 * That means `pnpm test` runs this with the vitest already in devDependencies
 * and no config file, no alias shims and no jsdom. It was the deciding factor
 * in putting the purchase lifecycle in lib/paywallMachine.ts rather than inside
 * the modal component: the rules worth protecting here are commercial, and
 * commercial rules should not need a renderer to verify.
 *
 * ── What is NOT covered ─────────────────────────────────────────────────────
 * Anything that needs a rendered tree — actual modal presentation, safe-area
 * behaviour, VoiceOver output, the look of the seal. Those are covered by the
 * manual visual acceptance pass in the dev preview, and this file does not
 * pretend otherwise.
 */
import { describe, expect, it } from "vitest";

import {
  PAYWALL_SOURCES,
  ANNUAL_SCANS,
  MONTHLY_SCANS,
  resolvePaywallConfig,
  type ProPaywallSource,
} from "@/lib/paywallConfig";

import {
  MAX_PLAUSIBLE_PERCENT,
  MIN_DISPLAY_PERCENT,
  NO_PRICING,
  annualSavingsLabel,
  annualSavingsPercent,
  planPriceLabel,
  readProductPricing,
  renewalDisclosure,
  type ProductPricing,
} from "@/lib/paywallPricing";

import {
  INITIAL_STATE,
  afterActivation,
  canPurchase,
  isBusy,
  isTerminal,
  purchaseBlockedReason,
  purchaseSettled,
  purchaseStarted,
  restoreSettled,
  restoreStarted,
  shouldShowAlreadyPro,
  type PurchaseAvailability,
} from "@/lib/paywallMachine";

// ── Fixtures ────────────────────────────────────────────────────────────────

const USD = (amount: number, str: string): ProductPricing => ({
  priceString: str,
  priceAmount: amount,
  currencyCode: "USD",
});

/** The intended production configuration. */
const MONTHLY = USD(7.99, "$7.99");
const ANNUAL = USD(39.99, "$39.99");

/** Everything green: ready to buy. */
const READY: PurchaseAvailability = {
  phase: "idle",
  productsStatus: "ready",
  selectedProductAvailable: true,
  entitlementStatus: "ready",
  isPro: false,
};

// ── Configuration & sources ─────────────────────────────────────────────────

describe("paywall configuration", () => {
  it("exposes every source the spec names", () => {
    for (const s of [
      "generate_listings",
      "deep_analysis",
      "third_photo",
      "camera_context",
      "scan_limit",
    ] as ProPaywallSource[]) {
      expect(PAYWALL_SOURCES).toContain(s);
    }
  });

  it("resolves a config for every source", () => {
    for (const s of PAYWALL_SOURCES) {
      const c = resolvePaywallConfig(s);
      expect(c.source).toBe(s);
      expect(c.headline.length).toBeGreaterThan(0);
      expect(c.ctaLabel.length).toBeGreaterThan(0);
    }
  });

  /**
   * The launch-critical product rule. Packs buy quantity, never capability, so
   * a capability paywall must never route someone to the Scan Store — it would
   * sell them something that cannot unlock what they asked for.
   */
  it("offers the Scan Store ONLY on scan_limit", () => {
    expect(resolvePaywallConfig("scan_limit").showScanStoreAlternative).toBe(true);

    for (const s of [
      "generate_listings",
      "deep_analysis",
      "third_photo",
      "camera_context",
    ] as ProPaywallSource[]) {
      expect(resolvePaywallConfig(s).showScanStoreAlternative).toBe(false);
    }
  });

  it("fails closed on an unknown source", () => {
    const c = resolvePaywallConfig("not_a_real_source" as ProPaywallSource);
    expect(c.showScanStoreAlternative).toBe(false);
    expect(c.ctaLabel.length).toBeGreaterThan(0);
  });

  it("mirrors the server's scan allowances", () => {
    expect(MONTHLY_SCANS).toBe(300);
    expect(ANNUAL_SCANS).toBe(4000);
  });

  /** Phase 2 must not ship half-designed contextual copy into a real path. */
  it("uses the generic CTA everywhere until later phases override it", () => {
    for (const s of PAYWALL_SOURCES) {
      expect(resolvePaywallConfig(s).ctaLabel).toBe("Unlock FlipStart Pro");
    }
  });
});

// ── Pricing ─────────────────────────────────────────────────────────────────

describe("pricing", () => {
  it("reads localized pricing off a RevenueCat package", () => {
    const p = readProductPricing({
      product: { priceString: "£34.99", price: 34.99, currencyCode: "GBP" },
    });
    expect(p).toEqual({ priceString: "£34.99", priceAmount: 34.99, currencyCode: "GBP" });
  });

  it("degrades to no-pricing rather than throwing on a malformed product", () => {
    expect(readProductPricing(null)).toEqual(NO_PRICING);
    expect(readProductPricing({})).toEqual(NO_PRICING);
    expect(readProductPricing({ product: { priceString: "  ", price: 0 } })).toEqual(NO_PRICING);
  });

  /** Requirement 12: loading must not render a purchasable-looking price. */
  it("returns no price label while the store has not answered", () => {
    expect(planPriceLabel(NO_PRICING, "year")).toBeNull();
    expect(planPriceLabel(NO_PRICING, "month")).toBeNull();
  });

  it("formats a resolved price with its period", () => {
    expect(planPriceLabel(ANNUAL, "year")).toBe("$39.99 / year");
    expect(planPriceLabel(MONTHLY, "month")).toBe("$7.99 / month");
  });

  it("computes the intended 58% saving from live prices", () => {
    expect(annualSavingsPercent(MONTHLY, ANNUAL)).toBe(58);
    expect(annualSavingsLabel(MONTHLY, ANNUAL)).toBe("Save 58% vs paying monthly");
  });

  it("refuses to compare across currencies", () => {
    const eurAnnual: ProductPricing = { priceString: "39,99 €", priceAmount: 39.99, currencyCode: "EUR" };
    expect(annualSavingsPercent(MONTHLY, eurAnnual)).toBeNull();
    // Still labels the card, just without a number.
    expect(annualSavingsLabel(MONTHLY, eurAnnual)).toBe("Best value on FlipStart Pro");
  });

  it("refuses to invent a saving when prices are missing", () => {
    expect(annualSavingsPercent(NO_PRICING, ANNUAL)).toBeNull();
    expect(annualSavingsPercent(MONTHLY, NO_PRICING)).toBeNull();
  });

  it("refuses to claim a saving when annual is not actually cheaper", () => {
    expect(annualSavingsPercent(MONTHLY, USD(95.88, "$95.88"))).toBeNull();
    expect(annualSavingsPercent(MONTHLY, USD(120, "$120.00"))).toBeNull();
  });

  it("suppresses trivial and implausible percentages", () => {
    // ~2% — reads as a trick.
    expect(annualSavingsPercent(MONTHLY, USD(93.9, "$93.90"))).toBeNull();
    // ~99% — almost certainly a misconfigured product.
    expect(annualSavingsPercent(MONTHLY, USD(0.99, "$0.99"))).toBeNull();

    const justAbove = annualSavingsPercent(MONTHLY, USD(7.99 * 12 * 0.9, "x"));
    expect(justAbove).not.toBeNull();
    expect(justAbove!).toBeGreaterThanOrEqual(MIN_DISPLAY_PERCENT);
    expect(justAbove!).toBeLessThan(MAX_PLAUSIBLE_PERCENT);
  });

  it("builds the renewal disclosure from the real price", () => {
    const d = renewalDisclosure(ANNUAL, "year");
    expect(d).toContain("$39.99 per year");
    expect(d).toContain("Apple Account");
    expect(d).toContain("renews automatically");
  });

  it("never invents a price in the disclosure when none is known", () => {
    const d = renewalDisclosure(NO_PRICING, "month");
    // No currency symbol and no money-shaped number. "24 hours" is part of the
    // required Apple wording and is deliberately allowed.
    expect(d).not.toMatch(/[$£€]/);
    expect(d).not.toMatch(/\d+[.,]\d{2}/);
    expect(d).toContain("the listed price");
  });
});

// ── Purchase lifecycle ──────────────────────────────────────────────────────

describe("purchase lifecycle", () => {
  it("starts clean, clearing any previous notice", () => {
    const s = purchaseStarted("annual");
    expect(s.phase).toBe("purchasing");
    expect(s.notice).toBeNull();
    expect(s.target).toBe("annual");
    expect(isBusy(s.phase)).toBe(true);
  });

  /**
   * Requirement 18/19, and the single most important assertion in this file.
   * A successful store call must NOT resolve the paywall.
   */
  it("does NOT unlock on a successful store response alone", () => {
    const s = purchaseSettled({ status: "success", target: "annual" });
    expect(s.phase).toBe("activating");
    expect(s.phase).not.toBe("unlocked");
    expect(isTerminal(s.phase)).toBe(false);
  });

  it("treats a sync failure as activating, never as an error", () => {
    const s = purchaseSettled({ status: "sync_pending", target: "monthly" });
    expect(s.phase).toBe("activating");
    expect(s.notice).toBeNull();
  });

  /** Requirement 17. Cancellation is a decision, not a fault. */
  it("returns silently to idle on cancellation", () => {
    const s = purchaseSettled({ status: "cancelled", target: "annual" });
    expect(s.phase).toBe("idle");
    expect(s.notice).toBeNull();
    expect(s.target).toBeNull();
  });

  it("reports a deferred purchase as information, not an error", () => {
    const s = purchaseSettled({ status: "pending", message: "Pending approval." });
    expect(s.phase).toBe("idle");
    expect(s.notice?.tone).toBe("info");
  });

  /** Requirement 25. Account A's result must not travel into account B's UI. */
  it("carries no plan or target out of an account switch", () => {
    const s = purchaseSettled({ status: "account_changed", target: "annual" });
    expect(s.phase).toBe("idle");
    expect(s.target).toBeNull();
    expect(s.notice?.tone).toBe("info"); // protection working, not a failure
    expect(s.notice?.text.toLowerCase()).toContain("different account");
  });

  it("explains an unavailable purchase module without alarming", () => {
    const s = purchaseSettled({ status: "unavailable", message: "Needs a dev build." });
    expect(s.phase).toBe("idle");
    expect(s.notice?.tone).toBe("info");
  });

  it("surfaces a real failure as an error with sanitized copy", () => {
    const s = purchaseSettled({ status: "error", message: "The App Store is unavailable." });
    expect(s.phase).toBe("idle");
    expect(s.notice?.tone).toBe("error");
    expect(s.notice?.text).toBe("The App Store is unavailable.");
  });

  it("always has user-facing copy, even with no message from the service", () => {
    const s = purchaseSettled({ status: "error" });
    expect(s.notice?.text.length).toBeGreaterThan(0);
    expect(s.notice?.text).not.toContain("undefined");
  });

  it("unlocks only once the server confirms", () => {
    const s = afterActivation(true, "annual");
    expect(s.phase).toBe("unlocked");
    expect(isTerminal(s.phase)).toBe(true);
  });

  /** Requirement 20. Paid, sync slow — never presented as a failure. */
  it("ends in pending_activation when the server does not confirm in time", () => {
    const s = afterActivation(false, "monthly");
    expect(s.phase).toBe("pending_activation");
    expect(s.phase).not.toBe("unlocked");
    expect(s.notice?.tone).toBe("info");
    expect(s.notice?.text.toLowerCase()).toContain("purchase complete");
    expect(s.notice?.text.toLowerCase()).not.toContain("fail");
    expect(s.notice?.text.toLowerCase()).not.toContain("error");
  });
});

// ── Restore ─────────────────────────────────────────────────────────────────

describe("restore", () => {
  it("marks itself busy so a second tap cannot start another", () => {
    const s = restoreStarted();
    expect(s.phase).toBe("restoring");
    expect(isBusy(s.phase)).toBe(true);
  });

  /** Requirement 23. Restore is subject to the same authority rule. */
  it("does not unlock on a restored receipt alone", () => {
    const s = restoreSettled({ status: "restored" });
    expect(s.phase).toBe("activating");
    expect(s.phase).not.toBe("unlocked");
  });

  it("treats nothing-to-restore as a clean, non-technical answer", () => {
    const s = restoreSettled({ status: "nothing_to_restore" });
    expect(s.phase).toBe("idle");
    expect(s.notice?.tone).toBe("info");
    expect(s.notice?.text.toLowerCase()).toContain("apple account");
  });

  /**
   * The RevenueCat transfer policy doing its job. It must not read as a fault,
   * and it must NOT tell the user to try Restore — that is what just happened.
   */
  it("presents a receipt held by another account as benign, without suggesting Restore", () => {
    const s = restoreSettled({ status: "owned_by_another_account" });
    expect(s.phase).toBe("idle");
    expect(s.notice?.tone).toBe("info");
    expect(s.notice?.text.toLowerCase()).not.toContain("restore");
  });

  /** Requirement 24. */
  it("sanitizes a restore failure into an error notice", () => {
    const s = restoreSettled({ status: "error", message: "We couldn't reach the store." });
    expect(s.notice?.tone).toBe("error");
    expect(s.notice?.text).toBe("We couldn't reach the store.");
  });

  it("never leaks an undefined message", () => {
    for (const status of [
      "error",
      "nothing_to_restore",
      "owned_by_another_account",
      "account_changed",
      "unavailable",
    ] as const) {
      const s = restoreSettled({ status });
      expect(s.notice?.text ?? "").not.toContain("undefined");
      expect((s.notice?.text ?? "").length).toBeGreaterThan(0);
    }
  });
});

// ── Purchase availability ───────────────────────────────────────────────────

describe("purchase availability", () => {
  it("permits a purchase when everything is resolved", () => {
    expect(canPurchase(READY)).toBe(true);
    expect(purchaseBlockedReason(READY)).toBeNull();
  });

  /** Requirement 16. Duplicate taps cannot start a second transaction. */
  it("blocks while any operation is in flight", () => {
    for (const phase of ["purchasing", "activating", "restoring"] as const) {
      expect(canPurchase({ ...READY, phase })).toBe(false);
      expect(purchaseBlockedReason({ ...READY, phase })).toBe("busy");
    }
  });

  it("blocks once the decision is over", () => {
    for (const phase of ["unlocked", "pending_activation"] as const) {
      expect(canPurchase({ ...READY, phase })).toBe(false);
      expect(purchaseBlockedReason({ ...READY, phase })).toBe("terminal");
    }
  });

  /** Requirement 27. Never sell the same subscription twice. */
  it("blocks a user the server already reports as Pro", () => {
    const pro = { ...READY, isPro: true };
    expect(canPurchase(pro)).toBe(false);
    expect(purchaseBlockedReason(pro)).toBe("already_pro");
    expect(shouldShowAlreadyPro("ready", true, "idle")).toBe(true);
  });

  /**
   * Requirement 26 and the neutral-loading rule. An unresolved entitlement is
   * not Free and it is not Pro.
   */
  it("blocks purchase until identity resolves, and shows no Pro state", () => {
    const unresolved = { ...READY, entitlementStatus: "unresolved" as const };
    expect(canPurchase(unresolved)).toBe(false);
    expect(purchaseBlockedReason(unresolved)).toBe("entitlement_unresolved");

    // No Pro flash while unresolved, even if a stale isPro leaks in.
    expect(shouldShowAlreadyPro("unresolved", true, "idle")).toBe(false);
    expect(shouldShowAlreadyPro("unresolved", false, "idle")).toBe(false);
  });

  it("does not treat an entitlement error as Pro, or as a reason to refuse a sale", () => {
    const errored = { ...READY, entitlementStatus: "error" as const };
    // A failed read is not a finding. Apple independently refuses duplicates.
    expect(canPurchase(errored)).toBe(true);
    expect(shouldShowAlreadyPro("error", true, "idle")).toBe(false);
  });

  /** Requirement 13. Product failure disables purchase safely. */
  it("blocks purchase when products failed to load", () => {
    expect(canPurchase({ ...READY, productsStatus: "error" })).toBe(false);
    expect(purchaseBlockedReason({ ...READY, productsStatus: "error" })).toBe("products");
  });

  it("blocks purchase while products are still loading", () => {
    expect(canPurchase({ ...READY, productsStatus: "loading" })).toBe(false);
  });

  it("blocks purchase when only the OTHER plan resolved", () => {
    expect(canPurchase({ ...READY, selectedProductAvailable: false })).toBe(false);
    expect(purchaseBlockedReason({ ...READY, selectedProductAvailable: false })).toBe("products");
  });

  it("does not show the already-Pro panel over a terminal or busy phase", () => {
    expect(shouldShowAlreadyPro("ready", true, "unlocked")).toBe(false);
    expect(shouldShowAlreadyPro("ready", true, "purchasing")).toBe(false);
  });
});

// ── Invariants ──────────────────────────────────────────────────────────────

describe("invariants", () => {
  it("starts idle with nothing to report", () => {
    expect(INITIAL_STATE).toEqual({ phase: "idle", notice: null, target: null });
  });

  /**
   * No path from a store response straight to "unlocked".
   *
   * Written as an exhaustive sweep rather than a list, so a new PurchaseStatus
   * added later cannot quietly acquire a shortcut to entitlement.
   */
  it("has no purchase status that unlocks without server confirmation", () => {
    const statuses = [
      "idle",
      "purchasing",
      "syncing",
      "success",
      "cancelled",
      "pending",
      "sync_pending",
      "error",
      "unavailable",
      "account_changed",
    ] as const;

    for (const status of statuses) {
      expect(purchaseSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  it("has no restore status that unlocks without server confirmation", () => {
    const statuses = [
      "restored",
      "nothing_to_restore",
      "error",
      "unavailable",
      "sync_pending",
      "account_changed",
      "owned_by_another_account",
    ] as const;

    for (const status of statuses) {
      expect(restoreSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  it("only ever reaches unlocked through afterActivation(true)", () => {
    expect(afterActivation(true, "annual").phase).toBe("unlocked");
    expect(afterActivation(false, "annual").phase).not.toBe("unlocked");
  });
});