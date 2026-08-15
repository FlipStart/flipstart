/**
 * server/monetization/policy.ts
 *
 * The ONE place that decides plan, feature access, and which bucket a scan
 * comes from. No screen and no endpoint may reimplement any of this.
 *
 * Pure and synchronous on purpose: it takes state and returns decisions, with
 * no database or network access. That makes every rule in the product testable
 * without a Supabase connection, which is why the whole consumption policy can
 * be verified in CI.
 */

// ── Plan values. Constants, not magic numbers scattered through call sites. ──
export const FREE_LIFETIME_SCANS = 15;
export const TRIAL_SCANS = 50;
export const TRIAL_DAYS = 7;
export const MONTHLY_SCANS = 300;
export const ANNUAL_SCANS = 4_000;

/** Product ids. Values land when App Store products are created in a later
 *  phase; the shape is fixed now so nothing downstream has to change. */
export const PRODUCT_MONTHLY = "flipstart_pro_monthly";
export const PRODUCT_ANNUAL  = "flipstart_pro_annual";

export type PlanState = "free" | "trial" | "monthly" | "annual";
export type ScanSource = "trial" | "free" | "subscription" | "pack";

export type Feature =
  | "scan_photo_3" | "camera_context" | "generate_listings"
  | "deep_analysis" | "sold_comps" | "hunt_mode" | "premium_stats";

/** FlipStart-owned usage. Mirrors account_usage. */
export interface AccountUsage {
  free_scans_used: number;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  trial_scans_used: number;
  subscription_product_id: string | null;
  subscription_period_start: string | null;
  subscription_period_end: string | null;
  subscription_scans_used: number;
  pack_scan_balance: number;
}

export function emptyUsage(): AccountUsage {
  return {
    free_scans_used: 0,
    trial_started_at: null, trial_expires_at: null, trial_scans_used: 0,
    subscription_product_id: null, subscription_period_start: null,
    subscription_period_end: null, subscription_scans_used: 0,
    pack_scan_balance: 0,
  };
}

/**
 * Plan is DERIVED, never stored.
 *
 * There is deliberately no `is_pro` column. Apple owns subscription truth, and
 * a boolean copy of it goes stale the moment a subscription lapses between
 * syncs — you would be granting Pro to an expired subscriber. Deriving from the
 * period window means an expired subscription reads as free automatically.
 *
 * An active subscription outranks an active trial: converting mid-trial should
 * move you onto the subscription allowance, not leave you on 50 scans.
 */
export function derivePlan(u: AccountUsage, now = new Date()): PlanState {
  const t = now.getTime();
  const subActive = Boolean(
    u.subscription_product_id && u.subscription_period_end &&
    Date.parse(u.subscription_period_end) > t,
  );
  if (subActive) {
    return u.subscription_product_id === PRODUCT_ANNUAL ? "annual" : "monthly";
  }
  if (u.trial_expires_at && Date.parse(u.trial_expires_at) > t) return "trial";
  return "free";
}

export function isTrialActive(u: AccountUsage, now = new Date()): boolean {
  return Boolean(u.trial_expires_at && Date.parse(u.trial_expires_at) > now.getTime());
}

/** Subscription allowance for the plan. Free/trial have no subscription bucket. */
export function subscriptionLimitFor(plan: PlanState): number {
  return plan === "monthly" ? MONTHLY_SCANS : plan === "annual" ? ANNUAL_SCANS : 0;
}

/**
 * Bucket order, BY PLAN.
 *
 * Not one universal order. A trial user must never touch their lifetime free
 * allowance — those 15 scans have to survive the trial intact — and a paying
 * subscriber must not silently burn them either. The audit's single
 * `trial → free → subscription → pack` chain would have drained the free bucket
 * for exactly the users who should never touch it.
 *
 * Packs are always last, in every plan.
 */
export function consumptionOrder(plan: PlanState): ScanSource[] {
  switch (plan) {
    case "trial":   return ["trial", "pack"];
    case "monthly":
    case "annual":  return ["subscription", "pack"];
    case "free":
    default:        return ["free", "pack"];
  }
}

/**
 * Feature access.
 *
 * Sold Comps and Hunt Mode are FREE features — a deliberate product decision.
 * Sold Comps costs real money per request, so the temptation to gate it is
 * real, but it is part of the core scanning experience and the comps budget
 * system already caps that spend independently.
 *
 * Pack ownership is not a parameter here. Packs buy quantity, never capability.
 */
export function canUseFeature(plan: PlanState, feature: Feature): boolean {
  const pro = plan === "trial" || plan === "monthly" || plan === "annual";
  switch (feature) {
    case "sold_comps":
    case "hunt_mode":         return true;
    case "scan_photo_3":
    case "camera_context":
    case "generate_listings":
    case "deep_analysis":
    case "premium_stats":     return pro;
    default:                  return false;
  }
}

/** Photo slots allowed. Free is 2 (front + tag); Pro is 3. */
export function maxPhotoSlots(plan: PlanState): 2 | 3 {
  return canUseFeature(plan, "scan_photo_3") ? 3 : 2;
}

export interface Balances {
  trialScansRemaining: number;
  freeScansRemaining: number;
  subscriptionScansRemaining: number;
  packScansRemaining: number;
  /** Only the buckets this plan can actually spend. A free user's total must not
   *  include a subscription allowance they do not have. */
  totalUsableScans: number;
}

export function computeBalances(u: AccountUsage, now = new Date()): Balances {
  const plan = derivePlan(u, now);
  const trialLive = isTrialActive(u, now);
  const subLimit = subscriptionLimitFor(plan);

  const trial = trialLive ? Math.max(0, TRIAL_SCANS - u.trial_scans_used) : 0;
  const free  = Math.max(0, FREE_LIFETIME_SCANS - u.free_scans_used);
  const sub   = Math.max(0, subLimit - u.subscription_scans_used);
  const pack  = Math.max(0, u.pack_scan_balance);

  // Sum only the spendable buckets for this plan, so the headline number the UI
  // shows is one a scan can actually draw on.
  const order = consumptionOrder(plan);
  const usable = order.reduce((n, s) =>
    n + (s === "trial" ? trial : s === "free" ? free : s === "subscription" ? sub : pack), 0);

  return {
    trialScansRemaining: trial,
    freeScansRemaining: free,
    subscriptionScansRemaining: sub,
    packScansRemaining: pack,
    totalUsableScans: usable,
  };
}

/** Safe client read model. No credentials, no internal ids, no override state. */
export interface EntitlementReadModel {
  plan: PlanState;
  isPro: boolean;
  trialActive: boolean;
  trialExpiresAt: string | null;
  subscriptionPeriodEnd: string | null;
  maxPhotoSlots: 2 | 3;
  features: Record<Feature, boolean>;
  balances: Balances;
}

export function buildReadModel(u: AccountUsage, now = new Date()): EntitlementReadModel {
  const plan = derivePlan(u, now);
  const feats = [
    "scan_photo_3", "camera_context", "generate_listings",
    "deep_analysis", "sold_comps", "hunt_mode", "premium_stats",
  ] as const;
  return {
    plan,
    // Convenience for the UI only. Derived here, never stored, never trusted
    // back from the client.
    isPro: plan !== "free",
    trialActive: isTrialActive(u, now),
    trialExpiresAt: u.trial_expires_at,
    subscriptionPeriodEnd: u.subscription_period_end,
    maxPhotoSlots: maxPhotoSlots(plan),
    features: Object.fromEntries(feats.map(f => [f, canUseFeature(plan, f)])) as Record<Feature, boolean>,
    balances: computeBalances(u, now),
  };
}