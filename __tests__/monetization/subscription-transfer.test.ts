/**
 * __tests__/monetization/subscription-transfer.test.ts
 *
 * One Apple subscription must never leave two FlipStart accounts able to scan.
 *
 * ── The confirmed vulnerability ─────────────────────────────────────────────
 * Account A (monthly, 299 remaining) + Restore on Account B produced:
 *     A = Pro + 299        B = Pro + 300
 * Two Pro accounts and 599 scans from one subscription. And because B started
 * fresh, the allowance was FARMABLE: spend, make an account, Restore, repeat.
 *
 * ── What is executed vs asserted ────────────────────────────────────────────
 * `candidateUserIds` is pure and runs for real. The RPC's quota semantics are
 * executed against a faithful in-test model of the SQL, so the 299-stays-299
 * invariant is arithmetic rather than prose. Orchestration order and the SQL
 * text itself are asserted structurally, which is stated plainly rather than
 * dressed up as a database test.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * transfer.ts imports supabaseAdmin transitively. Nothing under test touches
 * the database -- only pure id filtering and the modelled RPC semantics -- so
 * the SDK is stubbed to keep this a unit test with no client construction.
 */
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  derivePlan, computeBalances, emptyUsage,
  MONTHLY_SCANS, ANNUAL_SCANS, FREE_LIFETIME_SCANS,
  type AccountUsage,
} from "@/server/monetization/policy";
import { candidateUserIds } from "@/server/monetization/transfer";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const SQL = read("drizzle/sql/transfer_subscription_ownership.sql");
const TRANSFER = read("server/monetization/transfer.ts");
const WEBHOOK = read("server/monetization/webhook.ts");

const NOW = new Date("2026-08-15T12:00:00Z");
const P = "2026-08-01T00:00:00+00:00";
const P_END = "2026-09-01T00:00:00+00:00";

const A_UID = "78edf4ee-1111-4111-8111-aaaaaaaaaaaa";
const B_UID = "9747ab3a-2222-4222-8222-bbbbbbbbbbbb";
const C_UID = "5555cccc-3333-4333-8333-cccccccccccc";

const sub = (over: Partial<AccountUsage> = {}): AccountUsage => ({
  ...emptyUsage(),
  subscription_product_id: "flipstart_pro_monthly",
  subscription_period_start: P,
  subscription_period_end: P_END,
  subscription_scans_used: 1,
  ...over,
});

/**
 * Faithful model of transfer_subscription_ownership.
 *
 * Mirrors the SQL exactly: the source is chosen by STATE (holds a subscription,
 * latest period_end) never by array position; period + usage move together;
 * every source is cleared; free and pack buckets are never touched on either
 * side.
 */
function transferOwnership(
  rows: Record<string, AccountUsage>, fromIds: string[], toId: string,
  /** The period RevenueCat confirmed the destination owns. */
  productId = "flipstart_pro_monthly", periodStart = P,
): { transferred: boolean; source?: string } {
  const dest = rows[toId] ?? (rows[toId] = emptyUsage());

  /**
   * Eligible ONLY if the row already represents THIS subscription period.
   * "Latest period_end" is not enough — a different subscriber named in the
   * array could win that comparison and have their quota stolen.
   */
  const candidates = fromIds
    .filter(id => id !== toId
      && rows[id]?.subscription_product_id === productId
      && rows[id]?.subscription_period_start === periodStart)
    // Duplicate stale owners: highest usage wins. Never summed, never lowest.
    .sort((a, b) => rows[b].subscription_scans_used - rows[a].subscription_scans_used
                    || a.localeCompare(b));

  // FAIL CLOSED: destination is left exactly as it was, no allowance minted.
  if (candidates.length === 0) return { transferred: false };
  const src = rows[candidates[0]];

  // Period AND usage move together. This one line is the anti-farming rule.
  dest.subscription_product_id   = src.subscription_product_id;
  dest.subscription_period_start = src.subscription_period_start;
  dest.subscription_period_end   = src.subscription_period_end;
  dest.subscription_scans_used   = src.subscription_scans_used;
  // free_scans_used / pack_scan_balance deliberately absent.

  for (const id of fromIds) {
    if (id === toId || !rows[id]) continue;
    // Only stale owners OF THIS subscription. An unrelated subscription on a
    // named account is left alone.
    if (rows[id].subscription_product_id !== productId
        || rows[id].subscription_period_start !== periodStart) continue;
    rows[id].subscription_product_id   = null;
    rows[id].subscription_period_start = null;
    rows[id].subscription_period_end   = null;
    rows[id].subscription_scans_used   = 0;
  }
  return { transferred: true, source: candidates[0] };
}

