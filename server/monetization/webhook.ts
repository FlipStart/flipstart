/**
 * server/monetization/webhook.ts
 *
 * RevenueCat webhook receiver.
 *
 * ── Why it re-fetches rather than interpreting events ───────────────────────
 * A per-event state machine has to get ordering right, and webhooks arrive out
 * of order and get retried. Worse, acting on a CANCELLATION event would revoke
 * access that is still paid for through the period end.
 *
 * So an event is only a NUDGE: "something changed for this user". The handler
 * then asks RevenueCat what is true right now and applies that. Ordering stops
 * mattering, cancellation stops being dangerous, and there is exactly one piece
 * of subscription logic in the codebase.
 */
import crypto from "node:crypto";
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { reconcileUser, isFlipStartUserId } from "./revenuecatServer.js";

/** Constant-time compare, so a wrong secret cannot be discovered by timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyWebhookAuth(headerValue: unknown): boolean {
  const expected = (process.env.REVENUECAT_WEBHOOK_AUTH ?? "").trim();
  // Unset secret means REJECT. An open webhook that mutates subscription state
  // is worse than a webhook that does not work.
  if (!expected) {
    console.error("[revenuecat-webhook] REVENUECAT_WEBHOOK_AUTH not set — rejecting");
    return false;
  }
  const got = typeof headerValue === "string" ? headerValue.trim() : "";
  if (!got) return false;
  return safeEqual(got, expected);
}

export interface WebhookResult {
  status: number;
  body: {
    ok: boolean;
    reason?: string;
    /**
     * Present only on dashboard TEST acknowledgements.
     *
     * Explicit in the type rather than loosened to an index signature, so the
     * response shape stays a contract: a future field has to be declared here
     * before it can be returned, which is what caught this one.
     */
    test?: boolean;
  };
}

