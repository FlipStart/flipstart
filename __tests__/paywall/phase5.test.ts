/**
 * __tests__/paywall/phase5.test.ts
 *
 * Phase 5 — Third Photo contextual paywall, camera and library origins.
 *
 * The slot rules live in lib/thirdPhotoDecision.ts precisely so they can be
 * executed here rather than described: whether a Free user's image reaches the
 * scan payload is not something to verify by reading a camera screen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PAYWALL_SOURCES, resolvePaywallConfig, type ProPaywallSource } from "@/lib/paywallConfig";
import {
  FREE_SLOTS,
  MAX_SLOTS,
  SLOT_FILL_ORDER,
  allowedSlots,
  decideCameraTap,
  decidePromotion,
  planSelection,
  type PromotionContext,
} from "@/lib/thirdPhotoDecision";
import { afterActivation, purchaseSettled, restoreSettled } from "@/lib/paywallMachine";

const TP = () => resolvePaywallConfig("third_photo");

/** Named assets, so failures read like the manual tests. */
const A = "assetA", B = "assetB", C = "assetC", D = "assetD";

const READY_PRO = { status: "ready" as const, slots: 3 };
const READY_FREE = { status: "ready" as const, slots: 2 };

// ── 6-13. Hero / config ─────────────────────────────────────────────────────

describe("third_photo configuration", () => {
  it("has its own contextual config", () => {
    const generic = resolvePaywallConfig("camera_context");
    expect(TP().headline).not.toBe(generic.headline);
    expect(TP().ctaLabel).not.toBe(generic.ctaLabel);
  });

  /** Requirement 7. */
  it("uses the shared eyebrow", () => {
    expect(TP().eyebrow).toBe("FLIPSTART PRO");
  });

  /** Requirement 8. */
  it("uses the exact specified headline", () => {
    expect(TP().headline).toBe("Give FlipStart Another Angle");
  });

  it("rejects every limit-flavoured headline the brief rules out", () => {
    const h = TP().headline.toLowerCase();
    for (const bad of [
      "unlock premium photos",
      "photo limit reached",
      "upgrade to add more",
      "third photo locked",
    ]) {
      expect(h).not.toContain(bad);
    }
  });

  /** Requirement 9. */
  it("explains another angle, detail or tag", () => {
    const sub = TP().subtitle.toLowerCase();
    expect(sub).toContain("third photo");
    expect(sub).toContain("angle");
    expect(sub).toContain("detail");
    expect(sub).toContain("tag");
  });

  /**
   * More input is not a guarantee of a better answer. Claiming otherwise is a
   * promise FlipStart cannot keep.
   */
  it("promises no accuracy, identification or confidence gain", () => {
    const copy = `${TP().headline} ${TP().subtitle} ${TP().secondaryValueLine ?? ""}`.toLowerCase();
    for (const claim of ["guarantee", "accurate", "confidence score", "identif", "more likely"]) {
      expect(copy).not.toContain(claim);
    }
  });

  /** Requirement 10. */
  it("uses the contextual CTA", () => {
    expect(TP().ctaLabel).toBe("Unlock Third Photo");
    for (const bad of ["Upgrade", "Subscribe", "Unlock Pro", "Continue"]) {
      expect(TP().ctaLabel).not.toBe(bad);
    }
  });

  /** Requirement 11. Packs never unlock a photo slot. */
  it("never offers the Scan Store", () => {
    expect(TP().showScanStoreAlternative).toBe(false);
    for (const s of PAYWALL_SOURCES) {
      expect(resolvePaywallConfig(s).showScanStoreAlternative).toBe(s === "scan_limit");
    }
  });

  /** Requirement 13. */
  it("contains no trial language", () => {
    const copy = [TP().eyebrow, TP().headline, TP().subtitle, TP().ctaLabel, TP().secondaryValueLine ?? ""]
      .join(" ")
      .toLowerCase();
    for (const t of ["free trial", "trial", "days free", "try free"]) {
      expect(copy).not.toContain(t);
    }
  });

  it("keeps the secondary line short", () => {
    expect(TP().secondaryValueLine).toBe("More visual evidence for your scan.");
  });

  /**
   * Superseded by Phase 7 — every source now has designed copy.
   *
   * GENERIC survives only as the fail-closed fallback for an unrecognised
   * source, which is what this now pins instead.
   */
  it("keeps a generic fallback for an unrecognised source (phase5)", () => {
    const fallback = resolvePaywallConfig("not_a_real_source" as ProPaywallSource);
    expect(fallback.headline).toBe("Unlock More From Every Find");
    expect(fallback.ctaLabel).toBe("Unlock FlipStart Pro");
    expect(fallback.showScanStoreAlternative).toBe(false);
  });
});

// ── 59-60. Slot allowance ───────────────────────────────────────────────────

