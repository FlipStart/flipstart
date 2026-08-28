/**
 * __tests__/monetization/packs-and-lifetime.test.ts
 *
 * Three invariants about how packs, plans and the lifetime free allowance
 * interact. All three are things a user would feel immediately if they broke,
 * and none of them had a test.
 *
 *   1. While Pro, EVERY scan gets Pro features — including pack-funded ones.
 *   2. When the plan lapses, packs survive but Pro features do not.
 *   3. The lifetime free allowance never regenerates. Subscribing and lapsing
 *      returns the user to the count they had, not to 15.
 *
 * server/monetization/policy.ts has zero imports, so this runs in plain Node.
 *
 * ── What this file canNOT prove ─────────────────────────────────────────────
 * Every counter (`free_scans_used`, `pack_scan_balance`,
 * `subscription_scans_used`) is written by Postgres functions —
 * `apply_revenuecat_snapshot`, `reserve_scan`, `grant_scan_pack_purchase` — and
 * those live in drizzle/. This file pins the DERIVATION, which is the half that
 * is in TypeScript. See the report for the SQL check that covers the other half.
 */
import { describe, expect, it } from "vitest";
import {
  ANNUAL_SCANS,
  FREE_LIFETIME_SCANS,
  MONTHLY_SCANS,
  buildReadModel,
  canUseFeature,
  computeBalances,
  consumptionOrder,
  derivePlan,
  emptyUsage,
  maxPhotoSlots,
  type AccountUsage,
  type Feature,
} from "@/server/monetization/policy";

const NOW = new Date("2026-06-15T12:00:00Z");
const FUTURE = "2026-07-15T12:00:00Z";
const PAST = "2026-05-15T12:00:00Z";

/** Pro subscriber, with whatever usage and packs the case needs. */
const proUsage = (over: Partial<AccountUsage> = {}): AccountUsage => ({
  ...emptyUsage(),
  subscription_product_id: "flipstart_pro_monthly",
  subscription_period_start: PAST,
  subscription_period_end: FUTURE,
  ...over,
});

/** The same account after the subscription window closes. */
const lapsed = (u: AccountUsage): AccountUsage => ({
  ...u,
  subscription_period_end: PAST,
});

const PRO_FEATURES: Feature[] = [
  "scan_photo_3",
  "camera_context",
  "generate_listings",
  "deep_analysis",
];

// ── 1. Pack scans inherit Pro while the plan is active ──────────────────────

describe("packs bought while Pro", () => {
  /**
   * The mechanism, stated plainly: features are a function of PLAN, and a scan's
   * funding bucket is not an input to that function. There is no per-scan
   * feature record, so a pack-funded scan cannot differ from a
   * subscription-funded one.
   */
  it("gives every Pro feature regardless of which bucket funds the scan", () => {
    const u = proUsage({ pack_scan_balance: 2310 });
    for (const f of PRO_FEATURES) {
      expect(canUseFeature(derivePlan(u, NOW), f)).toBe(true);
    }
    expect(maxPhotoSlots(derivePlan(u, NOW))).toBe(3);
  });

  /**
   * The case that actually matters: subscription allowance fully spent, so the
   * NEXT scan is pack-funded. Features must be unchanged.
   */
  it("keeps 3-photo scans once the subscription allowance is exhausted", () => {
    const u = proUsage({
      subscription_scans_used: MONTHLY_SCANS, // nothing left in the sub bucket
      pack_scan_balance: 500,
    });
    const b = computeBalances(u, NOW);
    expect(b.subscriptionScansRemaining).toBe(0);
    expect(b.packScansRemaining).toBe(500);
    // Still spendable, and still Pro.
    expect(b.totalUsableScans).toBe(500);
    expect(buildReadModel(u, NOW).maxPhotoSlots).toBe(3);
    expect(buildReadModel(u, NOW).features.scan_photo_3).toBe(true);
  });

  it("spends the subscription allowance before touching packs", () => {
    expect(consumptionOrder("monthly")).toEqual(["subscription", "pack"]);
    expect(consumptionOrder("annual")).toEqual(["subscription", "pack"]);
  });

  /**
   * And never the lifetime free bucket.
   *
   * This is what preserves the free allowance across a subscription: a paying
   * user physically cannot draw from it, so free_scans_used cannot move while
   * they are Pro.
   */
  it("never draws from the lifetime free bucket while Pro", () => {
    for (const plan of ["monthly", "annual"] as const) {
      expect(consumptionOrder(plan)).not.toContain("free");
    }
  });
});

// ── 2. Packs survive the plan; Pro features do not ──────────────────────────

describe("when the subscription lapses", () => {
  it("reads as free the moment the period window closes", () => {
    const u = proUsage({ pack_scan_balance: 2310 });
    expect(derivePlan(u, NOW)).toBe("monthly");
    expect(derivePlan(lapsed(u), NOW)).toBe("free");
  });

  /** The packs the user paid for are still theirs. */
  it("keeps the full pack balance", () => {
    const u = proUsage({ pack_scan_balance: 2310, subscription_scans_used: 40 });
    const after = computeBalances(lapsed(u), NOW);
    expect(after.packScansRemaining).toBe(2310);
    expect(after.totalUsableScans).toBeGreaterThanOrEqual(2310);
    expect(consumptionOrder("free")).toContain("pack");
  });

  /** But those pack scans are ordinary Free scans now. */
  it("removes every Pro feature from those pack scans", () => {
    const u = lapsed(proUsage({ pack_scan_balance: 2310 }));
    const model = buildReadModel(u, NOW);
    for (const f of PRO_FEATURES) {
      expect(model.features[f]).toBe(false);
    }
    expect(model.maxPhotoSlots).toBe(2);
    expect(model.isPro).toBe(false);
    // Free features stay free.
    expect(model.features.sold_comps).toBe(true);
    expect(model.features.hunt_mode).toBe(true);
  });

  /** A huge pack balance is still not a plan. */
  it("does not let pack quantity imply capability", () => {
    const rich = lapsed(proUsage({ pack_scan_balance: 999_999 }));
    expect(buildReadModel(rich, NOW).features.deep_analysis).toBe(false);
    expect(buildReadModel(rich, NOW).features.scan_photo_3).toBe(false);
  });

  /** The stale subscription allowance must not remain spendable. */
  it("stops counting the subscription bucket toward usable scans", () => {
    const u = lapsed(proUsage({ subscription_scans_used: 10, pack_scan_balance: 100 }));
    const b = computeBalances(u, NOW);
    expect(b.subscriptionScansRemaining).toBe(0);
    expect(b.totalUsableScans).toBe(FREE_LIFETIME_SCANS + 100);
  });
});

