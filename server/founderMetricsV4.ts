/**
 * server/founderMetricsV4.ts
 *
 * Founder Dashboard V4 — the business-analytics layer.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * V3's metrics (server/founderMetrics.ts) answer product questions: how many
 * scans, which brands, which achievements. This module answers business ones:
 * who reaches a paywall, what they do there, who pays, how long it takes, and
 * where the Scan Store funnel breaks. It ADDS to V3 rather than replacing it;
 * every V3 section is still computed and rendered further down the page.
 *
 * ── Every user counts ───────────────────────────────────────────────────────
 * Nobody is excluded. `is_internal` exists on profiles as dormant
 * infrastructure and nobody is flagged, so `loadBaseData()`'s filter is a
 * no-op. No email or user id is special-cased anywhere in this file.
 *
 * ── Two eras of data ────────────────────────────────────────────────────────
 * Some events have always existed (paywall_opened, purchase_completed, scan
 * store events) and their whole history is valid. Others only exist once the
 * V4 client instrumentation ships (entitlement snapshots, continue-free,
 * explicit close, balances, entry_source, reliable scan_completed). Those are
 * gated on ANALYTICS_V4_CUTOVER_AT: with no cutover configured they report
 * `available: false` and the UI says so, because a zero would be a lie about
 * data that was never collected.
 *
 * ── Trust labels ────────────────────────────────────────────────────────────
 * Every number carries one of: EXACT (a count from an authoritative table),
 * DERIVED (arithmetic over exact inputs, e.g. a conversion rate), ESTIMATED
 * (a model, e.g. API spend), NOT_TRACKED, or LEGACY (known-unreliable). The
 * renderer surfaces these subtly; this file is where they are decided.
 *
 * ── Performance ─────────────────────────────────────────────────────────────
 * Four table loads (profiles+events via loadBaseData, scans, account_usage,
 * auth users) and everything else is maps in memory. No per-user queries.
 */
import { loadBaseData, fetchAll, type BaseData } from "./founderMetrics";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { derivePlan, type AccountUsage, type PlanState } from "./monetization/policy";
import { PAYWALL_SOURCES } from "../lib/paywallConfig";
import { SCAN_PACKS } from "../lib/scanPackCatalog";
import {
  DASHBOARD_TZ, DASHBOARD_TZ_LABEL, centralDay, centralToday, centralRangeUtc,
  addCentralDays, centralDaysBetween, formatDayLabel,
} from "./dashboardDates";

export type Trust = "EXACT" | "DERIVED" | "ESTIMATED" | "NOT_TRACKED" | "LEGACY";

/** A number with its provenance and, for rates, its denominator. */
export interface Metric {
  value: number | null;
  trust: Trust;
  /** For rates: numerator / denominator, so the UI can show "2 / 36". */
  n?: number;
  d?: number;
  /** For V4-gated metrics: false until a cutover is configured. */
  available?: boolean;
  note?: string;
}

const exact = (value: number | null, note?: string): Metric => ({ value, trust: "EXACT", note });
const derived = (n: number, d: number, note?: string): Metric =>
  ({ value: d > 0 ? n / d : null, trust: "DERIVED", n, d, note });
const unavailable = (note = "Available after Analytics V4 cutover"): Metric =>
  ({ value: null, trust: "NOT_TRACKED", available: false, note });

const DAY = 86_400_000;
const SMALL_SAMPLE = 20;

// ── Global launch cohort ────────────────────────────────────────────────────

/**
 * Which users a section is about.
 *
 * `post_launch` is the DEFAULT for business analytics. FlipStart accumulated
 * ~160 development-era profiles before it was public; mixing them with real
 * acquisitions makes activation and free-user behaviour meaningless — an
 * abandoned dev account looks identical to a real user who never scanned.
 *
 * `all` preserves every historical number for platform totals and long-term
 * product context. Nothing is deleted; the scope only chooses who is counted.
 */
export type Scope = "post_launch" | "all";

export interface LaunchCohort {
  scope: Scope;
  /** ISO boundary, or null in `all` scope. */
  at: string | null;
  /** Where the value came from, for the Data Quality section. */
  source: "env" | "default";
  assumed: boolean;
  label: string;
}

/**
 * FlipStart's global App Store launch.
 *
 * Read from FLIPSTART_GLOBAL_LAUNCH_AT so it can be corrected without a
 * deploy, but it DEFAULTS to the known date rather than disabling the cohort
 * when unset. That differs deliberately from ANALYTICS_V4_CUTOVER_AT: the
 * cutover describes data that may not exist yet, so guessing it would invent
 * numbers; the launch date is a fixed historical company event that already
 * happened, and refusing to apply it would leave the dashboard showing the
 * misleading all-time mix by default.
 *
 * The 00:00:00Z time-of-day is an ASSUMPTION — no exact launch timestamp is
 * stored anywhere in the product. Surfaced as such in Data Quality.
 *
 * These two constants are unrelated concepts and must never be conflated:
 *   GLOBAL_LAUNCH_AT       → which USERS are counted (acquisition cohort)
 *   ANALYTICS_V4_CUTOVER_AT → which FIELDS are trustworthy (instrumentation)
 */
export const GLOBAL_LAUNCH_AT_DEFAULT = "2026-09-08T00:00:00Z";

export function getLaunchCohort(scope: Scope = "post_launch", env: NodeJS.ProcessEnv = process.env): LaunchCohort {
  if (scope === "all") {
    return { scope: "all", at: null, source: "default", assumed: false, label: "All time" };
  }
  const raw = (env.FLIPSTART_GLOBAL_LAUNCH_AT ?? "").trim();
  const parsed = raw && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null;
  const at = parsed ?? new Date(Date.parse(GLOBAL_LAUNCH_AT_DEFAULT)).toISOString();
  return {
    scope: "post_launch", at, source: parsed ? "env" : "default",
    // The DATE is known; only the time-of-day is assumed, and only when the
    // env var is absent.
    assumed: !parsed,
    label: `Since ${at.slice(0, 10)}`,
  };
}

/** Parse ?scope= into a Scope. Anything unrecognised falls back to the default. */
export function parseScope(raw: unknown): Scope {
  return raw === "all" || raw === "all_time" ? "all" : "post_launch";
}

// ── Analysis window ─────────────────────────────────────────────────────────

/**
 * WHEN the activity being analysed happened.
 *
 * Completely independent of Scope, which decides WHICH USERS are eligible.
 * Scope = Post Launch + range = Sep 15–20 means: of the users acquired since
 * global launch, what did they do between the 15th and the 20th. A user who
 * joined on the 10th still contributes scans on the 18th — that is correct,
 * and collapsing the two filters into one is the mistake this separation
 * exists to prevent.
 *
 * ── Two semantics, one control ──────────────────────────────────────────────
 * The same selected range means different things to different sections, and
 * each says which it is using on screen:
 *
 *   ACTIVITY   — scans, paywalls, sessions, purchases, Scan Store, features.
 *                Rows whose own timestamp falls inside the window.
 *
 *   COHORT     — activation and retention. The window selects who ENTERED
 *                during it, then follows them FORWARD past the end date. A
 *                three-day window would otherwise make D7 retention
 *                impossible by construction, and a campaign's activation
 *                would be truncated before anyone had a chance to activate.
 */
export type RangePreset =
  | "today" | "yesterday" | "7d" | "14d" | "30d" | "since_launch" | "all" | "custom";

export interface AnalysisWindow {
  preset: RangePreset;
  /** Central calendar days, inclusive. Null start = unbounded (All Available). */
  fromDay: string | null;
  toDay: string | null;
  /** Half-open UTC bounds: >= startMs, < endMs. Null = unbounded on that side. */
  startMs: number | null;
  endMs: number | null;
  /** Inclusive day count, 0 when unbounded. */
  days: number;
  label: string;
  timezone: string;
  timezoneLabel: string;
  /** Set when the requested range was rejected; the fallback is in use. */
  warning: string | null;
}

const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 Days", "14d": "Last 14 Days",
  "30d": "Last 30 Days", since_launch: "Since Global Launch", all: "All Available", custom: "Custom",
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function windowFrom(preset: RangePreset, fromDay: string | null, toDay: string | null, warning: string | null): AnalysisWindow {
  if (!fromDay || !toDay) {
    return {
      preset, fromDay: null, toDay: null, startMs: null, endMs: null, days: 0,
      label: PRESET_LABELS[preset], timezone: DASHBOARD_TZ, timezoneLabel: DASHBOARD_TZ_LABEL, warning,
    };
  }
  const r = centralRangeUtc(fromDay, toDay);
  if (!r) {
    return {
      preset: "all", fromDay: null, toDay: null, startMs: null, endMs: null, days: 0,
      label: PRESET_LABELS.all, timezone: DASHBOARD_TZ, timezoneLabel: DASHBOARD_TZ_LABEL,
      warning: warning ?? `Could not interpret ${fromDay} → ${toDay}; showing all available activity.`,
    };
  }
  return {
    preset, fromDay, toDay, startMs: r.startMs, endMs: r.endMs,
    days: centralDaysBetween(fromDay, toDay),
    label: preset === "custom" || preset === "since_launch"
      ? `${formatDayLabel(fromDay)} – ${formatDayLabel(toDay)}`
      : `${PRESET_LABELS[preset]} (${formatDayLabel(fromDay)} – ${formatDayLabel(toDay)})`,
    timezone: DASHBOARD_TZ, timezoneLabel: DASHBOARD_TZ_LABEL, warning,
  };
}

