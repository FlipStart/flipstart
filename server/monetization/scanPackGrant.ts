/**
 * server/monetization/scanPackGrant.ts
 *
 * THE grant path. The webhook and the recovery endpoint both end here.
 *
 * Two implementations would drift, and the drift would be invisible until
 * someone had scans they never bought.
 */
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { checkUserExists } from "./revenuecatServer.js";
import {
  findPurchaseByStoreId, listCustomerPurchases, resolvePurchaseProduct,
  isV2Configured, purchaseEnvironment, type V2Purchase,
} from "./revenuecatV2.js";

/**
 * Sandbox allowlist.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Test Store purchases are free and unlimited. Without a gate, anyone who
 * discovered the sandbox build could mint permanent scan credits — and
 * `pack_scan_balance` never expires and never resets, so a test grant would be
 * indistinguishable from a paid one forever.
 *
 * PRODUCTION PURCHASES DO NOT CONSULT THIS LIST. A real paying customer must
 * never be blocked by a testing control.
 *
 * ── The "*" wildcard ────────────────────────────────────────────────────────
 * Broad TestFlight QA needs every tester able to buy packs, and collecting a
 * UUID from each of them before the build ships is not workable. So a literal
 * "*" opens sandbox grants to any AUTHENTICATED user.
 *
 * It is deliberately narrow:
 *
 *   • It is re-checked against REVENUECAT_PURCHASE_ENVIRONMENT INSIDE this
 *     function, not only at the call site. The caller already guards on
 *     `env === "sandbox"`, so this is redundant today — and that is the point.
 *     A "*" left in a production environment by mistake is the single most
 *     expensive misconfiguration available here, because pack_scan_balance
 *     never expires, so a stray grant is permanent and indistinguishable from
 *     a paid one. One guard is a policy; two is a guarantee.
 *
 *   • It still requires an authenticated user. "All authenticated users" is not
 *     "anyone", so an empty or missing uid is refused even under "*".
 *
 * Explicit UUID behaviour is untouched, and empty/unset still means nobody.
 */
export const SANDBOX_GRANT_WILDCARD = "*";

export function isSandboxGrantAllowed(userId: string): boolean {
  const ids = (process.env.REVENUECAT_SANDBOX_PACK_USER_IDS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);

  /**
   * Authentication first, for both paths. An absent uid can never match an
   * explicit entry, and must not ride in on the wildcard either.
   */
  if (!userId) return false;

  if (ids.includes(SANDBOX_GRANT_WILDCARD)) {
    /**
     * Second environment check. `purchaseEnvironment()` returns null on an
     * absent or malformed value, so an unreadable environment fails closed
     * rather than honouring the wildcard.
     */
    if (purchaseEnvironment() === "sandbox") return true;
    console.warn(
      '[scan-pack] REVENUECAT_SANDBOX_PACK_USER_IDS contains "*" but ' +
      "REVENUECAT_PURCHASE_ENVIRONMENT is not \"sandbox\" — ignoring the wildcard. " +
      "Remove it before public launch.",
    );
    // Fall through: an explicit uuid alongside "*" still works normally.
  }

  return ids.includes(userId);
}

/**
 * Every reason a purchase may be refused before it can grant.
 *
 * Deliberately granular: "we could not verify this" and "this is not ours" have
 * opposite handling — one retries, the other acknowledges — and collapsing them
 * is how a paid purchase gets silently dropped.
 */
export type ValidationFailure =
  | "missing_purchase_id"
  | "customer_mismatch"
  | "environment_mismatch"
  | "store_id_mismatch"
  | "bad_status"
  | "not_a_scan_pack"
  | "catalog_drift"
  | "sandbox_not_allowlisted"
  | "product_unresolved";

