/**
 * server/founderMetrics.ts
 *
 * Founder Dashboard V3 — server-side metrics layer.
 *
 * Every function is Supabase-backed and READ-ONLY. The `profiles` table is the
 * source of truth for real users; analytics_events / scans / discovery tables
 * are joined to that set. (Guest mode has been removed — every user has an
 * account, so all activity attributes to a profile.)
 *
 * Each section function is independently fail-safe: on error it returns
 * `{ error: string }` so the dashboard can render an error card for that one
 * section without breaking the whole page.
 *
 * NO writes. NO deletes. NO service-role key ever leaves the server.
 */

import { getSupabaseAdmin } from "./supabaseAdmin";
import {
  achievements as ACH_LIST,
  brands as BRAND_LIST,
  diamonds as DIAMOND_LIST,
} from "./founderCatalogs";
import type { CatalogAchievement, CatalogBrand, CatalogDiamond } from "./founderCatalogs";

// ─── Types ────────────────────────────────────────────────────────────────────

type Maybe<T> = T | { error: string };

// Catalog interfaces (CatalogAchievement/Brand/Diamond) are imported from
// ./founderCatalogs alongside the data.
const ACH_CATALOG: CatalogAchievement[]  = ACH_LIST;
const BRAND_CATALOG: CatalogBrand[]      = BRAND_LIST;
const DIAMOND_CATALOG: CatalogDiamond[]  = DIAMOND_LIST;

// ─── Time helpers ───────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n: number): Date { return new Date(Date.now() - n * DAY_MS); }
function iso(d: Date): string { return d.toISOString(); }
function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10; // one decimal
}

// ─── Paginated fetch helper ─────────────────────────────────────────────────
// Supabase caps a single select at 1000 rows. For beta scale this paginates
// safely up to a sane ceiling so totals are accurate without unbounded reads.

async function fetchAll<T = any>(
  table: string,
  columns: string,
  opts: { gte?: { col: string; val: string }; maxRows?: number } = {},
): Promise<T[]> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase not configured");
  const pageSize = 1000;
  const maxRows  = opts.maxRows ?? 50000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    let q = sb.from(table).select(columns).range(from, from + pageSize - 1);
    if (opts.gte) q = q.gte(opts.gte.col, opts.gte.val);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return out;
}

// Count-only helper (cheap; uses head request).
async function countRows(
  table: string,
  filter?: { col: string; gte?: string; eq?: string },
): Promise<number> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase not configured");
  let q = sb.from(table).select("*", { count: "exact", head: true });
  if (filter?.gte) q = q.gte(filter.col, filter.gte);
  if (filter?.eq)  q = q.eq(filter.col, filter.eq);
  const { count, error } = await q;
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

// ─── Shared base data ───────────────────────────────────────────────────────
// Loaded once per dashboard request and threaded into section functions to
// avoid refetching profiles/events repeatedly.

export interface BaseData {
  profiles: Array<{ id: string; created_at: string; onboarding_complete?: boolean }>;
  profileIds: Set<string>;
  // analytics events, lightweight projection
  events: Array<{
    user_id: string | null;
    anonymous_id: string | null;
    session_id: string | null;
    event_name: string;
    created_at: string;
    metadata: any;
  }>;
}

export async function loadBaseData(): Promise<BaseData> {
  const profiles = await fetchAll<{ id: string; created_at: string; onboarding_complete?: boolean }>(
    "profiles", "id, created_at, onboarding_complete",
  );
  const profileIds = new Set(profiles.map(p => p.id));
  const events = await fetchAll<BaseData["events"][number]>(
    "analytics_events", "user_id, anonymous_id, session_id, event_name, created_at, metadata",
  );
  return { profiles, profileIds, events };
}

