/**
 * server/monetization/subscriptionNormalizer.ts
 *
 * RevenueCat subscriber state -> a FlipStart subscription snapshot.
 *
 * PURE. No network, no database, no clock reads except the `now` argument. Every
 * rule that decides whether someone is Trial, Monthly, Annual or Free lives here
 * and is testable without a RevenueCat account — which matters because the
 * expensive mistakes in monetization are logic mistakes, not plumbing ones.
 *
 * ── The boundary this file enforces ─────────────────────────────────────────
 * RevenueCat owns: is the entitlement active, which product, which period,
 * when does it end, is it a trial.
 * FlipStart owns: how many scans that entitles you to.
 *
 * Nothing here invents an allowance. It reports what the store says, and the
 * Phase 1 policy turns that into numbers.
 */

/** The entitlement configured in the RevenueCat dashboard. */
export const PRO_ENTITLEMENT = "pro";

export const PRODUCT_MONTHLY = "flipstart_pro_monthly";

/**
 * Annual identifiers.
 *
 * Re-exported from policy.ts rather than redeclared, so the sandbox/production
 * split lives in exactly one place. Three independent copies of a product id is
 * how one gets missed during a rename.
 */
export {
  PRODUCT_ANNUAL, PRODUCT_ANNUAL_SANDBOX, PRODUCT_ANNUAL_PRODUCTION,
  ANNUAL_PRODUCT_IDS, isAnnualProduct,
} from "./policy.js";
import { isAnnualProduct } from "./policy.js";

/**
 * FlipStart does not offer a trial, so "trial" is not a snapshot plan.
 *
 * An unexpected RevenueCat trial resolves to "unknown", which grants no
 * allowance and clears subscription state — see normalizeSubscriber().
 */
export type SnapshotPlan = "free" | "monthly" | "annual" | "unknown";

export interface SubscriptionSnapshot {
  plan: SnapshotPlan;
  productId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** RevenueCat's own period type, kept for diagnostics. */
  periodType: string | null;
  environment: string | null;
  willRenew: boolean | null;
  /** True when the entitlement is active RIGHT NOW. */
  active: boolean;
}

export function freeSnapshot(): SubscriptionSnapshot {
  return {
    plan: "free", productId: null, periodStart: null, periodEnd: null,
    periodType: null, environment: null, willRenew: null, active: false,
  };
}

/** Minimal shape of the v1 subscriber payload we depend on. */
export interface RcSubscriber {
  entitlements?: Record<string, {
    expires_date?: string | null;
    purchase_date?: string | null;
    product_identifier?: string;
    period_type?: string;
    grace_period_expires_date?: string | null;
  }>;
  subscriptions?: Record<string, {
    expires_date?: string | null;
    purchase_date?: string | null;
    original_purchase_date?: string | null;
    period_type?: string;
    unsubscribe_detected_at?: string | null;
    billing_issues_detected_at?: string | null;
    /** V1 returns grace at the SUBSCRIPTION level, not the entitlement. */
    grace_period_expires_date?: string | null;
    store?: string;
    is_sandbox?: boolean;
    auto_resume_date?: string | null;
  }>;
  original_app_user_id?: string;
}

const ts = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Build the snapshot.
 *
 * ── Active means active, not "will renew" ───────────────────────────────────
 * A cancelled subscription keeps its entitlement until the paid period ends.
 * Deriving access from `unsubscribe_detected_at` or `willRenew` would revoke
 * Pro the instant someone cancels, which is both wrong and the kind of thing
 * that generates refund requests. Access is decided purely by whether
 * `expires_date` is still in the future.
 *
 * ── Grace period counts as active ───────────────────────────────────────────
 * A billing retry is not a lapse. RevenueCat reports a grace period expiry, and
 * a user in one still has entitlement — cutting them off mid-retry would punish
 * them for their bank being slow.
 */
