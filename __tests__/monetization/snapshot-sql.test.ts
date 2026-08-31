/**
 * __tests__/monetization/snapshot-sql.test.ts
 *
 * Executes apply_revenuecat_snapshot against a REAL Postgres (PGlite).
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Every other test of this function modelled its semantics in TypeScript. That
 * caught logic errors and missed the one that actually shipped:
 *
 *     column reference "subscription_scans_used" is ambiguous
 *
 * RETURNS TABLE declares OUT parameters that shadow the table's columns, so a
 * bare reference inside the body is ambiguous — and plpgsql resolves it at CALL
 * time, not CREATE time. The function created cleanly, then failed every single
 * sync in production. No amount of modelling could have found that; only
 * running it could.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SQL_PATH = path.resolve(__dirname, "../../drizzle/sql/apply_revenuecat_snapshot_ownership.sql");
const A = "78edf4ee-1111-4111-8111-aaaaaaaaaaaa";
const B = "9747ab3a-2222-4222-8222-bbbbbbbbbbbb";
const P = "2026-08-30T20:00:00Z", PE = "2026-09-30T20:00:00Z";
const P2 = "2026-09-30T20:00:00Z", PE2 = "2026-10-30T20:00:00Z";

let db: any;

beforeAll(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  db = new PGlite();
  await db.exec(`create table public.account_usage (
    user_id uuid primary key, free_scans_used int not null default 0,
    subscription_scans_used int not null default 0, trial_scans_used int not null default 0,
    pack_scan_balance int not null default 0, subscription_product_id text,
    subscription_period_start timestamptz, subscription_period_end timestamptz,
    trial_started_at timestamptz, trial_expires_at timestamptz,
    revenuecat_synced_at timestamptz, revenuecat_environment text,
    revenuecat_period_type text, updated_at timestamptz default now());`);
  // PGlite has no roles and runs statements outside an explicit transaction.
  const sql = readFileSync(SQL_PATH, "utf8")
    .replace(/^(revoke|grant).*$/gm, "").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  await db.exec(sql);
}, 60_000);

const sync = (u: string, plan: string, prod: string | null, ps: string | null, pe: string | null) =>
  db.query(`select * from public.apply_revenuecat_snapshot($1,$2,$3,$4,$5,'normal','sandbox')`,
    [u, plan, prod, ps, pe]);
const row = async (u: string) =>
  (await db.query("select * from public.account_usage where user_id=$1", [u])).rows[0];
const reset = async () => {
  await db.query("delete from public.account_usage");
  await db.query(`insert into public.account_usage (user_id,subscription_product_id,
    subscription_period_start,subscription_period_end,subscription_scans_used,
    free_scans_used,pack_scan_balance) values ($1,'flipstart_pro_monthly',$2,$3,3,4,40)`, [B, P, PE]);
  await db.query(`insert into public.account_usage (user_id,free_scans_used,pack_scan_balance)
    values ($1,9,110)`, [A]);
};

describe("apply_revenuecat_snapshot, executed", () => {
  /** The regression that shipped. It fails at CALL time, so it must be called. */
  it("runs without a column-ambiguity error", async () => {
    await reset();
    const r = await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    expect(r.rows[0].applied_plan).toBe("monthly");
  });

  it("carries the previous owner's usage instead of resetting", async () => {
    await reset();
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    expect((await row(A)).subscription_scans_used).toBe(3);   // not 0
    expect((await row(A)).subscription_product_id).toBe("flipstart_pro_monthly");
  });

  it("clears the previous owner", async () => {
    await reset();
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    const b = await row(B);
    expect(b.subscription_product_id).toBeNull();
    expect(b.subscription_scans_used).toBe(0);
  });

  it("never moves free or pack balances", async () => {
    await reset();
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    expect((await row(A)).free_scans_used).toBe(9);
    expect((await row(A)).pack_scan_balance).toBe(110);
    expect((await row(B)).free_scans_used).toBe(4);
    expect((await row(B)).pack_scan_balance).toBe(40);
  });

  it("is idempotent on a repeated restore", async () => {
    await reset();
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    expect((await row(A)).subscription_scans_used).toBe(3);
  });

  /** The exploit: the count must only ever go down within a period. */
  it("cannot be farmed by bouncing between accounts", async () => {
    await reset();
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    await db.query("update public.account_usage set subscription_scans_used=subscription_scans_used+1 where user_id=$1", [A]);
    for (const u of [B, A, B, A]) await sync(u, "monthly", "flipstart_pro_monthly", P, PE);
    const owner = (await row(A)).subscription_product_id ? await row(A) : await row(B);
    expect(owner.subscription_scans_used).toBe(4);
  });

  it("exactly one account owns the subscription after every operation", async () => {
    await reset();
    for (const u of [A, B, A]) {
      await sync(u, "monthly", "flipstart_pro_monthly", P, PE);
      const owners = [await row(A), await row(B)].filter(r => r.subscription_product_id !== null);
      expect(owners).toHaveLength(1);
    }
  });

  /** A GENUINE new period still resets — that distinction is the point. */
  it("resets on a true renewal", async () => {
    await reset();
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    await sync(A, "monthly", "flipstart_pro_monthly", P2, PE2);
    expect((await row(A)).subscription_scans_used).toBe(0);
  });

  it("clears subscription state on expiry", async () => {
    await reset();
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    await sync(A, "free", null, null, null);
    const a = await row(A);
    expect(a.subscription_product_id).toBeNull();
    expect(a.free_scans_used).toBe(9);      // untouched
    expect(a.pack_scan_balance).toBe(110);  // untouched
  });

  it("a fresh subscriber with no prior owner starts at zero used", async () => {
    await db.query("delete from public.account_usage");
    await sync(A, "monthly", "flipstart_pro_monthly", P, PE);
    expect((await row(A)).subscription_scans_used).toBe(0);
  });
});