/** Models apply_revenuecat_snapshot's reset rule: only a NEW period resets. */
function applySnapshot(
  row: AccountUsage, productId: string, periodStart: string, periodEnd: string,
): AccountUsage {
  const isNewPeriod = row.subscription_period_start !== periodStart;
  return {
    ...row,
    subscription_product_id: productId,
    subscription_period_start: periodStart,
    subscription_period_end: periodEnd,
    subscription_scans_used: isNewPeriod ? 0 : row.subscription_scans_used,
  };
}

// ── A-D, P. The core invariant ──────────────────────────────────────────────

describe("subscription transfer preserves usage", () => {
  /** Requirements A, C, D, P. */
  it("moves 299 remaining to B and strips A of Pro", () => {
    const rows: Record<string, AccountUsage> = {
      [A_UID]: sub({ free_scans_used: 4, pack_scan_balance: 40 }),
      [B_UID]: emptyUsage(),
    };
    expect(computeBalances(rows[A_UID], NOW).subscriptionScansRemaining).toBe(299);

    const r = transferOwnership(rows, [A_UID], B_UID);
    expect(r.transferred).toBe(true);

    // B is Pro with EXACTLY 299 -- not a fresh 300.
    expect(derivePlan(rows[B_UID], NOW)).toBe("monthly");
    expect(rows[B_UID].subscription_scans_used).toBe(1);
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).toBe(299);
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).not.toBe(MONTHLY_SCANS);

    // A is no longer Pro and holds no subscription bucket.
    expect(derivePlan(rows[A_UID], NOW)).toBe("free");
    expect(computeBalances(rows[A_UID], NOW).subscriptionScansRemaining).toBe(0);

    // Requirement P: exactly one account can consume the subscription.
    const proOwners = [A_UID, B_UID].filter(id => derivePlan(rows[id], NOW) !== "free");
    expect(proOwners).toEqual([B_UID]);
  });

  /** Requirement B. Heavier use transfers just as exactly. */
  it("moves 53 remaining as 53, not 300", () => {
    const rows: Record<string, AccountUsage> = {
      [A_UID]: sub({ subscription_scans_used: MONTHLY_SCANS - 53 }),
      [B_UID]: emptyUsage(),
    };
    transferOwnership(rows, [A_UID], B_UID);
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).toBe(53);
  });

  /** Requirement G. A second hop preserves it again — no reset anywhere. */
  it("preserves usage across a second transfer B -> C", () => {
    const rows: Record<string, AccountUsage> = {
      [A_UID]: sub({ subscription_scans_used: MONTHLY_SCANS - 53 }),
      [B_UID]: emptyUsage(), [C_UID]: emptyUsage(),
    };
    transferOwnership(rows, [A_UID], B_UID);
    transferOwnership(rows, [A_UID, B_UID], C_UID);

    expect(computeBalances(rows[C_UID], NOW).subscriptionScansRemaining).toBe(53);
    expect(derivePlan(rows[B_UID], NOW)).toBe("free");
    expect(derivePlan(rows[A_UID], NOW)).toBe("free");
  });

  /** Requirement M. Annual carries its real remaining allowance. */
  it("preserves an Annual remainder exactly", () => {
    const rows: Record<string, AccountUsage> = {
      [A_UID]: sub({ subscription_product_id: "flipstart_pro_annual", subscription_scans_used: 1200 }),
      [B_UID]: emptyUsage(),
    };
    transferOwnership(rows, [A_UID], B_UID, "flipstart_pro_annual", P);
    expect(derivePlan(rows[B_UID], NOW)).toBe("annual");
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).toBe(ANNUAL_SCANS - 1200);
  });
});