/**
 * Build the window from query params.
 *
 * Never throws and never silently reinterprets a bad range: an invalid request
 * falls back to the default and says why, so a typo cannot masquerade as a
 * real result.
 */
export function resolveAnalysisWindow(
  params: { preset?: unknown; from?: unknown; to?: unknown },
  scope: Scope = "post_launch",
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): AnalysisWindow {
  const today = centralToday(now);
  const raw = typeof params.preset === "string" ? params.preset : "";
  const from = typeof params.from === "string" ? params.from.trim() : "";
  const to = typeof params.to === "string" ? params.to.trim() : "";

  // An explicit from/to implies a custom range even without preset=custom.
  const wantsCustom = raw === "custom" || (!raw && (!!from || !!to));
  if (wantsCustom) {
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
      return windowFrom("7d", addCentralDays(today, -6), today,
        "Custom range needs both a start and an end date as YYYY-MM-DD. Showing the last 7 days.");
    }
    if (from > to) {
      // Swapping silently would be a reinterpretation; say what happened.
      return windowFrom("custom", to, from, `Start was after end, so the dates were swapped: ${formatDayLabel(to)} – ${formatDayLabel(from)}.`);
    }
    const future = to > today
      ? `End date is in the future; there is no activity after ${formatDayLabel(today)}.`
      : null;
    return windowFrom("custom", from, to, future);
  }

  switch (raw) {
    case "today":     return windowFrom("today", today, today, null);
    case "yesterday": { const y = addCentralDays(today, -1); return windowFrom("yesterday", y, y, null); }
    case "14d":       return windowFrom("14d", addCentralDays(today, -13), today, null);
    case "30d":       return windowFrom("30d", addCentralDays(today, -29), today, null);
    case "all":       return windowFrom("all", null, null, null);
    case "since_launch": {
      const at = getLaunchCohort("post_launch", env).at;
      const day = at ? centralDay(at) : null;
      return day
        ? windowFrom("since_launch", day, today, null)
        : windowFrom("all", null, null, "Global launch date unavailable; showing all activity.");
    }
    case "7d":
    default:
      // The default. Business activity is read week to week.
      return windowFrom("7d", addCentralDays(today, -6), today, null);
  }
}

/** Is an ISO timestamp inside the activity window? Unbounded window = always. */
export function inWindow(w: AnalysisWindow, isoStr: string | null | undefined): boolean {
  if (w.startMs === null || w.endMs === null) return true;
  if (!isoStr) return false;
  const t = Date.parse(isoStr);
  if (!Number.isFinite(t)) return false;
  return t >= w.startMs && t < w.endMs;
}

// ── Cutover ─────────────────────────────────────────────────────────────────

export interface Cutover {
  configured: boolean;
  at: string | null;
  /** Human explanation for the Data Quality section. */
  status: string;
}

/**
 * The single source of truth for "when did V4 instrumentation start".
 *
 * Read from the environment so it is set ONCE, at the moment the V4 client is
 * released, and never guessed. Until then every V4-gated metric is
 * unavailable rather than zero.
 */
export function getCutover(env: NodeJS.ProcessEnv = process.env): Cutover {
  const raw = (env.ANALYTICS_V4_CUTOVER_AT ?? "").trim();
  if (!raw) {
    return { configured: false, at: null,
      status: "Awaiting Analytics V4 client release — set ANALYTICS_V4_CUTOVER_AT when the build ships" };
  }
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) {
    return { configured: false, at: null,
      status: `ANALYTICS_V4_CUTOVER_AT is set but not a parseable timestamp: "${raw}"` };
  }
  return { configured: true, at: new Date(t).toISOString(), status: `Analytics V4 active since ${new Date(t).toISOString()}` };
}

// ── Data ────────────────────────────────────────────────────────────────────

type Ev = BaseData["events"][number];

interface ScanRow { user_id: string | null; created_at: string; }
interface UsageRow extends AccountUsage { user_id: string; }
interface AuthUser { id: string; email: string | null; created_at: string; }
interface ProfileRow { id: string; display_name: string | null; username: string | null; created_at: string; }

export interface V4Data {
  window: AnalysisWindow;
  /**
   * Events and scans restricted to the ACTIVITY window. Most sections use
   * these. `allEvents` / `allScans` keep the unwindowed set for the sections
   * that must look outside it — a purchaser's history before the range, and
   * retention's follow-up after it.
   */
  allEvents: BaseData["events"];
  allScans: ScanRow[];
  cohort: LaunchCohort;
  /** Profiles excluded by the scope. 0 in `all`. */
  preLaunchProfiles: number;
  /** Anonymous events dropped because they cannot be cohort-attributed. */
  anonymousExcluded: number;
  base: BaseData;
  scans: ScanRow[];
  usage: Map<string, UsageRow>;
  auth: Map<string, AuthUser>;
  profiles: Map<string, ProfileRow>;
  now: Date;
}

/** Auth users via the admin API. Email is read here and rendered only into founder HTML. */
async function fetchAuthUsers(): Promise<AuthUser[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const out: AuthUser[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) out.push({ id: u.id, email: u.email ?? null, created_at: u.created_at });
    if (data.users.length < 1000) break;
  }
  return out;
}

export async function loadV4Data(
  base?: BaseData,
  scope: Scope = "post_launch",
  env: NodeJS.ProcessEnv = process.env,
  window: AnalysisWindow = resolveAnalysisWindow({}, scope, new Date(), env),
): Promise<V4Data> {
  const cohort = getLaunchCohort(scope, env);
  const b = base ?? await loadBaseData();
  const [scans, usageRows, authUsers, profileRows] = await Promise.all([
    fetchAll<ScanRow>("scans", "user_id, created_at"),
    fetchAll<UsageRow>("account_usage", "*"),
    fetchAuthUsers().catch(() => [] as AuthUser[]),
    fetchAll<ProfileRow>("profiles", "id, display_name, username, created_at"),
  ]);
  /**
   * ONE filter, applied once, at the source.
   *
   * Two things narrow the population and both land here, so every downstream
   * section is correct by construction rather than by each one remembering:
   *
   *   1. is_internal / ghost profiles — already removed by loadBaseData().
   *   2. the acquisition cohort — profiles created before the global launch,
   *      removed here when scope is post_launch.
   *
   * The cohort is defined by ACCOUNT CREATION, never by activity date. A
   * pre-launch user who scans or pays in October is still a pre-launch
   * acquisition and stays out of post-launch numbers; their rows appear in
   * `all` scope only. Filtering events by their own timestamp instead would
   * silently fold those users back in, which is the exact mistake this scope
   * exists to prevent.
   */
  const cohortProfiles = cohort.at
    ? b.profiles.filter(p => p.created_at >= cohort.at!)
    : b.profiles;
  const preLaunchProfiles = b.profiles.length - cohortProfiles.length;
  const keep = new Set(cohortProfiles.map(p => p.id));

  /**
   * Anonymous (pre-auth) events carry no user_id, so they cannot be attributed
   * to an acquisition cohort. In post_launch scope they are EXCLUDED rather
   * than guessed at — an anonymous onboarding event could belong to a
   * dev-era profile just as easily as a new one. They remain in `all`.
   */
  const events = cohort.at
    ? b.events.filter(e => !!e.user_id && keep.has(e.user_id))
    : b.events.filter(e => !e.user_id || keep.has(e.user_id));
  const anonymousExcluded = cohort.at ? b.events.filter(e => !e.user_id).length : 0;

  /**
   * Cohort first, then window. Order matters and is not interchangeable:
   * the cohort decides who is eligible at all, the window decides which of
   * their activity is being examined. Reversing it would let a pre-launch
   * user back in whenever they were active during the selected dates.
   */
  const cohortScans = scans.filter(sc => !!sc.user_id && keep.has(sc.user_id));
  const windowedEvents = events.filter(e => inWindow(window, e.created_at));
  const windowedScans = cohortScans.filter(sc => inWindow(window, sc.created_at));

  return {
    window, allEvents: events, allScans: cohortScans,
    cohort, preLaunchProfiles, anonymousExcluded,
    base: { ...b, profiles: cohortProfiles, profileIds: keep, events: windowedEvents },
    scans: windowedScans,
    usage:    new Map(usageRows.filter(u => keep.has(u.user_id)).map(u => [u.user_id, u])),
    auth:     new Map(authUsers.map(u => [u.id, u])),
    profiles: new Map(profileRows.map(p => [p.id, p])),
    now: new Date(),
  };
}

