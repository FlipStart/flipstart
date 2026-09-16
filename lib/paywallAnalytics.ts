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
import { setActivePaywall, currentScanBalances, trackAnalyticsEvent } from "@/lib/analytics";
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
  | "paywall_continue_free"
  | "paywall_closed"
  /** @deprecated Legacy overloaded terminal event — see `dismissed` below. */
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
  /**
   * Impression, enriched with the monetization context that makes it useful.
   *
   * Balances come from the in-memory snapshot, so this costs no network call
   * and cannot delay the paywall appearing. When entitlement has not resolved
   * yet the balances are simply absent rather than zero — "we don't know" and
   * "they have none" are different facts and must not be conflated.
   *
   * Also marks this paywall active, so a subsequent app_backgrounded records
   * that the user left with it on screen.
   */
  opened: (source: ProPaywallSource, extra: Record<string, unknown> = {}) => {
    setActivePaywall(source);
    emit("paywall_opened", source, { ...currentScanBalances(), ...extra });
  },

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

  /**
   * The user chose the free path.
   *
   * Its own event, because it was previously indistinguishable from closing:
   * continueFree() called dismiss(false), which emitted paywall_dismissed
   * exactly as the X did. That made the single most important question about
   * the onboarding offer — did they decline, or did they not realise they
   * could — unanswerable.
   *
   * Terminal, so the active-paywall marker is cleared.
   */
  continueFree: (source: ProPaywallSource) => {
    setActivePaywall(null);
    emit("paywall_continue_free", source, { ...currentScanBalances() });
  },

  /**
   * An EXPLICIT close: the user pressed the X.
   *
   * Never emitted for a purchase, a restore, or the free path. Those are
   * separate outcomes and collapsing them into one "dismissed" bucket is what
   * this replaces.
   */
  closed: (source: ProPaywallSource) => {
    setActivePaywall(null);
    emit("paywall_closed", source, { ...currentScanBalances() });
  },

  /**
   * Clears the active-paywall marker without emitting anything.
   *
   * For terminal paths that already have their own event — purchase completed,
   * restore unlocked — so the marker cannot go stale and mislabel an unrelated
   * background later as paywall abandonment.
   */
  resolved: (_source: ProPaywallSource) => { setActivePaywall(null); },

  /**
   * @deprecated Legacy overloaded event. No longer emitted by new builds.
   *
   * Retained ONLY so historical rows remain interpretable: before this change,
   * paywall_dismissed{resolved:false} meant EITHER continue-free OR an explicit
   * close. V4 queries must treat pre-cutover rows as ambiguous and must not sum
   * them with paywall_continue_free or paywall_closed, or terminal actions will
   * be double counted across the boundary.
   */
  dismissed: (source: ProPaywallSource, resolved: boolean) =>
    emit("paywall_dismissed", source, { resolved }),
};