// ── Hardened source selection ───────────────────────────────────────────────

describe("source must match the transferred subscription", () => {
  const OTHER_P = "2026-07-01T00:00:00+00:00";
  const OTHER_END = "2027-07-01T00:00:00+00:00";

  /** Requirement 1. Two valid users, only one holds period P. */
  it("picks the row representing period P, not merely a subscribed row", () => {
    const rows: Record<string, AccountUsage> = {
      [C_UID]: sub({ subscription_period_start: OTHER_P, subscription_period_end: OTHER_END,
                     subscription_scans_used: 5 }),
      [A_UID]: sub({ subscription_scans_used: 1 }),
      [B_UID]: emptyUsage(),
    };
    const r = transferOwnership(rows, [C_UID, A_UID], B_UID);
    expect(r.source).toBe(A_UID);
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).toBe(299);
    // C's own unrelated subscription is untouched.
    expect(derivePlan(rows[C_UID], NOW)).toBe("monthly");
    expect(rows[C_UID].subscription_scans_used).toBe(5);
  });

  /**
   * Requirement 2. A LATER period_end must not win.
   *
   * This is exactly what the old "order by period_end desc" would have chosen,
   * and it would have stolen an unrelated subscriber's quota.
   */
  it("never chooses a later period_end belonging to a different period", () => {
    const rows: Record<string, AccountUsage> = {
      [C_UID]: sub({ subscription_period_start: OTHER_P,
                     subscription_period_end: "2099-01-01T00:00:00+00:00",
                     subscription_scans_used: 200 }),
      [A_UID]: sub({ subscription_scans_used: 1 }),
      [B_UID]: emptyUsage(),
    };
    const r = transferOwnership(rows, [C_UID, A_UID], B_UID);
    expect(r.source).toBe(A_UID);
    expect(r.source).not.toBe(C_UID);
    expect(rows[C_UID].subscription_scans_used).toBe(200);
  });

  /** Requirement 3. No match -> fail closed, and NO fresh allowance. */
  it("fails closed when no source represents the period", () => {
    const rows: Record<string, AccountUsage> = {
      [C_UID]: sub({ subscription_period_start: OTHER_P, subscription_period_end: OTHER_END }),
      [B_UID]: emptyUsage(),
    };
    const r = transferOwnership(rows, [C_UID], B_UID);
    expect(r.transferred).toBe(false);
    // The destination is untouched: no product, no minted 300.
    expect(derivePlan(rows[B_UID], NOW)).toBe("free");
    expect(rows[B_UID].subscription_product_id).toBeNull();
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).toBe(0);
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).not.toBe(MONTHLY_SCANS);
  });

  /** Requirement 4. Duplicate owners of the SAME period. */
  it("takes the highest usage from duplicate owners, never the sum or the lowest", () => {
    const rows: Record<string, AccountUsage> = {
      [A_UID]: sub({ subscription_scans_used: 10 }),
      [C_UID]: sub({ subscription_scans_used: 40 }),
      [B_UID]: emptyUsage(),
    };
    transferOwnership(rows, [A_UID, C_UID], B_UID);
    // Highest — 40. Not 50 (sum, double-charging) and not 10 (farmable).
    expect(rows[B_UID].subscription_scans_used).toBe(40);
    expect(rows[B_UID].subscription_scans_used).not.toBe(50);
    expect(rows[B_UID].subscription_scans_used).not.toBe(10);
    // Both stale owners cleared — exactly one counter survives.
    expect(derivePlan(rows[A_UID], NOW)).toBe("free");
    expect(derivePlan(rows[C_UID], NOW)).toBe("free");
    expect([A_UID, B_UID, C_UID].filter(id => derivePlan(rows[id], NOW) !== "free")).toEqual([B_UID]);
  });

  /** Requirement 5. Buckets stay put even on the fail-closed path. */
  it("leaves free and pack balances untouched, including when it fails closed", () => {
    const rows: Record<string, AccountUsage> = {
      [C_UID]: sub({ subscription_period_start: OTHER_P, subscription_period_end: OTHER_END,
                     free_scans_used: 3, pack_scan_balance: 70 }),
      [B_UID]: { ...emptyUsage(), free_scans_used: 6, pack_scan_balance: 25 },
    };
    transferOwnership(rows, [C_UID], B_UID);
    expect(rows[C_UID].free_scans_used).toBe(3);
    expect(rows[C_UID].pack_scan_balance).toBe(70);
    expect(rows[B_UID].free_scans_used).toBe(6);
    expect(rows[B_UID].pack_scan_balance).toBe(25);
  });

  /** The SQL enforces the same rule, and drops the permissive overload. */
  it("the RPC requires product and period_start to match", () => {
    expect(SQL).toMatch(/and subscription_product_id\s+= p_product_id/);
    expect(SQL).toMatch(/and subscription_period_start = p_period_start/);
    expect(SQL).toMatch(/order by subscription_scans_used desc, user_id/);
    expect(SQL).not.toMatch(/order by subscription_period_end desc nulls last/);
    expect(SQL).toMatch(/drop function if exists public\.transfer_subscription_ownership\(uuid\[\], uuid\);/);

    /**
     * The CLEARING statement must be scoped too, not just the SELECT.
     *
     * Unscoped, it would wipe the subscription of any user merely named in
     * transferred_from — the mirror image of the duplication bug, revoking a
     * different subscriber. The mutation run caught this gap.
     */
    const clearStmt = SQL.slice(SQL.indexOf("with cleared as ("), SQL.indexOf("returning 1"));
    expect(clearStmt).toMatch(/and subscription_product_id\s+= p_product_id/);
    expect(clearStmt).toMatch(/and subscription_period_start = p_period_start/);
  });

  /** Verification must not WRITE, or a fail-closed RPC leaves a minted allowance. */
  it("verifies the destination with a read-only fetch, not reconcileUser", () => {
    const t = TRANSFER;
    const fetchAt = t.indexOf("const sub = await fetchSubscriber(destination)");
    const rpcAt = t.indexOf('sb.rpc("transfer_subscription_ownership"');
    expect(fetchAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeLessThan(rpcAt);
    // No write before the RPC.
    expect(t.slice(0, rpcAt)).not.toMatch(/reconcileUser\(/);
    expect(t).toMatch(/p_product_id: snapshot\.productId/);
    expect(t).toMatch(/p_period_start: snapshot\.periodStart/);
  });
});

