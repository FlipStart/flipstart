/**
 * lib/paywallAnalytics.ts
 *
 * Paywall events, named in one place.
 *
 * ── No new SDK, no new pipeline ─────────────────────────────────────────────
 * Everything routes through the existing `trackAnalyticsEvent`, which is
 * already fire-and-forget and already cannot throw. This file adds names and a
 * typed payload, nothing else — it exists so the event vocabulary is a list you
 * can read rather than string literals scattered across a modal.
 *
 * ── The source travels with every event ─────────────────────────────────────
 * A paywall event without its source is close to useless: "purchase_completed"
 * cannot tell you whether Generate Listings or the scan limit is what actually
 * converts. Source is therefore required on every function here rather than
 * optional.
 *
 * Note: analytics inserts are currently failing RLS on `analytics_events`, so
 * these will be recorded by the legacy sink only until that is fixed. That is a
 * pre-existing condition, not something this phase introduces — and it is
 * precisely why nothing in the paywall's behaviour depends on an event landing.
 */
import { trackAnalyticsEvent } from "@/lib/analytics";
import type { ProPaywallSource } from "@/lib/paywallConfig";
import type { PurchaseTarget } from "@/lib/purchases";

export type PaywallEvent =
  | "paywall_opened"
  | "paywall_plan_selected"
  | "paywall_purchase_started"
  | "paywall_purchase_completed"
  | "paywall_purchase_cancelled"
  | "paywall_purchase_failed"
  | "paywall_restore_started"
  | "paywall_restore_completed"
  | "paywall_dismissed";

/** Never call trackAnalyticsEvent directly from paywall code — go through here. */
function emit(
  event: PaywallEvent,
  source: ProPaywallSource,
  extra: Record<string, unknown> = {},
): void {
  try {
    trackAnalyticsEvent(event, { paywall_source: source, ...extra });
  } catch {
    // trackAnalyticsEvent is already safe; this is the last line of defence.
    // A telemetry failure must never interrupt a purchase.
  }
}

export const paywallAnalytics = {
  opened: (source: ProPaywallSource) => emit("paywall_opened", source),

  planSelected: (source: ProPaywallSource, plan: PurchaseTarget) =>
    emit("paywall_plan_selected", source, { selected_plan: plan }),

  purchaseStarted: (source: ProPaywallSource, plan: PurchaseTarget) =>
    emit("paywall_purchase_started", source, { selected_plan: plan }),

  /**
   * Fired ONLY after the server confirms the plan.
   *
   * Deliberately not fired on a successful store call: a conversion metric that
   * counts payments the server never applied would overstate revenue and hide
   * exactly the activation failures worth knowing about.
   */
  purchaseCompleted: (source: ProPaywallSource, plan: PurchaseTarget | null) =>
    emit("paywall_purchase_completed", source, { selected_plan: plan }),

  purchaseCancelled: (source: ProPaywallSource, plan: PurchaseTarget | null) =>
    emit("paywall_purchase_cancelled", source, { selected_plan: plan }),

  /** `reason` is a short internal kind, never the user-facing message. */
  purchaseFailed: (source: ProPaywallSource, plan: PurchaseTarget | null, reason: string) =>
    emit("paywall_purchase_failed", source, { selected_plan: plan, reason }),

  restoreStarted: (source: ProPaywallSource) => emit("paywall_restore_started", source),

  restoreCompleted: (source: ProPaywallSource, outcome: string) =>
    emit("paywall_restore_completed", source, { outcome }),

  /** `resolved` distinguishes "closed after unlocking" from "walked away". */
  dismissed: (source: ProPaywallSource, resolved: boolean) =>
    emit("paywall_dismissed", source, { resolved }),
};