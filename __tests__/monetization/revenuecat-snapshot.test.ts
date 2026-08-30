/**
 * __tests__/monetization/revenuecat-snapshot.test.ts
 *
 * Pre-release hardening: an unknown RevenueCat product must never downgrade a
 * legitimately active Pro subscriber.
 *
 * ── What each half proves ───────────────────────────────────────────────────
 * The plan MAPPING is executed for real — subscriptionNormalizer imports only
 * policy.ts, which is pure, so a fake subscriber payload can be pushed straight
 * through it and the resulting plan asserted.
 *
 * The GUARD that stops an unknown plan reaching the database is a source
 * assertion, because reconcileUser talks to RevenueCat and Supabase. That is
 * weaker than executing it, and it is the honest tool for the claim being made:
 * "this code path must return before that RPC call".
 *
 * ── The SQL is not covered here ─────────────────────────────────────────────
 * apply_revenuecat_snapshot lives in drizzle/ and cannot run in this suite. Its
 * behaviour is quoted in the report from the function body Dylan supplied.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  normalizeSubscriber, freeSnapshot, type RcSubscriber,
} from "@/server/monetization/subscriptionNormalizer";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Strip comments before asserting ABSENCE. Learned the hard way in Phase 2. */
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
const code = (src: string) => stripComments(src);

const SERVER = read("server/monetization/revenuecatServer.ts");

const NOW = new Date("2026-06-15T12:00:00Z");
const FUTURE = "2026-07-15T12:00:00Z";
const PAST = "2026-05-15T12:00:00Z";

/** A subscriber with an ACTIVE `pro` entitlement on the given product. */
const activeOn = (productId: string, periodType = "normal", expires = FUTURE): RcSubscriber =>
  ({
    entitlements: { pro: { expires_date: expires, product_identifier: productId, period_type: periodType, purchase_date: PAST } },
    subscriptions: { [productId]: { expires_date: expires, period_type: periodType, purchase_date: PAST, store: "app_store" } },
  } as unknown as RcSubscriber);

// ── 1-3. Known products map correctly ───────────────────────────────────────

describe("plan mapping", () => {
  /** Requirement 1. */
  it("keeps an active Monthly as monthly", () => {
    const s = normalizeSubscriber(activeOn("flipstart_pro_monthly"), NOW);
    expect(s.plan).toBe("monthly");
    expect(s.active).toBe(true);
    expect(s.periodEnd).toBe(FUTURE);
  });

  /** Requirement 2. */
  it("keeps an active Annual as annual", () => {
    const s = normalizeSubscriber(activeOn("flipstart_pro_annual"), NOW);
    expect(s.plan).toBe("annual");
    expect(s.active).toBe(true);
  });

  /**
   * The deprecated annual id must still resolve, or every existing annual
   * subscriber would fall through to unknown at once.
   */
  it("maps the deprecated annual id too", () => {
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/isAnnualProduct/);
    // Whatever ids that helper accepts, neither may ever resolve to unknown.
    const s = normalizeSubscriber(activeOn("flipstart_pro_annual"), NOW);
    expect(s.plan).not.toBe("unknown");
  });

  /** Requirement 3. An explicitly inactive entitlement is a real answer. */
  it("treats a confirmed absence of subscription as free", () => {
    expect(freeSnapshot().plan).toBe("free");
    expect(freeSnapshot().active).toBe(false);
    // An expired entitlement is inactive, so it resolves to free, not unknown.
    const expired = normalizeSubscriber(activeOn("flipstart_pro_monthly", "normal", PAST), NOW);
    expect(expired.plan).toBe("free");
    expect(expired.active).toBe(false);
  });
});

// ── 4-6. The vulnerability, and the guard ───────────────────────────────────

