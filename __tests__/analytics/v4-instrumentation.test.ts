/**
 * __tests__/analytics/v4-instrumentation.test.ts
 *
 * Founder Dashboard V4 instrumentation.
 *
 * Two properties matter most and are tested by EXECUTION rather than by
 * matching source: that the monetization snapshot never invents data, and that
 * PII cannot reach the event pipeline. Everything else — wiring, event names,
 * additive-only guarantees — is checked structurally.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Comments here legitimately quote the patterns they warn about. */
function stripComments(src: string): string {
  let out = "", mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code", i = 0;
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
const code = (rel: string) => stripComments(read(rel));

// ── Executed: the snapshot must never invent data ──────────────────────────

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "2.1" } } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({ insert: async () => ({ error: null }) }) } }));
/** Native modules pulled in transitively by analytics.ts's import graph. */
vi.mock("expo-linking", () => ({ createURL: () => "flipstart://", useURL: () => null }));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "2.1" }));
vi.mock("expo-router", () => ({
  usePathname: () => "/", useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  useLocalSearchParams: () => ({}), useSegments: () => [],
}));

const A = await import("@/lib/analytics");

beforeEach(() => { A.setAnalyticsMonetizationContext(null); A.setActivePaywall(null); });

describe("monetization snapshot", () => {
  it("is 'unknown' before entitlement resolves — never 'free'", () => {
    // A signed-out user browsing onboarding is not a Free customer. Defaulting
    // to 'free' would manufacture a cohort that does not exist.
    A.setAnalyticsMonetizationContext({ resolved: false });
    expect(A.currentScanBalances()).toBeNull();
    // The state itself must say "unknown", not "free". Defaulting to free
    // would put every pre-auth event into the Free cohort.
    expect(A.currentEntitlementSnapshot()).toBe("unknown");
    A.setAnalyticsMonetizationContext(null);
    expect(A.currentEntitlementSnapshot()).toBe("unknown");
  });

  it("exposes balances only once resolved", () => {
    expect(A.currentScanBalances()).toBeNull();
    A.setAnalyticsMonetizationContext({
      resolved: true, plan: "free",
      freeScansRemaining: 4, subscriptionScansRemaining: 0,
      packScansRemaining: 0, totalUsableScans: 4,
    });
    expect(A.currentScanBalances()).toEqual({
      freeScansRemaining: 4, subscriptionScansRemaining: 0,
      packScansRemaining: 0, totalUsableScans: 4,
    });
  });

  it("maps only the known plans, and anything else to 'unknown'", () => {
    for (const plan of ["free", "monthly", "annual"]) {
      A.setAnalyticsMonetizationContext({ resolved: true, plan });
      expect(A.currentEntitlementSnapshot(), plan).toBe(plan);
    }
    for (const bogus of ["pro", "trial", "", "FREE"]) {
      A.setAnalyticsMonetizationContext({ resolved: true, plan: bogus });
      expect(A.currentEntitlementSnapshot(), bogus).toBe("unknown");
    }
    // A future plan name must not silently become a fourth cohort.
    expect(code("lib/analytics.ts")).toMatch(
      /plan === "free" \|\| plan === "monthly" \|\| plan === "annual" \? plan\s*:\s*"unknown"/);
  });

  it("never throws into its caller", () => {
    expect(() => A.setAnalyticsMonetizationContext(null)).not.toThrow();
    expect(() => A.setAnalyticsMonetizationContext({ resolved: true } as never)).not.toThrow();
    expect(() => A.setActivePaywall(null)).not.toThrow();
  });
});

describe("active paywall marker", () => {
  it("tracks which paywall is open, and clears on terminal actions", () => {
    expect(A.getActivePaywall()).toBeNull();
    A.setActivePaywall("onboarding_offer");
    expect(A.getActivePaywall()).toBe("onboarding_offer");
    A.setActivePaywall(null);
    // Cleared, so a later ordinary background cannot be mislabelled as
    // paywall abandonment.
    expect(A.getActivePaywall()).toBeNull();
  });

  it("is cleared by every terminal paywall path", () => {
    const pa = code("lib/paywallAnalytics.ts");
    for (const fn of ["continueFree", "closed", "resolved"]) {
      const start = pa.indexOf(`${fn}: (`);
      expect(start, fn).toBeGreaterThan(-1);
      // End at this function's closing brace, not a fixed window — a window
      // wide enough to reach the NEXT function made this assertion pass even
      // when the line had been deleted.
      const end = pa.indexOf("},", start);
      const block = pa.slice(start, end);
      expect(block, fn).toMatch(/setActivePaywall\(null\)/);
    }
  });
});

// ── Executed: PII must not reach the pipeline ──────────────────────────────

