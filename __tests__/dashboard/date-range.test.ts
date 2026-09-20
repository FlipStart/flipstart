/**
 * __tests__/dashboard/date-range.test.ts
 *
 * The custom date-range feature.
 *
 * The property that matters most and is easiest to get wrong: SCOPE and RANGE
 * are independent. Scope decides who is eligible; range decides which of their
 * activity is examined. A pre-launch user active during the range must stay
 * excluded, and a post-launch user's activity outside the range must not count.
 *
 * The second: activation and retention invert the range's meaning — it selects
 * who ENTERED during it, then follows them forward. Without that, a three-day
 * window could never show D7.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

vi.mock("@/server/supabaseAdmin", () => ({ getSupabaseAdmin: () => null }));
vi.mock("../../server/supabaseAdmin", () => ({ getSupabaseAdmin: () => null }));

const M = await import("../../server/founderMetricsV4");
const R = await import("../../server/founderDashboardV4");

const NOW = new Date("2026-09-25T15:00:00Z");   // 10:00 Central, Sep 25
const LAUNCH = "2026-09-08T00:00:00Z";
const ENV = { FLIPSTART_GLOBAL_LAUNCH_AT: LAUNCH } as any;

const ev = (user_id: string | null, event_name: string, created_at: string, metadata: any = {}, session_id = "s1") =>
  ({ user_id, anonymous_id: user_id ? null : "anon", session_id, event_name, created_at, metadata });

// ── Window resolution ───────────────────────────────────────────────────────

describe("window resolution", () => {
  it("1 · parses a custom range", () => {
    const w = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-15", to: "2026-09-20" }, "post_launch", NOW, ENV);
    expect(w.preset).toBe("custom");
    expect(w.fromDay).toBe("2026-09-15"); expect(w.toDay).toBe("2026-09-20");
    expect(w.days).toBe(6);
    expect(w.warning).toBeNull();
  });

  it("from/to without preset still means custom", () => {
    const w = M.resolveAnalysisWindow({ from: "2026-09-15", to: "2026-09-16" }, "post_launch", NOW, ENV);
    expect(w.preset).toBe("custom");
  });

  it("2 · a single day covers that entire calendar day", () => {
    const w = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-20", to: "2026-09-20" }, "post_launch", NOW, ENV);
    expect(w.days).toBe(1);
    expect((w.endMs! - w.startMs!) / 3_600_000).toBe(24);
    // 00:00 Central Sep 20 == 05:00Z (CDT).
    expect(new Date(w.startMs!).toISOString()).toBe("2026-09-20T05:00:00.000Z");
  });

  it("3 · the end boundary is exclusive, at the next day's midnight", () => {
    const w = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-20", to: "2026-09-20" }, "post_launch", NOW, ENV);
    expect(new Date(w.endMs!).toISOString()).toBe("2026-09-21T05:00:00.000Z");
    // The final millisecond of the day is IN; the next instant is OUT.
    expect(M.inWindow(w, "2026-09-21T04:59:59.999Z")).toBe(true);
    expect(M.inWindow(w, "2026-09-21T05:00:00.000Z")).toBe(false);
  });

  it("4 · Central boundaries, not UTC — an evening event is the local day", () => {
    const w = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-20", to: "2026-09-20" }, "post_launch", NOW, ENV);
    // 7pm Central Sep 20 is already Sep 21 in UTC; it belongs to Sep 20.
    expect(M.inWindow(w, "2026-09-21T00:00:00Z")).toBe(true);
    // 11pm Central Sep 19 is Sep 20 UTC but must NOT be in the Sep 20 window.
    expect(M.inWindow(w, "2026-09-20T04:00:00Z")).toBe(false);
  });

  it("22 · presets resolve, including Since Global Launch", () => {
    expect(M.resolveAnalysisWindow({ preset: "today" }, "post_launch", NOW, ENV).fromDay).toBe("2026-09-25");
    expect(M.resolveAnalysisWindow({ preset: "yesterday" }, "post_launch", NOW, ENV).fromDay).toBe("2026-09-24");
    expect(M.resolveAnalysisWindow({ preset: "7d" }, "post_launch", NOW, ENV).fromDay).toBe("2026-09-19");
    expect(M.resolveAnalysisWindow({ preset: "30d" }, "post_launch", NOW, ENV).fromDay).toBe("2026-08-27");
    const sl = M.resolveAnalysisWindow({ preset: "since_launch" }, "post_launch", NOW, ENV);
    expect(sl.fromDay).toBe("2026-09-07");   // 2026-09-08T00:00Z is Sep 7 in Central
    expect(sl.toDay).toBe("2026-09-25");
  });

  it("default is the last 7 days", () => {
    const w = M.resolveAnalysisWindow({}, "post_launch", NOW, ENV);
    expect(w.preset).toBe("7d"); expect(w.days).toBe(7);
  });

  it("All Available is unbounded and does not touch user scope", () => {
    const w = M.resolveAnalysisWindow({ preset: "all" }, "post_launch", NOW, ENV);
    expect(w.startMs).toBeNull(); expect(w.endMs).toBeNull();
    expect(M.inWindow(w, "2020-01-01T00:00:00Z")).toBe(true);
    // Scope is a separate control and is untouched by the range.
    expect(M.getLaunchCohort("post_launch", ENV).at).toBe("2026-09-08T00:00:00.000Z");
  });

  it("19 · invalid ranges fail safely and say why — never silently reinterpreted", () => {
    const missing = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-15" }, "post_launch", NOW, ENV);
    expect(missing.preset).toBe("7d");
    expect(missing.warning).toMatch(/needs both a start and an end/);

    const garbage = M.resolveAnalysisWindow({ preset: "custom", from: "yesterday", to: "today" }, "post_launch", NOW, ENV);
    expect(garbage.warning).toBeTruthy();

    const swapped = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-20", to: "2026-09-15" }, "post_launch", NOW, ENV);
    expect(swapped.fromDay).toBe("2026-09-15"); expect(swapped.toDay).toBe("2026-09-20");
    expect(swapped.warning).toMatch(/swapped/);

    const future = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-20", to: "2027-01-01" }, "post_launch", NOW, ENV);
    expect(future.warning).toMatch(/future/);
    expect(future.fromDay).toBe("2026-09-20");   // still usable

    const impossible = M.resolveAnalysisWindow({ preset: "custom", from: "2026-02-31", to: "2026-03-01" }, "post_launch", NOW, ENV);
    expect(impossible.warning).toBeTruthy();
  });

  it("timezone is Central and is reported", () => {
    const w = M.resolveAnalysisWindow({}, "post_launch", NOW, ENV);
    expect(w.timezone).toBe("America/Chicago");
    expect(w.timezoneLabel).toBe("Central Time");
  });
});

// ── Scope × range independence ──────────────────────────────────────────────

describe("scope and range are independent filters", () => {
  const base = {
    profiles: [
      { id: "u-pre",  created_at: "2026-07-01T12:00:00Z", onboarding_complete: true },  // pre-launch
      { id: "u-post", created_at: "2026-09-10T12:00:00Z", onboarding_complete: true },  // post-launch
    ],
    profileIds: new Set(["u-pre", "u-post"]),
    ghostProfiles: 0,
    events: [
      // Pre-launch user, active INSIDE the range.
      ev("u-pre", "paywall_opened", "2026-09-20T15:00:00Z", { paywall_source: "deep_analysis" }),
      ev("u-pre", "paywall_purchase_completed", "2026-09-20T15:01:00Z", { paywall_source: "deep_analysis", selected_plan: "monthly" }),
      // Post-launch user, inside the range.
      ev("u-post", "paywall_opened", "2026-09-20T16:00:00Z", { paywall_source: "onboarding_offer" }),
      // Post-launch user, OUTSIDE the range.
      ev("u-post", "paywall_opened", "2026-09-01T16:00:00Z", { paywall_source: "scan_limit" }),
      ev("u-post", "scan_store_opened", "2026-09-01T16:05:00Z", { entry_mode: "browse" }),
    ],
  } as any;
  const scans = [
    { user_id: "u-pre",  created_at: "2026-09-20T15:00:00Z" },   // in range, wrong cohort
    { user_id: "u-post", created_at: "2026-09-20T17:00:00Z" },   // in range, right cohort
    { user_id: "u-post", created_at: "2026-09-01T17:00:00Z" },   // out of range
  ];
  const usage = [
    { user_id: "u-pre",  subscription_product_id: "flipstart_pro_monthly", subscription_period_end: "2026-12-01T00:00:00Z", subscription_scans_used: 3, free_scans_used: 15, pack_scan_balance: 0 },
    { user_id: "u-post", subscription_product_id: null, subscription_period_end: null, subscription_scans_used: 0, free_scans_used: 2, pack_scan_balance: 0 },
  ];

  async function load(scope: "post_launch" | "all", range: any) {
    const fm = await import("../../server/founderMetrics");
    const spy = vi.spyOn(fm, "fetchAll").mockImplementation(async (table: string) => {
      if (table === "scans") return scans as any;
      if (table === "account_usage") return usage as any;
      return [] as any;
    });
    const w = M.resolveAnalysisWindow(range, scope, NOW, ENV);
    const d = await M.loadV4Data(JSON.parse(JSON.stringify(base)) as any, scope, ENV, w);
    spy.mockRestore();
    return d;
  }
  const SEP20 = { preset: "custom", from: "2026-09-20", to: "2026-09-20" };

  it("5 · scope and range compose without either overriding the other", async () => {
    const d = await load("post_launch", SEP20);
    // Only u-post is eligible; only Sep 20 activity counts.
    expect(d.base.profiles.map((p: any) => p.id)).toEqual(["u-post"]);
    expect(d.base.events.every((e: any) => e.user_id === "u-post")).toBe(true);
    expect(d.base.events.length).toBe(1);
  });

  it("7 · a pre-launch user active during the range stays excluded", async () => {
    const d = await load("post_launch", SEP20);
    expect(d.base.events.some((e: any) => e.user_id === "u-pre")).toBe(false);
    expect(d.scans.some((s: any) => s.user_id === "u-pre")).toBe(false);
    const mo = M.getMonetization(d, M.getPaywalls(d, M.getCutover({} as any)), M.getPaidJourneys(d));
    expect(mo.purchaseCompletions.value).toBe(0);
  });

  it("8+9 · scans in range count, scans outside do not", async () => {
    const d = await load("post_launch", SEP20);
    expect(d.scans.map((s: any) => s.created_at)).toEqual(["2026-09-20T17:00:00Z"]);
    // The unwindowed set still holds both, for sections that need history.
    expect(d.allScans.filter((s: any) => s.user_id === "u-post").length).toBe(2);
  });

  it("10 · paywalls outside the range are excluded", async () => {
    const d = await load("post_launch", SEP20);
    const pw = M.getPaywalls(d, M.getCutover({} as any));
    expect(pw.rows.find(r => r.source === "onboarding_offer")!.impressions).toBe(1);
    expect(pw.rows.find(r => r.source === "scan_limit")!.impressions).toBe(0);
  });

  it("11 · purchases outside the range are excluded", async () => {
    const wide = await load("all", { preset: "all" });
    expect(M.getMonetization(wide, M.getPaywalls(wide, M.getCutover({} as any)), M.getPaidJourneys(wide)).purchaseCompletions.value).toBe(1);
    const narrow = await load("all", { preset: "custom", from: "2026-09-21", to: "2026-09-22" });
    expect(M.getMonetization(narrow, M.getPaywalls(narrow, M.getCutover({} as any)), M.getPaidJourneys(narrow)).purchaseCompletions.value).toBe(0);
  });

  it("12 · new users are selected by created_at inside the range", async () => {
    const d = await load("all", { preset: "custom", from: "2026-09-10", to: "2026-09-10" });
    const a = M.getActivation(d);
    expect(a.lifecycle[0].users).toBe(1);   // only u-post was created that day
  });

  it("13+14 · a purchaser's history reaches back before the range start", async () => {
    // u-pre bought on Sep 20; their account and scans predate it.
    const d = await load("all", SEP20);
    const j = M.getPaidJourneys(d).journeys.find(j => j.userId === "u-pre");
    expect(j).toBeDefined();
    // Account creation is July — well before analysisStart — and is preserved.
    expect(j!.profileCreatedAt).toBe("2026-07-01T12:00:00Z");
    expect(j!.hoursAccountToPay).toBeGreaterThan(24 * 70);
  });

  it("15 · activation follows the acquisition cohort forward past the range end", async () => {
    // Range is the single day u-post signed up; their scans came later.
    const d = await load("all", { preset: "custom", from: "2026-09-10", to: "2026-09-10" });
    const a = M.getActivation(d);
    expect(a.lifecycle[0].users).toBe(1);
    // Two scans, both AFTER Sep 10 — still counted.
    expect(a.lifecycle[1].users).toBe(1);
    expect(a.neverScanned.value).toBe(0);
    expect(a.semantics).toMatch(/counted for all time/);
    expect(a.cohortWindow).toEqual({ from: "2026-09-10", to: "2026-09-10", label: expect.any(String) });
  });

  it("16 · retention follows returns beyond the range end", async () => {
    const d = await load("all", { preset: "custom", from: "2026-09-01", to: "2026-09-01" });
    const r = M.getRetentionV2(d);
    // u-post first appeared Sep 1 (Central) and is the only cohort member.
    expect(r.cohortUsers).toBe(1);
    expect(r.semantics).toMatch(/extends beyond the range end/);
    expect(r.d1.d).toBeGreaterThanOrEqual(1);
  });

  it("16b · a D1 RETURN outside the window is still counted", async () => {
    // The decisive case: cohort entry Sep 1, return Sep 2. The window is Sep 1
    // ONLY, so the return lies outside it. Reading returns from the windowed
    // set would score this user as churned and make D1 unmeasurable for any
    // single-day range.
    const fm = await import("../../server/founderMetrics");
    const b = JSON.parse(JSON.stringify(base));
    b.events = [
      ev("u-post", "app_session_started", "2026-09-01T16:00:00Z"),   // Sep 1 Central
      ev("u-post", "app_session_started", "2026-09-02T16:00:00Z"),   // Sep 2 Central — the return
    ];
    const spy = vi.spyOn(fm, "fetchAll").mockImplementation(async (t: string) =>
      (t === "account_usage" ? usage : []) as any);
    const w = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-01", to: "2026-09-01" }, "all", NOW, ENV);
    const d = await M.loadV4Data(b as any, "all", ENV, w);
    spy.mockRestore();
    // Only the Sep 1 event is inside the window...
    expect(d.base.events.length).toBe(1);
    // ...but the Sep 2 return still counts toward D1.
    const r = M.getRetentionV2(d);
    expect(r.cohortUsers).toBe(1);
    expect(r.d1).toMatchObject({ n: 1, d: 1 });
  });

  it("17 · current plan counts are not historicized by the range", async () => {
    const d = await load("all", SEP20);
    const c = M.getCohorts(d);
    // u-pre is Monthly TODAY; the label says current, not "Monthly on Sep 20".
    expect(c.monthly.users.value).toBe(1);
    expect(c.monthly.classificationNote).toMatch(/^CURRENT plan\./);
  });

  it("21 · zero activity in a valid range reads as 0, not Not Tracked", async () => {
    const d = await load("post_launch", { preset: "custom", from: "2026-09-22", to: "2026-09-23" });
    const pw = M.getPaywalls(d, M.getCutover({} as any));
    const row = pw.rows.find(r => r.source === "deep_analysis")!;
    expect(row.impressions).toBe(0);
    expect(row.purchases).toBe(0);
    // NOT the "unavailable" shape — that is reserved for missing instrumentation.
    expect(pw.totalViewers.value).toBe(0);
    expect(pw.totalViewers.available).toBeUndefined();
  });

  it("18 · V4 cutover still gates instrumentation independently of the range", async () => {
    const d = await load("all", SEP20);
    const noCut = M.getPaywalls(d, M.getCutover({} as any));
    expect(noCut.rows[0].continueFree.available).toBe(false);   // not zero
    const withCut = M.getPaywalls(d, M.getCutover({ ANALYTICS_V4_CUTOVER_AT: "2026-09-01T00:00:00Z" } as any));
    expect(withCut.rows[0].continueFree.available).not.toBe(false);
  });

  it("20 · all-time scope with all-available range is the full dataset", async () => {
    const d = await load("all", { preset: "all" });
    expect(d.base.profiles.length).toBe(2);
    expect(d.base.events.length).toBe(5);
    expect(d.scans.length).toBe(3);
  });
});

// ── Route + UI ──────────────────────────────────────────────────────────────

describe("route and UI", () => {
  it("23+24 · same route, secret and scope preserved alongside range", () => {
    const idx = read("server/_core/index.ts");
    expect(idx).toMatch(/app\.get\("\/api\/dev\/founder-dashboard-v3"/);
    expect(idx).not.toMatch(/founder-dashboard-v4"/);
    expect(idx).toMatch(/secretOk\(req\.query\.secret, process\.env\.FOUNDER_DASHBOARD_SECRET\)/);
    expect(idx).toMatch(/const range = \{ preset: req\.query\.preset, from: req\.query\.from, to: req\.query\.to \};/);
  });

  it("renders presets, a custom form, and the window summary", () => {
    const win = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-15", to: "2026-09-20" }, "post_launch", NOW, ENV);
    const metrics: Record<string, any> = {
      configured: true, generatedAt: NOW.toISOString(),
      cutover: M.getCutover({} as any), cohort: M.getLaunchCohort("post_launch", ENV), window: win,
      scans: { error: "s" }, trust: { error: "s" }, cost: { error: "s" }, hunt: { error: "s" }, progress: { error: "s" },
      achievements: { error: "s" }, brands: { error: "s" }, diamonds: { error: "s" }, listings: { error: "s" }, sold: { error: "s" },
      acquisition: { error: "s" }, activation: { error: "s" }, paywalls: { error: "s" }, paidJourneys: { error: "s" },
      monetization: { error: "s" }, onboardingOffer: { error: "s" }, scanStore: { error: "s" }, cohorts: { error: "s" },
      freeBehaviour: { error: "s" }, retentionV2: { error: "s" }, sessionsV2: { error: "s" }, featureUsage: { error: "s" },
      unitEconomics: { error: "s" }, dataQualityV4: { error: "s" },
    };
    const html = R.generateFounderDashboardV4(metrics, "SEKRET");
    for (const label of ["Today", "Yest.", "7D", "14D", "30D", "Since Launch", "All"]) {
      expect(html, label).toContain(`>${label}</a>`);
    }
    expect(html).toMatch(/<input type="date" name="from" value="2026-09-15"/);
    expect(html).toMatch(/<input type="date" name="to" value="2026-09-20"/);
    expect(html).toMatch(/name="preset" value="custom"/);
    // Secret and scope survive the form submit.
    expect(html).toMatch(/name="secret" value="SEKRET"/);
    expect(html).toMatch(/name="scope" value="post_launch"/);
    // Preset links keep the secret too.
    expect(html).toMatch(/\?secret=SEKRET[^"]*preset=30d/);
  });

  it("27 · the window, scope and timezone are stated at the top", () => {
    const win = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-15", to: "2026-09-20" }, "post_launch", NOW, ENV);
    const metrics: Record<string, any> = {
      configured: true, generatedAt: NOW.toISOString(), cutover: M.getCutover({} as any),
      cohort: M.getLaunchCohort("post_launch", ENV), window: win,
      acquisition: { error: "s" }, monetization: { error: "s" },
      activation: { error: "s" }, paywalls: { error: "s" }, paidJourneys: { error: "s" }, onboardingOffer: { error: "s" },
      scanStore: { error: "s" }, cohorts: { error: "s" }, freeBehaviour: { error: "s" }, retentionV2: { error: "s" },
      sessionsV2: { error: "s" }, featureUsage: { error: "s" }, unitEconomics: { error: "s" }, dataQualityV4: { error: "s" },
      scans: { error: "s" }, trust: { error: "s" }, cost: { error: "s" }, hunt: { error: "s" }, progress: { error: "s" },
      achievements: { error: "s" }, brands: { error: "s" }, diamonds: { error: "s" }, listings: { error: "s" }, sold: { error: "s" },
    };
    const html = R.generateFounderDashboardV4(metrics, "SEKRET");
    expect(html).toMatch(/Analysis Window/);
    expect(html).toMatch(/Sep 15, 2026 – Sep 20, 2026/);
    expect(html).toMatch(/Central Time/);
    expect(html).toMatch(/<strong>Scope<\/strong>/);
    // The dual semantics are explained, not left implicit.
    expect(html).toMatch(/Activation and Retention instead use it to pick who ENTERED/);
  });

  it("a rejected range surfaces its warning on the page", () => {
    const win = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-20", to: "2026-09-15" }, "post_launch", NOW, ENV);
    const metrics: Record<string, any> = {
      configured: true, generatedAt: NOW.toISOString(), cutover: M.getCutover({} as any),
      cohort: M.getLaunchCohort("post_launch", ENV), window: win,
      acquisition: { error: "s" }, monetization: { error: "s" }, activation: { error: "s" }, paywalls: { error: "s" },
      paidJourneys: { error: "s" }, onboardingOffer: { error: "s" }, scanStore: { error: "s" }, cohorts: { error: "s" },
      freeBehaviour: { error: "s" }, retentionV2: { error: "s" }, sessionsV2: { error: "s" }, featureUsage: { error: "s" },
      unitEconomics: { error: "s" }, dataQualityV4: { error: "s" }, scans: { error: "s" }, trust: { error: "s" },
      cost: { error: "s" }, hunt: { error: "s" }, progress: { error: "s" }, achievements: { error: "s" },
      brands: { error: "s" }, diamonds: { error: "s" }, listings: { error: "s" }, sold: { error: "s" },
    };
    expect(R.generateFounderDashboardV4(metrics, "S")).toMatch(/dates were swapped/);
  });

  it("26 · launch, cutover and range stay three separate concepts", () => {
    const src = read("server/founderMetricsV4.ts");
    expect(src).toMatch(/env\.FLIPSTART_GLOBAL_LAUNCH_AT/);
    expect(src).toMatch(/env\.ANALYTICS_V4_CUTOVER_AT/);
    expect(src).toMatch(/export function resolveAnalysisWindow/);
    // Date parsing is centralized, not scattered.
    expect(read("server/dashboardDates.ts")).toMatch(/export const DASHBOARD_TZ = "America\/Chicago"/);
  });
});