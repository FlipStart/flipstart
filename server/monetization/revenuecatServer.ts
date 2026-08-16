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
  reason?: "NOT_CONFIGURED" | "RC_UNAVAILABLE" | "DB_ERROR" | "INVALID_USER";
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

  if (snapshot.plan === "unknown") {
    console.error(
      `[revenuecat] UNKNOWN active product "${snapshot.productId}" — no allowance granted. ` +
      `Add it to subscriptionNormalizer.ts if this is a real FlipStart product.`,
    );
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