export async function handleRevenueCatWebhook(
  authHeader: unknown,
  payload: unknown,
): Promise<WebhookResult> {
  if (!verifyWebhookAuth(authHeader)) {
    return { status: 401, body: { ok: false, reason: "unauthorized" } };
  }

  const ev = (payload as { event?: Record<string, unknown> })?.event;
  const eventId = typeof ev?.id === "string" ? ev.id : null;
  const appUserId = typeof ev?.app_user_id === "string" ? ev.app_user_id : null;
  const eventType = typeof ev?.type === "string" ? ev.type : null;

  if (!eventId) return { status: 400, body: { ok: false, reason: "missing event id" } };

  console.log(`[revenuecat-webhook] received type=${eventType ?? "?"}`);

  /**
   * ── DASHBOARD TEST EVENTS ────────────────────────────────────────────────
   *
   * Placed AFTER Authorization and basic payload validation, and BEFORE the
   * ledger, the subscriber fetch and any reconciliation. Order matters in both
   * directions: an unauthenticated TEST must still be rejected, and an
   * authenticated TEST must touch nothing.
   *
   * ── What went wrong live ─────────────────────────────────────────────────
   * RevenueCat's dashboard TEST carries a SYNTHETIC app_user_id that happens to
   * be UUID-shaped. `isFlipStartUserId` only ever checked SHAPE, so the TEST
   * sailed through as a real identity and reconciliation ran:
   *
   *   GET /v1/subscribers/<synthetic>  -> 201, a phantom RevenueCat customer
   *   apply_revenuecat_snapshot        -> account_usage_user_id_fkey violation
   *   RevenueCat received              -> HTTP 500
   *
   * A TEST is diagnostic traffic, not subscription state. It is acknowledged
   * here and goes no further.
   *
   * ── Why TEST does not enter the event ledger ─────────────────────────────
   * The ledger records subscription lifecycle for idempotency and audit. A TEST
   * has no lifecycle to be idempotent about, and RevenueCat reuses ids across
   * repeated dashboard tests — so a stored TEST row could collide with, or be
   * mistaken for, a real event. Keeping it out leaves the ledger meaning exactly
   * one thing. The log line is the diagnostic record.
   */
  if (eventType === "TEST") {
    console.log("[revenuecat-webhook] authenticated TEST event received");
    console.log("[revenuecat-webhook] TEST acknowledged without reconciliation");
    return { status: 200, body: { ok: true, test: true } };
  }

  const sb = getSupabaseAdmin();
  if (!sb) return { status: 503, body: { ok: false, reason: "unavailable" } };

  /**
   * Claim atomically.
   *
   * The previous version inserted and treated ANY unique-constraint conflict as
   * a duplicate. That silently broke retries: a FAILED event redelivered with
   * the same id conflicted, was dismissed as already-seen, and never got
   * processed — the exact case a webhook retry exists for.
   *
   * Now only `processed` is permanently ignorable. `failed` is reclaimable, and
   * a `processing` row is reclaimable once stale, so a crashed worker cannot
   * strand an event forever.
   */
  const { data: claim, error: claimErr } = await sb.rpc("claim_revenuecat_event", {
    p_event_id: eventId,
    p_app_user_id: appUserId,
    p_event_type: eventType,
    p_product_id: typeof ev?.product_id === "string" ? ev.product_id : null,
    p_period_type: typeof ev?.period_type === "string" ? ev.period_type : null,
    p_environment: typeof ev?.environment === "string" ? ev.environment : null,
  });

  if (claimErr) {
    console.error("[revenuecat-webhook] claim failed:", claimErr.message);
    // 500 so RevenueCat retries — nothing was recorded, so a retry is safe.
    return { status: 500, body: { ok: false, reason: "ledger" } };
  }

  if (claim === "duplicate") {
    // Already succeeded. 200 stops the retries; reprocessing could reset a
    // period a second time.
    console.log("[revenuecat-webhook] already processed — ignoring");
    return { status: 200, body: { ok: true, reason: "duplicate" } };
  }
  if (claim === "in_progress") {
    /**
     * Another instance holds it and is still within the stale window.
     *
     * RETRYABLE, not 200. Processing happens inline in this request — there is
     * no durable background queue behind it. A 200 would tell RevenueCat the
     * event was delivered and stop the retries, so if the holding worker then
     * crashed, the event would be lost until the next unrelated event or a
     * manual sync.
     *
     * 503 keeps it in RevenueCat's retry queue, and both outcomes are then safe:
     *   - holder succeeds  -> the retry sees `processed` -> 200, no reprocessing
     *   - holder crashes   -> the row goes stale -> the retry reclaims it
     *
     * Revisit only if processing moves to a durable queue, at which point 200
     * becomes correct because the queue owns the guarantee.
     */
    console.log("[revenuecat-webhook] concurrent delivery — asking for retry");
    return { status: 503, body: { ok: false, reason: "in_progress" } };
  }

  /**
   * Structurally invalid identity: $RCAnonymousID, an email, a username, a
   * legacy scannerId, a device id. Recorded, never acted on.
   *
   * No heuristic mapping, no email or username lookup, no account creation. A
   * guess here would be an account merge, and a wrong one is unrecoverable.
   * Acknowledged rather than retried, because no future attempt would resolve it.
   */
  if (!isFlipStartUserId(appUserId)) {
    console.warn("[revenuecat-webhook] identity is not a FlipStart user id — ignoring, no account changed");
    await sb.rpc("finish_revenuecat_event", {
      p_event_id: eventId, p_ok: true, p_detail: "ignored_invalid_identity",
    });
    return { status: 200, body: { ok: true, reason: "ignored_invalid_identity" } };
  }

  /**
   * NON_RENEWING_PURCHASE — scan packs.
   *
   * Handled BEFORE subscription reconciliation because a consumable has no
   * subscription state to reconcile; running the subscription path would be a
   * wasted RevenueCat call and could log a misleading plan=free.
   *
   * `event.transaction_id` is a LOOKUP HINT only. V2 proves the purchase exists
   * and supplies the canonical `purchase.id` the ledger keys on.
   */
  if (eventType === "NON_RENEWING_PURCHASE") {
    const storeTxn = typeof ev?.transaction_id === "string" ? ev.transaction_id : "";
    const { grantFromWebhookTransaction } = await import("./scanPackGrant.js");
    const g = await grantFromWebhookTransaction(appUserId as string, storeTxn);

    if (g.retryable) {
      // Catalog drift, V2 unavailable, or the purchase not yet indexed. NEVER
      // acknowledged: a paid pack must not be silently dropped.
      console.warn(`[revenuecat-webhook] scan pack not granted (${g.outcome}) — retryable`);
      await sb.rpc("finish_revenuecat_event", {
        p_event_id: eventId, p_ok: false, p_detail: `scan_pack_${g.outcome}`,
      });
      return { status: 503, body: { ok: false, reason: g.outcome } };
    }

    await sb.rpc("finish_revenuecat_event", {
      p_event_id: eventId, p_ok: true, p_detail: `scan_pack_${g.outcome}`,
    });
    console.log(`[revenuecat-webhook] scan pack ${g.outcome}`);
    return { status: 200, body: { ok: true, reason: g.outcome } };
  }

  const result = await reconcileUser(appUserId as string);

  /**
   * Definitively no FlipStart account for this id.
   *
   * Legitimate causes: the user deleted their account, a stale customer from an
   * old environment, historical RevenueCat data. NOT an error and NOT "free" —
   * free means an existing account without Pro, whereas this means there is no
   * account to mutate at all.
   *
   * Acknowledged with 200 so RevenueCat stops retrying an event that can never
   * be reconciled, and recorded so the ledger still shows what arrived.
   */
  if (!result.ok && result.reason === "UNKNOWN_USER") {
    console.warn("[revenuecat-webhook] ignored event for unknown FlipStart user");
    await sb.rpc("finish_revenuecat_event", {
      p_event_id: eventId, p_ok: true, p_detail: "ignored_unknown_user",
    });
    return { status: 200, body: { ok: true, reason: "ignored_unknown_user" } };
  }

  /**
   * We could not determine whether the account exists.
   *
   * A Supabase outage, timeout or unexpected response. Deliberately NOT treated
   * as absent: acknowledging here would silently discard a real subscription
   * event. Left FAILED so the redelivery reclaims it.
   */
  if (!result.ok && result.reason === "USER_LOOKUP_FAILED") {
    console.warn("[revenuecat-webhook] user lookup failed — retryable, NOT acknowledged");
    await sb.rpc("finish_revenuecat_event", {
      p_event_id: eventId, p_ok: false, p_detail: "user_lookup_failed",
    });
    return { status: 503, body: { ok: false, reason: "user_lookup_failed" } };
  }

  if (!result.ok) {
    // Recorded as FAILED, which is now genuinely reclaimable — the next delivery
    // of this same event id will retry rather than being dismissed.
    await sb.rpc("finish_revenuecat_event", {
      p_event_id: eventId, p_ok: false, p_detail: result.reason ?? null,
    });
    return { status: 500, body: { ok: false, reason: result.reason } };
  }

  await sb.rpc("finish_revenuecat_event", {
    p_event_id: eventId, p_ok: true, p_detail: null,
  });

  console.log(`[revenuecat-webhook] subscription reconciled plan=${result.plan}`);
  return { status: 200, body: { ok: true } };
}