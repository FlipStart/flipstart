/**
 * server/monetization/ledger.ts
 *
 * Reserve → operate → commit/refund, executed through Postgres RPCs.
 *
 * ── Why the database and not JavaScript ─────────────────────────────────────
 * Railway can run several instances. An in-process lock protects one process's
 * view of the last scan and nothing else, so two instances would both sell it.
 * `reserve_scan` decides eligibility and debits inside one statement under a row
 * lock, which is the only version of this that stays correct under scale.
 *
 * ── Why reserve BEFORE the AI call ──────────────────────────────────────────
 * The beta flow checked the quota, then called OpenAI, then counted. Two
 * requests could both pass the check. Reserving first means the balance moves
 * before any money is spent, and a failure hands it back.
 */
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../supabaseAdmin.js";
import {
  emptyUsage, derivePlan, consumptionOrder, subscriptionLimitFor, computeBalances,
  FREE_LIFETIME_SCANS,
  type AccountUsage, type ScanSource, type PlanState,
} from "./policy.js";

/** Longer than any observed scan (~18s worst case) by a wide margin, so a slow
 *  but live AI call is never refunded out from under itself. */
const RESERVATION_TTL_SECONDS = 600;

export interface ReserveResult {
  ok: boolean;
  reservationId?: string;
  source?: ScanSource;
  /** True when this attempt_id already had a reservation — a retry, not a new
   *  spend. The caller must NOT treat this as a second scan. */
  replayed?: boolean;
  reason?: "NO_SCANS_REMAINING" | "NOT_CONFIGURED" | "DB_ERROR";
  plan?: PlanState;
}

/** Reads usage, creating the row on first touch.
 *
 *  A missing row means a brand-new monetization epoch for this account: every
 *  existing beta user starts with a full 15 free scans, because their historical
 *  daily counters were beta infrastructure under different rules. */
export async function getUsage(userId: string): Promise<AccountUsage> {
  const sb = getSupabaseAdmin();
  if (!sb) return emptyUsage();
  const { data, error } = await sb
    .from("account_usage").select("*").eq("user_id", userId).maybeSingle();
  if (error || !data) return emptyUsage();
  return data as AccountUsage;
}

export async function reserveScan(
  userId: string, attemptId: string,
): Promise<ReserveResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, reason: "NOT_CONFIGURED" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "NOT_CONFIGURED" };

  const usage = await getUsage(userId);
  const plan = derivePlan(usage);

  /**
   * -- DIAGNOSTIC (temporary, QA only) --------------------------------------
   *
   * The authoritative state as the RESERVER sees it, immediately before the
   * bucket decision.
   *
   * Pairs with [rc-verify]: that line reports what persisted right after a
   * RevenueCat sync, this one reports what is read back on the next scan. Same
   * uid prefix in both, so one reproduction shows whether the state survived
   * between the two, and `end=` distinguishes a null period from a stale one.
   *
   * Observation only -- `plan` and the consumption order are already computed
   * above and are not touched here.
   */
  try {
    const bal = computeBalances(usage);
    console.log(
      `[reserve-pre] uid=${userId.slice(0, 8)}... plan=${plan} ` +
      `product=${usage.subscription_product_id ?? "null"} ` +
      `end=${usage.subscription_period_end ?? "null"} ` +
      `order=${consumptionOrder(plan).join(",")} ` +
      `free_rem=${bal.freeScansRemaining} ` +
      `sub_rem=${bal.subscriptionScansRemaining} ` +
      `pack_rem=${bal.packScansRemaining} ` +
      `total=${bal.totalUsableScans}`,
    );
  } catch { /* never block a scan for a log line */ }

  // The order is computed HERE and passed in, so the SQL stays plan-agnostic and
  // the policy remains the single source of that decision.
  const { data, error } = await sb.rpc("reserve_scan", {
    p_user_id: userId,
    p_attempt_id: attemptId,
    p_sources: consumptionOrder(plan),
    p_free_limit: FREE_LIFETIME_SCANS,
    /**
     * Trial is dead. Zero limit and inactive, so reserve_scan's trial branch can
     * never fire even if a stale `p_sources` array somehow contained it.
     *
     * The SQL parameters are kept rather than removed: changing the RPC
     * signature would need a migration on a live financial function, and
     * neutralising the inputs achieves the same guarantee with no schema risk.
     */
    p_trial_limit: 0,
    p_subscription_limit: subscriptionLimitFor(plan),
    p_trial_active: false,
    p_ttl_seconds: RESERVATION_TTL_SECONDS,
  });

  if (error) {
    console.error("[monetization] reserve failed:", error.message);
    return { ok: false, reason: "DB_ERROR", plan };
  }
  const row = Array.isArray(data) ? data[0] : data;
  // No row means every eligible bucket was empty. The function writes nothing in
  // that case, so there is no reservation to clean up.
  if (!row?.reservation_id) return { ok: false, reason: "NO_SCANS_REMAINING", plan };

  return {
    ok: true,
    reservationId: row.reservation_id,
    source: row.source as ScanSource,
    replayed: Boolean(row.replayed),
    plan,
  };
}

/** Seals a reservation. Idempotent: a second call returns false and changes
 *  nothing, because the RPC is guarded on state='reserved'. */
export async function commitScan(reservationId: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  if (!sb) return false;
  const { data, error } = await sb.rpc("commit_scan", { p_reservation_id: reservationId });
  if (error) { console.error("[monetization] commit failed:", error.message); return false; }
  return data === true;
}

/**
 * Returns the scan to the bucket it came from.
 *
 * Call ONLY for failures that mean the user got nothing: provider error,
 * malformed response, timeout. A Sold Comps failure after a successful analysis
 * is NOT one of these — the user received their analysis, so the scan stays
 * spent. Refunding there would make comps outages a free-scan generator.
 */
export async function refundScan(reservationId: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  if (!sb) return false;
  const { data, error } = await sb.rpc("refund_scan", { p_reservation_id: reservationId });
  if (error) { console.error("[monetization] refund failed:", error.message); return false; }
  return data === true;
}

/** Sweeps reservations stranded by a crash. Safe to call opportunistically. */
export async function expireStaleReservations(): Promise<number> {
  const sb = getSupabaseAdmin();
  if (!sb) return 0;
  const { data, error } = await sb.rpc("expire_stale_reservations");
  if (error) { console.error("[monetization] sweep failed:", error.message); return 0; }
  return typeof data === "number" ? data : 0;
}