// ── Small helpers ───────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString();
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const meta = (e: Ev, k: string): unknown => (e.metadata && typeof e.metadata === "object") ? e.metadata[k] : undefined;
const metaStr = (e: Ev, k: string): string | null => { const v = meta(e, k); return typeof v === "string" ? v : null; };
const metaNum = (e: Ev, k: string): number | null => { const v = meta(e, k); return typeof v === "number" && Number.isFinite(v) ? v : null; };

/** Events after the cutover, or none if it is not configured. */
function v4Events(d: V4Data, c: Cutover): Ev[] {
  if (!c.configured || !c.at) return [];
  const at = c.at;
  return d.base.events.filter(e => e.created_at >= at);
}

/** Current plan for a user from account_usage. "free" when no row. */
function currentPlan(d: V4Data, uid: string): PlanState {
  const u = d.usage.get(uid);
  return u ? derivePlan(u, d.now) : "free";
}

/**
 * The dashboard's calendar day, e.g. "2026-09-15".
 *
 * CENTRAL, not UTC. Every day-based metric routes through here — daily trends,
 * active days, retention anchors, "same day" conversion buckets — so the whole
 * dashboard agrees on when a day starts. Previously this sliced the ISO string,
 * which is a UTC day: an event at 8pm Central counted as tomorrow.
 */
const dayOf = (isoStr: string) => centralDay(isoStr);

// ── Executive + Acquisition ─────────────────────────────────────────────────

export function getAcquisition(d: V4Data) {
  const { profiles } = d.base;
  const now = d.now;
  const newSince = (days: number) => profiles.filter(p => p.created_at >= iso(ago(now, days))).length;
  const activeSince = (days: number) => new Set(
    d.base.events.filter(e => e.user_id && e.created_at >= iso(ago(now, days))).map(e => e.user_id!),
  ).size;

  // Daily trend, last 30 days, UTC days.
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(dayOf(iso(ago(now, i))));
  const newByDay = new Map(days.map(x => [x, 0]));
  const activeByDay = new Map(days.map(x => [x, new Set<string>()]));
  for (const p of profiles) { const k = dayOf(p.created_at); if (newByDay.has(k)) newByDay.set(k, newByDay.get(k)! + 1); }
  for (const e of d.base.events) {
    if (!e.user_id) continue;
    const k = dayOf(e.created_at);
    activeByDay.get(k)?.add(e.user_id);
  }
  // Cumulative growth.
  let cum = 0;
  const sorted = [...profiles].sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const cumulative = days.map(day => {
    while (cum < sorted.length && dayOf(sorted[cum].created_at) <= day) cum++;
    return { day, users: cum };
  });

  return {
    totalUsers: exact(profiles.length),
    newToday: exact(profiles.filter(p => dayOf(p.created_at) === dayOf(iso(now))).length),
    new7: exact(newSince(7)), new30: exact(newSince(30)),
    dau: exact(activeSince(1)), wau: exact(activeSince(7)), mau: exact(activeSince(30)),
    dauMau: derived(activeSince(1), activeSince(30)),
    trend: days.map(day => ({ day, newUsers: newByDay.get(day) ?? 0, active: activeByDay.get(day)?.size ?? 0 })),
    cumulative,
    attributionNote: "Acquisition source attribution not currently tracked.",
  };
}

// ── Activation ──────────────────────────────────────────────────────────────

/** Per-user scan counts within the ACTIVITY window. */
function scanStats(d: V4Data) { return scanStatsOver(d.scans); }

/** Per-user scan counts over ALL of the cohort's scans, ignoring the window. */
function scanStatsAll(d: V4Data) { return scanStatsOver(d.allScans); }

function scanStatsOver(rows: ScanRow[]) {
  const counts = new Map<string, number>();
  const first = new Map<string, string>();
  for (const s of rows) {
    if (!s.user_id) continue;
    counts.set(s.user_id, (counts.get(s.user_id) ?? 0) + 1);
    const f = first.get(s.user_id);
    if (!f || s.created_at < f) first.set(s.user_id, s.created_at);
  }
  return { counts, first };
}

export function getActivation(d: V4Data) {
  /**
   * COHORT semantics, not activity.
   *
   * The window selects users ACQUIRED during it, then their scans are counted
   * for all time — including after the window closes. A campaign run Sep 20–22
   * is judged by whether the people it brought in ever activated, which is a
   * question about them, not about those three days. Truncating at the end
   * date would report every campaign as a failure.
   */
  const profiles = d.window.startMs === null
    ? d.base.profiles
    : d.base.profiles.filter(p => inWindow(d.window, p.created_at));
  const { counts, first } = scanStatsAll(d);
  const withAtLeast = (n: number) => profiles.filter(p => (counts.get(p.id) ?? 0) >= n).length;
  const total = profiles.length;

  // Account → first scan, hours. Only users who actually scanned.
  const hours: number[] = [];
  for (const p of profiles) {
    const f = first.get(p.id);
    if (!f) continue;
    const h = (Date.parse(f) - Date.parse(p.created_at)) / 3_600_000;
    if (Number.isFinite(h) && h >= 0) hours.push(h);
  }

  const ids = new Set(profiles.map(p => p.id));
  // Also all-time: a user acquired in the window may finish onboarding later.
  const onboardingDone = new Set(d.allEvents.filter(e => e.event_name === "onboarding_completed" && e.user_id && ids.has(e.user_id)).map(e => e.user_id!)).size;

  return {
    // Sequential lifecycle. Each stage is a superset-free count: "users with
    // N+ scans" is genuinely nested, unlike V3's mixed-event funnel.
    lifecycle: [
      { stage: "Account created",      users: total,                 trust: "EXACT" as Trust },
      { stage: "1+ scans",             users: withAtLeast(1),        trust: "EXACT" as Trust },
      { stage: "2+ scans",             users: withAtLeast(2),        trust: "EXACT" as Trust },
      { stage: "3+ scans",             users: withAtLeast(3),        trust: "EXACT" as Trust },
      { stage: "5+ scans",             users: withAtLeast(5),        trust: "EXACT" as Trust },
      { stage: "10+ scans",            users: withAtLeast(10),       trust: "EXACT" as Trust },
    ],
    // Standalone rather than a ladder stage: the event only exists for users
    // who completed onboarding after it shipped, so it is not a superset of
    // "1+ scans" and would break the nesting the ladder promises.
    onboardingCompleted: exact(onboardingDone, "users with an onboarding_completed event"),
    cohortWindow: d.window.startMs === null ? null : { from: d.window.fromDay, to: d.window.toDay, label: d.window.label },
    semantics: "Acquisition cohort: users who signed up during the selected range. Their scans are counted for all time, including after the range ends.",
    neverScanned: exact(total - withAtLeast(1)),
    activationRate: derived(withAtLeast(1), total, "users with at least one scan"),
    hoursToFirstScanMedian: { value: median(hours), trust: "DERIVED" as Trust, d: hours.length },
    hoursToFirstScanMean:   { value: mean(hours),   trust: "DERIVED" as Trust, d: hours.length },
  };
}

// ── Paywalls ────────────────────────────────────────────────────────────────

const PW_EVENTS = {
  opened: "paywall_opened", plan: "paywall_plan_selected",
  started: "paywall_purchase_started", completed: "paywall_purchase_completed",
  cancelled: "paywall_purchase_cancelled", failed: "paywall_purchase_failed",
  continueFree: "paywall_continue_free", closed: "paywall_closed",
  dismissed: "paywall_dismissed", backgrounded: "app_backgrounded",
} as const;

export interface PaywallRow {
  source: string;
  impressions: number; uniqueViewers: number; impressionsPerViewer: number | null;
  monthlySelected: number; annualSelected: number;
  purchaseStarts: number; purchases: number; cancelled: number; failed: number;
  impressionToPurchase: Metric; startToCompletion: Metric;
  // V4-gated
  continueFree: Metric; closed: Metric; backgroundedActive: Metric;
  avgScansRemainingAtImpression: Metric;
  entitlementAtImpression: { free: number; monthly: number; annual: number; unknown: number } | null;
}

