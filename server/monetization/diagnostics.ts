/**
 * server/monetization/diagnostics.ts
 *
 * Founder-only verification harness for the RevenueCat integration.
 *
 * ── What this exists for ────────────────────────────────────────────────────
 * Phase 2A shipped 192 passing tests, but every one runs against fixtures. The
 * first contact with the real RevenueCat API is the moment assumptions get
 * tested, and an EAS build costs 45 minutes. This harness verifies everything
 * that does NOT require a device purchase, so the build is spent confirming the
 * purchase flow rather than discovering a wrong env var.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * It never fabricates a plan, never writes a trial or subscription the store did
 * not report, and never grants scans. A diagnostic that can mint entitlement is
 * a backdoor, and one left enabled by accident would be a very expensive one.
 * Everything here is either read-only or applies the REAL fetched state — which
 * is exactly what a normal sync does.
 */
import crypto from "node:crypto";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../supabaseAdmin.js";
import {
  normalizeSubscriber, isNewPeriod, freeSnapshot,
  PRODUCT_MONTHLY, PRODUCT_ANNUAL, type RcSubscriber,
} from "./subscriptionNormalizer.js";
import {
  fetchSubscriber, isRevenueCatConfigured, isFlipStartUserId,
} from "./revenuecatServer.js";
import { verifyWebhookAuth } from "./webhook.js";

/**
 * Dedicated secret, not COMPS_FOUNDER_SECRET.
 *
 * Same reasoning the comps gate gives: a secret that reaches subscription
 * diagnostics should not be the same one that burns a comps quota. Separate
 * blast radius per capability.
 */
export function diagnosticsAuthorised(supplied: string): boolean {
  const expected = (process.env.MONETIZATION_DIAG_SECRET ?? "").trim();
  if (expected.length < 16) return false;   // fail closed
  const a = crypto.createHash("sha256").update((supplied ?? "").trim()).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  /** True when this check cannot be completed without a real device purchase. */
  needsPurchase?: boolean;
}

const ok   = (name: string, detail: string): Check => ({ name, status: "pass", detail });
const bad  = (name: string, detail: string): Check => ({ name, status: "fail", detail });
const warn = (name: string, detail: string): Check => ({ name, status: "warn", detail });
const skip = (name: string, detail: string, needsPurchase = false): Check =>
  ({ name, status: "skip", detail, needsPurchase });

// ── Fixtures ────────────────────────────────────────────────────────────────
// Exercise the normalizer in memory. Nothing here touches the database, so a
// fixture can never become a stored entitlement.
function fixtures(now: Date): Check[] {
  const iso = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
  const mk = (o: {
    product?: string; period?: string; expires?: string | null;
    grace?: string | null; subGrace?: string | null; cancelled?: boolean;
  }): RcSubscriber => ({
    entitlements: { pro: {
      product_identifier: o.product ?? PRODUCT_ANNUAL,
      period_type: o.period ?? "normal",
      expires_date: o.expires === undefined ? iso(300) : o.expires,
      purchase_date: iso(-10),
      grace_period_expires_date: o.grace ?? null,
    }},
    subscriptions: { [o.product ?? PRODUCT_ANNUAL]: {
      expires_date: o.expires === undefined ? iso(300) : o.expires,
      purchase_date: iso(-10),
      grace_period_expires_date: o.subGrace ?? null,
      unsubscribe_detected_at: o.cancelled ? iso(-1) : null,
    }},
  });

  const cases: Array<[string, RcSubscriber | null, string]> = [
    ["no subscriber -> free",            null,                                        "free"],
    ["monthly",                          mk({ product: PRODUCT_MONTHLY }),            "monthly"],
    ["annual",                           mk({ product: PRODUCT_ANNUAL }),             "annual"],
    ["TRIAL outranks annual product",    mk({ period: "trial" }),                     "trial"],
    ["intro is NOT trial",               mk({ period: "intro", product: PRODUCT_MONTHLY }), "monthly"],
    ["expired -> free",                  mk({ expires: iso(-1) }),                    "free"],
    ["cancelled but active -> still Pro",mk({ cancelled: true, expires: iso(200) }),  "annual"],
    ["entitlement grace -> active",      mk({ expires: iso(-2), grace: iso(3) }),     "annual"],
    ["subscription grace -> active",     mk({ expires: iso(-2), subGrace: iso(3) }),  "annual"],
    ["unknown product -> unknown",       mk({ product: "mystery_product" }),          "unknown"],
  ];

  const out = cases.map(([label, sub, expected]) => {
    const got = sub === null ? freeSnapshot().plan : normalizeSubscriber(sub, now).plan;
    return got === expected
      ? ok(`normalizer: ${label}`, `-> ${got}`)
      : bad(`normalizer: ${label}`, `expected ${expected}, got ${got}`);
  });

  // Period rollover: the guard against repeat-sync minting scans.
  const s = normalizeSubscriber(mk({ product: PRODUCT_MONTHLY }), now);
  out.push(
    isNewPeriod(s, s.periodStart) === false
      ? ok("period: repeat sync does NOT reset", "same period_start -> no reset")
      : bad("period: repeat sync does NOT reset", "a repeat sync would mint scans"),
    isNewPeriod(s, iso(-40)) === true
      ? ok("period: new period DOES reset", "changed period_start -> reset")
      : bad("period: new period DOES reset", "a real renewal would not reset usage"),
  );
  return out;
}

