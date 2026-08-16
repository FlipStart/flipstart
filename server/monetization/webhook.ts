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
  body: { ok: boolean; reason?: string };
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

  // Anonymous or malformed identity: recorded, never acted on. FlipStart always
  // configures RevenueCat with a Supabase uuid, so anything else is not ours and
  // guessing at an owner would be an account merge by heuristic.
  if (!isFlipStartUserId(appUserId)) {
    console.warn("[revenuecat-webhook] non-FlipStart app_user_id — no account changed");
    // Marked OK so it is never retried: no future attempt would resolve it.
    await sb.rpc("finish_revenuecat_event", {
      p_event_id: eventId, p_ok: true, p_detail: null,
    });
    return { status: 200, body: { ok: true, reason: "ignored" } };
  }

  const result = await reconcileUser(appUserId as string);

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