export function getPaywalls(d: V4Data, c: Cutover) {
  const all = d.base.events;
  const post = v4Events(d, c);
  const bySource = (evs: Ev[], name: string, src: string) =>
    evs.filter(e => e.event_name === name && metaStr(e, "paywall_source") === src);

  /**
   * dev_preview is a first-class source in paywallConfig so the dev harness
   * can render any variant, but no production user ever sees it. A row for it
   * would be either empty or founder test noise — excluded from the table.
   */
  const rows: PaywallRow[] = PAYWALL_SOURCES.filter(s => s !== "dev_preview").map(src => {
    const opened = bySource(all, PW_EVENTS.opened, src);
    const viewers = new Set(opened.map(e => e.user_id ?? e.anonymous_id ?? "")).size;
    const plans = bySource(all, PW_EVENTS.plan, src);
    const starts = bySource(all, PW_EVENTS.started, src).length;
    const purchases = bySource(all, PW_EVENTS.completed, src).length;
    const cancelled = bySource(all, PW_EVENTS.cancelled, src).length;
    const failed = bySource(all, PW_EVENTS.failed, src).length;

    // V4-only fields.
    let continueFree = unavailable(), closed = unavailable(), bg = unavailable(), avgRem = unavailable();
    let ent: PaywallRow["entitlementAtImpression"] = null;
    if (c.configured) {
      continueFree = exact(bySource(post, PW_EVENTS.continueFree, src).length);
      closed = exact(bySource(post, PW_EVENTS.closed, src).length);
      bg = exact(post.filter(e => e.event_name === PW_EVENTS.backgrounded && metaStr(e, "active_paywall_source") === src).length);
      const postOpened = bySource(post, PW_EVENTS.opened, src);
      const rem = postOpened.map(e => metaNum(e, "totalUsableScans")).filter((x): x is number => x !== null);
      avgRem = { value: mean(rem), trust: "EXACT", d: rem.length, available: true };
      ent = { free: 0, monthly: 0, annual: 0, unknown: 0 };
      for (const e of postOpened) {
        const s = e.entitlement_state_snapshot as string | null | undefined;
        if (s === "free" || s === "monthly" || s === "annual") ent[s]++; else ent.unknown++;
      }
    }

    return {
      source: src,
      impressions: opened.length, uniqueViewers: viewers,
      impressionsPerViewer: viewers ? opened.length / viewers : null,
      monthlySelected: plans.filter(e => metaStr(e, "selected_plan") === "monthly").length,
      annualSelected:  plans.filter(e => metaStr(e, "selected_plan") === "annual").length,
      purchaseStarts: starts, purchases, cancelled, failed,
      impressionToPurchase: derived(purchases, viewers, "unique viewers who purchased"),
      startToCompletion: derived(purchases, starts),
      continueFree, closed, backgroundedActive: bg, avgScansRemainingAtImpression: avgRem,
      entitlementAtImpression: ent,
    };
  }).sort((a, b) => b.impressions - a.impressions);

  // Repeat exposure: how many paywall impressions each viewer has seen, all sources.
  const perViewer = new Map<string, number>();
  for (const e of all.filter(e => e.event_name === PW_EVENTS.opened)) {
    const k = e.user_id ?? e.anonymous_id ?? "";
    if (!k) continue;
    perViewer.set(k, (perViewer.get(k) ?? 0) + 1);
  }
  const buckets = { "1": 0, "2": 0, "3": 0, "4–5": 0, "6+": 0 };
  for (const n of perViewer.values()) {
    if (n === 1) buckets["1"]++; else if (n === 2) buckets["2"]++; else if (n === 3) buckets["3"]++;
    else if (n <= 5) buckets["4–5"]++; else buckets["6+"]++;
  }

  const anyViewers = new Set(all.filter(e => e.event_name === PW_EVENTS.opened).map(e => e.user_id ?? e.anonymous_id ?? "")).size;
  const viewers7 = new Set(all.filter(e => e.event_name === PW_EVENTS.opened && e.created_at >= iso(ago(d.now, 7))).map(e => e.user_id ?? e.anonymous_id ?? "")).size;
  const purchases7 = all.filter(e => e.event_name === PW_EVENTS.completed && e.created_at >= iso(ago(d.now, 7))).length;

  return {
    rows, repeatExposure: buckets,
    mostShown: rows[0]?.source ?? null,
    totalViewers: exact(anyViewers), viewers7: exact(viewers7), purchases7: exact(purchases7),
    legacyDismissed: exact(all.filter(e => e.event_name === PW_EVENTS.dismissed).length,
      "Legacy overloaded event — continue-free OR close. Never summed with V4 events."),
  };
}

// ── Onboarding offer ────────────────────────────────────────────────────────

export function getOnboardingOffer(d: V4Data, c: Cutover) {
  const src = "onboarding_offer";
  const all = d.base.events.filter(e => metaStr(e, "paywall_source") === src);
  const n = (name: string, evs = all) => evs.filter(e => e.event_name === name).length;
  const shown = n(PW_EVENTS.opened);

  /**
   * Legacy inference. The onboarding offer has NO close control (dismissible:
   * false in paywallConfig), so a pre-cutover paywall_dismissed{resolved:false}
   * on THIS source can only have been Continue Free. That reasoning does not
   * hold for any other paywall and is not applied to them.
   */
  const legacyDismissed = all.filter(e => e.event_name === PW_EVENTS.dismissed && meta(e, "resolved") === false);
  const legacyInferredContinueFree = c.configured
    ? legacyDismissed.filter(e => e.created_at < c.at!).length
    : legacyDismissed.length;

  const post = c.configured ? all.filter(e => e.created_at >= c.at!) : [];
  const postOpened = post.filter(e => e.event_name === PW_EVENTS.opened);
  const postViewers = new Set(postOpened.map(e => e.user_id ?? "").filter(Boolean));
  // "Later activity": any event by that user after their offer impression.
  let laterActivity = 0, noLaterActivity = 0;
  if (c.configured) {
    for (const uid of postViewers) {
      const firstOpen = postOpened.filter(e => e.user_id === uid).map(e => e.created_at).sort()[0];
      const later = d.base.events.some(e => e.user_id === uid && e.created_at > firstOpen && !e.event_name.startsWith("paywall_"));
      if (later) laterActivity++; else noLaterActivity++;
    }
  }

  return {
    legacy: {
      shown: exact(shown), planSelected: exact(n(PW_EVENTS.plan)),
      purchaseStarted: exact(n(PW_EVENTS.started)), purchaseCompleted: exact(n(PW_EVENTS.completed)),
      inferredContinueFree: { value: legacyInferredContinueFree, trust: "LEGACY" as Trust,
        note: "Legacy inference: onboarding_offer has no close control, so a pre-cutover dismiss can only be Continue Free" },
      conversion: derived(n(PW_EVENTS.completed), shown),
    },
    v4: c.configured ? {
      available: true,
      shown: exact(postOpened.length),
      monthlySelected: exact(post.filter(e => e.event_name === PW_EVENTS.plan && metaStr(e, "selected_plan") === "monthly").length),
      annualSelected:  exact(post.filter(e => e.event_name === PW_EVENTS.plan && metaStr(e, "selected_plan") === "annual").length),
      purchaseStarted: exact(n(PW_EVENTS.started, post)), purchaseCompleted: exact(n(PW_EVENTS.completed, post)),
      continueFree: exact(n(PW_EVENTS.continueFree, post)),
      backgroundedActive: exact(v4Events(d, c).filter(e => e.event_name === PW_EVENTS.backgrounded && metaStr(e, "active_paywall_source") === src).length),
      laterActivity: exact(laterActivity), noLaterActivity: exact(noLaterActivity),
      abandonmentDefinition: "Impression with no terminal paywall event (purchase_completed, continue_free) in the same session AND no non-paywall event by that user afterwards. iOS does not report app termination; this is an inference.",
    } : { available: false, note: "Available after Analytics V4 cutover" },
  };
}

// ── Paid user journeys ──────────────────────────────────────────────────────

export interface PaidJourney {
  userId: string; displayName: string | null; email: string | null;
  currentPlan: PlanState; firstPaidProduct: string | null; firstPaidKind: "monthly" | "annual" | "scan_pack" | "unknown";
  packGrantConfirmed: boolean | null;
  firstPurchaseAt: string | null; latestPaidEventAt: string | null;
  firstSeenAt: string | null; accountCreatedAt: string | null; profileCreatedAt: string;
  firstScanAt: string | null; firstPaywallAt: string | null; latestActivityAt: string | null;
  hoursFirstSeenToPay: number | null; hoursAccountToPay: number | null;
  hoursFirstScanToPay: number | null; hoursFirstPaywallToPay: number | null;
  scansBeforePay: number; sessionsBeforePay: number; activeDaysBeforePay: number;
  paywallImpressionsBeforePay: number; uniquePaywallSourcesBeforePay: number;
  firstPaywallSource: string | null; lastPaywallBeforePay: string | null; convertingPaywall: string | null;
  scanStoreVisitsBeforePay: number;
  huntEventsBeforePay: number; listingsBeforePay: number;
  sameSession: boolean;
}

