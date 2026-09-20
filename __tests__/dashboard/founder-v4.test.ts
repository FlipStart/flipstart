/**
 * __tests__/dashboard/founder-v4.test.ts
 *
 * Founder Dashboard V4.
 *
 * The metrics layer is a set of pure functions over one in-memory data
 * object, so the important behaviours are EXECUTED against small fixtures:
 * paywall aggregation, attribution, time-to-pay bucketing, cohorts, retention
 * anchoring, and above all the cutover gate — which must return "unavailable"
 * rather than zero until a cutover is configured.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// The metrics module imports founderMetrics (which imports supabaseAdmin) only
// for loaders we never call here. Stub the client so the module loads.
vi.mock("@/server/supabaseAdmin", () => ({ getSupabaseAdmin: () => null }));
vi.mock("../../server/supabaseAdmin", () => ({ getSupabaseAdmin: () => null }));

const M = await import("../../server/founderMetricsV4");
const R = await import("../../server/founderDashboardV4");

// ── Fixture ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-09-15T12:00:00Z");
const t = (daysAgo: number, hour = 10) => new Date(NOW.getTime() - daysAgo * 86_400_000 + (hour - 12) * 3_600_000).toISOString();
const ev = (user_id: string | null, event_name: string, created_at: string, metadata: any = {}, session_id = "s1", snap?: string) =>
  ({ user_id, anonymous_id: user_id ? null : "anon-1", session_id, event_name, created_at, metadata, entitlement_state_snapshot: snap });

function fixture(opts: { cutoverEvents?: boolean; scope?: "post_launch" | "all"; window?: any } = {}) {
  const profiles = [
    { id: "u-pay", created_at: t(10), onboarding_complete: true },      // pays on day 3 via deep_analysis
    { id: "u-free", created_at: t(8), onboarding_complete: true },      // free, 3 scans, saw 2 paywalls
    { id: "u-never", created_at: t(5), onboarding_complete: false },    // never scanned
    { id: "u-annual", created_at: t(20), onboarding_complete: true },   // annual, no purchase event (webhook-only)
  ];
  const events = [
    // u-pay journey
    ev("u-pay", "app_session_started", t(10, 9), {}, "s-a"),
    ev("u-pay", "onboarding_completed", t(10, 9), {}, "s-a"),
    ev("u-pay", "paywall_opened", t(10, 9), { paywall_source: "onboarding_offer" }, "s-a"),
    ev("u-pay", "paywall_dismissed", t(10, 9), { paywall_source: "onboarding_offer", resolved: false }, "s-a"),
    ev("u-pay", "app_session_started", t(7, 9), {}, "s-b"),
    ev("u-pay", "paywall_opened", t(7, 9), { paywall_source: "deep_analysis" }, "s-b"),
    ev("u-pay", "paywall_plan_selected", t(7, 9), { paywall_source: "deep_analysis", selected_plan: "monthly" }, "s-b"),
    ev("u-pay", "paywall_purchase_started", t(7, 9), { paywall_source: "deep_analysis", selected_plan: "monthly" }, "s-b"),
    ev("u-pay", "paywall_purchase_completed", t(7, 9), { paywall_source: "deep_analysis", selected_plan: "monthly" }, "s-b"),
    ev("u-pay", "app_session_started", t(1, 9), {}, "s-c"),
    // u-free journey
    ev("u-free", "app_session_started", t(8, 9), {}, "s-d"),
    ev("u-free", "paywall_opened", t(8, 9), { paywall_source: "onboarding_offer" }, "s-d"),
    ev("u-free", "paywall_opened", t(6, 9), { paywall_source: "generate_listings" }, "s-e"),
    ev("u-free", "paywall_purchase_started", t(6, 9), { paywall_source: "generate_listings", selected_plan: "annual" }, "s-e"),
    ev("u-free", "paywall_purchase_cancelled", t(6, 9), { paywall_source: "generate_listings", selected_plan: "annual" }, "s-e"),
    ev("u-free", "scan_store_opened", t(6, 10), { entry_mode: "browse" }, "s-e"),
    ev("u-free", "scan_pack_purchase_started", t(6, 10), { product_id: "flipstart_scan_pack_40" }, "s-e"),
    ev("u-free", "scan_pack_purchase_cancelled", t(6, 10), { product_id: "flipstart_scan_pack_40" }, "s-e"),
    ev("u-free", "app_session_started", t(7, 9), {}, "s-f"),  // day-1 return for retention
    // anonymous
    ev(null, "app_session_started", t(3, 9), {}, "s-anon"),
    // u-annual: no events at all
  ];
  if (opts.cutoverEvents) {
    events.push(
      ev("u-free", "paywall_opened", t(0, 8), { paywall_source: "deep_analysis", totalUsableScans: 12, freeScansRemaining: 12 }, "s-g", "free"),
      ev("u-free", "paywall_continue_free", t(0, 8), { paywall_source: "deep_analysis" }, "s-g", "free"),
      ev("u-free", "paywall_opened", t(0, 9), { paywall_source: "scan_limit", totalUsableScans: 0 }, "s-h", "free"),
      ev("u-free", "paywall_closed", t(0, 9), { paywall_source: "scan_limit" }, "s-h", "free"),
      ev("u-free", "app_backgrounded", t(0, 9), { active_paywall_source: "scan_limit" }, "s-h", "free"),
      ev("u-free", "scan_store_opened", t(0, 10), { entry_mode: "browse", entry_source: "settings", totalUsableScans: 0 }, "s-i", "free"),
    );
  }
  const scans = [
    { user_id: "u-pay", created_at: t(9) }, { user_id: "u-pay", created_at: t(8) },   // 2 before pay (pay at t(7))
    { user_id: "u-pay", created_at: t(6) },                                          // 1 after
    { user_id: "u-free", created_at: t(7) }, { user_id: "u-free", created_at: t(6) }, { user_id: "u-free", created_at: t(5) },
    { user_id: "u-annual", created_at: t(19) },
  ];
  const usage = new Map<string, any>([
    ["u-pay",    { user_id: "u-pay", subscription_product_id: "flipstart_pro_monthly", subscription_period_end: t(-20), subscription_scans_used: 30, free_scans_used: 15, pack_scan_balance: 0 }],
    ["u-free",   { user_id: "u-free", subscription_product_id: null, subscription_period_end: null, subscription_scans_used: 0, free_scans_used: 3, pack_scan_balance: 0 }],
    ["u-annual", { user_id: "u-annual", subscription_product_id: "flipstart_pro_annual", subscription_period_end: t(-300), subscription_scans_used: 400, free_scans_used: 15, pack_scan_balance: 0 }],
  ]);
  const auth = new Map([
    ["u-pay", { id: "u-pay", email: "payer@example.com", created_at: t(10) }],
    ["u-free", { id: "u-free", email: "free@example.com", created_at: t(8) }],
  ]);
  const prof = new Map([["u-pay", { id: "u-pay", display_name: "Payer <b>", username: "payer", created_at: t(10) }]]);
  /**
   * An unbounded window by default, so existing assertions describe all-time
   * behaviour. Range-specific tests pass their own window explicitly.
   */
  const window = opts.window ?? M.resolveAnalysisWindow({ preset: "all" }, "all", NOW);
  const inWin = (t: string) => window.startMs === null || (Date.parse(t) >= window.startMs && Date.parse(t) < window.endMs!);
  return {
    window, allEvents: events, allScans: scans,
    cohort: M.getLaunchCohort(opts.scope ?? "all"),
    preLaunchProfiles: 0, anonymousExcluded: 0,
    base: { profiles, profileIds: new Set(profiles.map(p => p.id)), events: events.filter(e => inWin(e.created_at)), ghostProfiles: 0 },
    scans: scans.filter(sc => inWin(sc.created_at)), usage, auth, profiles: prof, now: NOW,
  } as any;
}

