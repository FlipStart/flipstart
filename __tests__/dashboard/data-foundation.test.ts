/**
 * __tests__/dashboard/data-foundation.test.ts
 *
 * The data-foundation corrections, each checked against what production
 * actually showed:
 *
 *   • scans are scan_completed EVENTS, not rows in the `scans` table (which
 *     is the user's saved collection). On the old source, three of four
 *     generate_listings / deep_analysis buyers showed 0 scans before paying —
 *     impossible, since those paywalls need a scan to reach.
 *   • paid journeys read the full timeline; the date range only picks which
 *     conversions are shown.
 *   • lifetime and fixed-window cards never read the date-windowed set.
 *   • the ghost filter keeps any profile with activity.
 *   • offset paging is ordered, and the loader checks itself.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// A fake Supabase client: records every query so ordering can be asserted,
// and serves rows in pages exactly as PostgREST would.
const calls: Array<{ table: string; order: string[]; range: [number, number] }> = [];
let tables: Record<string, any[]> = {};
function fakeClient() {
  return {
    from(table: string) {
      const rec = { table, order: [] as string[], range: [0, 0] as [number, number] };
      const q: any = {
        select: () => q,
        gte: () => q,
        eq: () => q,
        order: (col: string) => { rec.order.push(col); return q; },
        range: (a: number, b: number) => { rec.range = [a, b]; calls.push(rec); return q; },
        then: (res: any) => {
          const rows = tables[table] ?? [];
          return Promise.resolve({ data: rows.slice(rec.range[0], rec.range[1] + 1), error: null }).then(res);
        },
      };
      return q;
    },
  };
}
vi.mock("../../server/supabaseAdmin", () => ({ getSupabaseAdmin: () => fakeClient() }));
vi.mock("@/server/supabaseAdmin", () => ({ getSupabaseAdmin: () => fakeClient() }));

const FM = await import("../../server/founderMetrics");
const M = await import("../../server/founderMetricsV4");
const R = await import("../../server/founderDashboardV4");
const D = await import("../../server/dashboardDates");

const NOW = new Date("2026-10-04T17:00:00Z");   // 12:00 Central, Oct 4
const ev = (user_id: string | null, event_name: string, created_at: string, metadata: any = {}, session_id = "s1") =>
  ({ user_id, anonymous_id: user_id ? null : "anon", session_id, event_name, created_at, metadata });

/** A V4Data built the way loadV4Data builds it: windowed sets derived from full ones. */
function v4(opts: { profiles: any[]; events: any[]; usage?: any[]; saved?: any[]; window?: any }) {
  const window = opts.window ?? M.resolveAnalysisWindow({ preset: "all" }, "all", NOW);
  const inWin = (t: string) => M.inWindow(window, t);
  const allScans = opts.events.filter(e => e.event_name === "scan_completed" && e.user_id)
    .map(e => ({ user_id: e.user_id, created_at: e.created_at }));
  return {
    window, cohort: M.getLaunchCohort("all"), preLaunchProfiles: 0, anonymousExcluded: 0,
    allEvents: opts.events, allScans, allSaved: opts.saved ?? [], anonymousScans: 0,
    eventsLoaded: opts.events.length, eventsInDatabase: opts.events.length,
    base: { profiles: opts.profiles, profileIds: new Set(opts.profiles.map(p => p.id)),
            events: opts.events.filter(e => inWin(e.created_at)), ghostProfiles: 0 },
    scans: allScans.filter(s => inWin(s.created_at)),
    usage: new Map((opts.usage ?? []).map(u => [u.user_id, u])),
    auth: new Map(), profiles: new Map(), now: NOW,
  } as any;
}
const monthly = (uid: string) => ({ user_id: uid, subscription_product_id: "flipstart_pro_monthly",
  subscription_period_end: "2026-12-01T00:00:00Z", subscription_scans_used: 5, free_scans_used: 15, pack_scan_balance: 0 });

// ── The reported bug ────────────────────────────────────────────────────────