export type GrantOutcome =
  | "granted"
  | "already_granted"      // idempotent no-op — expected, not an error
  | "not_a_scan_pack"      // unrelated product; safe to acknowledge
  | "unknown_user"
  | "purchase_not_found"
  | "catalog_drift"        // looks like ours, absent from the map — RETRYABLE
  | "not_configured"
  | "unavailable"          // transport/auth failure — RETRYABLE
  | "ambiguous_match"      // several purchases share a store id — RETRYABLE
  | "sandbox_not_allowlisted"
  | "invalid";

export interface GrantResult {
  outcome: GrantOutcome;
  scansGranted?: number;
  packBalance?: number;
  rcPurchaseId?: string;
  storeIdentifier?: string | null;
  /** True when the caller must NOT acknowledge — retry instead. */
  retryable: boolean;
}

const retryable = (o: GrantOutcome): boolean =>
  o === "unavailable" || o === "catalog_drift" ||
  o === "not_configured" || o === "ambiguous_match";

export interface ValidatedPurchase {
  purchase: V2Purchase;
  sku: string;
  scans: number;
  storeIdentifier: string;
}

export type ValidationResult =
  | { ok: true; value: ValidatedPurchase }
  | { ok: false; failure: ValidationFailure; retryable: boolean };

/**
 * EVERY check a purchase must pass before a single scan is granted.
 *
 * One function, used by BOTH paths. The webhook and recovery must not be able to
 * disagree about what "verified" means — a weaker recovery path would be the
 * obvious way in.
 *
 * `expectedStoreId` is supplied only by the webhook, which knows which store
 * transaction it is acting on. Recovery has no such expectation and passes null.
 */
export async function validatePurchase(
  expectedUserId: string,
  purchase: V2Purchase,
  expectedStoreId: string | null,
): Promise<ValidationResult> {
  // 1. Canonical identity must exist — it IS the exactly-once key.
  if (!purchase.id || !purchase.id.trim()) {
    return { ok: false, failure: "missing_purchase_id", retryable: false };
  }

  // 2. Ownership. customer_id is the appUserID, which FlipStart always sets to
  //    the Supabase uid, so a mismatch means this is someone else's purchase.
  if (!purchase.customer_id || purchase.customer_id !== expectedUserId) {
    console.warn("[scan-pack] REJECTED: purchase belongs to a different customer");
    return { ok: false, failure: "customer_mismatch", retryable: false };
  }

  // 3. Environment must match what this deployment operates in. A sandbox
  //    purchase reaching a production server must never grant.
  const env = purchaseEnvironment();
  if (!env) return { ok: false, failure: "environment_mismatch", retryable: true };
  const purchaseEnv = (purchase.environment ?? "").toLowerCase();
  if (purchaseEnv !== env) {
    console.warn(`[scan-pack] REJECTED: environment ${purchaseEnv || "unknown"} != ${env}`);
    return { ok: false, failure: "environment_mismatch", retryable: false };
  }

  // 4. The webhook's transaction must be the one we actually found. Without
  //    this, a search returning an unrelated purchase would still grant.
  if (expectedStoreId && purchase.store_purchase_identifier !== expectedStoreId) {
    console.warn("[scan-pack] REJECTED: store transaction id does not match the webhook");
    return { ok: false, failure: "store_id_mismatch", retryable: false };
  }

  // 5. Purchase state. Only a settled purchase may grant — a refunded or
  //    pending one must not.
  const status = (purchase.status ?? "").toLowerCase();
  const GRANTABLE = ["", "owned", "purchased", "completed", "active", "unknown"];
  if (!GRANTABLE.includes(status)) {
    console.warn(`[scan-pack] REJECTED: purchase status "${status}" is not grantable`);
    return { ok: false, failure: "bad_status", retryable: false };
  }

  // 6. Resolve RevenueCat's internal product id to the real store SKU.
  const resolved = await resolvePurchaseProduct(purchase);
  if (!resolved.ok) {
    // Could NOT read the product. Never assume "not ours" — that would swallow
    // a paid purchase.
    return { ok: false, failure: "product_unresolved", retryable: true };
  }
  const { storeIdentifier, resolution } = resolved.data;

  // 7. Must map to one of the five locked SKUs.
  if (resolution.kind === "unrelated") {
    return { ok: false, failure: "not_a_scan_pack", retryable: false };
  }
  if (resolution.kind === "drift") {
    console.error(
      `[scan-pack] CATALOG DRIFT: "${resolution.sku}" looks like a FlipStart scan pack ` +
      `but is not in the server map. NOT granting. Add it to scanPacks.ts.`,
    );
    return { ok: false, failure: "catalog_drift", retryable: true };
  }

  // 8. Sandbox gate. Checked LAST so a genuine configuration or ownership
  //    problem is reported as itself rather than masked by the allowlist.
  //    Production never reaches this branch.
  if (env === "sandbox" && !isSandboxGrantAllowed(expectedUserId)) {
    console.warn(
      "[scan-pack] sandbox purchase for a non-allowlisted user — NOT granting. " +
      "Add the uid to REVENUECAT_SANDBOX_PACK_USER_IDS to test grants.",
    );
    return { ok: false, failure: "sandbox_not_allowlisted", retryable: false };
  }

  return {
    ok: true,
    value: {
      purchase, sku: resolution.sku, scans: resolution.scans,
      storeIdentifier: storeIdentifier as string,
    },
  };
}