export function normalizeSubscriber(
  sub: RcSubscriber | null | undefined,
  now: Date = new Date(),
): SubscriptionSnapshot {
  if (!sub?.entitlements) return freeSnapshot();

  const ent = sub.entitlements[PRO_ENTITLEMENT];
  if (!ent) return freeSnapshot();

  const t = now.getTime();
  const productId = ent.product_identifier ?? null;
  const rcSub = productId ? sub.subscriptions?.[productId] : undefined;

  const expires = ts(ent.expires_date);
  /**
   * Grace is read from BOTH levels.
   *
   * V1 reports `grace_period_expires_date` on the SUBSCRIPTION object; reading
   * only the entitlement would miss it entirely and cut off a customer whose
   * card is merely being retried. Whichever level supplies it, an active grace
   * window grants access.
   */
  const grace = Math.max(
    ts(ent.grace_period_expires_date) ?? 0,
    ts(rcSub?.grace_period_expires_date) ?? 0,
  ) || null;

  /**
   * ACTIVE = normal entitlement still running OR a grace window still running.
   *
   * Never derived from `willRenew` or `unsubscribe_detected_at` — those describe
   * intent to renew, not present entitlement, and using them would revoke access
   * the moment someone cancels rather than at the end of the period they paid
   * for. `billing_issues_detected_at` likewise does not remove access on its own:
   * a failed charge with a live grace window is still access.
   */
  const effectiveEnd = Math.max(expires ?? 0, grace ?? 0);
  const active = expires === null ? true : effectiveEnd > t;

  if (!active) return freeSnapshot();

  /**
   * V1 REST sends lowercase period types ("normal", "trial", "intro").
   * The client SDK sends uppercase ("NORMAL", "TRIAL"). Each side normalizes at
   * its own boundary rather than assuming one shape — mixing them is how a trial
   * silently reads as a paid annual.
   */
  const periodType = (ent.period_type ?? rcSub?.period_type ?? "").toLowerCase() || null;

  const periodStart = ent.purchase_date ?? rcSub?.purchase_date ?? null;
  const periodEnd   = ent.expires_date ?? rcSub?.expires_date ?? null;

  /**
   * UNEXPECTED REVENUECAT TRIAL — fail closed.
   *
   * FlipStart no longer offers a free trial, so an active `period_type: trial`
   * means something is wrong: stale sandbox state, a legacy configuration, or an
   * introductory offer created in a dashboard by accident.
   *
   * It resolves to "unknown" deliberately:
   *   - NO trial bucket is provisioned, and no 50-scan allowance exists to grant
   *   - it is NOT silently reinterpreted as monthly or annual, even though the
   *     product id is present — granting a full paid allowance to someone in an
   *     unexpected introductory state is inventing entitlement
   *   - "unknown" already grants zero scans and logs loudly, so this reuses a
   *     proven fail-closed path rather than adding a new one
   *
   * apply_revenuecat_snapshot's else-branch then clears subscription state, so
   * the account derives as free until the real state is understood.
   */
  const isTrial = periodType === "trial";

  let plan: SnapshotPlan;
  if (isTrial) {
    console.error(
      `[revenuecat] UNEXPECTED period_type=trial for product "${productId}". ` +
      `FlipStart does not offer a free trial — failing closed, no allowance granted. ` +
      `Check App Store Connect for an introductory offer and RevenueCat for stale sandbox state.`,
    );
    plan = "unknown";
  } else if (productId === PRODUCT_MONTHLY) {
    plan = "monthly";
  } else if (isAnnualProduct(productId)) {
    // Both the deprecated and current annual ids resolve to annual, so an
    // existing subscriber never falls through to "unknown".
    plan = "annual";
  } else {
    /**
     * Active `pro` on a product we do not recognise.
     *
     * Never guessed. A wrong guess grants an allowance we did not sell — and a
     * silent one, because the user would simply have more scans than they paid
     * for. `unknown` grants no scan allowance and is loud in the logs.
     */
    plan = "unknown";
  }

  return {
    plan,
    productId,
    periodStart,
    periodEnd,
    periodType,
    environment: rcSub?.is_sandbox ? "sandbox" : rcSub?.store ? "production" : null,
    // Cancelled-but-active is normal and must not affect access.
    willRenew: rcSub ? !rcSub.unsubscribe_detected_at : null,
    active: true,
  };
}

/**
 * Does this snapshot begin a NEW subscription period?
 *
 * Compared on `periodStart`, not on how many times sync ran. Repeatedly calling
 * the reconcile endpoint must never mint 300 fresh scans — that would be a
 * trivially exploitable free-scan generator. Only the store advancing the period
 * resets usage.
 */
export function isNewPeriod(
  snapshot: SubscriptionSnapshot,
  storedPeriodStart: string | null,
): boolean {
  if (!snapshot.periodStart) return false;
  if (!storedPeriodStart) return true;
  return ts(snapshot.periodStart) !== ts(storedPeriodStart);
}