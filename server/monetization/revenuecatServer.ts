/**
 * server/monetization/revenuecatServer.ts
 *
 * Server-only RevenueCat REST adapter, plus the ONE reconciliation path shared
 * by the authenticated endpoint and the webhook.
 *
 * ── Why the server fetches instead of trusting the client ───────────────────
 * A phone can say anything. If the app posted `{ isPro: true }` and we believed
 * it, monetization would be a suggestion. The server asks RevenueCat directly,
 * keyed on the Supabase uid it already verified, so the only input from the
 * client is "please refresh me".
 *
 * ── Why one implementation ──────────────────────────────────────────────────
 * The webhook and the manual endpoint both end in `reconcileUser`. Two copies of
 * subscription logic would drift, and the drift would be invisible until someone
 * got the wrong allowance.
 */
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import {
  normalizeSubscriber, freeSnapshot,
  type RcSubscriber, type SubscriptionSnapshot,
} from "./subscriptionNormalizer.js";

const RC_API_BASE = "https://api.revenuecat.com/v1";
const TIMEOUT_MS = 10_000;

export interface ReconcileResult {
  ok: boolean;
  plan?: SubscriptionSnapshot["plan"];
  periodReset?: boolean;
  reason?: "NOT_CONFIGURED" | "RC_UNAVAILABLE" | "DB_ERROR" | "INVALID_USER"
    /** Authoritatively established: no FlipStart account with this id. */
    | "UNKNOWN_USER"
    /** Could not determine existence. Retryable — never treated as absent. */
    | "USER_LOOKUP_FAILED"
    /**
     * RevenueCat reports an ACTIVE entitlement on a product we cannot map to
     * a plan. Existing state is preserved untouched — see the guard below.
     */
    | "UNKNOWN_PRODUCT";
  snapshot?: SubscriptionSnapshot;
}

export function isRevenueCatConfigured(): boolean {
  return Boolean((process.env.REVENUECAT_API_KEY ?? "").trim());
}

/**
 * Fetch authoritative subscriber state.
 *
 * ── ONLY a valid payload proves anything ────────────────────────────────────
 * `GET /v1/subscribers/{id}` is GET-OR-CREATE: it returns 200 for an existing
 * customer and 201 for one it just created. Both carry a real payload, and a
 * brand-new customer with no `pro` entitlement is genuinely Free.
 *
 * EVERYTHING ELSE is a synchronization failure, including 404. An earlier
 * version treated 404 as proof of Free, which was wrong twice over: this
 * endpoint should not 404, and interpreting an unexpected status as "no
 * subscription" is exactly how a RevenueCat incident mass-downgrades paying
 * customers. `undefined` means "we do not know", and the caller preserves the
 * stored snapshot.
 */
