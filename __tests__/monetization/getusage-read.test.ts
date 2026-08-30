/**
 * __tests__/monetization/getusage-read.test.ts
 *
 * The authoritative usage read, and what happens when it fails.
 *
 * ── The bug these lock down ─────────────────────────────────────────────────
 * `getUsage` used to be `if (error || !data) return emptyUsage()`. That
 * collapsed two opposite answers into one:
 *
 *   no row yet      → a new account genuinely has empty usage      (correct)
 *   the read failed → we do not know anything                      (fabricated)
 *
 * With RLS enabled on account_usage, every WRITE went through a SECURITY
 * DEFINER RPC and succeeded, while this direct table read was filtered and
 * returned zero rows. A paying Monthly subscriber was served
 * `plan=free, 15 scans remaining` — invented by that line — while the logs
 * said `sync result plan=monthly` throughout.
 *
 * ── What is executed vs asserted ────────────────────────────────────────────
 * `readUsage` talks to Supabase, so its two branches are asserted structurally.
 * Everything downstream of it — derivePlan, balances, consumption order — is
 * pure and runs for real against the exact row Supabase reported.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  derivePlan, computeBalances, consumptionOrder, emptyUsage,
  maxPhotoSlots, canUseFeature,
  FREE_LIFETIME_SCANS, MONTHLY_SCANS, ANNUAL_SCANS,
  type AccountUsage,
} from "@/server/monetization/policy";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function stripComments(src: string): string {
  let out = ""; let mode: "code"|"line"|"block"|"sq"|"dq"|"tpl" = "code"; let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "sq"; else if (c === '"') mode = "dq"; else if (c === "`") mode = "tpl";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; } else i++; continue; }
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c; i++;
  }
  return out;
}
const code = (s: string) => stripComments(s);

const LEDGER = read("server/monetization/ledger.ts");
const ENFORCE = read("server/monetization/enforce.ts");
const ROUTERS = read("server/routers.ts");

const NOW = new Date("2026-08-30T12:00:00Z");

/** The EXACT row Supabase reported for the failing TestFlight account. */
const REAL_MONTHLY_ROW: AccountUsage = {
  ...emptyUsage(),
  subscription_product_id: "flipstart_pro_monthly",
  subscription_period_start: "2026-07-31T17:43:28+00:00",
  subscription_period_end: "2026-08-31T17:43:28+00:00",
  subscription_scans_used: 0,
  free_scans_used: 2,
};

// ── 1-7. The real row, read correctly ───────────────────────────────────────

describe("the row that was already correct in Postgres", () => {
  /** Requirements 2-3. */
  it("derives monthly from the persisted product and future period end", () => {
    expect(derivePlan(REAL_MONTHLY_ROW, NOW)).toBe("monthly");
  });

  /** Requirement 4. Free usage is preserved, not reset, by going Pro. */
  it("preserves free_scans_used=2 while Monthly", () => {
    expect(REAL_MONTHLY_ROW.free_scans_used).toBe(2);
    const b = computeBalances(REAL_MONTHLY_ROW, NOW);
    expect(b.freeScansRemaining).toBe(FREE_LIFETIME_SCANS - 2);
  });

  /** Requirement 5. */
  it("reports 300 subscription scans remaining when none are used", () => {
    expect(computeBalances(REAL_MONTHLY_ROW, NOW).subscriptionScansRemaining).toBe(MONTHLY_SCANS);
  });

  /** Requirement 6. */
  it("consumes the subscription bucket 300 -> 299", () => {
    const after: AccountUsage = { ...REAL_MONTHLY_ROW, subscription_scans_used: 1 };
    expect(computeBalances(after, NOW).subscriptionScansRemaining).toBe(MONTHLY_SCANS - 1);
  });

  /** Requirement 7. The free bucket is dormant, never drawn from, while Pro. */
  it("never draws from the free bucket while Monthly", () => {
    expect(consumptionOrder(derivePlan(REAL_MONTHLY_ROW, NOW))).toEqual(["subscription", "pack"]);
    const after: AccountUsage = { ...REAL_MONTHLY_ROW, subscription_scans_used: 1 };
    expect(after.free_scans_used).toBe(2);
  });

  /** Requirement 11. Both readers agree because both use this one row. */
  it("gives the entitlement view and the reserver the same answer", () => {
    const plan = derivePlan(REAL_MONTHLY_ROW, NOW);
    expect(plan).toBe("monthly");
    expect(maxPhotoSlots(plan)).toBe(3);
    expect(canUseFeature(plan, "camera_context")).toBe(true);
    expect(canUseFeature(plan, "deep_analysis")).toBe(true);
  });

  /** Requirement 12. */
  it("is stable across repeated derivations", () => {
    for (let i = 0; i < 5; i++) {
      expect(derivePlan(REAL_MONTHLY_ROW, NOW)).toBe("monthly");
      /**
       * 300, NOT 313. The dormant free bucket is deliberately excluded from
       * usable scans while Pro — my first version of this assertion added it in
       * and was wrong. Excluding it is requirement 7 working.
       */
      expect(computeBalances(REAL_MONTHLY_ROW, NOW).totalUsableScans).toBe(MONTHLY_SCANS);
    }
  });
});

// ── 8-10. No row vs read failure ────────────────────────────────────────────