// ── E, F, O. Idempotence and stale events ───────────────────────────────────

describe("replays and stale events", () => {
  /** Requirement E. A second TRANSFER finds nothing to move. */
  it("is idempotent on a repeated TRANSFER", () => {
    const rows: Record<string, AccountUsage> = { [A_UID]: sub(), [B_UID]: emptyUsage() };
    transferOwnership(rows, [A_UID], B_UID);
    const before = { ...rows[B_UID] };

    const second = transferOwnership(rows, [A_UID], B_UID);
    expect(second.transferred).toBe(false);
    expect(rows[B_UID]).toEqual(before);
    expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).toBe(299);
  });

  /** Requirement F. A same-period restore never resets the counter. */
  it("does not reset usage on a repeated restore in the same period", () => {
    const rows: Record<string, AccountUsage> = { [A_UID]: sub(), [B_UID]: emptyUsage() };
    transferOwnership(rows, [A_UID], B_UID);

    // Every subsequent reconcile carries the SAME period_start.
    for (let i = 0; i < 3; i++) {
      rows[B_UID] = applySnapshot(rows[B_UID], "flipstart_pro_monthly", P, P_END);
      expect(computeBalances(rows[B_UID], NOW).subscriptionScansRemaining).toBe(299);
    }
  });

  /**
   * Requirement O. A delayed event for A cannot resurrect it.
   *
   * Nothing trusts an event payload for subscription state: reconcileUser does a
   * LIVE REST fetch, which now reports no entitlement for A, so A resolves to
   * free and its columns stay cleared.
   */
  it("cannot reactivate the old owner from a stale event", () => {
    const rows: Record<string, AccountUsage> = { [A_UID]: sub(), [B_UID]: emptyUsage() };
    transferOwnership(rows, [A_UID], B_UID);

    // A stale reconcile for A resolves to free -> the else-branch clears again.
    rows[A_UID] = { ...rows[A_UID], subscription_product_id: null, subscription_period_start: null,
                    subscription_period_end: null, subscription_scans_used: 0 };
    expect(derivePlan(rows[A_UID], NOW)).toBe("free");
    expect(derivePlan(rows[B_UID], NOW)).toBe("monthly");

    // The live-state rule, asserted in code.
    // Verification is now a READ-ONLY fetch — reconcileUser would write and
    // could mint an allowance if the transfer then failed closed.
    expect(TRANSFER).toMatch(/const sub = await fetchSubscriber\(destination\);/);
    expect(TRANSFER).toMatch(/snapshot\.plan !== "monthly" && snapshot\.plan !== "annual"/);
  });

  /** Replay protection remains the first line of defence. */
  it("keeps the event-ledger claim ahead of any transfer work", () => {
    const claim = WEBHOOK.indexOf('claim_revenuecat_event');
    const transfer = WEBHOOK.indexOf('eventType === "TRANSFER"');
    expect(claim).toBeGreaterThan(-1);
    expect(transfer).toBeGreaterThan(claim);
    expect(WEBHOOK).toMatch(/if \(claim === "duplicate"\)/);
  });
});