const NO_CUTOVER = M.getCutover({} as any);
const CUTOVER = M.getCutover({ ANALYTICS_V4_CUTOVER_AT: t(0, 0) } as any);

// ── Cutover gate ───────────────────────────────────────────────────────────

describe("cutover", () => {
  it("is unconfigured with no env, and says so", () => {
    expect(NO_CUTOVER.configured).toBe(false);
    expect(NO_CUTOVER.status).toMatch(/Awaiting Analytics V4 client release/);
  });
  it("rejects an unparseable value rather than guessing", () => {
    const c = M.getCutover({ ANALYTICS_V4_CUTOVER_AT: "soon" } as any);
    expect(c.configured).toBe(false);
    expect(c.status).toMatch(/not a parseable timestamp/);
  });
  it("V4-only metrics are UNAVAILABLE, not zero, without a cutover", () => {
    const pw = M.getPaywalls(fixture({ cutoverEvents: true }), NO_CUTOVER);
    for (const r of pw.rows) {
      expect(r.continueFree.available).toBe(false);
      expect(r.continueFree.value).toBeNull();
      expect(r.closed.available).toBe(false);
    }
    const s = M.getScanStore(fixture({ cutoverEvents: true }), NO_CUTOVER);
    expect(s.v4.available).toBe(false);
    const o = M.getOnboardingOffer(fixture(), NO_CUTOVER);
    expect(o.v4.available).toBe(false);
  });
  it("post-cutover queries use the cutover boundary", () => {
    const pw = M.getPaywalls(fixture({ cutoverEvents: true }), CUTOVER);
    const da = pw.rows.find(r => r.source === "deep_analysis")!;
    expect(da.continueFree.value).toBe(1);
    expect(da.closed.value).toBe(0);
    const sl = pw.rows.find(r => r.source === "scan_limit")!;
    expect(sl.closed.value).toBe(1);
    expect(sl.backgroundedActive.value).toBe(1);
    expect(sl.avgScansRemainingAtImpression.value).toBe(0);
    expect(da.entitlementAtImpression).toEqual({ free: 1, monthly: 0, annual: 0, unknown: 0 });
  });
  it("legacy paywall_dismissed is counted separately and never summed with V4 events", () => {
    const pw = M.getPaywalls(fixture({ cutoverEvents: true }), CUTOVER);
    expect(pw.legacyDismissed.value).toBe(1);
    // The onboarding offer's continue-free post-cutover is 0 even though a
    // legacy dismissed exists for it — the two are never added together.
    expect(pw.rows.find(r => r.source === "onboarding_offer")!.continueFree.value).toBe(0);
  });
});

// ── Paywalls ───────────────────────────────────────────────────────────────

