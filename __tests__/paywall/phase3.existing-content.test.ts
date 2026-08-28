/**
 * __tests__/paywall/phase3.existing-content.test.ts
 *
 * Existing listings are never gated. Only CREATING new ones is Pro.
 *
 * ── The bug this locks down ─────────────────────────────────────────────────
 * A Free user whose scan already had generated listings saw the Pro paywall,
 * on a button reading "View Listings", for content already stored on their
 * device. Showing it makes no model call, spends no scan and touches no
 * server — there was nothing to charge for.
 *
 * Every case runs against the real decision function, not a description of it.
 */
import { describe, expect, it } from "vitest";
import {
  decideAfterResolve,
  decideGenerateListingsAction,
  type GenerateListingsInput,
} from "@/lib/generateListingsDecision";

/**
 * Fixtures named after the matrix in the brief.
 *
 * Note there is no pack-balance field to set: the input type has none, so
 * "Free" and "Free + Packs" are the SAME input by construction. That is the
 * "packs buy quantity, never capability" rule enforced by the type rather than
 * by anyone remembering it.
 */
const free = (hasExisting: boolean): GenerateListingsInput => ({
  hasExisting,
  entitlementStatus: "ready",
  canGenerateListings: false,
});

const pro = (hasExisting: boolean): GenerateListingsInput => ({
  hasExisting,
  entitlementStatus: "ready",
  canGenerateListings: true,
});

// ── 1-3. Existing listings: everyone views, nobody is gated ─────────────────

describe("existing listings are viewable by everyone", () => {
  /** Requirement 1. */
  it("Free with existing listings views them directly", () => {
    expect(decideGenerateListingsAction(free(true))).toBe("view_existing");
  });

  /**
   * Requirement 2.
   *
   * "Free + Packs" is the same input as "Free" — there is no pack field to
   * differ on. Asserted explicitly so the intent is on the record.
   */
  it("Free + Packs with existing listings views them directly", () => {
    const freeWithPacks = free(true);
    expect(decideGenerateListingsAction(freeWithPacks)).toBe("view_existing");
    expect(decideGenerateListingsAction(freeWithPacks)).toBe(
      decideGenerateListingsAction(free(true)),
    );
  });

  it("no scan balance of any kind can reach the decision", () => {
    const keys = Object.keys(free(true));
    expect(keys.sort()).toEqual(
      ["canGenerateListings", "entitlementStatus", "hasExisting"].sort(),
    );
    for (const k of keys) {
      expect(k.toLowerCase()).not.toContain("pack");
      expect(k.toLowerCase()).not.toContain("scan");
      expect(k.toLowerCase()).not.toContain("balance");
    }
  });

  /** Requirement 3. */
  it("Monthly and Annual with existing listings view them directly", () => {
    expect(decideGenerateListingsAction(pro(true))).toBe("view_existing");
  });

  /**
   * Requirement 6, stated as strongly as a pure test can.
   *
   * "view_existing" is the only action that does not lead to the mutation, and
   * it is what EVERY caller with existing content receives — regardless of
   * plan, and regardless of whether entitlement resolved at all.
   */
  it("viewing never routes to generation, under any entitlement state", () => {
    for (const status of ["ready", "unresolved", "error"] as const) {
      for (const can of [true, false]) {
        const action = decideGenerateListingsAction({
          hasExisting: true,
          entitlementStatus: status,
          canGenerateListings: can,
        });
        expect(action).toBe("view_existing");
        expect(action).not.toBe("run");
        expect(action).not.toBe("paywall");
      }
    }
  });

  /**
   * Viewing survives a failed or pending entitlement read.
   *
   * There is nothing to fail closed about: the content is already on the
   * device, so an offline user must still be able to open it.
   */
  it("existing listings open even when entitlement cannot be resolved", () => {
    expect(
      decideGenerateListingsAction({
        hasExisting: true,
        entitlementStatus: "error",
        canGenerateListings: false,
      }),
    ).toBe("view_existing");
  });
});

// ── 4-5. Creating new listings is still gated ───────────────────────────────

describe("creating new listings is still Pro", () => {
  /** Requirement 4. */
  it("Free with no listings gets the paywall", () => {
    expect(decideGenerateListingsAction(free(false))).toBe("paywall");
  });

  it("Free + Packs with no listings still gets the paywall", () => {
    expect(decideGenerateListingsAction(free(false))).toBe("paywall");
  });

  /** Requirement 5. */
  it("Pro with no listings generates", () => {
    expect(decideGenerateListingsAction(pro(false))).toBe("run");
  });

  it("an unresolved entitlement with no listings resolves before deciding", () => {
    for (const status of ["unresolved", "error"] as const) {
      expect(
        decideGenerateListingsAction({
          hasExisting: false,
          entitlementStatus: status,
          canGenerateListings: false,
        }),
      ).toBe("resolve_then_decide");
    }
  });

  /** Unknown must never be silently treated as Pro. */
  it("never runs on an unresolved entitlement", () => {
    for (const status of ["unresolved", "error"] as const) {
      for (const can of [true, false]) {
        expect(
          decideGenerateListingsAction({
            hasExisting: false,
            entitlementStatus: status,
            canGenerateListings: can,
          }),
        ).not.toBe("run");
      }
    }
  });
});

// ── Post-resolution decision ────────────────────────────────────────────────

describe("after a single entitlement refetch", () => {
  it("runs only for a confirmed paid plan", () => {
    expect(decideAfterResolve("monthly")).toBe("run");
    expect(decideAfterResolve("annual")).toBe("run");
  });

  it("paywalls a confirmed free plan", () => {
    expect(decideAfterResolve("free")).toBe("paywall");
  });

  it("does nothing on an unknown plan rather than guessing", () => {
    for (const plan of [null, undefined, "", "trial", "unknown", "pro"]) {
      expect(decideAfterResolve(plan)).toBeNull();
    }
  });
});