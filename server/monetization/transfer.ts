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
import { checkUserExists, reconcileUser } from "./revenuecatServer.js";

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
   * Reconcile the destination. That is the entire transfer.
   *
   * apply_revenuecat_snapshot is now ownership-aware: it locks every row
   * holding this product+period_start, carries the prior owner's consumed count
   * across, and clears them — atomically, in one transaction.
   *
   * So this handler no longer implements ownership logic of its own. It exists
   * only to resolve WHICH FlipStart account to reconcile, because on a TRANSFER
   * the top-level app_user_id is frequently an alias.
   *
   * That consolidation is what makes the race safe. Whether this webhook or the
   * client's own syncSubscription arrives first no longer matters: both call
   * the same primitive, and whichever runs second finds the work done and
   * becomes a no-op.
   */
  const result = await reconcileUser(destination);

  if (!result.ok) {
    // Retryable: nothing was applied, and RevenueCat will redeliver.
    console.warn(`[transfer] reconcile failed (${result.reason ?? "?"}) - retryable`);
    return { outcome: "rpc_failed", retryable: true };
  }

  if (result.plan !== "monthly" && result.plan !== "annual") {
    /**
     * RevenueCat does not report the destination as an active subscriber.
     * Retryable — the move may not be indexed yet. Nothing was granted.
     */
    console.warn(`[transfer] destination not active (plan=${result.plan}) - retryable`);
    return { outcome: "destination_not_active", retryable: true };
  }

  console.log(
    `[transfer] reconciled dest=${destination.slice(0, 8)}... plan=${result.plan} ` +
    `from_candidates=${fromCandidates.length}`,
  );

  return { outcome: "transferred", reconciled: true, destination };
}