describe("slot allowance", () => {
  /** Requirement 59. Unresolved must not grant a premium slot. */
  it("fails closed while entitlement is unresolved", () => {
    for (const status of ["unresolved", "error"] as const) {
      expect(allowedSlots(status, 3)).toBe(FREE_SLOTS);
    }
  });

  it("grants three only to a resolved Pro", () => {
    expect(allowedSlots("ready", 3)).toBe(MAX_SLOTS);
    expect(allowedSlots("ready", 2)).toBe(FREE_SLOTS);
  });

  /**
   * Requirement 60. There is no pack parameter in this signature, so no balance
   * can widen the allowance — the rule is enforced by the type.
   */
  /**
   * Asserted on the SOURCE, not on Function.length.
   *
   * `length` excludes parameters with defaults, so adding
   * `packBalance = 0` to the signature left it at 2 and the test passed while
   * packs unlocked Photo 3. The mutation run caught it.
   */
  it("takes no scan-balance input at all", () => {
    const src = readFileSync(
      path.join(__dirname, "../../lib/thirdPhotoDecision.ts"),
      "utf8",
    );
    const start = src.indexOf("export function allowedSlots");
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).not.toMatch(/pack|balance/i);
    expect(body).toMatch(/maxPhotoSlots >= MAX_SLOTS/);
  });
});

// ── 18-25. Camera origin ────────────────────────────────────────────────────

describe("camera origin", () => {
  /** Requirements 18, 19. */
  it("opens the paywall instead of the camera for Free at two photos", () => {
    expect(decideCameraTap(2, READY_FREE.status, READY_FREE.slots)).toBe("paywall");
  });

  it("captures normally for Free below the limit", () => {
    expect(decideCameraTap(0, READY_FREE.status, READY_FREE.slots)).toBe("capture");
    expect(decideCameraTap(1, READY_FREE.status, READY_FREE.slots)).toBe("capture");
  });

  /** Requirements 23-25. No paywall flash for a resolved subscriber. */
  it("captures normally for Pro at two photos", () => {
    expect(decideCameraTap(2, READY_PRO.status, READY_PRO.slots)).toBe("capture");
  });

  it("stops everyone at three", () => {
    expect(decideCameraTap(3, READY_PRO.status, READY_PRO.slots)).toBe("at_capacity");
    expect(decideCameraTap(3, READY_FREE.status, READY_FREE.slots)).toBe("at_capacity");
  });

  /** Requirement 59, at the tap. */
  it("never captures a third photo while entitlement is unknown", () => {
    for (const status of ["unresolved", "error"] as const) {
      expect(decideCameraTap(2, status, 3)).toBe("paywall");
    }
  });
});

// ── 32-37, 50-53. Library origin ────────────────────────────────────────────

describe("library origin", () => {
  /** Requirements 32-37: Free picks three from empty. */
  it("accepts the first two and holds the third as intent", () => {
    const plan = planSelection([A, B, C], {}, "ready", 2);
    expect(plan.assignments).toEqual([
      { slot: "front", asset: A },
      { slot: "tag", asset: B },
    ]);
    expect(plan.pendingThird).toBe(C);
    expect(plan.needsPaywall).toBe(true);
    // The pending image is NOT an assignment, so it cannot become active state.
    expect(plan.assignments.map(a => a.asset)).not.toContain(C);
  });

  /**
   * Requirements 50-51, and the bug this phase fixes.
   *
   * The shipped handler sliced from picker index 0 and assigned SLOT_ORDER[i],
   * so an existing front photo was silently overwritten and nothing gated.
   */
  it("fills empty slots without overwriting an existing photo", () => {
    const plan = planSelection([B, C], { front: A }, "ready", 2);
    expect(plan.assignments).toEqual([{ slot: "tag", asset: B }]);
    // front is absent from assignments — A survives untouched.
    expect(plan.assignments.some(a => a.slot === "front")).toBe(false);
    expect(plan.pendingThird).toBe(C);
    expect(plan.needsPaywall).toBe(true);
  });

  it("computes the threshold from active count, not picker index", () => {
    // One existing photo + two picked: the SECOND picked image is the premium one.
    const plan = planSelection([B, C], { front: A }, "ready", 2);
    expect(plan.pendingThird).toBe(C);
    // From empty, the same two images both fit.
    const fromEmpty = planSelection([B, C], {}, "ready", 2);
    expect(fromEmpty.pendingThird).toBeNull();
    expect(fromEmpty.needsPaywall).toBe(false);
  });

  it("gives Pro all three slots with no paywall", () => {
    const plan = planSelection([A, B, C], {}, "ready", 3);
    expect(plan.assignments).toHaveLength(3);
    expect(plan.assignments[2]).toEqual({ slot: "detail", asset: C });
    expect(plan.pendingThird).toBeNull();
    expect(plan.needsPaywall).toBe(false);
  });

  /** Requirement 52. Photo 4 must never exist. */
  it("never exceeds three slots, for anyone", () => {
    const pro = planSelection([A, B, C, D], {}, "ready", 3);
    expect(pro.assignments).toHaveLength(3);
    expect(pro.discarded).toEqual([D]);
    expect(pro.pendingThird).toBeNull();
  });

  /** Requirement 53. */
  it("holds only ONE pending image and discards the rest", () => {
    const plan = planSelection([A, B, C, D], {}, "ready", 2);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.pendingThird).toBe(C);
    expect(plan.discarded).toEqual([D]);
  });

  it("gates when the only empty slot is the third", () => {
    const plan = planSelection([C], { front: A, tag: B }, "ready", 2);
    expect(plan.assignments).toEqual([]);
    expect(plan.pendingThird).toBe(C);
  });

  it("does nothing when all three slots are already full", () => {
    const plan = planSelection([D], { front: A, tag: B, detail: C }, "ready", 3);
    expect(plan.assignments).toEqual([]);
    expect(plan.pendingThird).toBeNull();
    expect(plan.discarded).toEqual([D]);
  });

  it("fails closed while entitlement is unresolved", () => {
    const plan = planSelection([A, B, C], {}, "unresolved", 3);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.pendingThird).toBe(C);
  });

  it("fills in the canonical slot order", () => {
    expect(SLOT_FILL_ORDER).toEqual(["front", "tag", "detail"]);
  });
});