/** Every user with any confirmed purchase, with the full pre-purchase story. */
export function getPaidJourneys(d: V4Data) {
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.base.events) { if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e); }
  for (const l of evsByUser.values()) l.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const scansByUser = new Map<string, string[]>();
  for (const s of d.scans) { if (s.user_id) (scansByUser.get(s.user_id) ?? scansByUser.set(s.user_id, []).get(s.user_id)!).push(s.created_at); }
  for (const l of scansByUser.values()) l.sort();

  const isPaid = (e: Ev) => e.event_name === PW_EVENTS.completed || e.event_name === "scan_pack_purchase_completed";

  const journeys: PaidJourney[] = [];
  for (const p of d.base.profiles) {
    const evs = evsByUser.get(p.id) ?? [];
    const paidEvents = evs.filter(isPaid);
    // A user can also be paying with no completed-event history (pre-analytics
    // or webhook-only). Their plan still counts; the timeline is just thinner.
    const plan = currentPlan(d, p.id);
    const subEvent = paidEvents.some(e => e.event_name === PW_EVENTS.completed);
    const holdsPacks = (d.usage.get(p.id)?.pack_scan_balance ?? 0) > 0;
    // Paying = a server-confirmed subscription event, OR a current plan, OR a
    // pack balance. An Apple-approved pack event alone is not enough — the
    // server may have refused it (sandbox / environment mismatch).
    if (!subEvent && plan === "free" && !holdsPacks) continue;

    const first = paidEvents[0] ?? null;
    const firstAt = first?.created_at ?? null;
    // "Before" is inclusive of the purchase instant but never the paid event
    // itself: the paywall that opened and the purchase_started that preceded a
    // completion often share its second, and a strict `<` dropped the
    // converting paywall from the purchaser's own history.
    const before = (ev: Ev) => !!firstAt && ev !== first && ev.created_at <= firstAt && !isPaid(ev);

    const prePaywalls = evs.filter(e => e.event_name === PW_EVENTS.opened && before(e));
    const preStart = [...evs].reverse().find(e => e.event_name === PW_EVENTS.started && before(e));
    // Direct attribution: the completed event carries its own source. The last
    // purchase_started before it must agree, or it is UNKNOWN rather than guessed.
    const completedSrc = first ? metaStr(first, "paywall_source") : null;
    const startSrc = preStart ? metaStr(preStart, "paywall_source") : null;
    const converting = first?.event_name === "scan_pack_purchase_completed" ? "scan_store"
      : (completedSrc && (!startSrc || startSrc === completedSrc)) ? completedSrc : null;

    const firstSeen = evs[0]?.created_at ?? null;
    const scans = scansByUser.get(p.id) ?? [];
    const scansBefore = firstAt ? scans.filter(s => s < firstAt) : scans;
    const preEvs = firstAt ? evs.filter(before) : evs;
    const packGranted = (d.usage.get(p.id)?.pack_scan_balance ?? 0) > 0;
    const kind = !first ? (plan === "free" ? "scan_pack" : plan)
      : first.event_name === "scan_pack_purchase_completed" ? "scan_pack"
      : (metaStr(first, "selected_plan") as "monthly" | "annual" | null) ?? "unknown";

    const h = (a: string | null, b: string | null) => (a && b) ? (Date.parse(b) - Date.parse(a)) / 3_600_000 : null;
    const auth = d.auth.get(p.id);
    const prof = d.profiles.get(p.id);

    journeys.push({
      userId: p.id, displayName: prof?.display_name ?? prof?.username ?? null, email: auth?.email ?? null,
      currentPlan: plan, firstPaidProduct: first ? (metaStr(first, "product_id") ?? metaStr(first, "selected_plan")) : d.usage.get(p.id)?.subscription_product_id ?? null,
      firstPaidKind: kind,
      // Only meaningful for pack purchases: did the server actually grant?
      packGrantConfirmed: kind === "scan_pack" ? packGranted : null,
      firstPurchaseAt: firstAt, latestPaidEventAt: paidEvents.at(-1)?.created_at ?? null,
      firstSeenAt: firstSeen, accountCreatedAt: auth?.created_at ?? null, profileCreatedAt: p.created_at,
      firstScanAt: scans[0] ?? null, firstPaywallAt: evs.find(e => e.event_name === PW_EVENTS.opened)?.created_at ?? null,
      latestActivityAt: evs.at(-1)?.created_at ?? null,
      hoursFirstSeenToPay: h(firstSeen, firstAt), hoursAccountToPay: h(auth?.created_at ?? p.created_at, firstAt),
      hoursFirstScanToPay: h(scans[0] ?? null, firstAt), hoursFirstPaywallToPay: h(prePaywalls[0]?.created_at ?? null, firstAt),
      scansBeforePay: scansBefore.length,
      sessionsBeforePay: new Set(preEvs.map(e => e.session_id).filter(Boolean)).size,
      activeDaysBeforePay: new Set(preEvs.map(e => dayOf(e.created_at))).size,
      paywallImpressionsBeforePay: prePaywalls.length,
      uniquePaywallSourcesBeforePay: new Set(prePaywalls.map(e => metaStr(e, "paywall_source")).filter(Boolean)).size,
      firstPaywallSource: prePaywalls[0] ? metaStr(prePaywalls[0], "paywall_source") : null,
      lastPaywallBeforePay: prePaywalls.at(-1) ? metaStr(prePaywalls.at(-1)!, "paywall_source") : null,
      convertingPaywall: converting,
      scanStoreVisitsBeforePay: preEvs.filter(e => e.event_name === "scan_store_opened").length,
      huntEventsBeforePay: preEvs.filter(e => e.event_name.startsWith("hunt_")).length,
      listingsBeforePay: preEvs.filter(e => e.event_name === "listing_generated").length,
      sameSession: !!first && !!first.session_id && evs.some(e => e.session_id === first.session_id && e.event_name === PW_EVENTS.opened),
    });
  }
  journeys.sort((a, b) => (b.firstPurchaseAt ?? "") < (a.firstPurchaseAt ?? "") ? -1 : 1);

  // Aggregates over users with a KNOWN first-purchase timestamp.
  const timed = journeys.filter(j => j.hoursAccountToPay !== null);
  const hrs = timed.map(j => j.hoursAccountToPay!);
  /**
   * Time-to-pay buckets, mutually exclusive by construction: each purchase is
   * placed by its first matching predicate in order. "Same session" wins over
   * "same day" so nothing is counted twice.
   */
  const buckets = { "same session": 0, "same day": 0, "<24h": 0, "1–3 days": 0, "4–7 days": 0, "8–14 days": 0, "15+ days": 0 };
  for (const j of timed) {
    const h = j.hoursAccountToPay!;
    if (j.sameSession) buckets["same session"]++;
    else if (j.accountCreatedAt && j.firstPurchaseAt && dayOf(j.accountCreatedAt) === dayOf(j.firstPurchaseAt)) buckets["same day"]++;
    else if (h < 24) buckets["<24h"]++;
    else if (h < 72) buckets["1–3 days"]++;
    else if (h < 168) buckets["4–7 days"]++;
    else if (h < 336) buckets["8–14 days"]++;
    else buckets["15+ days"]++;
  }
  const scanBuckets = { "0": 0, "1–2": 0, "3–5": 0, "6–10": 0, "11–14": 0, "15": 0, "16+": 0 };
  for (const j of timed) {
    const n = j.scansBeforePay;
    if (n === 0) scanBuckets["0"]++; else if (n <= 2) scanBuckets["1–2"]++; else if (n <= 5) scanBuckets["3–5"]++;
    else if (n <= 10) scanBuckets["6–10"]++; else if (n <= 14) scanBuckets["11–14"]++; else if (n === 15) scanBuckets["15"]++; else scanBuckets["16+"]++;
  }
  const byConverting = new Map<string, number>();
  for (const j of journeys) { const k = j.convertingPaywall ?? "UNKNOWN"; byConverting.set(k, (byConverting.get(k) ?? 0) + 1); }

  return {
    journeys,
    payingUsers: exact(journeys.length),
    withKnownPurchaseTime: exact(timed.length, "purchasers with a confirmed purchase event; others are known only from current plan"),
    hoursToPay: { mean: mean(hrs), median: median(hrs), fastest: hrs.length ? Math.min(...hrs) : null, slowest: hrs.length ? Math.max(...hrs) : null, d: hrs.length },
    scansBeforePay: { mean: mean(timed.map(j => j.scansBeforePay)), median: median(timed.map(j => j.scansBeforePay)), d: timed.length },
    sessionsBeforePay: { mean: mean(timed.map(j => j.sessionsBeforePay)), d: timed.length },
    paywallsBeforePay: { mean: mean(timed.map(j => j.paywallImpressionsBeforePay)), d: timed.length },
    timeBuckets: buckets, scanBuckets,
    byConvertingPaywall: [...byConverting.entries()].map(([source, purchases]) => ({ source, purchases })).sort((a, b) => b.purchases - a.purchases),
    smallSample: timed.length < SMALL_SAMPLE,
  };
}

// ── Monetization overview ───────────────────────────────────────────────────