describe("paywall aggregation", () => {
  const pw = M.getPaywalls(fixture(), NO_CUTOVER);
  it("counts impressions and unique viewers separately", () => {
    const ob = pw.rows.find(r => r.source === "onboarding_offer")!;
    expect(ob.impressions).toBe(2); expect(ob.uniqueViewers).toBe(2);
  });
  it("computes per-source purchase funnel and conversion with N", () => {
    const da = pw.rows.find(r => r.source === "deep_analysis")!;
    expect(da.monthlySelected).toBe(1); expect(da.purchaseStarts).toBe(1); expect(da.purchases).toBe(1);
    expect(da.impressionToPurchase).toMatchObject({ n: 1, d: 1, value: 1 });
    const gl = pw.rows.find(r => r.source === "generate_listings")!;
    expect(gl.annualSelected).toBe(0); expect(gl.cancelled).toBe(1); expect(gl.purchases).toBe(0);
    expect(gl.startToCompletion).toMatchObject({ n: 0, d: 1, value: 0 });
  });
  it("sorts by impressions and reports the most shown", () => {
    expect(pw.rows[0].impressions).toBeGreaterThanOrEqual(pw.rows[1].impressions);
    expect(pw.mostShown).toBe("onboarding_offer");
  });
  it("buckets repeat exposure per viewer", () => {
    expect(pw.repeatExposure).toEqual({ "1": 0, "2": 2, "3": 0, "4–5": 0, "6+": 0 });
  });
  it("includes every live paywall source, verified from config", () => {
    const srcs = pw.rows.map(r => r.source).sort();
    expect(srcs).toEqual(["camera_context", "deep_analysis", "generate_listings", "onboarding_offer", "scan_limit", "settings_upgrade", "third_photo"]);
  });
});

// ── Paid journeys ──────────────────────────────────────────────────────────

describe("paid user journeys", () => {
  const pj = M.getPaidJourneys(fixture());
  const payer = pj.journeys.find(j => j.userId === "u-pay")!;
  it("includes every paying user, including one known only from current plan", () => {
    expect(pj.journeys.map(j => j.userId).sort()).toEqual(["u-annual", "u-pay"]);
    expect(pj.withKnownPurchaseTime.value).toBe(1);   // u-annual has no purchase event
  });
  it("counts only scans BEFORE the first purchase", () => {
    expect(payer.scansBeforePay).toBe(2);
  });
  it("attributes the converting paywall directly, and marks disagreement UNKNOWN", () => {
    expect(payer.convertingPaywall).toBe("deep_analysis");
    // Disagreement: started on scan_limit, completed tagged deep_analysis.
    const d2 = fixture();
    d2.base.events.push(
      ev("u-free", "paywall_purchase_started", t(4, 9), { paywall_source: "scan_limit", selected_plan: "monthly" }, "s-z"),
      ev("u-free", "paywall_purchase_completed", t(4, 9), { paywall_source: "deep_analysis", selected_plan: "monthly" }, "s-z"),
    );
    const j2 = M.getPaidJourneys(d2).journeys.find(j => j.userId === "u-free")!;
    expect(j2.convertingPaywall).toBeNull();
    // Two UNKNOWNs: this disagreement, plus u-annual who has no purchase event
    // at all (known only from account_usage). Neither is guessed.
    expect(M.getPaidJourneys(d2).byConvertingPaywall.find(r => r.source === "UNKNOWN")?.purchases).toBe(2);
    expect(payer.firstPaywallSource).toBe("onboarding_offer");
    expect(payer.lastPaywallBeforePay).toBe("deep_analysis");
    const annual = pj.journeys.find(j => j.userId === "u-annual")!;
    expect(annual.convertingPaywall).toBeNull();
  });
  it("computes conversion timings from real timestamps", () => {
    expect(payer.hoursAccountToPay).toBeCloseTo(71, 0);   // t(10,10) → t(7,9)
    expect(payer.paywallImpressionsBeforePay).toBe(2);
    expect(payer.uniquePaywallSourcesBeforePay).toBe(2);
    expect(payer.sessionsBeforePay).toBe(2);
  });
  it("places each purchaser in exactly one time bucket", () => {
    const total = Object.values(pj.timeBuckets).reduce((a, b) => a + b, 0);
    expect(total).toBe(pj.withKnownPurchaseTime.value);
    // The converting paywall and the purchase share session s-b, so "same
    // session" wins — it is the first predicate, and buckets are exclusive.
    expect(pj.timeBuckets["same session"]).toBe(1);
    expect(pj.timeBuckets["1–3 days"]).toBe(0);
  });
  it("buckets scans before payment", () => {
    expect(pj.scanBuckets["1–2"]).toBe(1);
  });
  it("flags small samples", () => { expect(pj.smallSample).toBe(true); });
  it("carries email for the founder-only table", () => { expect(payer.email).toBe("payer@example.com"); });
});

// ── Cohorts / free / retention ─────────────────────────────────────────────