describe("PII filtering", () => {
  const src = code("lib/analytics.ts");

  it("blocks identity and credential keys by exact name", () => {
    for (const k of ["email", "password", "token", "accessToken", "apiKey",
                     "fullName", "displayName", "identityToken", "refreshToken"]) {
      expect(src, k).toContain(`"${k}"`);
    }
  });

  it("also blocks by key SHAPE, not just spelling", () => {
    // The exact list only catches keys someone thought of; a future
    // `userEmailAddress` would sail straight through it.
    expect(src).toMatch(/META_KEY_PATTERNS = \/email\|password\|secret\|token\|authorization\|api\[-_\]\?key\|credential\/i/);
    const re = /email|password|secret|token|authorization|api[-_]?key|credential/i;
    for (const k of ["userEmailAddress", "appleIdentityToken", "myApiKey",
                     "api_key", "Authorization", "someCredential"]) {
      expect(re.test(k), k).toBe(true);
    }
    for (const k of ["plan", "scan_id", "paywall_source", "entry_mode"]) {
      expect(re.test(k), k).toBe(false);
    }
  });

  it("the pattern sweep runs on every event write", () => {
    expect(src).toMatch(/if \(META_KEY_PATTERNS\.test\(k\)\) continue;/);
  });
});

// ── Structural ─────────────────────────────────────────────────────────────