describe("scans before pay come from scan_completed", () => {
  /**
   * Shaped on production's malerieeeee row: three scans, a deep_analysis
   * paywall, a purchase at 17:00, and the first SAVED item at 17:02 — so the
   * old saved-items source said 0 scans before paying.
   */
  const events = [
    ev("u", "paywall_opened", "2026-10-04T16:52:00Z", { paywall_source: "onboarding_offer" }),
    ev("u", "scan_completed", "2026-10-04T16:53:00Z"),
    ev("u", "scan_completed", "2026-10-04T16:56:00Z"),
    ev("u", "scan_completed", "2026-10-04T16:58:00Z"),
    ev("u", "paywall_opened", "2026-10-04T16:59:00Z", { paywall_source: "deep_analysis" }),
    ev("u", "paywall_purchase_started", "2026-10-04T16:59:30Z", { paywall_source: "deep_analysis", selected_plan: "annual" }),
    ev("u", "paywall_purchase_completed", "2026-10-04T17:00:00Z", { paywall_source: "deep_analysis", selected_plan: "annual" }),
  ];
  const d = v4({
    profiles: [{ id: "u", created_at: "2026-10-04T16:52:00Z", onboarding_complete: true }],
    events, usage: [monthly("u")],
    saved: [{ user_id: "u", created_at: "2026-10-04T17:02:00Z" }],   // saved AFTER paying
  });

  it("a deep_analysis buyer has the scans that let them reach it", () => {
    const j = M.getPaidJourneys(d).journeys[0];
    expect(j.convertingPaywall).toBe("deep_analysis");
    expect(j.scansBeforePay).toBe(3);
  });

  it("time from first scan to payment is positive, not 'paid first'", () => {
    const j = M.getPaidJourneys(d).journeys[0];
    expect(j.firstScanAt).toBe("2026-10-04T16:53:00Z");
    expect(j.hoursFirstScanToPay).toBeCloseTo(7 / 60, 5);
  });

  it("saved items never count as scans anywhere in V4", () => {
    const src = read("server/founderMetricsV4.ts");
    // The scans table is still loaded — as savedRows / allSaved only.
    expect(src).toMatch(/const \[savedRows, usageRows, authUsers, profileRows\]/);
    expect(src).toMatch(/\.filter\(e => e\.event_name === "scan_completed" && !!e\.user_id\)/);
    expect(src).not.toMatch(/scans\.filter\(sc => !!sc\.user_id && keep\.has\(sc\.user_id\)\)/);
  });
});

describe("loadV4Data takes scans from events, not the saved-items table", () => {
  /**
   * Goes through the REAL loader. The fixture helper above derives scans from
   * events itself, so on its own it would keep passing even if loadV4Data
   * reverted to counting saved items.
   */
  it("scans = scan_completed events; saved rows land in allSaved", async () => {
    tables = {
      scans: [{ user_id: "u", created_at: "2026-10-04T17:02:00Z" }],   // ONE saved item
      account_usage: [], profiles: [],
    };
    const base = {
      profiles: [{ id: "u", created_at: "2026-10-04T16:52:00Z", onboarding_complete: true }],
      profileIds: new Set(["u"]), ghostProfiles: 0, eventsInDatabase: 4,
      events: [
        ev("u", "scan_completed", "2026-10-04T16:53:00Z"),
        ev("u", "scan_completed", "2026-10-04T16:56:00Z"),
        ev("u", "scan_completed", "2026-10-04T16:58:00Z"),
        ev(null, "scan_completed", "2026-10-04T16:59:00Z"),            // anonymous
      ],
    } as any;
    const d = await M.loadV4Data(base, "all", {} as any, M.resolveAnalysisWindow({ preset: "all" }, "all", NOW));
    expect(d.allScans.length).toBe(3);        // the three attributed scans
    expect(d.allSaved.length).toBe(1);        // the one saved item, kept separately
    expect(d.anonymousScans).toBe(1);
    expect(d.eventsLoaded).toBe(4);
    expect(d.eventsInDatabase).toBe(4);
  });
});

// ── Paid journeys: full history, selected by first purchase ─────────────────