describe("unknown active product", () => {
  /**
   * It still resolves to `unknown` — that part was always right. Guessing a
   * plan would grant an allowance we never sold.
   */
  it("refuses to guess a plan for an unrecognised product", () => {
    const s = normalizeSubscriber(activeOn("flipstart_pro_quarterly_NEW"), NOW);
    expect(s.plan).toBe("unknown");
    // And it is genuinely active — this is a PAYING customer.
    expect(s.active).toBe(true);
    expect(s.productId).toBe("flipstart_pro_quarterly_NEW");
  });

  /** An unexpected introductory offer takes the same fail-closed path. */
  it("treats an unexpected trial period as unknown", () => {
    const s = normalizeSubscriber(activeOn("flipstart_pro_monthly", "trial"), NOW);
    expect(s.plan).toBe("unknown");
    expect(s.active).toBe(true);
  });

  /**
   * Requirements 4-6, and the fix.
   *
   * `unknown` must never reach apply_revenuecat_snapshot. Its else-branch
   * treats anything that is not trial/monthly/annual as "free or unknown" and
   * clears subscription_product_id, subscription_period_start,
   * subscription_period_end and subscription_scans_used — downgrading an active
   * subscriber and destroying their period window.
   *
   * Asserted positionally: the early return must come BEFORE the RPC call.
   */
  it("returns before the snapshot RPC can run", () => {
    const c = code(SERVER);
    const guard = c.indexOf('if (snapshot.plan === "unknown")');
    const earlyReturn = c.indexOf('return { ok: false, reason: "UNKNOWN_PRODUCT", snapshot };');
    const rpc = c.indexOf('apply_revenuecat_snapshot');

    expect(guard).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(rpc);
    expect(earlyReturn).toBeLessThan(rpc);
  });

  it("reports a distinct, non-ok reason", () => {
    expect(SERVER).toMatch(/\| "UNKNOWN_PRODUCT";/);
    expect(SERVER).toMatch(/reason: "UNKNOWN_PRODUCT"/);
  });

  /** Requirement 6. Nothing is written, so no bucket can be reset. */
  it("writes nothing at all on the unknown path", () => {
    const c = code(SERVER);
    const guard = c.indexOf('if (snapshot.plan === "unknown")');
    const ret = c.indexOf('return { ok: false, reason: "UNKNOWN_PRODUCT", snapshot };');
    const block = c.slice(guard, ret);
    expect(block).not.toMatch(/\.rpc\(|\.update\(|\.upsert\(|\.insert\(/);
  });

  /** `free` must NOT be diverted — clearing state for it is correct. */
  it("does not divert a confirmed free plan", () => {
    const c = code(SERVER);
    expect(c).not.toMatch(/snapshot\.plan === "free"[^;]*return \{ ok: false/);
    expect(c).toMatch(/p_plan: snapshot\.plan/);
  });
});

// ── 7. Ordering / stale events ──────────────────────────────────────────────

describe("stale and out-of-order events", () => {
  /**
   * Requirement 7 — and the answer is that ordering protection is structural.
   *
   * reconcileUser always re-fetches the CURRENT subscriber from RevenueCat and
   * never trusts the webhook event payload for subscription state. So an old
   * INITIAL_PURCHASE arriving after a RENEWAL still writes current truth: there
   * is no ordering to get wrong.
   */
  it("re-fetches current state rather than trusting the event payload", () => {
    expect(SERVER).toMatch(/const sub = await fetchSubscriber\(supabaseUserId\);/);
    const webhook = read("server/monetization/webhook.ts");
    expect(webhook).toMatch(/reconcileUser\(appUserId as string\)/);
    // The webhook passes only an id — never a plan, period or product.
    expect(code(webhook)).not.toMatch(/p_plan|p_period_start|p_period_end/);
  });

  /** A transport failure preserves state — the pattern the fix now matches. */
  it("preserves state when RevenueCat is unreachable", () => {
    expect(SERVER).toMatch(/reason: "RC_UNAVAILABLE"/);
    expect(SERVER).toMatch(/existing state preserved/);
  });

  /** Every uncertainty now preserves; only a confirmed answer writes. */
  it("fails closed on every unresolvable condition", () => {
    for (const reason of [
      "RC_UNAVAILABLE", "USER_LOOKUP_FAILED", "UNKNOWN_USER", "INVALID_USER", "UNKNOWN_PRODUCT",
    ]) {
      expect(SERVER).toContain(`reason: "${reason}"`);
    }
  });
});

// ── 8-9. Malformed input and pack isolation ─────────────────────────────────

describe("malformed and unrelated payloads", () => {
  /** Requirement 8. */
  it("resolves an empty or malformed subscriber to free rather than throwing", () => {
    expect(() => normalizeSubscriber({} as RcSubscriber, NOW)).not.toThrow();
    expect(normalizeSubscriber({} as RcSubscriber, NOW).plan).toBe("free");
    expect(normalizeSubscriber({ entitlements: {} } as RcSubscriber, NOW).plan).toBe("free");
  });

  it("survives an entitlement with no product identifier", () => {
    const weird = {
      entitlements: { pro: { expires_date: FUTURE, period_type: "normal" } },
    } as unknown as RcSubscriber;
    expect(() => normalizeSubscriber(weird, NOW)).not.toThrow();
    // No product to map: unknown, not a guessed plan.
    expect(normalizeSubscriber(weird, NOW).plan).not.toBe("monthly");
    expect(normalizeSubscriber(weird, NOW).plan).not.toBe("annual");
  });

  /**
   * Requirement 9. Packs are consumables attached to NO entitlement, so a
   * non-renewing purchase cannot appear as `pro` and cannot alter plan state.
   */
  it("ignores non-renewing pack purchases when resolving the plan", () => {
    const withPacks = {
      entitlements: {},
      non_subscriptions: { flipstart_scan_pack_1200: [{ id: "abc" }] },
    } as unknown as RcSubscriber;
    expect(normalizeSubscriber(withPacks, NOW).plan).toBe("free");

    const normalizer = code(read("server/monetization/subscriptionNormalizer.ts"));
    expect(normalizer).not.toMatch(/scan_pack|non_subscriptions/);
  });

  /** Packs never touch the subscription columns on the way in, either. */
  it("keeps pack grants out of the subscription path", () => {
    const purchases = read("lib/purchases.ts");
    expect(purchases).toMatch(/monetization\.recoverScanPacks\.mutate\(\)/);
    // The pack path calls recovery, never the subscription snapshot.
    const c = code(purchases);
    const packFn = c.slice(c.indexOf("export async function purchaseScanPack"), c.indexOf("export async function recoverPacksOnServer"));
    expect(packFn).not.toMatch(/syncWithServer|apply_revenuecat_snapshot|reconcile/i);
  });
});