/**
 * Grant a single already-fetched V2 purchase.
 *
 * `expectedUserId` is the Supabase uid the caller has independently established.
 * The purchase's own `customer_id` is checked against it, so a webhook for one
 * account can never credit another.
 */
export async function grantPurchase(
  expectedUserId: string, purchase: V2Purchase, expectedStoreId: string | null = null,
): Promise<GrantResult> {
  // EVERY purchase goes through the same gate. No path grants without it.
  const v = await validatePurchase(expectedUserId, purchase, expectedStoreId);
  if (!v.ok) {
    const outcome: GrantOutcome =
      v.failure === "not_a_scan_pack"          ? "not_a_scan_pack"
    : v.failure === "catalog_drift"            ? "catalog_drift"
    : v.failure === "sandbox_not_allowlisted"  ? "sandbox_not_allowlisted"
    : v.failure === "product_unresolved"       ? "unavailable"
    :                                            "invalid";
    return { outcome, retryable: v.retryable };
  }

  const { sku, scans, storeIdentifier } = v.value;

  const sb = getSupabaseAdmin();
  if (!sb) return { outcome: "unavailable", retryable: true };

  const purchasedAt = purchase.purchased_at
    ? new Date(typeof purchase.purchased_at === "number"
        ? purchase.purchased_at : Date.parse(String(purchase.purchased_at))).toISOString()
    : new Date().toISOString();

  const { data, error } = await sb.rpc("grant_scan_pack_purchase", {
    p_user_id: expectedUserId,
    p_rc_purchase_id: purchase.id,
    p_store_identifier: sku,
    p_scans: scans,
    p_store_purchase_identifier: purchase.store_purchase_identifier ?? null,
    p_environment: purchase.environment ?? null,
    p_purchased_at: purchasedAt,
  });

  if (error) {
    console.error("[scan-pack] grant RPC failed:", error.message);
    return { outcome: "unavailable", retryable: true };
  }
  const row = Array.isArray(data) ? data[0] : data;

  if (row?.granted) {
    console.log(`[scan-pack] GRANTED ${scans} scans (${sku}) balance=${row.pack_scan_balance}`);
    return {
      outcome: "granted", scansGranted: scans, packBalance: row.pack_scan_balance,
      rcPurchaseId: purchase.id, storeIdentifier, retryable: false,
    };
  }
  // Normal duplicate: a webhook retry AND a reconciliation pass both arrive.
  console.log(`[scan-pack] already granted (${row?.reason}) — no change`);
  return {
    outcome: "already_granted", packBalance: row?.pack_scan_balance,
    rcPurchaseId: purchase.id, storeIdentifier, retryable: false,
  };
}