// Filter helpers over the in-memory event set (profiles-only).
function eventsInRange(events: BaseData["events"], sinceISO?: string) {
  if (!sinceISO) return events;
  return events.filter(e => e.created_at >= sinceISO);
}
function profileEvents(events: BaseData["events"], profileIds: Set<string>) {
  return events.filter(e => e.user_id && profileIds.has(e.user_id));
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — CORE USER METRICS
// ═══════════════════════════════════════════════════════════════════════════

export function getUserMetrics(base: BaseData): Maybe<any> {
  try {
    const { profiles, profileIds, events } = base;
    const total = profiles.length;
    const t1 = iso(daysAgo(1)), t7 = iso(daysAgo(7)), t30 = iso(daysAgo(30));
    const todayStart = iso(new Date(new Date().setHours(0, 0, 0, 0)));

    const newToday = profiles.filter(p => p.created_at >= todayStart).length;
    const new7  = profiles.filter(p => p.created_at >= t7).length;
    const new30 = profiles.filter(p => p.created_at >= t30).length;

    const pe = profileEvents(events, profileIds);
    const activeUserSet = (sinceISO: string) =>
      new Set(pe.filter(e => e.created_at >= sinceISO).map(e => e.user_id));

    const activeToday = activeUserSet(todayStart).size;
    const activeWeek  = activeUserSet(t7).size;
    const activeMonth = activeUserSet(t30).size;

    // Returning = profile created before the period AND has an event within it.
    const profileCreatedAt = new Map(profiles.map(p => [p.id, p.created_at]));
    const returningInPeriod = (sinceISO: string) => {
      const ids = new Set<string>();
      for (const e of pe) {
        if (e.created_at < sinceISO) continue;
        const created = profileCreatedAt.get(e.user_id!);
        if (created && created < sinceISO) ids.add(e.user_id!);
      }
      return ids.size;
    };

    return {
      total,
      newToday, new7, new30,
      activeToday, activeWeek, activeMonth,
      returningToday: returningInPeriod(todayStart),
      returningWeek:  returningInPeriod(t7),
    };
  } catch (e: any) { return { error: e?.message ?? "user metrics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — RETENTION
// ═══════════════════════════════════════════════════════════════════════════
// First active day = profile.created_at (safer: every profile has it). Returned
// on day N = has any event in [firstDay + N, firstDay + N + 1). Eligible for DN
// = profile is at least N+1 days old (so the window has elapsed).

export function getRetentionMetrics(base: BaseData): Maybe<any> {
  try {
    const { profiles, profileIds, events } = base;
    const pe = profileEvents(events, profileIds);

    // Map user → sorted event days (ms at midnight UTC for bucketing).
    const byUser = new Map<string, number[]>();
    for (const e of pe) {
      const t = new Date(e.created_at).getTime();
      const arr = byUser.get(e.user_id!) ?? [];
      arr.push(t);
      byUser.set(e.user_id!, arr);
    }

    const computeDN = (n: number) => {
      let eligible = 0, retained = 0;
      const windowOpen = n * DAY_MS, windowClose = (n + 1) * DAY_MS;
      for (const p of profiles) {
        const first = new Date(p.created_at).getTime();
        const ageMs = Date.now() - first;
        if (ageMs < windowClose) continue; // not old enough — window hasn't fully elapsed
        eligible++;
        const evts = byUser.get(p.id);
        if (!evts) continue;
        const hit = evts.some(t => (t - first) >= windowOpen && (t - first) < windowClose);
        if (hit) retained++;
      }
      return { eligible, retained, percentage: eligible ? pct(retained, eligible) : null };
    };

    const d1 = computeDN(1), d7 = computeDN(7), d30 = computeDN(30);
    const fmt = (d: any) => d.eligible === 0
      ? { ...d, label: "Not enough data yet" }
      : d;

    return { d1: fmt(d1), d7: fmt(d7), d30: fmt(d30) };
  } catch (e: any) { return { error: e?.message ?? "retention failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — ACTIVATION FUNNEL (profiles-only)
// ═══════════════════════════════════════════════════════════════════════════

export async function getActivationFunnelMetrics(base: BaseData): Promise<Maybe<any>> {
  try {
    const { profiles, profileIds, events } = base;
    const totalProfiles = profiles.length;
    const pe = profileEvents(events, profileIds);

    // Distinct profile users who fired a given event.
    const usersWithEvent = (name: string) =>
      new Set(pe.filter(e => e.event_name === name).map(e => e.user_id)).size;

    // Source-of-truth tables: distinct profile users with ≥1 row.
    const distinctUsersInTable = async (table: string): Promise<number> => {
      const rows = await fetchAll<{ user_id: string }>(table, "user_id");
      return new Set(rows.filter(r => profileIds.has(r.user_id)).map(r => r.user_id)).size;
    };

    const scansUsers = await distinctUsersInTable("scans");
    const achUsers   = await distinctUsersInTable("user_achievements");
    const brandUsers = await distinctUsersInTable("user_brand_discoveries");
    const diaUsers   = await distinctUsersInTable("user_diamond_discoveries");

    const stages = [
      { key: "profiles_created",      label: "Profiles created",          count: totalProfiles },
      { key: "onboarding_started",    label: "Onboarding started",        count: usersWithEvent("onboarding_started") },
      { key: "onboarding_completed",  label: "Onboarding completed",      count: usersWithEvent("onboarding_completed") },
      { key: "first_scan_started",    label: "First scan started",        count: usersWithEvent("scan_started") },
      { key: "first_scan_completed",  label: "First scan completed",      count: usersWithEvent("scan_completed") },
      { key: "first_scan_saved",      label: "First scan saved (table)",  count: scansUsers },
      { key: "first_hunt_opened",     label: "First Hunt Mode opened",    count: usersWithEvent("hunt_mode_opened") },
      { key: "first_hunt_started",    label: "First Hunt started",        count: usersWithEvent("hunt_started") },
      { key: "first_achievement",     label: "First achievement (table)", count: achUsers },
      { key: "first_brand",           label: "First brand (table)",       count: brandUsers },
      { key: "first_diamond",         label: "First Diamond (table)",     count: diaUsers },
      { key: "first_listing",         label: "First listing generated",   count: usersWithEvent("listing_generated") },
      { key: "first_feedback",        label: "Submitted scan feedback",   count: usersWithEvent("scan_feedback_submitted") },
    ];

    let prev = totalProfiles;
    const withRates = stages.map((s, i) => {
      const pctOfTotal = pct(s.count, totalProfiles);
      const dropFromPrev = i === 0 ? null : (prev ? pct(prev - s.count, prev) : null);
      prev = s.count;
      return { ...s, pctOfTotal, dropFromPrev };
    });

    return { totalProfiles, stages: withRates };
  } catch (e: any) { return { error: e?.message ?? "funnel failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — ACCOUNT FUNNEL
// ═══════════════════════════════════════════════════════════════════════════

export function getAccountFunnelMetrics(base: BaseData): Maybe<any> {
  try {
    const { events } = base;
    const count = (name: string) => events.filter(e => e.event_name === name).length;

    const onboardingStarts = count("onboarding_started");
    const accountCreated   = count("account_created");
    const loginSuccess     = count("login_success");

    return {
      onboardingStarts,
      accountCreated,
      loginSuccess,
      conversionFromOnboarding: onboardingStarts ? pct(accountCreated, onboardingStarts) : null,
    };
  } catch (e: any) { return { error: e?.message ?? "account funnel failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — SESSION / APP OPEN
// ═══════════════════════════════════════════════════════════════════════════

export function getSessionMetrics(base: BaseData): Maybe<any> {
  try {
    const { events, profileIds } = base;
    const t7 = iso(daysAgo(7));
    const todayStart = iso(new Date(new Date().setHours(0, 0, 0, 0)));
    const count = (name: string, sinceISO?: string) =>
      events.filter(e => e.event_name === name && (!sinceISO || e.created_at >= sinceISO)).length;

    const sessionsToday = new Set(
      events.filter(e => e.event_name === "app_session_started" && e.created_at >= todayStart)
            .map(e => e.session_id),
    ).size;
    const sessions7 = new Set(
      events.filter(e => e.event_name === "app_session_started" && e.created_at >= t7)
            .map(e => e.session_id),
    ).size;

    // Average session length: app_session_ended carries durationMs in metadata.
    const ended = events.filter(e => e.event_name === "app_session_ended");
    const durations = ended
      .map(e => Number(e.metadata?.durationMs))
      .filter(n => Number.isFinite(n) && n > 0);
    const avgSessionMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

    const pe = profileEvents(events, profileIds);
    const activeWeekUsers = new Set(pe.filter(e => e.created_at >= t7).map(e => e.user_id)).size;
    const sessionsPerActivePerDay = activeWeekUsers
      ? Math.round((sessions7 / activeWeekUsers / 7) * 100) / 100
      : null;
    const avgSessionsPerProfile = profileIds.size
      ? Math.round((sessions7 / profileIds.size) * 100) / 100
      : null;

    return {
      appOpensToday: count("app_opened", todayStart),
      appOpens7:     count("app_opened", t7),
      sessionsToday,
      sessions7,
      avgSessionMs,
      avgSessionLabel: avgSessionMs === null ? "Session length not fully tracked yet" : null,
      sessionsPerActivePerDay,
      avgSessionsPerProfile,
    };
  } catch (e: any) { return { error: e?.message ?? "session metrics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — SCAN METRICS
// ═══════════════════════════════════════════════════════════════════════════

export async function getScanMetrics(base: BaseData): Promise<Maybe<any>> {
  try {
    const { events, profileIds } = base;
    const todayStart = iso(new Date(new Date().setHours(0, 0, 0, 0)));
    const pe = profileEvents(events, profileIds);
    const count = (name: string, sinceISO?: string) =>
      pe.filter(e => e.event_name === name && (!sinceISO || e.created_at >= sinceISO)).length;

    const started   = count("scan_started");
    const completed  = count("scan_completed");
    const failed     = count("scan_failed");
    const completionRate = (completed + failed) ? pct(completed, completed + failed) : null;

    // Saved scans from the scans table (source of truth) — profiles-only.
    const scanRows = await fetchAll<{ user_id: string; created_at: string }>(
      "scans", "user_id, created_at",
    );
    const savedRows = scanRows.filter(r => profileIds.has(r.user_id));
    const totalSaved = savedRows.length;

    const listingGen = events.filter(e => e.event_name === "listing_generated").length;
    const listingRatePerCompleted = completed ? pct(listingGen, completed) : null;

    // Scans per active user/day (last 7d, completed events from event stream).
    const t7 = iso(daysAgo(7));
    const completed7 = pe.filter(e => e.event_name === "scan_completed" && e.created_at >= t7);
    const perUserCounts = new Map<string, number>();
    for (const e of completed7) perUserCounts.set(e.user_id!, (perUserCounts.get(e.user_id!) ?? 0) + 1);
    const counts = [...perUserCounts.values()];
    const avgPerActive = counts.length ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length / 7) * 100) / 100 : null;
    const sorted = counts.slice().sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const usersWith5Plus = counts.filter(c => c >= 5).length;
    const pct5Plus = counts.length ? pct(usersWith5Plus, counts.length) : null;

    // Scans by day (last 7d) — completed vs failed from event stream.
    const byDay: Record<string, { completed: number; failed: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      byDay[key] = { completed: 0, failed: 0 };
    }
    for (const e of pe) {
      const key = e.created_at.slice(0, 10);
      if (!(key in byDay)) continue;
      if (e.event_name === "scan_completed") byDay[key].completed++;
      else if (e.event_name === "scan_failed") byDay[key].failed++;
    }
    const dailyTable = Object.entries(byDay).map(([date, v]) => ({
      date, completed: v.completed, failed: v.failed,
      completionRate: (v.completed + v.failed) ? pct(v.completed, v.completed + v.failed) : null,
    }));

    return {
      started, completed, failed, completionRate,
      totalSaved, listingGen, listingRatePerCompleted,
      avgPerActive, median, pct5Plus,
      dailyTable,
    };
  } catch (e: any) { return { error: e?.message ?? "scan metrics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — SCAN TRUST / FEEDBACK
// ═══════════════════════════════════════════════════════════════════════════
// Uses scan_feedback_submitted events (metadata carries rating + context).

export function getScanTrustMetrics(base: BaseData): Maybe<any> {
  try {
    const fb = base.events.filter(e => e.event_name === "scan_feedback_submitted");
    const total = fb.length;
    if (total === 0) return { total: 0, noData: true };

    const ratingOf = (e: any): string | null => {
      const r = e.metadata?.feedback_rating ?? e.metadata?.accuracyRating ?? null;
      return r ? String(r) : null;
    };
    let accurate = 0, somewhat = 0, bad = 0;
    for (const e of fb) {
      const r = ratingOf(e);
      if (r === "accurate") accurate++;
      else if (r === "somewhat") somewhat++;
      else if (r === "bad" || r === "inaccurate") bad++;
    }
    const rated = accurate + somewhat + bad;
    const trustScore = rated ? Math.round(((accurate + 0.5 * somewhat) / rated) * 1000) / 10 : null;

    // Trust by category + brand.
    const bucket = (keyFn: (e: any) => string) => {
      const m: Record<string, { acc: number; som: number; bad: number; total: number }> = {};
      for (const e of fb) {
        const r = ratingOf(e); if (!r) continue;
        const k = keyFn(e) || "Unknown";
        m[k] ??= { acc: 0, som: 0, bad: 0, total: 0 };
        if (r === "accurate") m[k].acc++;
        else if (r === "somewhat") m[k].som++;
        else if (r === "bad" || r === "inaccurate") m[k].bad++;
        m[k].total++;
      }
      return Object.entries(m).map(([k, v]) => ({
        key: k, total: v.total,
        score: v.total ? Math.round(((v.acc + 0.5 * v.som) / v.total) * 1000) / 10 : null,
      })).sort((a, b) => b.total - a.total);
    };

    const byCategory = bucket(e => String(e.metadata?.category ?? ""));
    const byBrand    = bucket(e => String(e.metadata?.brand ?? ""));
    const worstCategories = byCategory.filter(c => c.total >= 2).slice().sort((a, b) => (a.score ?? 100) - (b.score ?? 100)).slice(0, 8);

    // Recent feedback (safe fields only).
    const recent = fb
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map(e => ({
        date: e.created_at,
        item_title: e.metadata?.item_title ?? null,
        brand: e.metadata?.brand ?? null,
        category: e.metadata?.category ?? null,
        rating: ratingOf(e),
        recommendation: e.metadata?.recommendation ?? null,
        ai_value: e.metadata?.estimated_resale_value ?? null,
        user_value: e.metadata?.user_corrected_value ?? null,
        notes_present: !!e.metadata?.notes_present,
        note_length: e.metadata?.feedback_text_length ?? null,
      }));

    return { total, accurate, somewhat, bad, trustScore, byCategory, byBrand, worstCategories, recent };
  } catch (e: any) { return { error: e?.message ?? "trust metrics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — COST / BUDGET (estimate-based)
// ═══════════════════════════════════════════════════════════════════════════

function costConst(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function getCostBudgetMetrics(base: BaseData): Maybe<any> {
  try {
    const NORMAL  = costConst("ESTIMATED_NORMAL_SCAN_COST_USD", 0.01);
    const HUNT    = costConst("ESTIMATED_HUNT_SCAN_COST_USD", 0.01);
    const LISTING = costConst("ESTIMATED_LISTING_GENERATION_COST_USD", 0.005);
    const DEEP    = costConst("ESTIMATED_DEEP_SCAN_COST_USD", 0.02);
    const monthlyBudget = Number(process.env.MONTHLY_AI_BUDGET_USD);
    const hasBudget = Number.isFinite(monthlyBudget) && monthlyBudget > 0;

    const { events, profileIds } = base;
    const todayStart = iso(new Date(new Date().setHours(0, 0, 0, 0)));
    const t7 = iso(daysAgo(7)), t30 = iso(daysAgo(30));

    // Cost contributors: completed normal scans, hunt scans, listing gens.
    const inRange = (name: string, sinceISO: string) =>
      events.filter(e => e.event_name === name && e.created_at >= sinceISO).length;

    const estimate = (sinceISO: string) => {
      const normal  = inRange("scan_completed", sinceISO);
      const hunt    = inRange("hunt_scan_started", sinceISO);
      const listing = inRange("listing_generated", sinceISO);
      return normal * NORMAL + hunt * HUNT + listing * LISTING;
    };

    const costToday = estimate(todayStart);
    const cost7  = estimate(t7);
    const cost30 = estimate(t30);

    // Image count (sum of image_count metadata on completed scans, last 30d).
    const completed30 = events.filter(e => e.event_name === "scan_completed" && e.created_at >= t30);
    const totalImages = completed30.reduce((sum, e) => sum + (Number(e.metadata?.image_count) || 1), 0);
    const avgImagesPerScan = completed30.length ? Math.round((totalImages / completed30.length) * 100) / 100 : null;

    const pe = profileEvents(events, profileIds);
    const activeMonth = new Set(pe.filter(e => e.created_at >= t30).map(e => e.user_id)).size;
    const completedMonth = pe.filter(e => e.event_name === "scan_completed" && e.created_at >= t30).length;
    const costPerActiveUser = activeMonth ? Math.round((cost30 / activeMonth) * 1000) / 1000 : null;
    const costPerCompletedScan = completedMonth ? Math.round((cost30 / completedMonth) * 1000) / 1000 : null;

    return {
      estimated: true,
      rates: { NORMAL, HUNT, LISTING, DEEP },
      costToday, cost7, cost30,
      costPerActiveUser, costPerCompletedScan,
      totalImages, avgImagesPerScan,
      hasBudget,
      monthlyBudget: hasBudget ? monthlyBudget : null,
      budgetUsedPct: hasBudget ? pct(cost30, monthlyBudget) : null,
      tokenNote: "Exact token usage not tracked yet",
    };
  } catch (e: any) { return { error: e?.message ?? "cost metrics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9 — HUNT MODE
// ═══════════════════════════════════════════════════════════════════════════

export function getHuntMetrics(base: BaseData): Maybe<any> {
  try {
    const { events } = base;
    const count = (name: string) => events.filter(e => e.event_name === name).length;

    const opened  = count("hunt_mode_opened");
    const started = count("hunt_started");
    const ended   = count("hunt_ended");
    const huntScans = count("hunt_scan_started");
    const itemsSaved = count("hunt_item_saved");

    return {
      opened, started, ended, huntScans, itemsSaved,
      abandoned: null, // not explicitly tracked
      avgItemsPerHunt: started ? Math.round((itemsSaved / started) * 100) / 100 : null,
      avgDuration: null, // duration not in current hunt events
      openToStartRate: opened ? pct(started, opened) : null,
      completionRate: started ? pct(ended, started) : null,
    };
  } catch (e: any) { return { error: e?.message ?? "hunt metrics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10 — PROGRESS TAB ENGAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export function getProgressEngagementMetrics(base: BaseData): Maybe<any> {
  try {
    const { events, profileIds } = base;
    const pe = profileEvents(events, profileIds);
    const stat = (name: string, src = events) => {
      const evs = src.filter(e => e.event_name === name);
      const uniqueUsers = new Set(evs.filter(e => e.user_id).map(e => e.user_id)).size;
      return { total: evs.length, uniqueUsers };
    };

    const progress = stat("progress_tab_opened");
    const ach   = stat("achievements_opened");
    const brand = stat("brand_compendium_opened");
    const dia   = stat("diamonds_opened");

    const subTotal = ach.total + brand.total + dia.total;
    const share = (n: number) => subTotal ? pct(n, subTotal) : 0;

    const activeWeek = new Set(pe.filter(e => e.created_at >= iso(daysAgo(7))).map(e => e.user_id)).size;
    const opensPerActive = activeWeek ? Math.round((progress.total / activeWeek) * 100) / 100 : null;

    return {
      progress, ach, brand, dia,
      subsectionShare: {
        achievements: share(ach.total),
        brands:       share(brand.total),
        diamonds:     share(dia.total),
      },
      opensPerActive,
      brandDetailOpens:   stat("brand_detail_opened").total,
      diamondDetailOpens: stat("diamond_detail_opened").total,
      achievementCategoryOpens: stat("achievement_category_opened").total,
      brandRarityOpens:   stat("brand_rarity_opened").total,
    };
  } catch (e: any) { return { error: e?.message ?? "progress engagement failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 11 — ACHIEVEMENT ANALYTICS (source: user_achievements)
// ═══════════════════════════════════════════════════════════════════════════

function rarityLabel(pctUnlocked: number): string {
  if (pctUnlocked >= 50) return "Very Common";
  if (pctUnlocked >= 25) return "Common";
  if (pctUnlocked >= 10) return "Uncommon";
  if (pctUnlocked >= 3)  return "Rare";
  return "Very Rare";
}

export async function getAchievementAnalytics(base: BaseData): Promise<Maybe<any>> {
  try {
    const { profileIds } = base;
    const totalUsers = profileIds.size;
    const rows = await fetchAll<{ user_id: string; achievement_id: string }>(
      "user_achievements", "user_id, achievement_id",
    );
    const valid = rows.filter(r => profileIds.has(r.user_id));

    // Per-achievement distinct users.
    const perAch = new Map<string, Set<string>>();
    const perUser = new Map<string, number>();
    for (const r of valid) {
      const s = perAch.get(r.achievement_id) ?? new Set<string>();
      s.add(r.user_id); perAch.set(r.achievement_id, s);
      perUser.set(r.user_id, (perUser.get(r.user_id) ?? 0) + 1);
    }

    const totalUnlocked = valid.length;
    const usersWithAny = perUser.size;
    const userCounts = [...perUser.values()];
    const avgPerUser = totalUsers ? Math.round((totalUnlocked / totalUsers) * 100) / 100 : 0;

    const table = ACH_CATALOG.map(a => {
      const users = perAch.get(a.id)?.size ?? 0;
      const p = pct(users, totalUsers);
      return {
        id: a.id, name: a.name, category: a.category,
        users, pct: p, rarity: rarityLabel(p),
      };
    }).sort((a, b) => b.users - a.users);

    // Group by category for collapse.
    const byCategory: Record<string, any[]> = {};
    for (const row of table) (byCategory[row.category] ??= []).push(row);

    return {
      totalUnlocked, avgPerUser,
      pctWithAny:  pct(usersWithAny, totalUsers),
      pctWith5:    pct(userCounts.filter(c => c >= 5).length, totalUsers),
      pctWith10:   pct(userCounts.filter(c => c >= 10).length, totalUsers),
      totalUsers,
      byCategory,
    };
  } catch (e: any) { return { error: e?.message ?? "achievement analytics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 12 — BRAND COMPENDIUM (source: user_brand_discoveries)
// ═══════════════════════════════════════════════════════════════════════════

export async function getBrandAnalytics(base: BaseData): Promise<Maybe<any>> {
  try {
    const { profileIds, events } = base;
    const totalUsers = profileIds.size;
    const rows = await fetchAll<{ user_id: string; brand_id: string; brand_name: string; rarity: string; category: string | null }>(
      "user_brand_discoveries", "user_id, brand_id, brand_name, rarity, category",
    );
    const valid = rows.filter(r => profileIds.has(r.user_id));

    const perBrand = new Map<string, Set<string>>();
    const perUser  = new Map<string, number>();
    const rarityCounts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    for (const r of valid) {
      const s = perBrand.get(r.brand_id) ?? new Set<string>();
      s.add(r.user_id); perBrand.set(r.brand_id, s);
      perUser.set(r.user_id, (perUser.get(r.user_id) ?? 0) + 1);
      const rr = (r.rarity ?? "").toLowerCase();
      if (rr in rarityCounts) rarityCounts[rr]++;
    }

    // Brand detail opens per brand (from analytics metadata.brand_name).
    const detailOpens = new Map<string, number>();
    for (const e of events.filter(ev => ev.event_name === "brand_detail_opened")) {
      const name = String(e.metadata?.brand_name ?? e.metadata?.brand_id ?? "").trim();
      if (!name) continue;
      detailOpens.set(name.toLowerCase(), (detailOpens.get(name.toLowerCase()) ?? 0) + 1);
    }

    const table = BRAND_CATALOG.map(b => {
      const users = perBrand.get(b.id)?.size ?? 0;
      const opens = detailOpens.get(b.name.toLowerCase()) ?? 0;
      return {
        id: b.id, name: b.name, rarity: b.rarity, category: b.category,
        users, pct: pct(users, totalUsers),
        detailOpens: opens,
        detailClickRate: users ? pct(opens, users) : null,
      };
    });

    const discovered = table.filter(b => b.users > 0);
    const sortedByUsers = table.slice().sort((a, b) => b.users - a.users);
    const mostDiscovered  = sortedByUsers.filter(b => b.users > 0).slice(0, 15);
    const leastDiscovered = sortedByUsers.filter(b => b.users === 0).slice(0, 15); // supported but never found
    const mostClicked = table.slice().filter(b => b.detailOpens > 0).sort((a, b) => b.detailOpens - a.detailOpens).slice(0, 15);

    // Rarity page opens.
    const rarityPageOpens: Record<string, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    for (const e of events.filter(ev => ev.event_name === "brand_rarity_opened")) {
      const r = String(e.metadata?.brand_rarity ?? "").toLowerCase();
      if (r in rarityPageOpens) rarityPageOpens[r]++;
    }

    return {
      totalDiscoveries: valid.length,
      uniqueBrands: perBrand.size,
      totalSupported: BRAND_CATALOG.length,
      avgPerUser: totalUsers ? Math.round((valid.length / totalUsers) * 100) / 100 : 0,
      pctWithAny: pct(perUser.size, totalUsers),
      rarityCounts,
      rarityPageOpens,
      mostDiscovered, leastDiscovered, mostClicked,
      byRarity: groupByRarity(table),
    };
  } catch (e: any) { return { error: e?.message ?? "brand analytics failed" }; }
}

function groupByRarity(rows: any[]) {
  const order = ["legendary", "rare", "uncommon", "common"];
  const g: Record<string, any[]> = {};
  for (const r of rows) (g[(r.rarity ?? "").toLowerCase()] ??= []).push(r);
  const out: Record<string, any[]> = {};
  for (const k of order) if (g[k]) out[k] = g[k].sort((a, b) => b.users - a.users);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 13 — DIAMONDS (source: user_diamond_discoveries)
// ═══════════════════════════════════════════════════════════════════════════

export async function getDiamondAnalytics(base: BaseData): Promise<Maybe<any>> {
  try {
    const { profileIds, events } = base;
    const totalUsers = profileIds.size;
    const rows = await fetchAll<{ user_id: string; diamond_id: string; diamond_title: string }>(
      "user_diamond_discoveries", "user_id, diamond_id, diamond_title",
    );
    const valid = rows.filter(r => profileIds.has(r.user_id));

    const perDia = new Map<string, Set<string>>();
    const perUser = new Map<string, number>();
    for (const r of valid) {
      const s = perDia.get(r.diamond_id) ?? new Set<string>();
      s.add(r.user_id); perDia.set(r.diamond_id, s);
      perUser.set(r.user_id, (perUser.get(r.user_id) ?? 0) + 1);
    }

    const detailOpens = new Map<string, number>();
    for (const e of events.filter(ev => ev.event_name === "diamond_detail_opened")) {
      const id = String(e.metadata?.diamond_id ?? "").trim();
      if (!id) continue;
      detailOpens.set(id, (detailOpens.get(id) ?? 0) + 1);
    }

    const table = DIAMOND_CATALOG.map(d => {
      const users = perDia.get(d.id)?.size ?? 0;
      const opens = detailOpens.get(d.id) ?? 0;
      return {
        id: d.id, title: d.title, category: d.category, label: d.label,
        users, pct: pct(users, totalUsers),
        detailOpens: opens,
        detailClickRate: users ? pct(opens, users) : null,
      };
    });

    const sorted = table.slice().sort((a, b) => b.users - a.users);
    return {
      totalUnlocks: valid.length,
      uniqueDiamonds: perDia.size,
      totalCatalog: DIAMOND_CATALOG.length,
      avgPerUser: totalUsers ? Math.round((valid.length / totalUsers) * 100) / 100 : 0,
      pctWithAny: pct(perUser.size, totalUsers),
      mostUnlocked: sorted.filter(d => d.users > 0).slice(0, 15),
      neverUnlocked: sorted.filter(d => d.users === 0).map(d => ({ id: d.id, title: d.title, category: d.category })),
      mostClicked: table.slice().filter(d => d.detailOpens > 0).sort((a, b) => b.detailOpens - a.detailOpens).slice(0, 15),
      fullTable: sorted,
    };
  } catch (e: any) { return { error: e?.message ?? "diamond analytics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 14 — LISTING GENERATION
// ═══════════════════════════════════════════════════════════════════════════

export async function getListingAnalytics(base: BaseData): Promise<Maybe<any>> {
  try {
    const { events, profileIds } = base;
    const todayStart = iso(new Date(new Date().setHours(0, 0, 0, 0)));
    const t7 = iso(daysAgo(7));
    const gen = events.filter(e => e.event_name === "listing_generated");
    const failed = events.filter(e => e.event_name === "listing_generation_failed");

    const platforms: Record<string, number> = { ebay: 0, depop: 0, both: 0, unknown: 0 };
    for (const e of gen) {
      const p = String(e.metadata?.platform ?? "unknown").toLowerCase();
      if (p in platforms) platforms[p]++; else platforms.unknown++;
    }

    const pe = profileEvents(events, profileIds);
    const completed = pe.filter(e => e.event_name === "scan_completed").length;

    // saved from scans table
    const scanRows = await fetchAll<{ user_id: string }>("scans", "user_id");
    const saved = scanRows.filter(r => profileIds.has(r.user_id)).length;

    const recentFailures = failed
      .slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10)
      .map(e => ({
        date: e.created_at,
        item_title: e.metadata?.item_title ?? null,
        platform: e.metadata?.platform ?? null,
        error_code: e.metadata?.error_code ?? null,
        stage: e.metadata?.failure_stage ?? null,
      }));

    return {
      total: gen.length,
      today: gen.filter(e => e.created_at >= todayStart).length,
      last7: gen.filter(e => e.created_at >= t7).length,
      ratePerCompleted: completed ? pct(gen.length, completed) : null,
      ratePerSaved: saved ? pct(gen.length, saved) : null,
      platforms,
      failures: failed.length,
      failureRate: (gen.length + failed.length) ? pct(failed.length, gen.length + failed.length) : null,
      recentFailures,
    };
  } catch (e: any) { return { error: e?.message ?? "listing analytics failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 15 — DATA QUALITY / TRACKING STATUS
// ═══════════════════════════════════════════════════════════════════════════

export async function getDataQualityMetrics(base: BaseData): Promise<Maybe<any>> {
  try {
    const { events, profiles } = base;
    const todayStart = iso(new Date(new Date().setHours(0, 0, 0, 0)));
    const withUser = events.filter(e => e.user_id).length;
    const anonOnly = events.filter(e => !e.user_id && e.anonymous_id).length;
    const missingSession = events.filter(e => !e.session_id).length;

    const latest = (arr: string[]) => arr.length ? arr.slice().sort().slice(-1)[0] : null;
    const latestEvent = latest(events.map(e => e.created_at));
    const latestProfile = latest(profiles.map(p => p.created_at));

    // latest scan saved
    let latestScan: string | null = null;
    try {
      const scanRows = await fetchAll<{ created_at: string }>("scans", "created_at");
      latestScan = latest(scanRows.map(r => r.created_at));
    } catch { latestScan = null; }

    // Table connectivity probe.
    const probe = async (table: string) => {
      try { await countRows(table); return true; } catch { return false; }
    };
    const tables = {
      profiles: await probe("profiles"),
      scans: await probe("scans"),
      analytics_events: await probe("analytics_events"),
      user_achievements: await probe("user_achievements"),
      user_brand_discoveries: await probe("user_brand_discoveries"),
      user_diamond_discoveries: await probe("user_diamond_discoveries"),
    };

    return {
      totalEvents: events.length,
      eventsToday: events.filter(e => e.created_at >= todayStart).length,
      withUser, anonOnly, missingSession,
      latestEvent, latestProfile, latestScan,
      tables,
      trackingStatus: {
        exact: [
          "Total profiles", "New users", "Achievements/Brands/Diamonds unlocked (tables)",
          "Scans saved (table)", "Navigation opens", "Listing generations",
        ],
        estimated: ["AI cost / budget (config-rate based)"],
        notTracked: [
          "Exact token usage / exact $ cost",
          "Hunt duration / hunt abandonment",
          "Session length (unless app_session_ended fires with durationMs)",
        ],
      },
    };
  } catch (e: any) { return { error: e?.message ?? "data quality failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATOR
// ═══════════════════════════════════════════════════════════════════════════

export async function getFounderDashboardV3Metrics(): Promise<any> {
  if (!getSupabaseAdmin()) {
    return { configured: false };
  }
  let base: BaseData;
  try {
    base = await loadBaseData();
  } catch (e: any) {
    return { configured: true, fatal: e?.message ?? "failed to load base data" };
  }

  // Run sections; each is independently fail-safe.
  const [
    funnel, scans, achievements, brands, diamonds, listings, dataQuality,
  ] = await Promise.all([
    getActivationFunnelMetrics(base),
    getScanMetrics(base),
    getAchievementAnalytics(base),
    getBrandAnalytics(base),
    getDiamondAnalytics(base),
    getListingAnalytics(base),
    getDataQualityMetrics(base),
  ]);

  return {
    configured: true,
    generatedAt: new Date().toISOString(),
    users:       getUserMetrics(base),
    retention:   getRetentionMetrics(base),
    funnel,
    conversion:  getAccountFunnelMetrics(base),
    sessions:    getSessionMetrics(base),
    scans,
    trust:       getScanTrustMetrics(base),
    cost:        getCostBudgetMetrics(base),
    hunt:        getHuntMetrics(base),
    progress:    getProgressEngagementMetrics(base),
    achievements,
    brands,
    diamonds,
    listings,
    dataQuality,
  };
}