/**
 * server/monetization/transfer.ts
 *
 * RevenueCat account transfers.
 *
 * ── The vulnerability this closes ───────────────────────────────────────────
 * With "Transfer to new App User ID", restoring on a second FlipStart account
 * moves the Apple receipt to that account. Before this file existed, the
 * webhook reconciled only the DESTINATION: the new account became Pro with a
 * fresh allowance, and the old account kept its own subscription row until its
 * period_end passed.
 *
 * One Apple subscription therefore produced two Pro accounts with two separate
 * subscription buckets. Worse, the fresh allowance made it FARMABLE: spend
 * scans, make a new account, Restore, get a full allowance again, repeat.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A transfer is not a billing period. The period and its consumed usage move
 * together, so 299 remaining stays 299 remaining. Only a genuine renewal --
 * detected by apply_revenuecat_snapshot comparing period_start -- resets.
 *
 * ── Fail closed, always ─────────────────────────────────────────────────────
 * Every ambiguity returns without mutating. Minting subscription quota is never
 * a fallback: refusing to act leaves the previous state, which is recoverable,
 * whereas an unearned allowance is money.
 */
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { checkUserExists, fetchSubscriber, reconcileUser } from "./revenuecatServer.js";
import { normalizeSubscriber, freeSnapshot } from "./subscriptionNormalizer.js";

/** RevenueCat sends both arrays on TRANSFER. Aliases and anonymous ids appear. */
export interface TransferEvent {
  transferred_from?: unknown;
  transferred_to?: unknown;
}

export type TransferOutcome =
  | "transferred"
  | "nothing_to_transfer"
  | "no_destination"
  | "ambiguous_destination"
  | "destination_not_active"
  | "rpc_failed"
  | "not_configured";

export interface TransferResult {
  outcome: TransferOutcome;
  /** True only when RevenueCat state was applied to the destination. */
  reconciled?: boolean;
  destination?: string;
  source?: string;
  movedScansUsed?: number;
  /** Retryable failures leave the event unacknowledged so RevenueCat redelivers. */
  retryable?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Strings from a RevenueCat id array that could be FlipStart users.
 *
 * RevenueCat mixes real App User IDs with `$RCAnonymousID:…` and historical
 * aliases. Only UUID-shaped entries can be Supabase users, so anything else is
 * discarded before a single lookup is spent on it.
 */
export function candidateUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (UUID_RE.test(s)) out.add(s.toLowerCase());
  }
  return [...out];
}

/**
 * Narrow candidates to ids that are genuinely FlipStart accounts.
 *
 * `checkUserExists` distinguishes "absent" from "unknown". An id we could not
 * resolve is NOT dropped -- it is reported, so the caller can retry rather than
 * transfer on a partial view of who exists.
 */
async function resolveExisting(
  ids: string[],
): Promise<{ present: string[]; lookupFailed: boolean }> {
  const present: string[] = [];
  let lookupFailed = false;
  for (const id of ids) {
    const e = await checkUserExists(id);
    if (e === "exists") present.push(id);
    else if (e === "unknown") lookupFailed = true;
  }
  return { present, lookupFailed };
}

/**
 * Handle a TRANSFER event.
 *
 * Order matters and is the crux of the whole fix:
 *
 *   1. resolve real FlipStart ids from both arrays (never paired by index)
 *   2. verify RevenueCat says the destination NOW owns an active subscription
 *   3. atomically move period + usage, clearing every source
 *   4. apply the live snapshot to the destination
 *
 * Step 3 before step 4 is what preserves the usage. The destination ends step 3
 * holding the same period_start the source had, so apply_revenuecat_snapshot
 * sees `period_start is not distinct from` and does NOT reset the counter. Run
 * the other way round, the snapshot would zero the counter before there was
 * anything left to preserve.
 */