// ── 3. The lifetime free allowance never regenerates ────────────────────────

describe("lifetime free allowance", () => {
  /**
   * The whole point of "lifetime": it is spent once, ever.
   *
   * A user who burned 10 of 15, subscribed, then lapsed must come back to 5 —
   * not to a fresh 15. `freeScansRemaining` is computed as
   * FREE_LIFETIME_SCANS - free_scans_used, so this holds exactly as long as
   * nothing resets that counter.
   */
  it("returns the user to what they had, not to a fresh 15", () => {
    const usedTen = { ...emptyUsage(), free_scans_used: 10 };
    expect(computeBalances(usedTen, NOW).freeScansRemaining).toBe(5);

    // Subscribes. The free bucket is untouched and unspendable.
    const subscribed = proUsage({ free_scans_used: 10, subscription_scans_used: 120 });
    expect(consumptionOrder(derivePlan(subscribed, NOW))).not.toContain("free");
    expect(computeBalances(subscribed, NOW).freeScansRemaining).toBe(5);

    // Lapses. Back to 5 — the count they left with.
    const after = computeBalances(lapsed(subscribed), NOW);
    expect(after.freeScansRemaining).toBe(5);
    expect(after.freeScansRemaining).not.toBe(FREE_LIFETIME_SCANS);
  });

  it("returns zero, never a refill, for a fully spent allowance", () => {
    const spent = lapsed(proUsage({ free_scans_used: FREE_LIFETIME_SCANS }));
    expect(computeBalances(spent, NOW).freeScansRemaining).toBe(0);
  });

  /**
   * Defence in depth, and deliberately NOT presented as a bug fix.
   *
   * The derivation used to floor at zero only, so a negative counter would
   * return more than the lifetime cap. Reading the SQL showed no application
   * path can produce one: refund_scan is idempotent (it matches
   * `state = 'reserved'`) and already wraps every decrement in greatest(0, ...).
   *
   * The clamp guards against a future SQL change or a hand-edited row, nothing
   * more. This test pins the derivation's behaviour, not a live vulnerability.
   */
  it("never reports more than the lifetime cap, even on a corrupt negative count", () => {
    for (const used of [-1, -5, -100]) {
      const weird = { ...emptyUsage(), free_scans_used: used };
      expect(computeBalances(weird, NOW).freeScansRemaining).toBe(FREE_LIFETIME_SCANS);
    }
  });

  it("clamps the subscription bucket to its allowance too", () => {
    const weird = proUsage({ subscription_scans_used: -50 });
    expect(computeBalances(weird, NOW).subscriptionScansRemaining).toBe(MONTHLY_SCANS);
  });

  it("treats a non-finite counter as spent rather than infinite", () => {
    const weird = { ...emptyUsage(), free_scans_used: Number.NaN };
    expect(computeBalances(weird, NOW).freeScansRemaining).toBe(0);
  });

  it("clamps a negative pack balance to zero rather than subtracting", () => {
    const weird = { ...emptyUsage(), pack_scan_balance: -20 };
    expect(computeBalances(weird, NOW).packScansRemaining).toBe(0);
    expect(computeBalances(weird, NOW).totalUsableScans).toBe(FREE_LIFETIME_SCANS);
  });

  /** Free + packs sums both spendable buckets. */
  it("adds packs on top of whatever free scans remain", () => {
    const u = { ...emptyUsage(), free_scans_used: 12, pack_scan_balance: 300 };
    const b = computeBalances(u, NOW);
    expect(b.freeScansRemaining).toBe(3);
    expect(b.packScansRemaining).toBe(300);
    expect(b.totalUsableScans).toBe(303);
  });
});

// ── Allowances themselves ───────────────────────────────────────────────────

describe("allowances are unchanged", () => {
  it("holds the shipped numbers", () => {
    expect(FREE_LIFETIME_SCANS).toBe(15);
    expect(MONTHLY_SCANS).toBe(300);
    expect(ANNUAL_SCANS).toBe(4000);
  });

  it("derives plan from the period window rather than a stored flag", () => {
    const active = proUsage();
    expect(derivePlan(active, new Date("2026-07-14T00:00:00Z"))).toBe("monthly");
    expect(derivePlan(active, new Date("2026-07-16T00:00:00Z"))).toBe("free");
  });

  it("recognises the annual product on both identifiers", () => {
    const annual = proUsage({ subscription_product_id: "flipstart_pro_annual" });
    expect(derivePlan(annual, NOW)).toBe("annual");
    expect(computeBalances(annual, NOW).subscriptionScansRemaining).toBe(ANNUAL_SCANS);
  });
});