// ── 41-49. Promotion ────────────────────────────────────────────────────────

describe("promotion of a pending image", () => {
  const ok: PromotionContext = {
    isAuthoritativelyPro: true,
    sameUid: true,
    sameSession: true,
    assetUsable: true,
    slotStillEmpty: true,
  };

  /** Requirements 42, 44. */
  it("promotes when everything checks out", () => {
    expect(decidePromotion(ok)).toBe("promote");
  });

  /** Requirement 41. */
  it("refuses without authoritative Pro, whatever else is true", () => {
    expect(decidePromotion({ ...ok, isAuthoritativelyPro: false })).toBe("abort");
  });

  /** Requirement 46. */
  it("aborts on an account switch", () => {
    expect(decidePromotion({ ...ok, sameUid: false })).toBe("abort");
  });

  /** Requirement 47. */
  it("aborts when the scan session changed", () => {
    expect(decidePromotion({ ...ok, sameSession: false })).toBe("abort");
  });

  it("aborts when the slot filled some other way", () => {
    expect(decidePromotion({ ...ok, slotStillEmpty: false })).toBe("abort");
  });

  /**
   * Requirements 48-49, and the distinction that matters most here.
   *
   * A missing asset is NOT a failed purchase. The subscription is real; only
   * the image is gone. Reporting a purchase error to a paying customer would be
   * telling them their payment failed when it did not.
   */
  it("separates a lost asset from a failed purchase", () => {
    const r = decidePromotion({ ...ok, assetUsable: false });
    expect(r).toBe("unlocked_without_asset");
    expect(r).not.toBe("abort");
    expect(r).not.toBe("promote");
  });

  /** Identity outranks a missing asset — attaching the wrong image is worse. */
  it("treats a stale identity as abort even when the asset is gone", () => {
    expect(decidePromotion({ ...ok, sameUid: false, assetUsable: false })).toBe("abort");
  });
});

// ── 26-31, 45. Continuation requires authoritative Pro ──────────────────────

describe("continuation requires authoritative Pro", () => {
  /** Requirements 26, 27. */
  it("no purchase outcome unlocks without server confirmation", () => {
    for (const status of [
      "success", "sync_pending", "cancelled", "pending", "error", "unavailable", "account_changed",
    ] as const) {
      expect(purchaseSettled({ status }).phase).not.toBe("unlocked");
    }
  });

  it("only a confirmed server plan reaches the continuing phase", () => {
    expect(afterActivation(true, "annual").phase).toBe("unlocked");
    expect(afterActivation(false, "annual").phase).toBe("pending_activation");
  });

  /** Requirement 22. Cancelling opens no camera and attaches no image. */
  it("cancellation returns silently and cannot continue", () => {
    const s = purchaseSettled({ status: "cancelled" });
    expect(s.phase).toBe("idle");
    expect(s.notice).toBeNull();
  });

  /** Requirements 31, 45. Restore follows the identical rule. */
  it("no restore outcome unlocks without server confirmation", () => {
    for (const status of [
      "restored", "nothing_to_restore", "error", "unavailable",
      "sync_pending", "account_changed", "owned_by_another_account",
    ] as const) {
      expect(restoreSettled({ status }).phase).not.toBe("unlocked");
    }
  });
});