describe("paid journeys", () => {
  const events = [
    ev("a", "scan_completed", "2026-09-15T15:00:00Z"),                // before the range
    ev("a", "paywall_opened", "2026-09-16T15:00:00Z", { paywall_source: "generate_listings" }),
    ev("a", "paywall_purchase_completed", "2026-09-25T15:00:00Z", { paywall_source: "generate_listings", selected_plan: "monthly" }),
    ev("b", "paywall_purchase_completed", "2026-09-10T15:00:00Z", { paywall_source: "onboarding_offer", selected_plan: "annual" }),
  ];
  const profiles = [
    { id: "a", created_at: "2026-09-14T15:00:00Z", onboarding_complete: true },
    { id: "b", created_at: "2026-09-10T14:00:00Z", onboarding_complete: true },
  ];
  const RANGE = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-21", to: "2026-09-27" }, "all", NOW);

  it("history before the range start is kept", () => {
    const j = M.getPaidJourneys(v4({ profiles, events, usage: [monthly("a"), monthly("b")], window: RANGE }))
      .journeys.find(x => x.userId === "a")!;
    // Both happened before Sep 21; the old windowed history dropped them.
    expect(j.scansBeforePay).toBe(1);
    expect(j.paywallImpressionsBeforePay).toBe(1);
    expect(j.firstPaywallSource).toBe("generate_listings");
  });

  it("a bounded range lists only users whose FIRST purchase falls inside it", () => {
    const ids = M.getPaidJourneys(v4({ profiles, events, usage: [monthly("a"), monthly("b")], window: RANGE }))
      .journeys.map(x => x.userId);
    // b is a current subscriber, but bought on Sep 10 — not a conversion this week.
    expect(ids).toEqual(["a"]);
  });

  it("an unbounded range lists every payer", () => {
    const ids = M.getPaidJourneys(v4({ profiles, events, usage: [monthly("a"), monthly("b")] }))
      .journeys.map(x => x.userId).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});

// ── Lifetime and fixed-window cards ignore the date range ───────────────────

describe("lifetime and fixed-window cards read the full timeline", () => {
  const PAST = M.resolveAnalysisWindow({ preset: "custom", from: "2026-09-01", to: "2026-09-02" }, "all", NOW);
  /**
   * Signup times DIFFER on purpose. With identical signups, pairing a scan
   * with the wrong user's signup gives the same answer, and a test for the
   * mispairing bug passes on the bug itself — which the first draft of this
   * test did.
   */
  const profiles = [
    { id: "never", created_at: "2026-09-19T15:00:00Z", onboarding_complete: true },
    { id: "fast",  created_at: "2026-09-20T15:00:00Z", onboarding_complete: true },
    { id: "slow",  created_at: "2026-09-20T21:00:00Z", onboarding_complete: true },
  ];
  const events = [
    ev("never", "app_session_started", "2026-10-04T15:00:00Z"),
    ev("fast", "scan_completed", "2026-09-20T17:00:00Z"),      // 2h after fast's signup
    ev("slow", "scan_completed", "2026-09-21T07:00:00Z"),      // 10h after slow's signup
    ev("slow", "scan_completed", "2026-10-04T16:00:00Z"),      // today
  ];

  it("free users' lifetime scans ignore a past date range", () => {
    const f = M.getFreeBehaviour(v4({ profiles, events, window: PAST }));
    // The Sep 1–2 window contains no scans; lifetime still has three.
    expect(f.lifetimeMean).toBeCloseTo(1, 5);        // (0 + 1 + 2) / 3
    expect(f.buckets).toMatchObject({ "0": 1, "1": 1, "2–5": 1 });
  });

  it("time to first scan pairs each scan with ITS OWN user's signup", () => {
    const f = M.getFreeBehaviour(v4({ profiles, events }));
    // Correct pairing: [2h, 10h] → median 6h. The old index bug paired fast's
    // scan with never's signup (26h) and slow's with fast's (16h) → median 21h.
    expect(f.hoursToFirstScanMedian.d).toBe(2);
    expect(f.hoursToFirstScanMedian.value).toBeCloseTo(6, 5);
  });

  it("cohort 'active today / 7d' are measured from now, whatever the range", () => {
    const c = M.getCohorts(v4({ profiles, events, window: PAST }));
    expect(c.free.activeToday.value).toBe(2);     // never + slow, both active Oct 4
    expect(c.free.active7.value).toBe(2);
  });
});

// ── "Today" is the Central calendar day ─────────────────────────────────────

describe("today means the Central calendar day", () => {
  it("activity late last night Central is not 'active today'", () => {
    const profiles = [{ id: "x", created_at: "2026-09-20T15:00:00Z", onboarding_complete: true }];
    // 2026-10-04T04:00Z = 11pm Oct 3 Central: inside a rolling 24h, NOT today.
    const a = M.getAcquisition(v4({ profiles, events: [ev("x", "app_session_started", "2026-10-04T04:00:00Z")] }));
    expect(a.dau.value).toBe(0);
    const b = M.getAcquisition(v4({ profiles, events: [ev("x", "app_session_started", "2026-10-04T06:00:00Z")] }));
    expect(b.dau.value).toBe(1);   // 1am Oct 4 Central
  });

  it("Executive's Scans 7d has a real source", () => {
    const profiles = [{ id: "x", created_at: "2026-09-20T15:00:00Z", onboarding_complete: true }];
    const a = M.getAcquisition(v4({ profiles, events: [
      ev("x", "scan_completed", "2026-10-03T15:00:00Z"), ev("x", "scan_completed", "2026-09-01T15:00:00Z"),
    ] }));
    expect(a.scans7.value).toBe(1);
  });
});

// ── Unit economics ──────────────────────────────────────────────────────────

describe("estimated API spend", () => {
  const v3 = { rates: { NORMAL: 0.01, HUNT: 0.01, LISTING: 0.005, DEEP: 0.02 } };
  const profiles = [{ id: "x", created_at: "2026-09-20T15:00:00Z", onboarding_complete: true }];
  const events = [
    ev("x", "scan_completed", "2026-10-01T15:00:00Z"), ev("x", "scan_completed", "2026-10-02T15:00:00Z"),
    ev("x", "listing_generated", "2026-10-02T16:00:00Z"),
    ev("x", "scan_completed", "2026-09-01T15:00:00Z"),   // outside the range below
  ];
  const RANGE = M.resolveAnalysisWindow({ preset: "custom", from: "2026-10-01", to: "2026-10-04" }, "all", NOW);

  it("is computed in range at V3's rates — no longer always blank", () => {
    const u = M.getUnitEconomics(v4({ profiles, events, window: RANGE }), v3);
    expect(u.estimatedSpend.value).toBeCloseTo(2 * 0.01 + 1 * 0.005, 10);
    expect(u.costPerScan.d).toBe(2);
  });

  it("refuses to estimate without rates rather than guessing", () => {
    expect(M.getUnitEconomics(v4({ profiles, events }), null).estimatedSpend.value).toBeNull();
    expect(M.getUnitEconomics(v4({ profiles, events }), { error: "x" }).estimatedSpend.value).toBeNull();
  });
});

// ── Ghost filter ────────────────────────────────────────────────────────────

describe("the ghost filter keeps anyone with activity", () => {
  const now = Date.parse("2026-10-04T17:00:00Z");
  const old = "2026-09-01T00:00:00Z";
  const profiles = [
    { id: "done",   created_at: old, onboarding_complete: true },
    { id: "active", created_at: old, onboarding_complete: false },   // skipped username, but scanned
    { id: "ghost",  created_at: old, onboarding_complete: false },   // nothing at all
    { id: "fresh",  created_at: "2026-10-04T16:30:00Z", onboarding_complete: false },
  ];
  it("drops only profiles with no username, no activity and past the grace window", () => {
    const kept = FM.filterGhostProfiles(profiles, [ev("active", "scan_completed", "2026-09-02T00:00:00Z")], now).map(p => p.id);
    expect(kept).toEqual(["done", "active", "fresh"]);
  });
});

// ── Loader ──────────────────────────────────────────────────────────────────

describe("the loader", () => {
  it("orders every page of a paged read", async () => {
    calls.length = 0;
    tables = { t: Array.from({ length: 2500 }, (_, i) => ({ id: i })) };
    const rows = await FM.fetchAll("t", "id", { order: ["created_at", "id"] });
    expect(rows.length).toBe(2500);
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c.order).toEqual(["created_at", "id"]);
  });

  it("warns when a multi-page read has no order", async () => {
    tables = { t: Array.from({ length: 1500 }, (_, i) => ({ id: i })) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await FM.fetchAll("t", "id");
    expect(warn.mock.calls.some(c => String(c[0]).includes("without an ORDER BY"))).toBe(true);
    warn.mockRestore();
  });

  it("does not warn on a single-page read, where order cannot matter", async () => {
    tables = { t: Array.from({ length: 300 }, (_, i) => ({ id: i })) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await FM.fetchAll("t", "id");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("orders analytics_events by created_at then id", () => {
    const src = read("server/founderMetrics.ts");
    expect((src.match(/"analytics_events", "[^"]+",\s*\{ order: \["created_at", "id"\] \}/g) ?? []).length).toBe(2);
  });

  it("checks itself against the database count", () => {
    expect(M.loaderIntegrity(27053, 27053)).toMatchObject({ status: "ok", gap: 0 });
    expect(M.loaderIntegrity(27051, 27053)).toMatchObject({ status: "ok", gap: 2 });   // written during load
    expect(M.loaderIntegrity(27040, 27053).status).toBe("skipped");
    expect(M.loaderIntegrity(27060, 27053).status).toBe("duplicated");
    expect(M.loaderIntegrity(27053, undefined).status).toBe("unverified");
  });

  it("the dashboard loads base data once and shares it", () => {
    const idx = read("server/_core/index.ts");
    const route = idx.slice(idx.indexOf('app.get("/api/dev/founder-dashboard-v3"'), idx.indexOf("// JSON variant"));
    expect((route.match(/await loadBaseData\(\)/g) ?? []).length).toBe(1);
    expect(route).toMatch(/getFounderDashboardV3Metrics\(base\)/);
    expect(route).toMatch(/getFounderDashboardV4Metrics\(v3, scope, process\.env, range, base\)/);
  });
});

// ── Rendering ───────────────────────────────────────────────────────────────

describe("rendering", () => {
  it("table timestamps are Central, not raw UTC", () => {
    // 02:37Z on Oct 5 is 21:37 on Oct 4 in Central.
    expect(D.formatCentralDateTime("2026-10-05T02:37:00Z")).toBe("2026-10-04 21:37");
    expect(D.formatCentralDateTime("2026-10-04T05:00:00Z")).toBe("2026-10-04 00:00");
    expect(D.formatCentralDateTime(null)).toBe("");
  });

  it("labels and captions say what they actually measure", () => {
    const src = read("server/founderDashboardV4.ts");
    expect(src).not.toMatch(/same UTC day/);
    expect(src).not.toMatch(/Paywall viewers \(all time\)|Unique viewers \(all time\)/);
    expect(src).toMatch(/"Selections"\)/);
    expect(src).toMatch(/scans are scan_completed events, not saved items/);
    expect(src).not.toMatch(/sc\.scans7 \?\? sc\.last7/);
  });

  it("text answers are the headline, not a dash", () => {
    const html = R.generateFounderDashboardV4({
      configured: true, generatedAt: NOW.toISOString(), cutover: M.getCutover({} as any),
      cohort: M.getLaunchCohort("all"), window: M.resolveAnalysisWindow({ preset: "all" }, "all", NOW),
      paywalls: { rows: [], repeatExposure: {}, mostShown: "onboarding_offer",
        totalViewers: { value: 1, trust: "EXACT" }, viewers7: { value: 1, trust: "EXACT" },
        purchases7: { value: 0, trust: "EXACT" }, legacyDismissed: { value: 0, trust: "EXACT" } },
      acquisition: { error: "s" }, activation: { error: "s" }, paidJourneys: { error: "s" }, monetization: { error: "s" },
      onboardingOffer: { error: "s" }, scanStore: { error: "s" }, cohorts: { error: "s" }, freeBehaviour: { error: "s" },
      retentionV2: { error: "s" }, sessionsV2: { error: "s" }, featureUsage: { error: "s" }, unitEconomics: { error: "s" },
      dataQualityV4: { error: "s" }, scans: { error: "s" }, trust: { error: "s" }, cost: { error: "s" }, hunt: { error: "s" },
      progress: { error: "s" }, achievements: { error: "s" }, brands: { error: "s" }, diamonds: { error: "s" },
      listings: { error: "s" }, sold: { error: "s" },
    }, "S");
    expect(html).toMatch(/<div class="stat-v stat-text">onboarding_offer /);
  });
});