describe("the two answers that used to be one", () => {
  /** Requirement 8. A genuinely absent row is a real, correct answer. */
  it("treats a missing row as legitimate empty usage", () => {
    expect(LEDGER).toMatch(/if \(!data\) \{/);
    expect(LEDGER).toMatch(/return \{ ok: true, usage: emptyUsage\(\), existed: false \}/);
    expect(LEDGER).toMatch(/\[getUsage\] NO_ROW/);
    // And that answer is correct: a new account IS free with a full allowance.
    expect(derivePlan(emptyUsage(), NOW)).toBe("free");
    expect(computeBalances(emptyUsage(), NOW).freeScansRemaining).toBe(FREE_LIFETIME_SCANS);
  });

  /**
   * Requirement 9, and the whole point of this change.
   *
   * A read error must NOT become a Free account. Asserted on both halves: the
   * error branch returns a failure, and it is a DIFFERENT branch from the
   * no-row one.
   */
  it("never fabricates a Free account on a read error", () => {
    const c = code(LEDGER);
    expect(c).toMatch(/if \(error\) \{/);
    expect(c).toMatch(/return \{ ok: false, reason: "DB_ERROR" \}/);
    expect(c).toMatch(/\[getUsage\] ERROR/);
    // The old conflation must be gone.
    expect(c).not.toMatch(/if \(error \|\| !data\) return emptyUsage\(\)/);
    // The error branch precedes the no-row branch, so an error can never be
    // mistaken for an absent row.
    expect(c.indexOf("if (error) {")).toBeLessThan(c.indexOf("if (!data) {"));
  });

  /** Requirement 10. An unconfigured client is also a failure, not a Free user. */
  it("fails closed when Supabase is unconfigured", () => {
    expect(LEDGER).toMatch(/return \{ ok: false, reason: "NOT_CONFIGURED" \}/);
  });

  /** Diagnostics must never carry row contents or credentials. */
  it("logs only sanitized fields", () => {
    const c = code(LEDGER);
    expect(c).toMatch(/userId\.slice\(0, 8\)/);
    expect(c).not.toMatch(/JSON\.stringify\(data\)|console\.log\(data\)|\$\{data\}/);
  });
});

// ── 3. Every consumer fails closed ──────────────────────────────────────────

describe("consumers fail closed on an unreadable row", () => {
  it("reserveScan refuses rather than granting from a fabricated bucket", () => {
    const c = code(LEDGER);
    expect(c).toMatch(/const read = await readUsage\(userId\);/);
    expect(c).toMatch(/if \(!read\.ok\) \{[\s\S]*?return \{ ok: false, reason: read\.reason \};/);
    // The refusal precedes the RPC, so nothing is reserved.
    expect(c.indexOf("if (!read.ok)")).toBeLessThan(c.indexOf('sb.rpc("reserve_scan"'));
  });

  it("the feature and photo gates refuse rather than deriving Free", () => {
    const c = code(ENFORCE);
    expect((c.match(/if \(!read\.ok\) return \{ allowed: false, reason: "USAGE_UNAVAILABLE" \};/g) ?? []).length).toBe(2);
    expect(c).toMatch(/"USAGE_UNAVAILABLE"/);
    // No gate derives a plan from a fabricated row any more.
    expect(c).not.toMatch(/derivePlan\(await getUsage\(/);
  });

  it("the entitlement route reports unresolved, never a Free model", () => {
    const c = code(ENFORCE);
    expect(c).toMatch(/Promise<EntitlementReadModel \| null>/);
    expect(c).toMatch(/if \(!read\.ok\) return null;/);
    const r = code(ROUTERS);
    expect(r).toMatch(/if \(!entitlement\) return \{ ok: false as const, reason: "USAGE_UNAVAILABLE" as const \};/);
  });

  it("every response that attaches the model handles null", () => {
    const r = code(ROUTERS);
    expect((r.match(/\(await getEntitlementReadModel\(uid\)\) \?\? undefined/g) ?? []).length).toBe(3);
    expect(r).not.toMatch(/entitlement: await getEntitlementReadModel\(uid\),/);
  });

  /**
   * The client already renders a missing model as UNRESOLVED — not Free — so
   * failing closed on the server produces the right UI with no client change.
   */
  it("matches what the client already does with a missing model", () => {
    const ent = read("lib/useEntitlement.ts");
    expect(ent).toMatch(/if \(!ent \|\| stale\) \{/);
    expect(ent).toMatch(/return \{ \.\.\.UNRESOLVED, can: \(\) => false, refresh \};/);
  });
});

// ── 13-14. Untouched behaviour ──────────────────────────────────────────────

describe("nothing else changed", () => {
  /** Requirement 13. */
  it("Annual still derives and allocates correctly", () => {
    const annual: AccountUsage = {
      ...REAL_MONTHLY_ROW, subscription_product_id: "flipstart_pro_annual",
    };
    expect(derivePlan(annual, NOW)).toBe("annual");
    expect(computeBalances(annual, NOW).subscriptionScansRemaining).toBe(ANNUAL_SCANS);
    expect(consumptionOrder("annual")).toEqual(["subscription", "pack"]);
  });

  /** Requirement 14. */
  it("pack logic is unaffected", () => {
    const withPacks: AccountUsage = { ...REAL_MONTHLY_ROW, pack_scan_balance: 40 };
    const b = computeBalances(withPacks, NOW);
    expect(b.packScansRemaining).toBe(40);
    // Subscription + packs. The free bucket stays dormant while Pro.
    expect(b.totalUsableScans).toBe(MONTHLY_SCANS + 40);
    expect(consumptionOrder("free")).toEqual(["free", "pack"]);
  });

  /** derivePlan itself was explicitly out of scope for this fix. */
  it("leaves derivePlan and the reconciliation untouched", () => {
    expect(read("server/monetization/policy.ts")).toMatch(
      /const subActive = Boolean\(\s*\n\s*u\.subscription_product_id && u\.subscription_period_end &&/,
    );
    expect(read("server/monetization/revenuecatServer.ts")).toMatch(/apply_revenuecat_snapshot/);
  });
});