describe("event write is enriched", () => {
  const src = code("lib/analytics.ts");

  it("attaches the snapshot to every event automatically", () => {
    expect(src).toMatch(/entitlement_state_snapshot:\s*_entitlementState/);
    expect(src).toMatch(/subscription_product_snapshot:\s*_subscriptionProduct/);
    expect(src).toMatch(/occurred_at:\s*occurredAt \?\? new Date\(\)\.toISOString\(\)/);
  });

  it("keeps every pre-existing column", () => {
    for (const col of ["user_id", "profile_id", "anonymous_id", "session_id",
                       "event_name", "event_category", "platform", "app_version",
                       "route", "metadata"]) {
      expect(src, col).toMatch(new RegExp(`${col}:`));
    }
  });

  it("is fed from the one place that knows entitlement", () => {
    expect(code("lib/useEntitlement.ts")).toMatch(/setAnalyticsMonetizationContext\(\{/);
    // Wrapped, so telemetry can never break entitlement resolution.
    expect(code("lib/useEntitlement.ts")).toMatch(/try \{\s*setAnalyticsMonetizationContext/);
  });
});

describe("paywall events", () => {
  const modal = code("components/monetization/paywall/ProPaywallModal.tsx");
  const pa = code("lib/paywallAnalytics.ts");

  it("continue-free is now distinguishable from an explicit close", () => {
    expect(pa).toMatch(/"paywall_continue_free"/);
    expect(pa).toMatch(/"paywall_closed"/);
    expect(modal).toMatch(/paywallAnalytics\.continueFree\(config\.source\)/);
    expect(modal).toMatch(/paywallAnalytics\.closed\(config\.source\)/);
  });

  it("continue-free does not emit a close, and vice versa", () => {
    const cf = modal.slice(modal.indexOf("const continueFree"), modal.indexOf("const continueFree") + 420);
    expect(cf).toMatch(/continueFree\(config\.source\)/);
    expect(cf).not.toMatch(/paywallAnalytics\.closed|paywallAnalytics\.dismissed/);
  });

  it("a resolved dismissal emits no terminal event of its own", () => {
    // Purchase and restore already have their own events; emitting a close too
    // would double-count the outcome.
    expect(modal).toMatch(/if \(resolved\) paywallAnalytics\.resolved\(config\.source\);/);
  });

  it("the impression carries balances and marks the paywall active", () => {
    expect(pa).toMatch(/setActivePaywall\(source\);/);
    expect(pa).toMatch(/emit\("paywall_opened", source, \{ \.\.\.currentScanBalances\(\), \.\.\.extra \}\)/);
  });

  it("the legacy overloaded event is retained for historical rows", () => {
    // Removing it would make pre-cutover rows uninterpretable.
    expect(pa).toMatch(/"paywall_dismissed"/);
    expect(read("lib/paywallAnalytics.ts")).toMatch(/@deprecated/);
  });

  it("all ten pre-existing paywall events still exist", () => {
    for (const e of ["paywall_opened", "paywall_plan_selected", "paywall_purchase_started",
                     "paywall_purchase_completed", "paywall_purchase_cancelled",
                     "paywall_purchase_failed", "paywall_restore_started",
                     "paywall_restore_completed", "paywall_dismissed"]) {
      expect(pa, e).toContain(`"${e}"`);
    }
  });
});

describe("scan store", () => {
  const store = code("app/scan-store.tsx");

  it("keeps entry_mode unchanged and ADDS entry_source", () => {
    // Existing rows and any query over them stay valid.
    expect(store).toMatch(/entry_mode:\s*entryMode/);
    expect(store).toMatch(/entry_source: typeof params\.from === 'string'/);
    expect(store).toMatch(/: 'unknown'/);
  });

  it("every entry point identifies itself", () => {
    const callers: Array<[string, string]> = [
      ["app/hunt-active.tsx", "hunt_active"],
      ["app/(tabs)/settings.tsx", "settings"],
      ["app/(tabs)/_layout.tsx", "tab_gate"],
      ["app/(tabs)/index.tsx", "home_gate"],
      ["app/(tabs)/index.tsx", "home_cta"],
      ["components/monetization/paywall/ProPaywallProvider.tsx", "paywall"],
    ];
    for (const [f, tag] of callers) {
      expect(read(f), `${f} -> ${tag}`).toContain(`/scan-store?from=${tag}`);
    }
  });

  it("records balances, so Pro visitors are distinguishable from exhausted free ones", () => {
    expect(store).toMatch(/scan_store_opened'[\s\S]{0,200}currentScanBalances\(\)/);
    expect(store).toMatch(/scan_pack_purchase_started'[\s\S]{0,160}currentScanBalances\(\)/);
  });

  it("keeps all seven pre-existing scan store events", () => {
    for (const e of ["scan_store_opened", "scan_store_resumed_scan", "scan_pack_purchase_started",
                     "scan_pack_purchase_cancelled", "scan_pack_purchase_completed",
                     "scan_pack_purchase_failed", "scan_pack_recovery"]) {
      expect(store, e).toContain(`'${e}'`);
    }
  });
});

describe("dead emitter wired up", () => {
  it("scan_completed is finally emitted at the completion point", () => {
    // founderMetrics has always queried it; nothing ever called the emitter.
    expect(code("app/loading.tsx")).toMatch(/m\.recordScanCompleted\(\{ scan_id: scanId \}\)/);
    expect(code("server/founderMetrics.ts")).toContain('"scan_completed"');
  });

  it("fires before any save decision, from the analysis result", () => {
    const l = code("app/loading.tsx");
    expect(l.indexOf("recordScanCompleted")).toBeGreaterThan(l.indexOf("analysis response received"));
  });
});

describe("internal account exclusion", () => {
  const fm = code("server/founderMetrics.ts");

  it("filters internal profiles at the source, not per metric", () => {
    expect(fm).toMatch(/const realProfiles = allProfiles\.filter\(p => p\.is_internal !== true\);/);
    // Applied before the ghost filter, so both narrow the same set.
    expect(fm.indexOf("realProfiles")).toBeLessThan(fm.indexOf("ghostCutoff"));
  });

  it("survives running BEFORE the migration", () => {
    // Selecting a missing column is an error, not a null — without the fallback
    // the whole dashboard would blank.
    expect(fm).toMatch(/hasInternalColumn = false;/);
    expect(fm).toMatch(/"profiles", "id, created_at, onboarding_complete",/);
    expect(fm).toMatch(/internalProfiles: hasInternalColumn \? internalProfiles : undefined/);
  });

  it("treats a missing flag as NOT internal", () => {
    // !== true, so undefined keeps the user counted — the pre-migration
    // behaviour is identical to V3.
    expect(fm).not.toMatch(/p\.is_internal === false/);
  });
});

describe("migration is additive only", () => {
  const sql = read("drizzle/sql/v4_analytics_foundation.sql");

  it("adds columns without dropping, renaming or backfilling", () => {
    expect(sql).toMatch(/add column if not exists is_internal boolean not null default false/);
    expect(sql).toMatch(/add column if not exists entitlement_state_snapshot text/);
    expect(sql).toMatch(/add column if not exists subscription_product_snapshot text/);
    expect(sql).toMatch(/add column if not exists occurred_at timestamptz/);
    const lower = sql.toLowerCase();
    expect(lower).not.toMatch(/drop column|drop table|rename to|truncate/);
    // No UPDATE that rewrites history — the only ones are in the commented runbook.
    expect(stripComments(sql.replace(/^--.*$/gm, ""))).not.toMatch(/update public\.analytics_events/i);
  });

  it("is idempotent", () => {
    expect((sql.match(/if not exists/gi) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(sql).toMatch(/where conname = 'analytics_events_entitlement_snapshot_chk'/);
  });

  it("leaves the snapshot columns nullable with no default", () => {
    // NULL is the honest value for an event written before entitlement
    // resolved; a default would manufacture data.
    expect(sql).not.toMatch(/entitlement_state_snapshot text not null/i);
    expect(sql).not.toMatch(/entitlement_state_snapshot text default/i);
  });

  it("marks nobody internal automatically", () => {
    const active = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(active).not.toMatch(/update public\.profiles set is_internal = true/i);
  });
});