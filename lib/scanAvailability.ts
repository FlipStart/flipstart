/**
 * lib/scanAvailability.ts
 *
 * Where a scan attempt should go when the allowance may be exhausted. Pure, and
 * answerable without React.
 *
 * ── Scan limit is QUANTITY, not a capability ────────────────────────────────
 * Every other gate in this app asks `can(feature)`. This one must not. Running
 * out of scans is not a locked feature — it is an empty bucket, and the two
 * have different answers:
 *
 *   a Free user out of scans     → can be sold a subscription
 *   a PRO user out of scans      → already owns the subscription
 *
 * Selling Pro to someone who already pays for it is the single worst outcome on
 * this screen, so plan is an input here rather than a capability check.
 *
 * ── Packs count ─────────────────────────────────────────────────────────────
 * `totalUsableScans` already sums every spendable bucket — free lifetime,
 * subscription allowance and packs. A Free user with 0 lifetime and 40 packs
 * has 40 scans and must not see a paywall. Taking the total rather than any
 * single bucket is what makes that true by construction.
 *
 * ── Not authorization ───────────────────────────────────────────────────────
 * This is a client preflight, and its only job is to stop the user wasting
 * effort photographing an item they cannot scan. `reserve_scan` on the server
 * remains the sole authority on whether a scan actually happens.
 */

/** No imports, by design — see the module comment. */

export type ScanPlan = "free" | "monthly" | "annual";
export type EntitlementReadiness = "unresolved" | "ready" | "error";

export type ScanAvailabilityDecision =
  /** Scans remain. Proceed into the normal camera flow. */
  | "allow_scan"
  /** Free with nothing left: the contextual Scan Limit paywall. */
  | "free_scan_limit_paywall"
  /**
   * Pro with nothing left: the Scan Store.
   *
   * NOT the subscription paywall. They already bought Pro; what they need is
   * more quantity, and offering another subscription would be asking them to
   * buy the thing they are already paying for.
   */
  | "pro_scan_store"
  /** Entitlement not known yet. Resolve once, then decide again. */
  | "unresolved";

export interface ScanAvailabilityInput {
  entitlementStatus: EntitlementReadiness;
  /** Meaningful only when entitlementStatus is "ready". */
  plan: ScanPlan;
  /** Every spendable bucket summed: free lifetime + subscription + packs. */
  totalUsableScans: number;
}

/**
 * Route a scan attempt.
 *
 * Fails closed on an unknown entitlement: never assume scans remain (that sends
 * the user into the camera to be rejected at reservation) and never assume they
 * are exhausted (that paywalls somebody who has scans). One bounded refresh,
 * then decide again.
 */
export function decideScanAvailability(i: ScanAvailabilityInput): ScanAvailabilityDecision {
  if (i.entitlementStatus !== "ready") return "unresolved";

  /**
   * A negative total would mean a corrupt counter; treat it as exhausted rather
   * than as permission. `> 0` rather than `!== 0` is doing that work.
   */
  if (i.totalUsableScans > 0) return "allow_scan";

  return i.plan === "free" ? "free_scan_limit_paywall" : "pro_scan_store";
}

/**
 * The decision after a single entitlement refetch.
 *
 * Reads the SERVER's plan and total straight off the refreshed payload. An
 * unrecognised plan returns null — do nothing rather than guess, and the next
 * tap tries again.
 */
export function decideAfterRefresh(
  plan: string | null | undefined,
  totalUsableScans: number | null | undefined,
): ScanAvailabilityDecision | null {
  if (plan !== "free" && plan !== "monthly" && plan !== "annual") return null;
  if (typeof totalUsableScans !== "number" || !Number.isFinite(totalUsableScans)) return null;
  return decideScanAvailability({
    entitlementStatus: "ready",
    plan,
    totalUsableScans,
  });
}

/**
 * May a purchased subscription resume the original scan?
 *
 * Authoritative Pro is NOT sufficient on its own, which is what separates this
 * source from every other contextual paywall. The others unlock a capability
 * the moment the plan lands. This one needs a spendable scan as well — and the
 * usage row can legitimately still read zero for a moment after activation.
 *
 * Resuming too early would open the camera, let the user photograph an item,
 * and then fail at reservation: strictly worse than not resuming at all.
 */
export function canResumeScanAfterUnlock(
  plan: string | null | undefined,
  totalUsableScans: number | null | undefined,
): boolean {
  if (plan !== "monthly" && plan !== "annual") return false;
  return typeof totalUsableScans === "number" && totalUsableScans > 0;
}

/**
 * Does a server error mean "no scans left"?
 *
 * The client balance can be stale, so a scan can pass preflight and still be
 * refused at reservation. Recognising that case lets it route into the SAME
 * exhausted-scan UX instead of surfacing `NO_SCANS_REMAINING` to a human.
 *
 * Matches on the server's own reason code and on the wording the analyze
 * procedure throws, not on arbitrary substrings.
 */
export function isScanExhaustionError(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.toUpperCase();
  return (
    s.includes("NO_SCANS_REMAINING") ||
    s.includes("GLOBAL_SCAN_LIMIT_REACHED") ||
    s.includes("OUT OF SCANS")
  );
}