// ── H, I. Account-specific buckets ──────────────────────────────────────────

describe("free and pack buckets never transfer", () => {
  /** Requirements H and I together. */
  it("leaves each account's free and pack balances exactly where they were", () => {
    const rows: Record<string, AccountUsage> = {
      [A_UID]: sub({ free_scans_used: 4, pack_scan_balance: 40 }),
      [B_UID]: { ...emptyUsage(), free_scans_used: 9, pack_scan_balance: 110 },
    };
    transferOwnership(rows, [A_UID], B_UID);

    // A keeps its own free usage and the packs it paid for.
    expect(rows[A_UID].free_scans_used).toBe(4);
    expect(rows[A_UID].pack_scan_balance).toBe(40);
    expect(computeBalances(rows[A_UID], NOW).freeScansRemaining).toBe(FREE_LIFETIME_SCANS - 4);

    // B keeps its own -- nothing was copied across.
    expect(rows[B_UID].free_scans_used).toBe(9);
    expect(rows[B_UID].pack_scan_balance).toBe(110);
  });

  /** The SQL must not name those columns in either statement. */
  it("the RPC never writes free or pack columns", () => {
    const moves = SQL.slice(SQL.indexOf("update public.account_usage set"));
    expect(moves).not.toMatch(/free_scans_used\s*=/);
    expect(moves).not.toMatch(/pack_scan_balance\s*=/);
    expect(SQL).toMatch(/subscription_scans_used\s*=\s*v_src\.subscription_scans_used/);
  });
});

// ── J-N. Normal behaviour preserved ─────────────────────────────────────────

describe("normal subscription behaviour is unchanged", () => {
  /** Requirement J. */
  it("a fresh Monthly purchase still starts at 300", () => {
    const fresh = applySnapshot(emptyUsage(), "flipstart_pro_monthly", P, P_END);
    expect(computeBalances(fresh, NOW).subscriptionScansRemaining).toBe(MONTHLY_SCANS);
  });

  /** Requirement K. A genuine renewal DOES reset — that is the distinction. */
  it("a real renewal resets Monthly to 300", () => {
    const used = sub({ subscription_scans_used: 250 });
    const renewed = applySnapshot(used, "flipstart_pro_monthly",
      "2026-09-01T00:00:00+00:00", "2026-10-01T00:00:00+00:00");
    expect(renewed.subscription_scans_used).toBe(0);
    expect(computeBalances(renewed, NOW).subscriptionScansRemaining).toBe(MONTHLY_SCANS);
  });

  /** Requirement L. */
  it("a fresh Annual purchase still starts at 4000", () => {
    const fresh = applySnapshot(emptyUsage(), "flipstart_pro_annual", P, P_END);
    expect(computeBalances(fresh, NOW).subscriptionScansRemaining).toBe(ANNUAL_SCANS);
  });

  /** Requirement N. A product change is a new period and resets, correctly. */
  it("Monthly to Annual still works", () => {
    const monthly = sub({ subscription_scans_used: 50 });
    const upgraded = applySnapshot(monthly, "flipstart_pro_annual",
      "2026-08-20T00:00:00+00:00", "2027-08-20T00:00:00+00:00");
    expect(derivePlan(upgraded, NOW)).toBe("annual");
    expect(computeBalances(upgraded, NOW).subscriptionScansRemaining).toBe(ANNUAL_SCANS);
  });
});