export interface DiagnosticsReport {
  ok: boolean;
  ranAt: string;
  environmentHint: string;
  checks: Check[];
  summary: { pass: number; fail: number; warn: number; skip: number };
  cannotVerifyWithoutPurchase: string[];
}

/**
 * Run every check that does not require a purchase.
 *
 * `probeUserId` is optional. When supplied it must be a Supabase uuid, and the
 * ONLY write performed is the same snapshot a normal sync would apply — the real
 * state RevenueCat reports for that user. For an account that has never
 * purchased, that state is Free, so applying it is a no-op.
 */
export async function runDiagnostics(
  probeUserId?: string | null,
  now: Date = new Date(),
): Promise<DiagnosticsReport> {
  const checks: Check[] = [];

  // ── Configuration ─────────────────────────────────────────────────────────
  checks.push(isRevenueCatConfigured()
    ? ok("config: REVENUECAT_API_KEY", "present")
    : bad("config: REVENUECAT_API_KEY", "not set — server cannot query RevenueCat"));

  checks.push(isSupabaseAdminConfigured()
    ? ok("config: Supabase service role", "present")
    : bad("config: Supabase service role", "not set — cannot read or write usage"));

  const webhookSecret = (process.env.REVENUECAT_WEBHOOK_AUTH ?? "").trim();
  checks.push(
    !webhookSecret ? bad("config: REVENUECAT_WEBHOOK_AUTH", "not set — webhook rejects everything")
    : webhookSecret.length < 20 ? warn("config: REVENUECAT_WEBHOOK_AUTH", `only ${webhookSecret.length} chars — use something longer`)
    : ok("config: REVENUECAT_WEBHOOK_AUTH", `set (${webhookSecret.length} chars)`));

  // Webhook auth, proven both ways. The secret itself never appears in output.
  if (webhookSecret) {
    checks.push(verifyWebhookAuth(webhookSecret)
      ? ok("webhook: correct secret accepted", "verifyWebhookAuth -> true")
      : bad("webhook: correct secret accepted", "a valid secret was rejected"));
    checks.push(!verifyWebhookAuth(`${webhookSecret}x`)
      ? ok("webhook: wrong secret rejected", "verifyWebhookAuth -> false")
      : bad("webhook: wrong secret rejected", "SECURITY: a wrong secret was accepted"));
    checks.push(!verifyWebhookAuth("")
      ? ok("webhook: empty secret rejected", "verifyWebhookAuth -> false")
      : bad("webhook: empty secret rejected", "SECURITY: empty was accepted"));
  }

  // ── Identity guard ────────────────────────────────────────────────────────
  const idCases: Array<[string, string | null, boolean]> = [
    ["supabase uuid", "a32b7c1e-1234-4abc-8def-1234567890ab", true],
    ["$RCAnonymousID", "$RCAnonymousID:abc123", false],
    ["email", "someone@example.com", false],
    ["legacy scanner id", "anon_1a2b3c", false],
    ["null", null, false],
  ];
  for (const [label, val, expected] of idCases) {
    checks.push(isFlipStartUserId(val) === expected
      ? ok(`identity: ${label}`, expected ? "accepted" : "rejected")
      : bad(`identity: ${label}`, `expected ${expected ? "accept" : "reject"}`));
  }

  // ── Normalizer + period logic ─────────────────────────────────────────────
  checks.push(...fixtures(now));

  // ── Live RevenueCat reachability ──────────────────────────────────────────
  if (!isRevenueCatConfigured()) {
    checks.push(skip("revenuecat: live fetch", "no API key configured"));
  } else if (!probeUserId) {
    checks.push(skip("revenuecat: live fetch", "no probeUserId supplied"));
  } else if (!isFlipStartUserId(probeUserId)) {
    checks.push(bad("revenuecat: live fetch", "probeUserId is not a Supabase uuid"));
  } else {
    const sub = await fetchSubscriber(probeUserId);
    if (sub === undefined) {
      checks.push(bad("revenuecat: live fetch",
        "sync failure — bad key, network, or unexpected status. Check server logs for 'fetch status='."));
    } else {
      checks.push(ok("revenuecat: live fetch",
        sub === null ? "reachable; no subscriber body (treated as free)" : "reachable; subscriber returned"));

      const snap = sub === null ? freeSnapshot() : normalizeSubscriber(sub, now);
      checks.push(ok("revenuecat: normalized live state",
        `plan=${snap.plan}` +
        `${snap.productId ? ` product=${snap.productId}` : ""}` +
        `${snap.periodType ? ` period=${snap.periodType}` : ""}` +
        `${snap.environment ? ` env=${snap.environment}` : ""}`));

      if (snap.plan === "unknown") {
        checks.push(bad("revenuecat: product recognised",
          `active product "${snap.productId}" is not a known FlipStart product — no allowance granted`));
      }

      // ── Snapshot write ─────────────────────────────────────────────────────
      // Applies the REAL state only. Never a fabricated plan.
      const sb = getSupabaseAdmin();
      if (!sb) {
        checks.push(skip("supabase: snapshot apply", "admin client unavailable"));
      } else {
        const { data, error } = await sb.rpc("apply_revenuecat_snapshot", {
          p_user_id: probeUserId,
          p_plan: snap.plan,
          p_product_id: snap.productId,
          p_period_start: snap.periodStart,
          p_period_end: snap.periodEnd,
          p_period_type: snap.periodType,
          p_environment: snap.environment,
        });
        if (error) {
          checks.push(bad("supabase: snapshot apply", `RPC failed — ${error.message}`));
        } else {
          const row = Array.isArray(data) ? data[0] : data;
          checks.push(ok("supabase: snapshot apply",
            `applied plan=${row?.applied_plan} reset=${row?.period_reset} ` +
            `sub_used=${row?.subscription_scans_used} trial_used=${row?.trial_scans_used} ` +
            `free_used=${row?.free_scans_used} packs=${row?.pack_scan_balance}`));

          // Idempotency: applying the same snapshot twice must not reset again.
          const { data: d2 } = await sb.rpc("apply_revenuecat_snapshot", {
            p_user_id: probeUserId,
            p_plan: snap.plan, p_product_id: snap.productId,
            p_period_start: snap.periodStart, p_period_end: snap.periodEnd,
            p_period_type: snap.periodType, p_environment: snap.environment,
          });
          const row2 = Array.isArray(d2) ? d2[0] : d2;
          checks.push(row2?.period_reset === false
            ? ok("supabase: repeat apply is idempotent", "second apply did not reset usage")
            : warn("supabase: repeat apply is idempotent",
                   "second apply reported a reset — investigate before enabling sync"));
        }
      }
    }
  }

  // ── Honest limits ─────────────────────────────────────────────────────────
  const cannot = [
    "A real trial / monthly / annual snapshot — requires an actual sandbox purchase on a device.",
    "Real webhook delivery from RevenueCat — requires a purchase event to fire.",
    "SDK configure / logIn on device — requires a dev or TestFlight build.",
    "Offering and package loading — requires the SDK, so a build.",
    "The purchase and restore flows themselves.",
  ];
  for (const c of cannot) checks.push(skip("device-only", c, true));

  const summary = {
    pass: checks.filter(c => c.status === "pass").length,
    fail: checks.filter(c => c.status === "fail").length,
    warn: checks.filter(c => c.status === "warn").length,
    skip: checks.filter(c => c.status === "skip").length,
  };

  return {
    ok: summary.fail === 0,
    ranAt: now.toISOString(),
    environmentHint: process.env.NODE_ENV ?? "unknown",
    checks,
    summary,
    cannotVerifyWithoutPurchase: cannot,
  };
}