describe("cohorts use CURRENT plan and say so", () => {
  const c = M.getCohorts(fixture());
  it("classifies from account_usage via derivePlan", () => {
    expect(c.free.users.value).toBe(2); expect(c.monthly.users.value).toBe(1); expect(c.annual.users.value).toBe(1);
  });
  it("computes allowance from the current period, never lifetime", () => {
    expect(c.monthly.allowance.limit).toBe(300); expect(c.monthly.allowance.meanUsed).toBe(30);
    expect(c.annual.allowance.limit).toBe(4000); expect(c.annual.allowance.meanPct).toBeCloseTo(0.1);
    expect(c.free.allowance).toBeNull();
  });
  it("does not infer historical entitlement from current plan", () => {
    expect(c.free.classificationNote).toMatch(/^CURRENT plan\./);
    expect(c.free.classificationNote).toMatch(/Historical events are not re-attributed/);
    // And behaviourally: classification reads account_usage (current), so a
    // user whose subscription just ended is Free today regardless of history.
    const d2 = fixture();
    d2.usage.set("u-pay", { ...d2.usage.get("u-pay"), subscription_period_end: t(1) });
    expect(M.getCohorts(d2).free.users.value).toBe(3);
    expect(read("server/founderMetricsV4.ts")).not.toMatch(/currentPlan\([^)]*\)\s*===\s*[^;]*\/\/ at event time/);
  });
});

describe("free user behaviour", () => {
  const f = M.getFreeBehaviour(fixture());
  it("buckets lifetime scans", () => { expect(f.buckets).toEqual({ "0": 1, "1": 0, "2–5": 1, "6–10": 0, "11–14": 0, "15+": 0 }); });
  it("uses the ledger's free_scans_used for exhaustion, not a guess", () => {
    expect(f.exhausted.value).toBe(0); expect(f.exhausted.note).toMatch(/free_scans_used/);
    expect(f.balanceHistoryNote).toMatch(/not stored/);
  });
});

describe("retention is anchored on first activity, in Central", () => {
  const r = M.getRetentionV2(fixture());
  it("uses first analytics event, Central days, and reports sample size", () => {
    expect(r.anchor).toMatch(/first analytics event/);
    // The whole dashboard is on Central now; a UTC anchor here would silently
    // disagree with the date filter.
    expect(r.timezone).toBe("Central Time");
    expect(r.cohortUsers).toBe(2);
  });
  it("counts a day-1 return", () => {
    // u-free first active t(8), returns t(7) => D1 returned. u-pay first t(10), next t(7) => not D1.
    expect(r.d1).toMatchObject({ n: 1, d: 2 });
    expect(r.d1.smallSample).toBe(true);
  });
  it("only counts users old enough for each window", () => { expect(r.d30.d).toBe(0); });
});

describe("activation", () => {
  const a = M.getActivation(fixture());
  it("is a nested lifecycle, not a mixed-event funnel", () => {
    const users = a.lifecycle.map(s => s.users);
    for (let i = 1; i < users.length; i++) expect(users[i]).toBeLessThanOrEqual(users[i - 1]);
    // Onboarding completion is event-based and lives outside the ladder.
    expect(a.lifecycle.map(s => s.stage)).not.toContain("Onboarding completed");
    expect(a.onboardingCompleted.value).toBe(1);
  });
  it("reports never-scanned and activation with N", () => {
    expect(a.neverScanned.value).toBe(1); expect(a.activationRate).toMatchObject({ n: 3, d: 4 });
  });
});

describe("scan store funnel", () => {
  const s = M.getScanStore(fixture(), NO_CUTOVER);
  it("builds visitor → attempt → completed without a StoreKit stage", () => {
    expect(s.funnel.map(f => f.stage)).toEqual(["Store opened (unique)", "Purchase attempted", "Purchase completed"]);
    expect(s.funnel.map(f => f.users)).toEqual([1, 1, 0]);
  });
  it("aggregates per SKU from the live catalogue", () => {
    const p40 = s.skus.find(k => k.sku === "flipstart_scan_pack_40")!;
    expect(p40.attempts).toBe(1); expect(p40.cancels).toBe(1); expect(p40.purchases).toBe(0);
    expect(s.skus.map(k => k.scans)).toEqual([40, 110, 300, 700, 1200]);
  });
  it("does not fabricate revenue", () => { expect(s.revenue.available).toBe(false); });
});

describe("sessions and monetization", () => {
  it("hides duration as LEGACY rather than showing the inflated number", () => {
    const s = M.getSessionsV2(fixture());
    expect(s.durationNote.trust).toBe("LEGACY");
    expect((s as any).avgDuration).toBeUndefined();
  });
  it("never calls an Apple-approved pack purchase a buyer unless the ledger agrees", () => {
    // The client event fires on Apple approval, before the server grant. A
    // sandbox purchase the server refused still emits it. This is exactly the
    // "4 scan pack buyers" that were not real.
    const d = fixture();
    d.base.events.push(
      ev("u-never", "scan_pack_purchase_started", t(2, 9), { product_id: "flipstart_scan_pack_40" }, "s-p"),
      ev("u-never", "scan_pack_purchase_completed", t(2, 9), { product_id: "flipstart_scan_pack_40" }, "s-p"),
    );
    // u-never has no account_usage row → no pack balance → server never granted.
    const mo = M.getMonetization(d, M.getPaywalls(d, NO_CUTOVER), M.getPaidJourneys(d));
    expect(mo.scanPackApproved.value).toBe(1);        // Apple said yes
    expect(mo.scanPackHolders.value).toBe(0);         // ledger says nobody holds scans
    expect(mo.scanPackApproved.note).toMatch(/includes sandbox and server-rejected/);
    // And the paid-journey roster does not list them as a paying user.
    expect(M.getPaidJourneys(d).journeys.map(j => j.userId)).not.toContain("u-never");
  });

  it("does list a pack buyer whose ledger balance confirms the grant", () => {
    const d = fixture();
    d.base.events.push(ev("u-never", "scan_pack_purchase_completed", t(2, 9), { product_id: "flipstart_scan_pack_40" }, "s-p"));
    d.usage.set("u-never", { user_id: "u-never", subscription_product_id: null, subscription_period_end: null, subscription_scans_used: 0, free_scans_used: 0, pack_scan_balance: 40 });
    const j = M.getPaidJourneys(d).journeys.find(j => j.userId === "u-never")!;
    expect(j).toBeDefined();
    expect(j.firstPaidKind).toBe("scan_pack");
    expect(j.packGrantConfirmed).toBe(true);
    expect(M.getMonetization(d, M.getPaywalls(d, NO_CUTOVER), M.getPaidJourneys(d)).scanPackHolders.value).toBe(1);
  });

  it("does not fabricate MRR or revenue", () => {
    const d = fixture();
    const mo = M.getMonetization(d, M.getPaywalls(d, NO_CUTOVER), M.getPaidJourneys(d));
    expect(mo.mrr.available).toBe(false); expect(mo.revenue.available).toBe(false);
    expect(mo.currentMonthly.value).toBe(1); expect(mo.monthlyPurchases.value).toBe(1);
  });
});