// ── Id resolution ───────────────────────────────────────────────────────────

describe("RevenueCat id arrays", () => {
  it("keeps only UUID-shaped ids", () => {
    expect(candidateUserIds([A_UID, "$RCAnonymousID:abc123", "not-a-uuid", B_UID]))
      .toEqual([A_UID, B_UID]);
  });

  it("survives malformed payloads", () => {
    for (const bad of [undefined, null, "string", 42, {}, [null, 1, {}]]) {
      expect(candidateUserIds(bad)).toEqual([]);
    }
  });

  it("de-duplicates and normalises case", () => {
    expect(candidateUserIds([A_UID, A_UID.toUpperCase()])).toEqual([A_UID]);
  });

  /** Requirement 4: never paired by index. */
  it("chooses the source by state, not array position", () => {
    const rows: Record<string, AccountUsage> = {
      [C_UID]: emptyUsage(),                       // listed FIRST, holds nothing
      [A_UID]: sub({ subscription_scans_used: 7 }), // listed second, real owner
      [B_UID]: emptyUsage(),
    };
    const r = transferOwnership(rows, [C_UID, A_UID], B_UID);
    expect(r.source).toBe(A_UID);
    expect(rows[B_UID].subscription_scans_used).toBe(7);
    // The SQL selects by subscription IDENTITY, never by array index and never
    // by "latest period_end" — that ordering is what the hardening removed.
    expect(SQL).toMatch(/and subscription_product_id\s+= p_product_id/);
    expect(SQL).toMatch(/and subscription_period_start = p_period_start/);
    expect(SQL).not.toMatch(/order by subscription_period_end desc nulls last/);
  });
});

// ── Orchestration and fail-closed ───────────────────────────────────────────

describe("orchestration", () => {
  /**
   * Transfer BEFORE the final reconcile. Reversed, the snapshot would zero the
   * counter before there was anything to preserve.
   */
  it("moves ownership before applying the final snapshot", () => {
    const rpc = TRANSFER.indexOf('sb.rpc("transfer_subscription_ownership"');
    const confirm = TRANSFER.indexOf("const confirm = await reconcileUser(destination)");
    expect(rpc).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(rpc);
  });

  it("fails closed on every ambiguity, never minting quota", () => {
    for (const outcome of [
      "no_destination", "ambiguous_destination", "destination_not_active", "rpc_failed",
    ]) {
      expect(TRANSFER).toContain(`"${outcome}"`);
    }
    expect(TRANSFER).toMatch(/dest\.present\.length > 1/);
    expect(TRANSFER).toMatch(/if \(dest\.lookupFailed\)/);
    // No path invents an allowance.
    expect(TRANSFER).not.toMatch(/subscription_scans_used\s*=\s*0/);
  });

  it("leaves an unresolved transfer unacknowledged so RevenueCat retries", () => {
    expect(WEBHOOK).toMatch(/if \(t\.retryable\) \{/);
    expect(WEBHOOK).toMatch(/p_ok: false, p_detail: `transfer_\$\{t\.outcome\}`/);
    expect(WEBHOOK).toMatch(/return \{ status: 503, body: \{ ok: false, reason: t\.outcome \} \}/);
  });

  it("locks rows deterministically and is SECURITY DEFINER", () => {
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/order by user_id\s*\n\s*for update/);
    expect(SQL).toMatch(/grant execute on function public\.transfer_subscription_ownership/);
    expect(SQL).toMatch(/revoke all on function public\.transfer_subscription_ownership/);
  });
});