export async function fetchSubscriber(
  appUserId: string,
): Promise<RcSubscriber | null | undefined> {
  const key = (process.env.REVENUECAT_API_KEY ?? "").trim();
  if (!key) return undefined;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${RC_API_BASE}/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
    });

    // 200 existing, 201 just created. Nothing else is trustworthy.
    if (res.status !== 200 && res.status !== 201) {
      console.warn(
        `[revenuecat] fetch status=${res.status} — treating as SYNC FAILURE, ` +
        `existing snapshot preserved`,
      );
      return undefined;
    }
    console.log(`[revenuecat] fetch status=${res.status} (${res.status === 201 ? "customer created" : "customer found"})`);

    let body: { subscriber?: RcSubscriber };
    try {
      body = await res.json() as { subscriber?: RcSubscriber };
    } catch {
      // Malformed JSON is a failure, not an empty subscriber.
      console.warn("[revenuecat] malformed response body — sync failure");
      return undefined;
    }
    // A valid payload with no subscriber object is still a valid answer meaning
    // "nothing here", which normalizes to Free.
    if (!body || typeof body !== "object") return undefined;
    return body.subscriber ?? null;
  } catch (e) {
    // Timeout, DNS, connection reset — all unknown, never Free.
    console.warn("[revenuecat] subscriber fetch failed:", (e as Error).message);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FlipStart never configures anonymous customers, so an `$RCAnonymousID:` — or
 *  anything that is not a Supabase uuid — is not ours to act on. */
export function isFlipStartUserId(appUserId: string | null | undefined): boolean {
  if (!appUserId) return false;
  if (appUserId.startsWith("$RCAnonymousID:")) return false;
  return UUID_RE.test(appUserId);
}

export type UserExistence = "exists" | "absent" | "unknown";

/**
 * Does this Supabase auth user actually exist?
 *
 * ── Why this had to be added ────────────────────────────────────────────────
 * `account_usage.user_id` is a foreign key to `auth.users(id)`. A syntactically
 * valid UUID that belongs to no account therefore blows up on INSERT with an FK
 * violation — which is exactly what the live dashboard TEST produced. The uuid
 * shape check was never an existence check, and treating it as one was the gap.
 *
 * ── The three-way return is the whole point ─────────────────────────────────
 * "absent" and "unknown" must never be collapsed. Absent means we asked and the
 * account genuinely is not there, so retrying forever is pointless. Unknown
 * means Supabase did not answer, and treating that as absent would silently drop
 * a real subscription event during an outage.
 */
export async function checkUserExists(userId: string): Promise<UserExistence> {
  const sb = getSupabaseAdmin();
  if (!sb) return "unknown";
  try {
    const { data, error } = await sb.auth.admin.getUserById(userId);
    if (error) {
      // A genuine "not found" is authoritative. Anything else is not.
      const status = (error as { status?: number }).status;
      const msg = (error.message ?? "").toLowerCase();
      if (status === 404 || /not found|user not found/.test(msg)) return "absent";
      console.warn("[revenuecat] user lookup FAILED (not treating as absent):", error.message);
      return "unknown";
    }
    return data?.user?.id ? "exists" : "absent";
  } catch (e) {
    // Timeout, network, unexpected shape — all unknown.
    console.warn("[revenuecat] user lookup threw (not treating as absent):", (e as Error).message);
    return "unknown";
  }
}

/**
 * THE reconciliation path. Both callers end here.
 *
 * Fetch -> normalize -> apply atomically. Never partially applied: the RPC does
 * the whole snapshot under one row lock.
 */
export async function reconcileUser(
  supabaseUserId: string,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  if (!isFlipStartUserId(supabaseUserId)) {
    console.warn("[revenuecat] refusing to reconcile a non-FlipStart identity");
    return { ok: false, reason: "INVALID_USER" };
  }
  if (!isRevenueCatConfigured()) return { ok: false, reason: "NOT_CONFIGURED" };

  /**
   * Existence check BEFORE the RevenueCat fetch.
   *
   * Two reasons for this ordering. It avoids an FK violation on a user who does
   * not exist — and, because `GET /v1/subscribers` is get-or-create, it avoids
   * MINTING a RevenueCat customer for an id that has no FlipStart account. The
   * live TEST created exactly such a phantom customer (status 201).
   */
  const existence = await checkUserExists(supabaseUserId);
  if (existence === "unknown") {
    // Do NOT proceed. We cannot tell absent from an outage, and guessing either
    // way is worse than retrying.
    return { ok: false, reason: "USER_LOOKUP_FAILED" };
  }
  if (existence === "absent") {
    console.warn("[revenuecat] no FlipStart account for this id — not reconciling");
    return { ok: false, reason: "UNKNOWN_USER" };
  }

  const sub = await fetchSubscriber(supabaseUserId);

  // undefined = transport failure. Leave the stored snapshot exactly as it is:
  // an active subscriber must not be downgraded because one request failed.
  if (sub === undefined) {
    console.warn("[revenuecat] sync skipped — RevenueCat unavailable, existing state preserved");
    return { ok: false, reason: "RC_UNAVAILABLE" };
  }

  const snapshot = sub === null ? freeSnapshot() : normalizeSubscriber(sub, now);
  console.log(
    `[revenuecat] normalized uid=${supabaseUserId.slice(0, 8)}… plan=${snapshot.plan}` +
    `${snapshot.productId ? ` product=${snapshot.productId}` : ""}` +
    `${snapshot.periodType ? ` period=${snapshot.periodType}` : ""}`,
  );

  /**
   * ── UNKNOWN ACTIVE PRODUCT — preserve, never downgrade ────────────────────
   *
   * `unknown` does NOT mean "no subscription". It means RevenueCat says the
   * `pro` entitlement IS ACTIVE on a product this server cannot map to a plan —
   * a SKU added in App Store Connect without updating subscriptionNormalizer,
   * or an unexpected introductory offer.
   *
   * This used to fall through to the RPC, whose else-branch treats anything
   * that is not trial/monthly/annual as "free or unknown" and clears
   * subscription_product_id, subscription_period_start, subscription_period_end
   * and subscription_scans_used. The effect was a legitimately paying
   * subscriber being downgraded to Free — and their period window destroyed —
   * on their very next sync. The old comment said "no allowance granted", which
   * understated it: it revoked one.
   *
   * Returning early leaves account_usage exactly as it was. That is consistent
   * with every other uncertainty in this function: an unreachable RevenueCat,
   * an unresolvable user and an absent user all preserve state rather than
   * guessing. An unrecognised product is the same kind of unknown.
   *
   * Preserving cannot over-grant. derivePlan() reads the stored period window,
   * so an expired subscription still derives to free on its own; and a user who
   * never had a subscription has nothing to preserve, so they stay free. The
   * blast radius is bounded by the period end in every case.
   *
   * `free` is deliberately NOT routed here. A confirmed inactive entitlement is
   * a real answer, and clearing state for it is correct.
   */
  if (snapshot.plan === "unknown") {
    console.error(
      `[revenuecat] UNKNOWN active product "${snapshot.productId}" — PRESERVING existing ` +
      `subscription state and applying nothing. Add this product to ` +
      `subscriptionNormalizer.ts if it is a real FlipStart product.`,
    );
    return { ok: false, reason: "UNKNOWN_PRODUCT", snapshot };
  }

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "DB_ERROR" };

  const { data, error } = await sb.rpc("apply_revenuecat_snapshot", {
    p_user_id: supabaseUserId,
    p_plan: snapshot.plan,
    p_product_id: snapshot.productId,
    p_period_start: snapshot.periodStart,
    p_period_end: snapshot.periodEnd,
    p_period_type: snapshot.periodType,
    p_environment: snapshot.environment,
  });
  if (error) {
    console.error("[revenuecat] snapshot apply failed:", error.message);
    return { ok: false, reason: "DB_ERROR", snapshot };
  }

  const row = Array.isArray(data) ? data[0] : data;
  console.log(
    `[revenuecat] sync result plan=${snapshot.plan}` +
    `${row?.period_reset ? " (NEW PERIOD — usage reset)" : ""}`,
  );
  return { ok: true, plan: snapshot.plan, periodReset: Boolean(row?.period_reset), snapshot };
}