export function getMonetization(d: V4Data, paywalls: ReturnType<typeof getPaywalls>, journeys: ReturnType<typeof getPaidJourneys>) {
  const plans = { free: 0, monthly: 0, annual: 0 };
  for (const p of d.base.profiles) plans[currentPlan(d, p.id)]++;
  /**
   * Two different facts, kept apart on purpose.
   *
   * scan_pack_purchase_completed fires when APPLE approves the purchase
   * (status 'success' OR 'sync_pending') — it does not wait for the server
   * grant the way paywall_purchase_completed does. A sandbox purchase the
   * server then rejects still emits it. So it is "Apple-approved attempts",
   * not buyers.
   *
   * Users actually HOLDING pack scans comes from the ledger. It undercounts
   * historical buyers (balances drain to zero) but it never counts a purchase
   * that was refused.
   */
  const packApproved = new Set(d.base.events.filter(e => e.event_name === "scan_pack_purchase_completed" && e.user_id).map(e => e.user_id!)).size;
  const packHolders = [...d.usage.values()].filter(u => (u.pack_scan_balance ?? 0) > 0).length;
  const sum = (k: keyof PaywallRow) => paywalls.rows.reduce((a, r) => a + (r[k] as number), 0);
  const all = d.base.events;
  return {
    currentFree: exact(plans.free), currentMonthly: exact(plans.monthly), currentAnnual: exact(plans.annual),
    totalPaying: exact(plans.monthly + plans.annual),
    scanPackApproved: exact(packApproved, "Apple-approved pack purchases (client event; includes sandbox and server-rejected)"),
    scanPackHolders: exact(packHolders, "users with pack_scan_balance > 0 in the ledger — the only server-confirmed signal"),
    paywallViewers: paywalls.totalViewers,
    purchaseStarts: exact(sum("purchaseStarts")), purchaseCompletions: exact(sum("purchases")),
    purchaseCancellations: exact(sum("cancelled")), purchaseFailures: exact(sum("failed")),
    viewToPurchase: derived(sum("purchases"), paywalls.totalViewers.value ?? 0, "unique paywall viewers who purchased"),
    monthlyPurchases: exact(all.filter(e => e.event_name === PW_EVENTS.completed && metaStr(e, "selected_plan") === "monthly").length),
    annualPurchases:  exact(all.filter(e => e.event_name === PW_EVENTS.completed && metaStr(e, "selected_plan") === "annual").length),
    scanPackPurchases: exact(all.filter(e => e.event_name === "scan_pack_purchase_completed").length, "Apple-approved, not server-granted"),
    planSelection: { monthly: sum("monthlySelected"), annual: sum("annualSelected") },
    revenue: unavailable("Exact revenue requires RevenueCat transaction amounts, which are not stored server-side. Purchase counts are exact."),
    mrr: unavailable("MRR requires live RevenueCat data — not sourced server-side."),
    firstTimePurchasers: journeys.payingUsers,
  };
}

// ── Scan Store ──────────────────────────────────────────────────────────────

export function getScanStore(d: V4Data, c: Cutover) {
  const all = d.base.events;
  const post = v4Events(d, c);
  const opens = all.filter(e => e.event_name === "scan_store_opened");
  const visitors = new Map<string, number>();
  for (const e of opens) { const k = e.user_id ?? e.anonymous_id ?? ""; if (k) visitors.set(k, (visitors.get(k) ?? 0) + 1); }
  const starts = all.filter(e => e.event_name === "scan_pack_purchase_started");
  const completed = all.filter(e => e.event_name === "scan_pack_purchase_completed");
  const cancelled = all.filter(e => e.event_name === "scan_pack_purchase_cancelled");
  const failed = all.filter(e => e.event_name === "scan_pack_purchase_failed");
  const buyers = new Set(completed.map(e => e.user_id ?? "").filter(Boolean));

  const entryMode = new Map<string, number>();
  for (const e of opens) { const m = metaStr(e, "entry_mode") ?? "unknown"; entryMode.set(m, (entryMode.get(m) ?? 0) + 1); }

  const skus = SCAN_PACKS.map(pk => {
    const by = (evs: Ev[]) => evs.filter(e => metaStr(e, "product_id") === pk.sku).length;
    return { sku: pk.sku, name: pk.name, scans: pk.scans,
      attempts: by(starts), purchases: by(completed), cancels: by(cancelled), failures: by(failed),
      conversion: derived(by(completed), by(starts)) };
  });

  // First visit → first purchase, hours, per buyer.
  const firstVisit = new Map<string, string>(); for (const e of opens) { const k = e.user_id ?? ""; if (k && (!firstVisit.has(k) || e.created_at < firstVisit.get(k)!)) firstVisit.set(k, e.created_at); }
  const firstBuy = new Map<string, string>(); for (const e of completed) { const k = e.user_id ?? ""; if (k && (!firstBuy.has(k) || e.created_at < firstBuy.get(k)!)) firstBuy.set(k, e.created_at); }
  const hrs: number[] = []; for (const [k, b] of firstBuy) { const v = firstVisit.get(k); if (v) hrs.push((Date.parse(b) - Date.parse(v)) / 3_600_000); }

  let v4: any = { available: false, note: "Available after Analytics V4 cutover" };
  if (c.configured) {
    const pOpens = post.filter(e => e.event_name === "scan_store_opened");
    const src = new Map<string, number>(); for (const e of pOpens) { const s = metaStr(e, "entry_source") ?? "unknown"; src.set(s, (src.get(s) ?? 0) + 1); }
    const ent = { free: 0, monthly: 0, annual: 0, unknown: 0 };
    let atZero = 0, aboveZero = 0; const bal: number[] = [];
    for (const e of pOpens) {
      const s = e.entitlement_state_snapshot as string | null | undefined;
      if (s === "free" || s === "monthly" || s === "annual") ent[s]++; else ent.unknown++;
      const t = metaNum(e, "totalUsableScans"); if (t !== null) { bal.push(t); if (t <= 0) atZero++; else aboveZero++; }
    }
    const pStarts = post.filter(e => e.event_name === "scan_pack_purchase_started");
    const remAtAttempt = pStarts.map(e => metaNum(e, "totalUsableScans")).filter((x): x is number => x !== null);
    v4 = { available: true, entrySource: [...src.entries()].map(([source, opens]) => ({ source, opens })).sort((a, b) => b.opens - a.opens),
      entitlement: ent, atZero: exact(atZero), aboveZero: exact(aboveZero),
      avgBalanceAtOpen: { value: mean(bal), trust: "EXACT", d: bal.length },
      avgRemainingAtAttempt: { value: mean(remAtAttempt), trust: "EXACT", d: remAtAttempt.length } };
  }

  return {
    opens: exact(opens.length), uniqueVisitors: exact(visitors.size),
    repeatVisitors: exact([...visitors.values()].filter(n => n > 1).length),
    opensPerVisitor: { value: visitors.size ? opens.length / visitors.size : null, trust: "DERIVED" as Trust },
    entryMode: [...entryMode.entries()].map(([mode, opens]) => ({ mode, opens })),
    funnel: [
      { stage: "Store opened (unique)", users: visitors.size },
      { stage: "Purchase attempted", users: new Set(starts.map(e => e.user_id ?? e.anonymous_id ?? "")).size },
      { stage: "Purchase completed", users: buyers.size },
    ],
    outcomes: { completed: completed.length, cancelled: cancelled.length, failed: failed.length },
    visitorToBuyer: derived(buyers.size, visitors.size),
    skus,
    hoursFirstVisitToPurchase: { mean: mean(hrs), median: median(hrs), d: hrs.length },
    revenue: unavailable("Pack prices come from RevenueCat/App Store at runtime and are not stored server-side. Counts are exact."),
    v4, smallSample: visitors.size < SMALL_SAMPLE,
  };
}

// ── Cohorts (CURRENT plan) + Free behaviour ─────────────────────────────────

export function getCohorts(d: V4Data) {
  const { counts } = scanStats(d);
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.base.events) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e);
  const scans7 = new Map<string, number>(), scans30 = new Map<string, number>();
  const t7 = iso(ago(d.now, 7)), t30 = iso(ago(d.now, 30));
  for (const s of d.scans) { if (!s.user_id) continue; if (s.created_at >= t7) scans7.set(s.user_id, (scans7.get(s.user_id) ?? 0) + 1); if (s.created_at >= t30) scans30.set(s.user_id, (scans30.get(s.user_id) ?? 0) + 1); }

  const build = (plan: PlanState) => {
    const users = d.base.profiles.filter(p => currentPlan(d, p.id) === plan);
    const ids = users.map(u => u.id);
    const lifetime = ids.map(id => counts.get(id) ?? 0);
    const active = (days: number) => ids.filter(id => (evsByUser.get(id) ?? []).some(e => e.created_at >= iso(ago(d.now, days)))).length;
    const sessions = ids.map(id => new Set((evsByUser.get(id) ?? []).map(e => e.session_id).filter(Boolean)).size);
    const activeDays = ids.map(id => new Set((evsByUser.get(id) ?? []).map(e => dayOf(e.created_at))).size);
    const listings = ids.reduce((a, id) => a + (evsByUser.get(id) ?? []).filter(e => e.event_name === "listing_generated").length, 0);
    const hunt = ids.filter(id => (evsByUser.get(id) ?? []).some(e => e.event_name.startsWith("hunt_"))).length;
    const ageDays = users.map(u => (d.now.getTime() - Date.parse(u.created_at)) / DAY);

    // Allowance consumption from the CURRENT subscription period — never lifetime.
    let allowance: any = null;
    if (plan !== "free") {
      const used = ids.map(id => d.usage.get(id)?.subscription_scans_used ?? 0);
      const limit = plan === "monthly" ? 300 : 4000;
      allowance = { limit, meanUsed: mean(used), medianUsed: median(used), meanPct: mean(used.map(u => u / limit)), d: used.length,
        note: `subscription_scans_used in the current period ÷ ${limit}` };
    }
    return {
      plan, users: exact(ids.length), activeToday: exact(active(1)), active7: exact(active(7)), active30: exact(active(30)),
      lifetimeScansMean: mean(lifetime), lifetimeScansMedian: median(lifetime),
      scans7PerUser: ids.length ? ids.reduce((a, id) => a + (scans7.get(id) ?? 0), 0) / ids.length : null,
      scans30PerUser: ids.length ? ids.reduce((a, id) => a + (scans30.get(id) ?? 0), 0) / ids.length : null,
      sessionsPerUser: mean(sessions), activeDaysPerUser: mean(activeDays),
      listings, huntUsers: hunt, accountAgeDaysMean: mean(ageDays), allowance,
      classificationNote: "CURRENT plan. Historical events are not re-attributed to today's plan; event-time analysis uses V4 snapshots post-cutover.",
    };
  };
  return { free: build("free"), monthly: build("monthly"), annual: build("annual") };
}