// ── Rendering ──────────────────────────────────────────────────────────────

describe("rendering", () => {
  const d = fixture();
  const v3Stub = { configured: true, generatedAt: NOW.toISOString(), scans: { error: "stub" }, trust: { error: "stub" }, cost: { error: "stub" }, hunt: { error: "stub" }, progress: { error: "stub" }, achievements: { error: "stub" }, brands: { error: "stub" }, diamonds: { error: "stub" }, listings: { error: "stub" }, sold: { error: "stub" } };
  const metrics: Record<string, any> = {
    ...v3Stub, cutover: NO_CUTOVER,
    acquisition: M.getAcquisition(d), activation: M.getActivation(d), paywalls: M.getPaywalls(d, NO_CUTOVER),
    paidJourneys: M.getPaidJourneys(d), onboardingOffer: M.getOnboardingOffer(d, NO_CUTOVER), scanStore: M.getScanStore(d, NO_CUTOVER),
    cohorts: M.getCohorts(d), freeBehaviour: M.getFreeBehaviour(d), retentionV2: M.getRetentionV2(d), sessionsV2: M.getSessionsV2(d),
    featureUsage: M.getFeatureUsage(d), unitEconomics: M.getUnitEconomics(d, null), dataQualityV4: M.getDataQualityV4(d, NO_CUTOVER),
  };
  metrics.monetization = M.getMonetization(d, metrics.paywalls, metrics.paidJourneys);
  const html = R.generateFounderDashboardV4(metrics);

  it("renders all 23 sections in business-first order", () => {
    const ids = ["exec", "acq", "act", "mon", "pw", "offer", "paid", "store", "cohorts", "free", "ret", "sess", "feat", "cost", "dq"];
    let last = -1;
    for (const id of ids) { const i = html.indexOf(`<section id="${id}"`); expect(i, id).toBeGreaterThan(last); last = i; }
  });
  it("shows 'Not yet available' for V4 metrics, never 0%", () => {
    expect(html).toMatch(/Awaiting Analytics V4 client release/);
    expect(html).toMatch(/Not yet available/);
    const paywallSection = html.slice(html.indexOf('<section id="pw"'), html.indexOf('<section id="offer"'));
    expect(paywallSection).toMatch(/Post-cutover outcomes[\s\S]*?Awaiting Analytics V4/);
  });
  it("exposes N on every rate and flags small samples", () => {
    expect(html).toMatch(/1 \/ 1/); expect(html).toMatch(/n&lt;20/);
  });
  it("escapes HTML in purchaser data", () => {
    expect(html).toContain("Payer &lt;b&gt;");
    expect(html).not.toContain("Payer <b>");
  });
  it("renders purchaser email only inside the founder page HTML, with no client JS fetching data", () => {
    expect(html).toContain("payer@example.com");
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/fetch\(/);
  });
  it("labels acquisition attribution as not tracked", () => { expect(html).toMatch(/Acquisition source attribution not currently tracked/); });
  it("carries the trust legend and badges", () => { expect(html).toMatch(/class="tb tb-exact"/); expect(html).toMatch(/class="legend"/); });
  it("shows legacy session duration warning, not a number", () => { expect(html).toMatch(/Session duration is hidden/); });
});

describe("internal flag reaches every aggregate, not just the roster", () => {
  it("drops an internal user's events, scans and usage, not only their profile row", async () => {
    // loadV4Data is where the filter is applied. Drive it with a base whose
    // profileIds already exclude u-pay (as loadBaseData would after the flag),
    // and stubbed table loads that still contain u-pay's rows.
    const base = fixture().base;
    base.profiles = base.profiles.filter((p: any) => p.id !== "u-pay");
    base.profileIds = new Set(base.profiles.map((p: any) => p.id));
    const fm = await import("../../server/founderMetrics");
    const spy = vi.spyOn(fm, "fetchAll").mockImplementation(async (table: string) => {
      if (table === "scans") return fixture().scans as any;
      if (table === "account_usage") return [...fixture().usage.values()] as any;
      return [] as any;
    });
    // Scope "all" isolates the behaviour under test: this is about the
    // is_internal flag, not the launch cohort, and the fixture's profiles
    // predate the global launch date.
    const d = await M.loadV4Data(base, "all", {} as any, M.resolveAnalysisWindow({ preset: "all" }, "all", NOW));
    spy.mockRestore();
    expect(d.base.events.some(e => e.user_id === "u-pay")).toBe(false);
    expect(d.scans.some(sc => sc.user_id === "u-pay")).toBe(false);
    expect(d.usage.has("u-pay")).toBe(false);
    // Anonymous events are kept: they cannot be attributed to anyone.
    expect(d.base.events.some(e => e.user_id === null)).toBe(true);
    // And the aggregates no longer see the excluded user's purchase.
    expect(M.getPaywalls(d, NO_CUTOVER).rows.find(r => r.source === "deep_analysis")!.purchases).toBe(0);
  });
});

