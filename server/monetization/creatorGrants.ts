/**
 * server/monetization/creatorGrants.ts
 *
 * Free Pro for accounts the founder chooses (UGC creators).
 *
 * ── How a grant works ────────────────────────────────────────────────────────
 * The founder runs `select * from grant_premium('<user id>')` in Supabase
 * (drizzle/sql/creator_premium_grants.sql). That records the grant in
 * `premium_grants` and writes a 30-day Pro period straight into the user's
 * `account_usage` row under the product id below. Everything that decides Pro
 * — derivePlan(), the scan reservation, the app's entitlement — reads those
 * columns, so the creator is Pro immediately, with the Monthly allowance.
 *
 * This file keeps it that way:
 *   - every 30 days the period rolls over (fresh Monthly allowance) for as long
 *     as the grant is active — checked whenever the account's usage is read
 *   - a RevenueCat sync (after a restore, or a webhook) that finds no paid
 *     subscription leaves an active grant alone instead of clearing it
 *   - a creator who later BUYS Pro gets their real subscription; when it ends,
 *     an active grant takes over again
 *
 * Revoking: `select * from revoke_premium('<user id>')` ends it at once.
 *
 * Never revenue: there is no purchase event, so no revenue figure counts it.
 * Plan breakdowns show the creator as Monthly with this product id.
 *
 * Grants are read with the service role only. The table has RLS on and no
 * policies, and the SQL functions are not callable by app users.
 */
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import type { AccountUsage } from "./policy.js";

export const CREATOR_GRANT_PRODUCT = "flipstart_creator_grant";
const PERIOD_MS = 30 * 86_400_000;
const CACHE_MS = 60_000;

interface GrantRow { user_id: string; ends_at: string | null; revoked_at: string | null }

/** Active grants by user id → end (null = until revoked). Refreshed every
 *  minute; a failed refresh keeps the last good copy. */
let cache: { at: number; grants: Map<string, number | null> } | null = null;
let loading: Promise<void> | null = null;

async function refresh(now: number): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const { data, error } = await sb.from("premium_grants").select("user_id, ends_at, revoked_at").is("revoked_at", null);
  if (error) {
    // Missing table (SQL not run yet) or an outage: grants simply don't apply.
    console.warn(`[creator-grant] could not read premium_grants: ${String(error.message ?? "").slice(0, 120)}`);
    cache = cache ?? { at: now, grants: new Map() };
    cache.at = now;
    return;
  }
  const grants = new Map<string, number | null>();
  for (const g of (data ?? []) as GrantRow[]) {
    const end = g.ends_at ? Date.parse(g.ends_at) : null;
    if (end === null || (Number.isFinite(end) && end > now)) grants.set(g.user_id, end);
  }
  cache = { at: now, grants };
}

/** The active grant's end for this user: a time, null for "until revoked",
 *  or undefined when the user has no active grant. */
export async function activeGrantEnd(userId: string, now = Date.now()): Promise<number | null | undefined> {
  if (!cache || now - cache.at > CACHE_MS) {
    loading ??= refresh(now).finally(() => { loading = null; });
    await loading;
  }
  const g = cache?.grants;
  if (!g || !g.has(userId)) return undefined;
  const end = g.get(userId) as number | null;
  return end === null || end > now ? end : undefined;
}

/** The next 30-day period, cut short at the grant's own end. */
export function grantPeriod(now: number, grantEnd: number | null): { start: string; end: string } {
  const end = grantEnd === null ? now + PERIOD_MS : Math.min(now + PERIOD_MS, grantEnd);
  return { start: new Date(now).toISOString(), end: new Date(end).toISOString() };
}

const periodOver = (u: AccountUsage, now: number) => {
  const end = u.subscription_period_end ? Date.parse(u.subscription_period_end) : NaN;
  return !Number.isFinite(end) || end <= now;
};

/**
 * Start a new grant period when one is due. Called on every usage read; costs
 * nothing unless the user has an active grant AND no running Pro period.
 *
 * Never touches a running paid subscription. Returns the usage to use.
 */
export async function applyCreatorGrantIfDue(
  userId: string, usage: AccountUsage, now = Date.now(),
): Promise<AccountUsage> {
  if (!periodOver(usage, now)) return usage;                    // Pro period still running (paid or granted)
  const grantEnd = await activeGrantEnd(userId, now);
  if (grantEnd === undefined) return usage;                       // no active grant: nothing to do
  const sb = getSupabaseAdmin();
  if (!sb) return usage;
  const p = grantPeriod(now, grantEnd);
  // Conditional on the period we read, so two requests at once roll it once.
  let q = sb.from("account_usage").update({
    subscription_product_id: CREATOR_GRANT_PRODUCT,
    subscription_period_start: p.start,
    subscription_period_end: p.end,
    subscription_scans_used: 0,
  }).eq("user_id", userId);
  q = usage.subscription_period_end ? q.eq("subscription_period_end", usage.subscription_period_end)
                                    : q.is("subscription_period_end", null);
  const { data, error } = await q.select("*").maybeSingle();
  if (error) {
    console.error(`[creator-grant] period roll failed uid=${userId.slice(0, 8)}…: ${String(error.message ?? "").slice(0, 120)}`);
    return usage;
  }
  if (data) {
    console.log(`[creator-grant] new period uid=${userId.slice(0, 8)}… until ${p.end}`);
    return data as AccountUsage;
  }
  // Another request rolled it first: read what it wrote.
  const { data: again } = await sb.from("account_usage").select("*").eq("user_id", userId).maybeSingle();
  return (again as AccountUsage | null) ?? usage;
}

/**
 * For the RevenueCat sync: RevenueCat says "no subscription" and the user has
 * an active grant. Apply the grant (if its period needs starting) and tell the
 * caller to leave account_usage alone. False = no grant; sync as normal.
 */
export async function keepCreatorGrant(userId: string, usage: AccountUsage | null, now = Date.now()): Promise<boolean> {
  if (await activeGrantEnd(userId, now) === undefined) return false;
  if (usage) await applyCreatorGrantIfDue(userId, usage, now);
  return true;
}

/** Test seam. */
export function __resetCreatorGrants(): void { cache = null; loading = null; }