export function getFreeBehaviour(d: V4Data) {
  const { counts, first } = scanStats(d);
  const free = d.base.profiles.filter(p => currentPlan(d, p.id) === "free");
  const lifetime = free.map(p => counts.get(p.id) ?? 0);
  const b = { "0": 0, "1": 0, "2–5": 0, "6–10": 0, "11–14": 0, "15+": 0 };
  for (const n of lifetime) { if (n === 0) b["0"]++; else if (n === 1) b["1"]++; else if (n <= 5) b["2–5"]++; else if (n <= 10) b["6–10"]++; else if (n <= 14) b["11–14"]++; else b["15+"]++; }
  const evsByUser = new Map<string, Set<string>>();
  for (const e of d.base.events) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, new Set()).get(e.user_id)!).add(dayOf(e.created_at));
  const activeDays = free.map(p => evsByUser.get(p.id)?.size ?? 0);
  const hrsToFirst = free.map(p => first.get(p.id)).filter((f): f is string => !!f).map((f, i) => (Date.parse(f) - Date.parse(free[i].created_at)) / 3_600_000).filter(h => Number.isFinite(h) && h >= 0);
  // "Exhausted": free_scans_used >= 15 from account_usage, the ledger's own field.
  const exhausted = free.filter(p => (d.usage.get(p.id)?.free_scans_used ?? 0) >= 15).length;
  return {
    users: exact(free.length), buckets: b,
    lifetimeMean: mean(lifetime), lifetimeMedian: median(lifetime),
    activeDaysMean: mean(activeDays), activeDaysMedian: median(activeDays),
    hoursToFirstScanMedian: { value: median(hrsToFirst), d: hrsToFirst.length },
    neverScanned: exact(b["0"]),
    exhausted: { value: exhausted, trust: "EXACT" as Trust, note: "free_scans_used ≥ 15 in account_usage (current state)" },
    exhaustedRate: derived(exhausted, free.length),
    /** Share of free users reaching each depth — the pricing question. */
    everScanned:  derived(free.length - b["0"], free.length),
    reached3Plus: derived(lifetime.filter(n => n >= 3).length, free.length),
    reached5Plus: derived(lifetime.filter(n => n >= 5).length, free.length),
    reached10Plus: derived(lifetime.filter(n => n >= 10).length, free.length),
    balanceHistoryNote: "Historical free-scan balance is not stored; only the current ledger state is known. Post-cutover, balances are captured on each paywall impression.",
  };
}

// ── Retention (anchored on first ACTIVITY) ──────────────────────────────────

export function getRetentionV2(d: V4Data) {
  /**
   * Anchor: the user's first analytics event, NOT profiles.created_at. A user
   * who signs up and first opens the app three days later is day-0 on that
   * third day. UTC calendar days throughout. Returned on day N = any event on
   * UTC day (anchor + N). Eligible for DN only if the anchor is ≥ N+1 days
   * old, so the window has actually elapsed.
   */
  /**
   * COHORT semantics. The window selects users whose FIRST activity fell
   * inside it; their return events are then read from the unwindowed set, so
   * D7 can be observed even when a three-day range is selected. Filtering
   * returns to the window would make long windows the only measurable ones.
   */
  const firstDay = new Map<string, string>(), days = new Map<string, Set<string>>();
  for (const e of d.allEvents) {
    if (!e.user_id) continue;
    const day = dayOf(e.created_at);
    const f = firstDay.get(e.user_id); if (!f || day < f) firstDay.set(e.user_id, day);
    (days.get(e.user_id) ?? days.set(e.user_id, new Set()).get(e.user_id)!).add(day);
  }
  // Restrict the COHORT (not the returns) to users who first appeared in range.
  if (d.window.startMs !== null) {
    for (const [uid, f] of [...firstDay]) {
      /**
       * The EARLIEST event, not the first in array order. `find()` returns
       * whatever the query happened to return first, which silently excluded
       * users whose earliest event sat later in the array.
       */
      let earliest: string | null = null;
      for (const e of d.allEvents) {
        if (e.user_id !== uid) continue;
        if (!earliest || e.created_at < earliest) earliest = e.created_at;
      }
      if (!earliest || !inWindow(d.window, earliest)) { firstDay.delete(uid); days.delete(uid); }
    }
  }
  const today = dayOf(iso(d.now));
  // DST-safe: Central days are not all 24h, so stepping by milliseconds from
  // a UTC midnight would drift by an hour twice a year and mis-bucket a return.
  const addDays = (day: string, n: number) => addCentralDays(day, n) ?? day;
  const calc = (n: number) => {
    let eligible = 0, returned = 0;
    for (const [uid, f] of firstDay) {
      if (addDays(f, n + 1) > today) continue;
      eligible++;
      if (days.get(uid)!.has(addDays(f, n))) returned++;
    }
    return { ...derived(returned, eligible), smallSample: eligible < SMALL_SAMPLE };
  };
  return {
    anchor: "first analytics event (Central calendar day)",
    timezone: DASHBOARD_TZ_LABEL,
    cohortWindow: d.window.startMs === null ? null : { from: d.window.fromDay, to: d.window.toDay, label: d.window.label },
    semantics: "Retention cohort: users first active during the selected range. Follow-up activity extends beyond the range end.",
    d1: calc(1), d3: calc(3), d7: calc(7), d14: calc(14), d30: calc(30), cohortUsers: firstDay.size,
  };
}

// ── Sessions, feature usage, data quality ───────────────────────────────────

export function getSessionsV2(d: V4Data) {
  const all = d.base.events;
  const started = all.filter(e => e.event_name === "app_session_started");
  const sessions7 = new Set(started.filter(e => e.created_at >= iso(ago(d.now, 7))).map(e => e.session_id)).size;
  const users7 = new Set(started.filter(e => e.created_at >= iso(ago(d.now, 7)) && e.user_id).map(e => e.user_id)).size;
  return {
    sessionsToday: exact(new Set(started.filter(e => dayOf(e.created_at) === dayOf(iso(d.now))).map(e => e.session_id)).size),
    sessions7: exact(sessions7), sessionsPerUser7: derived(sessions7, users7),
    durationNote: { trust: "LEGACY" as Trust, note: "Session duration is hidden: app_session_ended.durationMs includes background time (endSession fires on the NEXT foreground after 30 min), so historical values are inflated by hours. Not shown as a KPI until the client redefines a session." },
  };
}

export function getFeatureUsage(d: V4Data) {
  const all = d.base.events;
  const count = (name: string) => all.filter(e => e.event_name === name).length;
  const users = (pred: (e: Ev) => boolean) => new Set(all.filter(e => pred(e) && e.user_id).map(e => e.user_id!)).size;
  const pw = (src: string) => all.filter(e => e.event_name === PW_EVENTS.opened && metaStr(e, "paywall_source") === src).length;
  return [
    { feature: "Generate Listings", accessed: null, paywallTriggered: pw("generate_listings"), completed: count("listing_generated"), completedUsers: users(e => e.event_name === "listing_generated"), note: "completed = listing_generated events" },
    { feature: "Deep Analysis", accessed: null, paywallTriggered: pw("deep_analysis"), completed: null, completedUsers: null, note: "Only the paywall is tracked. Completion is NOT TRACKED." },
    { feature: "Hunt Mode", accessed: count("hunt_mode_opened") || null, paywallTriggered: null, completed: count("hunt_ended"), completedUsers: users(e => e.event_name.startsWith("hunt_")), note: "accessed = hunt_mode_opened; completed = hunt_ended" },
    { feature: "Progress tab", accessed: count("progress_opened") || null, paywallTriggered: null, completed: null, completedUsers: users(e => e.event_name.startsWith("progress_") || e.event_name.startsWith("brand_") || e.event_name.startsWith("diamond_")), note: "accessed only" },
    { feature: "Scan saved", accessed: null, paywallTriggered: null, completed: count("scan_saved") || null, completedUsers: users(e => e.event_name === "scan_saved"), note: "from scan_saved events where present" },
  ];
}