describe("route and PII surface", () => {
  it("keeps the same URL and auth, serving V4", () => {
    const idx = read("server/_core/index.ts");
    expect(idx).toMatch(/app\.get\("\/api\/dev\/founder-dashboard-v3"/);
    expect(idx).not.toMatch(/founder-dashboard-v4"/);
    expect(idx).toMatch(/secretOk\(req\.query\.secret, process\.env\.FOUNDER_DASHBOARD_SECRET\)/);
    // The secret rides along so the scope tabs keep the session.
    expect(idx).toMatch(/generateFounderDashboardV4\(metrics, String\(req\.query\.secret/);
    expect(idx).toMatch(/const scope = parseScope\(req\.query\.scope\);/);
    expect(idx).toMatch(/getFounderDashboardV4Metrics\(v3, scope, process\.env, range\)/);
    // Range params come from the query string, alongside scope.
    expect(idx).toMatch(/const range = \{ preset: req\.query\.preset, from: req\.query\.from, to: req\.query\.to \};/);
  });
  it("email is read only through the service-role admin API, server-side", () => {
    const src = read("server/founderMetricsV4.ts");
    expect(src).toMatch(/sb\.auth\.admin\.listUsers/);
    expect(read("lib/analytics.ts")).not.toMatch(/email:/);
  });
  it("nobody is excluded and no id or email is special-cased", () => {
    const src = read("server/founderMetricsV4.ts");
    expect(src).not.toMatch(/@[a-z0-9-]+\.(com|app)/i);
    expect(src).not.toMatch(/is_internal\s*=/);
    expect(src).toMatch(/Nobody is excluded/);
  });
});

// ── Post-global-launch cohort ───────────────────────────────────────────────

/**
 * The cohort is defined by ACCOUNT CREATION, never by activity date. These
 * tests exist because the tempting shortcut — filtering events by their own
 * timestamp — silently folds pre-launch users back in the moment they do
 * anything after launch, which is exactly what this scope must prevent.
 */
describe("global launch cohort", () => {
  const LAUNCH = "2026-09-08T00:00:00Z";

  /** A pre-launch account that is still very active AFTER launch. */
  function mixedFixture() {
    const d = fixture({ scope: "all" });
    d.base.profiles = [
      { id: "u-old", created_at: "2026-07-01T10:00:00Z", onboarding_complete: true },   // pre-launch
      { id: "u-new", created_at: "2026-09-10T10:00:00Z", onboarding_complete: true },   // post-launch
    ];
    d.base.profileIds = new Set(["u-old", "u-new"]);
    d.base.events = [
      // Pre-launch user, all activity AFTER launch — must still be excluded.
      ev("u-old", "app_session_started", "2026-09-12T10:00:00Z", {}, "s-old"),
      ev("u-old", "paywall_opened", "2026-09-12T10:00:00Z", { paywall_source: "deep_analysis" }, "s-old"),
      ev("u-old", "paywall_purchase_started", "2026-09-12T10:01:00Z", { paywall_source: "deep_analysis", selected_plan: "monthly" }, "s-old"),
      ev("u-old", "paywall_purchase_completed", "2026-09-12T10:01:00Z", { paywall_source: "deep_analysis", selected_plan: "monthly" }, "s-old"),
      ev("u-old", "scan_store_opened", "2026-09-12T10:02:00Z", { entry_mode: "browse" }, "s-old"),
      // Post-launch user.
      ev("u-new", "app_session_started", "2026-09-11T10:00:00Z", {}, "s-new"),
      ev("u-new", "paywall_opened", "2026-09-11T10:00:00Z", { paywall_source: "onboarding_offer" }, "s-new"),
      // Anonymous, unattributable.
      ev(null, "app_session_started", "2026-09-11T11:00:00Z", {}, "s-anon"),
    ];
    d.scans = [
      { user_id: "u-old", created_at: "2026-09-12T10:00:00Z" },   // after launch, pre-launch user
      { user_id: "u-old", created_at: "2026-09-13T10:00:00Z" },
      { user_id: "u-new", created_at: "2026-09-11T10:30:00Z" },
    ];
    d.usage = new Map<string, any>([
      ["u-old", { user_id: "u-old", subscription_product_id: "flipstart_pro_monthly", subscription_period_end: "2026-12-01T00:00:00Z", subscription_scans_used: 5, free_scans_used: 15, pack_scan_balance: 0 }],
      ["u-new", { user_id: "u-new", subscription_product_id: null, subscription_period_end: null, subscription_scans_used: 0, free_scans_used: 1, pack_scan_balance: 0 }],
    ]);
    d.auth = new Map([
      ["u-old", { id: "u-old", email: "old@example.com", created_at: "2026-07-01T10:00:00Z" }],
      ["u-new", { id: "u-new", email: "new@example.com", created_at: "2026-09-10T10:00:00Z" }],
    ]);
    return d;
  }

  /** Run loadV4Data over the mixed fixture at a given scope. */
  async function scoped(scope: "post_launch" | "all") {
    const d = mixedFixture();
    const fm = await import("../../server/founderMetrics");
    const spy = vi.spyOn(fm, "fetchAll").mockImplementation(async (table: string) => {
      if (table === "scans") return d.scans as any;
      if (table === "account_usage") return [...d.usage.values()] as any;
      return [] as any;
    });
    // Unbounded window: these tests are about the USER cohort, not the
    // activity window, and the fixture's dates predate the 7-day default.
    const out = await M.loadV4Data(d.base, scope, { FLIPSTART_GLOBAL_LAUNCH_AT: LAUNCH } as any,
      M.resolveAnalysisWindow({ preset: "all" }, scope, NOW));
    spy.mockRestore();
    out.auth = d.auth;
    return out;
  }

  it("1 · defaults to post_launch", () => {
    expect(M.parseScope(undefined)).toBe("post_launch");
    expect(M.parseScope("")).toBe("post_launch");
    expect(M.parseScope("garbage")).toBe("post_launch");
    expect(M.getLaunchCohort().scope).toBe("post_launch");
  });

  it("2 · All Time remains available and applies no boundary", () => {
    expect(M.parseScope("all")).toBe("all");
    const c = M.getLaunchCohort("all");
    expect(c.scope).toBe("all"); expect(c.at).toBeNull();
  });

  it("12 · the launch date is centralized, with one default and one override", () => {
    expect(M.GLOBAL_LAUNCH_AT_DEFAULT).toBe("2026-09-08T00:00:00Z");
    const def = M.getLaunchCohort("post_launch", {} as any);
    expect(def.at).toBe("2026-09-08T00:00:00.000Z");
    expect(def.source).toBe("default");
    expect(def.assumed).toBe(true);                       // time-of-day assumed
    const env = M.getLaunchCohort("post_launch", { FLIPSTART_GLOBAL_LAUNCH_AT: "2026-09-08T17:30:00Z" } as any);
    expect(env.at).toBe("2026-09-08T17:30:00.000Z");
    expect(env.source).toBe("env"); expect(env.assumed).toBe(false);
    // An unparseable override falls back rather than disabling the cohort.
    expect(M.getLaunchCohort("post_launch", { FLIPSTART_GLOBAL_LAUNCH_AT: "launch day" } as any).at)
      .toBe("2026-09-08T00:00:00.000Z");
    // Exactly one hardcoded date in the source.
    const src = read("server/founderMetricsV4.ts");
    expect((src.match(/2026-09-08/g) ?? []).length).toBe(1);
  });

  it("3+4 · excludes a pre-launch user active after launch; includes a post-launch user", async () => {
    const post = await scoped("post_launch");
    expect(post.base.profiles.map((p: any) => p.id)).toEqual(["u-new"]);
    expect(post.preLaunchProfiles).toBe(1);
    const all = await scoped("all");
    expect(all.base.profiles.map((p: any) => p.id).sort()).toEqual(["u-new", "u-old"]);
    expect(all.preLaunchProfiles).toBe(0);
  });

  it("5 · scan counts use the USER cohort, not the scan timestamp", async () => {
    const post = await scoped("post_launch");
    // u-old's two scans both happened AFTER launch and must still be excluded.
    expect(post.scans.map((s: any) => s.user_id)).toEqual(["u-new"]);
    const act = M.getActivation(post);
    expect(act.lifecycle[0].users).toBe(1);
    const all = await scoped("all");
    expect(all.scans.length).toBe(3);
  });

  it("6 · paywall events use the user cohort", async () => {
    const post = await scoped("post_launch");
    const pw = M.getPaywalls(post, NO_CUTOVER);
    expect(pw.rows.find(r => r.source === "deep_analysis")!.impressions).toBe(0);
    expect(pw.rows.find(r => r.source === "onboarding_offer")!.impressions).toBe(1);
    const all = M.getPaywalls(await scoped("all"), NO_CUTOVER);
    expect(all.rows.find(r => r.source === "deep_analysis")!.impressions).toBe(1);
  });

  it("7 · purchases use the user cohort", async () => {
    const post = await scoped("post_launch");
    const mo = M.getMonetization(post, M.getPaywalls(post, NO_CUTOVER), M.getPaidJourneys(post));
    expect(mo.purchaseCompletions.value).toBe(0);
    expect(mo.monthlyPurchases.value).toBe(0);
    const all = await scoped("all");
    const moAll = M.getMonetization(all, M.getPaywalls(all, NO_CUTOVER), M.getPaidJourneys(all));
    expect(moAll.purchaseCompletions.value).toBe(1);
  });

  it("8 · Paid User Journeys use the user cohort", async () => {
    expect(M.getPaidJourneys(await scoped("post_launch")).journeys.map(j => j.userId)).toEqual([]);
    expect(M.getPaidJourneys(await scoped("all")).journeys.map(j => j.userId)).toEqual(["u-old"]);
  });

  it("9 · current plan cohorts use the user cohort", async () => {
    const post = M.getCohorts(await scoped("post_launch"));
    expect(post.monthly.users.value).toBe(0);   // u-old is Monthly but pre-launch
    expect(post.free.users.value).toBe(1);
    const all = M.getCohorts(await scoped("all"));
    expect(all.monthly.users.value).toBe(1);
  });

  it("10 · retention uses post-launch users only", async () => {
    const post = await scoped("post_launch");
    expect(M.getRetentionV2(post).cohortUsers).toBe(1);
    expect(M.getRetentionV2(await scoped("all")).cohortUsers).toBe(2);
  });

  it("11 · anonymous unattributed events do not leak into post-launch metrics", async () => {
    const post = await scoped("post_launch");
    expect(post.base.events.some((e: any) => !e.user_id)).toBe(false);
    expect(post.anonymousExcluded).toBe(1);
    // They remain available in All Time.
    expect((await scoped("all")).base.events.some((e: any) => !e.user_id)).toBe(true);
  });

  it("13 · Scan Pack test contamination is labelled, not silently counted", () => {
    const render = read("server/founderDashboardV4.ts");
    expect(render).toMatch(/Historical Scan Pack purchase events include test activity/);
    // The purchase-derived KPIs are demoted to LEGACY in that section.
    expect(render).toMatch(/m\("Completed", \{ value: s\.outcomes\.completed, trust: "LEGACY"/);
    expect(render).toMatch(/m\("Visitor → buyer", \{ \.\.\.s\.visitorToBuyer, trust: "LEGACY"/);
    const q = M.getDataQualityV4(fixture({ scope: "all" }), NO_CUTOVER);
    expect(q.scope.scanPackWarning).toMatch(/No genuine scan-pack sale has occurred/);
  });

  it("14 · all-time metrics are unchanged by the feature", async () => {
    // Scope "all" must reproduce pre-change behaviour exactly.
    const all = await scoped("all");
    expect(all.cohort.at).toBeNull();
    expect(all.base.events.length).toBe(8);
    expect(all.scans.length).toBe(3);
    expect(all.usage.size).toBe(2);
  });

  it("17 · launch scope and V4 cutover are independent concepts", () => {
    const q = M.getDataQualityV4(fixture({ scope: "all" }), NO_CUTOVER);
    expect(q.scope.note).toMatch(/GLOBAL_LAUNCH_AT defines the acquisition cohort/);
    expect(q.scope.note).toMatch(/ANALYTICS_V4_CUTOVER_AT defines instrumentation trust/);
    // Different env vars, neither reading the other.
    const src = read("server/founderMetricsV4.ts");
    expect(src).toMatch(/env\.FLIPSTART_GLOBAL_LAUNCH_AT/);
    expect(src).toMatch(/env\.ANALYTICS_V4_CUTOVER_AT/);
    expect(src).not.toMatch(/ANALYTICS_V4_CUTOVER_AT[\s\S]{0,80}FLIPSTART_GLOBAL_LAUNCH_AT/);
  });

  it("15 · the dashboard route is unchanged and carries scope", () => {
    const idx = read("server/_core/index.ts");
    expect(idx).toMatch(/app\.get\("\/api\/dev\/founder-dashboard-v3"/);
    expect(idx).not.toMatch(/founder-dashboard-v4"/);
    expect(idx).toMatch(/parseScope\(req\.query\.scope\)/);
  });

  it("renders scope tabs with Post Launch selected by default", () => {
    const d = fixture({ scope: "all" });
    const metrics: Record<string, any> = {
      configured: true, generatedAt: NOW.toISOString(), cutover: NO_CUTOVER,
      cohort: M.getLaunchCohort("post_launch", { FLIPSTART_GLOBAL_LAUNCH_AT: LAUNCH } as any),
      acquisition: M.getAcquisition(d), activation: M.getActivation(d), paywalls: M.getPaywalls(d, NO_CUTOVER),
      paidJourneys: M.getPaidJourneys(d), onboardingOffer: M.getOnboardingOffer(d, NO_CUTOVER), scanStore: M.getScanStore(d, NO_CUTOVER),
      cohorts: M.getCohorts(d), freeBehaviour: M.getFreeBehaviour(d), retentionV2: M.getRetentionV2(d), sessionsV2: M.getSessionsV2(d),
      featureUsage: M.getFeatureUsage(d), unitEconomics: M.getUnitEconomics(d, null), dataQualityV4: M.getDataQualityV4(d, NO_CUTOVER),
      scans: { error: "s" }, trust: { error: "s" }, cost: { error: "s" }, hunt: { error: "s" }, progress: { error: "s" },
      achievements: { error: "s" }, brands: { error: "s" }, diamonds: { error: "s" }, listings: { error: "s" }, sold: { error: "s" },
    };
    metrics.monetization = M.getMonetization(d, metrics.paywalls, metrics.paidJourneys);
    const html = R.generateFounderDashboardV4(metrics, "SEKRET");
    // Post Launch carries the "on" class; All Time does not.
    expect(html).toMatch(/<a class="scope-tab on" href="[^"]*">Post Launch<\/a>/);
    expect(html).toMatch(/<a class="scope-tab" href="[^"]*">All Time<\/a>/);
    expect(html).toMatch(/Scope: Post Global Launch/);
    // The & in the query string is HTML-escaped, as it must be in an href.
    expect(html).toMatch(/&amp;scope=all/);
    // The secret is URL-encoded so an odd character cannot break the link.
    expect(html).toContain("?secret=SEKRET");
    expect(html).toMatch(/Only accounts created on or after this date are counted/);
  });
});