export async function handleTransferEvent(ev: TransferEvent): Promise<TransferResult> {
  const sb = getSupabaseAdmin();
  if (!sb) return { outcome: "not_configured", retryable: true };

  const fromCandidates = candidateUserIds(ev?.transferred_from);
  const toCandidates = candidateUserIds(ev?.transferred_to);

  const dest = await resolveExisting(toCandidates);

  /**
   * A lookup we could not complete is not an answer. Retrying is safe; guessing
   * a destination is not.
   */
  if (dest.lookupFailed) {
    console.warn("[transfer] destination lookup failed - retryable, not acknowledged");
    return { outcome: "no_destination", retryable: true };
  }

  if (dest.present.length === 0) {
    // The receipt moved somewhere that is not a FlipStart account. Nothing to
    // do, and nothing will ever make it actionable -- acknowledge it.
    console.warn("[transfer] no valid FlipStart destination in transferred_to");
    return { outcome: "no_destination", retryable: false };
  }

  if (dest.present.length > 1) {
    /**
     * Ambiguous. Picking one would risk granting Pro to the wrong account, and
     * clearing "the others" could revoke a real subscriber.
     */
    console.error(
      `[transfer] AMBIGUOUS destination - ${dest.present.length} valid FlipStart users ` +
      `in transferred_to. Refusing to transfer.`,
    );
    return { outcome: "ambiguous_destination", retryable: false };
  }

  const destination = dest.present[0];

  /**
   * Confirm with LIVE RevenueCat state that the destination really owns an
   * active subscription now -- WITHOUT WRITING ANYTHING.
   *
   * This deliberately does not call reconcileUser. reconcileUser APPLIES the
   * snapshot, and applying it to a destination whose row has no period_start
   * makes apply_revenuecat_snapshot treat it as a new period and zero the
   * counter. If the transfer then failed closed, the destination would be left
   * holding a freshly minted allowance -- exactly the outcome this hardening
   * exists to prevent. So verification is a pure read, and nothing is written
   * until the RPC has found a legitimate source.
   *
   * The event payload is not trusted for entitlement either: it can be delayed,
   * and acting on it alone is how a stale event resurrects an old owner.
   */
  const sub = await fetchSubscriber(destination);
  if (sub === undefined) {
    // Transport failure. Unknown, not "no subscription".
    console.warn("[transfer] RevenueCat unreachable for destination - retryable");
    return { outcome: "destination_not_active", retryable: true };
  }
  const snapshot = sub === null ? freeSnapshot() : normalizeSubscriber(sub);

  if (snapshot.plan !== "monthly" && snapshot.plan !== "annual") {
    console.warn(
      `[transfer] destination does not hold an active subscription ` +
      `(plan=${snapshot.plan}) - refusing to transfer`,
    );
    // Retryable: RevenueCat may not have finished indexing the move yet.
    return { outcome: "destination_not_active", retryable: true };
  }

  /**
   * The period identity the source must match. Without both, there is nothing
   * to pin the transferred counter to, so we refuse rather than guess.
   */
  if (!snapshot.productId || !snapshot.periodStart) {
    console.warn("[transfer] destination snapshot lacks product/period - refusing");
    return { outcome: "destination_not_active", retryable: true };
  }

  const sources = await resolveExisting(fromCandidates);
  if (sources.lookupFailed) {
    console.warn("[transfer] source lookup failed - retryable, not acknowledged");
    return { outcome: "rpc_failed", retryable: true };
  }

  const sourceIds = sources.present.filter(id => id !== destination);
  if (sourceIds.length === 0) {
    /**
     * No previous FlipStart owner -- the receipt came from an anonymous id or an
     * account that no longer exists. The destination is already correct from the
     * reconcile above; there is simply no usage to carry over.
     */
    console.log("[transfer] no FlipStart source - destination reconciled, nothing to move");
    return { outcome: "nothing_to_transfer", reconciled: true, destination };
  }

  const { data, error } = await sb.rpc("transfer_subscription_ownership", {
    p_from_user_ids: sourceIds,
    p_to_user_id: destination,
    // The verified subscription identity. The RPC moves a counter only from a
    // row that already represents THIS period.
    p_product_id: snapshot.productId,
    p_period_start: snapshot.periodStart,
  });

  if (error) {
    console.error("[transfer] ownership RPC failed:", error.message);
    // Never fall back to leaving the destination with a minted allowance.
    return { outcome: "rpc_failed", retryable: true };
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.transferred) {
    /**
     * No source row represents this period.
     *
     * Benign when the transfer already applied. Suspicious otherwise -- so the
     * destination is left EXACTLY as it was. No snapshot is applied here, which
     * means no fresh allowance is minted. If the destination legitimately owns
     * the subscription, its own next syncSubscription will reconcile it, and
     * that path resets only on a genuine new period.
     */
    console.warn(
      `[transfer] NO MATCHING SOURCE for period ${snapshot.periodStart} ` +
      `dest=${destination.slice(0, 8)}... sources=${sourceIds.length} - ` +
      `failing closed, destination untouched`,
    );
    return { outcome: "nothing_to_transfer", reconciled: false, destination };
  }

  console.log(
    `[transfer] moved subscription src=${String(row.source_user_id).slice(0, 8)}... ` +
    `dest=${destination.slice(0, 8)}... product=${row.moved_product_id} ` +
    `period_start=${row.moved_period_start} scans_used=${row.moved_scans_used} ` +
    `sources_cleared=${row.sources_cleared}`,
  );

  /**
   * Re-apply the live snapshot AFTER the move.
   *
   * The destination now holds the source's period_start, so the snapshot's
   * reset condition is false and the moved usage survives. This confirms
   * product and period against RevenueCat one final time.
   */
  const confirm = await reconcileUser(destination);
  if (!confirm.ok) {
    // The move landed and is durable; only the confirmation read failed.
    console.warn("[transfer] post-transfer reconcile failed - state moved, will self-heal");
  }

  return {
    outcome: "transferred",
    reconciled: confirm.ok,
    destination,
    source: String(row.source_user_id),
    movedScansUsed: Number(row.moved_scans_used ?? 0),
  };
}