export function getDataQualityV4(d: V4Data, c: Cutover, totalProfilesAllTime?: number) {
  const all = d.base.events;
  const post = v4Events(d, c);
  const snap = (e: Ev) => e.entitlement_state_snapshot as string | null | undefined;
  const withSnap = post.filter(e => snap(e) != null);
  const inScope = d.base.profiles.length;
  // Defensive: every real V4Data carries these, but the section must degrade
  // rather than throw if it is ever handed a partial object.
  const cohort = d.cohort ?? { scope: "all" as Scope, at: null, source: "default" as const, assumed: false, label: "All time" };
  const preLaunch = d.preLaunchProfiles ?? 0;
  const allTime = totalProfilesAllTime ?? (inScope + preLaunch);
  return {
    /**
     * Scope facts. Deliberately separate from the cutover block below —
     * GLOBAL_LAUNCH_AT selects WHICH USERS are counted; ANALYTICS_V4_CUTOVER_AT
     * selects WHICH FIELDS are trustworthy. Conflating them would make a
     * pre-launch user look like missing instrumentation, or vice versa.
     */
    /** Part 29 debug block: verify the filters are doing what they claim. */
    window: {
      preset: d.window?.preset ?? "all",
      label: d.window?.label ?? "All available",
      from: d.window?.fromDay ?? null,
      to: d.window?.toDay ?? null,
      timezone: d.window?.timezone ?? DASHBOARD_TZ,
      timezoneLabel: d.window?.timezoneLabel ?? DASHBOARD_TZ_LABEL,
      warning: d.window?.warning ?? null,
      eligibleUsers: exact(inScope, "users passing the scope filter"),
      eventsInWindow: exact(d.base.events.length, "events inside the activity window"),
      eventsAllTime: exact((d.allEvents ?? d.base.events).length),
      scansInWindow: exact(d.scans.length, "scans inside the activity window"),
      scansAllTime: exact((d.allScans ?? d.scans).length),
    },
    scope: {
      scope: cohort.scope,
      launchAt: cohort.at,
      source: cohort.source,
      assumed: cohort.assumed,
      postLaunchProfiles: exact(inScope),
      preLaunchProfiles: exact(preLaunch),
      postLaunchShare: derived(inScope, allTime, "share of all profiles acquired since launch"),
      anonymousExcluded: exact(d.anonymousExcluded ?? 0, "pre-auth events with no user_id — cannot be cohort-attributed, so excluded from post-launch analytics"),
      scanPackWarning: "Historical Scan Pack purchase events include test activity. No genuine scan-pack sale has occurred; purchase counts are not monetization evidence.",
      note: "GLOBAL_LAUNCH_AT defines the acquisition cohort. ANALYTICS_V4_CUTOVER_AT defines instrumentation trust. They are independent.",
    },
    totalEvents: exact(all.length),
    authenticated: exact(all.filter(e => e.user_id).length), anonymous: exact(all.filter(e => !e.user_id).length),
    missingSession: exact(all.filter(e => !e.session_id).length),
    latestEvent: all.length ? all.reduce((a, e) => e.created_at > a ? e.created_at : a, all[0].created_at) : null,
    cutover: c,
    postCutoverEvents: c.configured ? exact(post.length) : unavailable(),
    snapshotCoverage: c.configured ? derived(withSnap.length, post.length, "post-cutover events carrying an entitlement snapshot") : unavailable(),
    unknownSnapshotPct: c.configured ? derived(withSnap.filter(e => snap(e) === "unknown").length, withSnap.length) : unavailable(),
    legacyDismissed: exact(all.filter(e => e.event_name === PW_EVENTS.dismissed).length),
    continueFreePost: c.configured ? exact(post.filter(e => e.event_name === PW_EVENTS.continueFree).length) : unavailable(),
    closedPost: c.configured ? exact(post.filter(e => e.event_name === PW_EVENTS.closed).length) : unavailable(),
    scanCompletedPost: c.configured ? exact(post.filter(e => e.event_name === "scan_completed").length) : unavailable(),
    scanCompletedLegacy: { value: all.filter(e => e.event_name === "scan_completed" && (!c.at || e.created_at < c.at)).length, trust: "LEGACY" as Trust, note: "Pre-cutover scan_completed had no emitter — expect 0. Scans table is authoritative historically." },
    anomalies: [
      ...(all.some(e => e.event_name === PW_EVENTS.completed && !e.user_id) ? ["purchase_completed rows with no user_id"] : []),
      ...(c.configured && post.length > 0 && withSnap.length === 0 ? ["Cutover configured but no events carry a snapshot — client build may not be live"] : []),
    ],
    revenueCatHistoryNote: "RevenueCat webhook events are stored via claim_revenuecat_event/finish_revenuecat_event, but the table name and timestamp columns are defined only in Supabase, not in this repo. Subscription renewal/cancellation history is therefore not reconstructed here. Current plan comes from account_usage.",
  };
}

// ── Cost (carried from V3, relabelled) ──────────────────────────────────────

export function getUnitEconomics(d: V4Data, v3Cost: any) {
  const active30 = new Set(d.base.events.filter(e => e.user_id && e.created_at >= iso(ago(d.now, 30))).map(e => e.user_id!)).size;
  const scans30 = d.scans.filter(s => s.created_at >= iso(ago(d.now, 30))).length;
  const spend = typeof v3Cost?.estimatedSpend === "number" ? v3Cost.estimatedSpend : (typeof v3Cost?.totalEstimatedUsd === "number" ? v3Cost.totalEstimatedUsd : null);
  return {
    estimatedSpend: { value: spend, trust: "ESTIMATED" as Trust, note: "from V3 cost model" },
    costPerScan: { value: spend !== null && d.scans.length ? spend / d.scans.length : null, trust: "ESTIMATED" as Trust, d: d.scans.length },
    costPerUser: { value: spend !== null && d.base.profiles.length ? spend / d.base.profiles.length : null, trust: "ESTIMATED" as Trust, d: d.base.profiles.length },
    costPerActiveUser30: { value: spend !== null && active30 ? spend / active30 : null, trust: "ESTIMATED" as Trust, d: active30 },
    scans30: exact(scans30),
    marginNote: "Contribution margin not calculated: Apple proceeds and exact revenue are not available server-side.",
    v3: v3Cost,
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function getFounderDashboardV4Metrics(
  v3Metrics: any,
  scope: Scope = "post_launch",
  env: NodeJS.ProcessEnv = process.env,
  rangeParams: { preset?: unknown; from?: unknown; to?: unknown } = {},
) {
  const cutover = getCutover(env);
  const cohort = getLaunchCohort(scope, env);
  const window = resolveAnalysisWindow(rangeParams, scope, new Date(), env);
  let d: V4Data;
  try { d = await loadV4Data(undefined, scope, env, window); }
  catch (e: any) { return { ...v3Metrics, v4: null, v4Error: e?.message ?? "failed to load V4 data", cutover, cohort, window }; }

  const safe = <T,>(name: string, fn: () => T): T | { error: string } => { try { return fn(); } catch (e: any) { return { error: `${name}: ${e?.message ?? e}` }; } };
  const paywalls = safe("paywalls", () => getPaywalls(d, cutover));
  const journeys = safe("paidJourneys", () => getPaidJourneys(d));
  return {
    ...v3Metrics,
    cutover, cohort, window,
    acquisition: safe("acquisition", () => getAcquisition(d)),
    activation:  safe("activation", () => getActivation(d)),
    paywalls, paidJourneys: journeys,
    monetization: safe("monetization", () => getMonetization(d, paywalls as any, journeys as any)),
    onboardingOffer: safe("onboardingOffer", () => getOnboardingOffer(d, cutover)),
    scanStore:   safe("scanStore", () => getScanStore(d, cutover)),
    cohorts:     safe("cohorts", () => getCohorts(d)),
    freeBehaviour: safe("freeBehaviour", () => getFreeBehaviour(d)),
    retentionV2: safe("retentionV2", () => getRetentionV2(d)),
    sessionsV2:  safe("sessionsV2", () => getSessionsV2(d)),
    featureUsage: safe("featureUsage", () => getFeatureUsage(d)),
    unitEconomics: safe("unitEconomics", () => getUnitEconomics(d, v3Metrics?.cost)),
    dataQualityV4: safe("dataQualityV4", () => getDataQualityV4(d, cutover)),
    preLaunchProfiles: d.preLaunchProfiles,
  };
}