/**
 * WEBHOOK PATH.
 *
 * The store transaction id is only a lookup hint — V2 is what proves the
 * purchase exists and what its canonical id is.
 */
export async function grantFromWebhookTransaction(
  supabaseUserId: string, storeTransactionId: string,
): Promise<GrantResult> {
  if (!isV2Configured()) return { outcome: "not_configured", retryable: true };
  if (!storeTransactionId) return { outcome: "invalid", retryable: false };

  const existence = await checkUserExists(supabaseUserId);
  if (existence === "unknown") return { outcome: "unavailable", retryable: true };
  if (existence === "absent")  return { outcome: "unknown_user", retryable: false };

  const found = await findPurchaseByStoreId(storeTransactionId);
  if (!found.ok) {
    return { outcome: found.reason === "not_found" ? "purchase_not_found" : "unavailable",
             retryable: true };
  }
  // Not indexed yet. Retryable, so a webhook arriving before RevenueCat has
  // written the purchase does not permanently lose the grant.
  if (found.data.kind === "none") return { outcome: "purchase_not_found", retryable: true };
  // Several purchases share the store id. Never guessed — see findPurchaseByStoreId.
  if (found.data.kind === "ambiguous") return { outcome: "ambiguous_match", retryable: true };

  // expectedStoreId is passed so validation can confirm the purchase we found is
  // the one the webhook is actually about.
  return grantPurchase(supabaseUserId, found.data.purchase, storeTransactionId);
}

export interface RecoveryResult {
  ok: boolean;
  grantedCount: number;
  totalScansGranted: number;
  alreadyGranted: number;
  packBalance?: number;
  retryable: boolean;
}

/**
 * RECOVERY PATH.
 *
 * Lists every one-time purchase for the customer and grants any not yet in the
 * ledger. Safe to run repeatedly: the unique index makes each already-granted
 * purchase a no-op.
 *
 * Exists because a webhook can be delayed or dropped, and a user who paid should
 * not have to wait on delivery.
 */
export async function recoverScanPacks(
  supabaseUserId: string,
): Promise<RecoveryResult> {
  const base = { grantedCount: 0, totalScansGranted: 0, alreadyGranted: 0 };
  if (!isV2Configured()) return { ok: false, ...base, retryable: true };

  const existence = await checkUserExists(supabaseUserId);
  if (existence !== "exists") {
    return { ok: existence === "absent", ...base, retryable: existence === "unknown" };
  }

  // customer_id IS the Supabase uid — FlipStart always configures RevenueCat
  // with it, so no lookup or mapping is needed.
  // Environment comes from configuration, never from a caller — see
  // purchaseEnvironment(). An unset value refuses rather than querying both.
  const list = await listCustomerPurchases(supabaseUserId);
  if (!list.ok) {
    return { ok: false, ...base, retryable: list.reason !== "not_found" };
  }

  let granted = 0, scans = 0, already = 0, balance: number | undefined;
  let sawRetryable = false;

  for (const purchase of list.data) {
    // Same validation as the webhook. Recovery has no expected store id, so it
    // passes null — every other check still applies.
    const r = await grantPurchase(supabaseUserId, purchase, null);
    if (r.outcome === "granted") { granted++; scans += r.scansGranted ?? 0; balance = r.packBalance; }
    else if (r.outcome === "already_granted") { already++; balance = r.packBalance ?? balance; }
    else if (r.retryable) sawRetryable = true;
    // not_a_scan_pack and invalid are skipped silently — a customer may own
    // unrelated one-time products.
  }

  console.log(
    `[scan-pack] recovery: ${granted} granted (+${scans} scans), ${already} already granted`,
  );
  return {
    ok: !sawRetryable, grantedCount: granted, totalScansGranted: scans,
    alreadyGranted: already, packBalance: balance, retryable: sawRetryable,
  };
}

export { retryable as isRetryableOutcome };