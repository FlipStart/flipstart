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
import { loadBaseData, fetchAll, countRows, type BaseData } from "./founderMetrics";
import { getPricingEras, getAppleFeeRate, eraAt, currentEra, eraPrice, ERA_NOTES, type PricingEra } from "./pricingEras";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { derivePlan, type AccountUsage, type PlanState,
  FREE_LIFETIME_SCANS, MONTHLY_SCANS, ANNUAL_SCANS } from "./monetization/policy";
import { PAYWALL_SOURCES } from "../lib/paywallConfig";
import { SCAN_PACKS } from "../lib/scanPackCatalog";
import {
  DASHBOARD_TZ, DASHBOARD_TZ_LABEL, centralDay, centralToday, centralRangeUtc,
  addCentralDays, centralDaysBetween, formatDayLabel,
} from "./dashboardDates";

/**
 * PARTIAL  — some of the underlying data is missing, so the figure is a floor.
 * CONFLICT — two sources that should agree, don't.
 * Neither is ever used for a figure whose joins are complete; EXACT is never
 * used for one whose joins are not.
 */
export type Trust = "EXACT" | "DERIVED" | "ESTIMATED" | "NOT_TRACKED" | "LEGACY" | "PARTIAL" | "CONFLICT";

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

/**
 * Device linking.
 *
 * Every analytics row carries the device's anonymous_id — including rows
 * written while signed in. So an event written while signed OUT can be
 * attributed to an account when that device has only ever signed in as ONE
 * account. A device used by several accounts (a founder's test phone) is
 * ambiguous: its signed-out events are never attributed, and every account on
 * it is flagged so its journeys are marked PARTIAL rather than presented as
 * complete.
 *
 * Linked events are kept apart from each user's own events. Nothing in the
 * metric sections reads them; they appear in the Explorer timeline (tagged)
 * and in integrity checks, where "linked by device" is stated, not assumed.
 */
export interface DeviceLink {
  /** Signed-out events attributable to exactly one account, by user. */
  byUser: Map<string, Ev[]>;
  /** Users who share a device with at least one other account. */
  sharedDeviceUsers: Set<string>;
  sharedDevices: Array<{ anonymousId: string; users: string[] }>;
  anonymousEvents: number;
  linkedEvents: number;
  ambiguousEvents: number;
  unlinkableEvents: number;
}

export function buildDeviceLink(events: Ev[]): DeviceLink {
  const usersByDevice = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.user_id || !e.anonymous_id) continue;
    (usersByDevice.get(e.anonymous_id) ?? usersByDevice.set(e.anonymous_id, new Set()).get(e.anonymous_id)!).add(e.user_id);
  }
  const sharedDeviceUsers = new Set<string>();
  const sharedDevices: DeviceLink["sharedDevices"] = [];
  for (const [anon, users] of usersByDevice) {
    if (users.size > 1) {
      sharedDevices.push({ anonymousId: anon, users: [...users].sort() });
      for (const u of users) sharedDeviceUsers.add(u);
    }
  }
  const byUser = new Map<string, Ev[]>();
  let anonymousEvents = 0, linkedEvents = 0, ambiguousEvents = 0, unlinkableEvents = 0;
  for (const e of events) {
    if (e.user_id) continue;
    anonymousEvents++;
    const users = e.anonymous_id ? usersByDevice.get(e.anonymous_id) : undefined;
    if (!users || users.size === 0) { unlinkableEvents++; continue; }
    if (users.size > 1) { ambiguousEvents++; continue; }
    const [uid] = users;
    (byUser.get(uid) ?? byUser.set(uid, []).get(uid)!).push(e);
    linkedEvents++;
  }
  for (const l of byUser.values()) l.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  return { byUser, sharedDeviceUsers, sharedDevices, anonymousEvents, linkedEvents, ambiguousEvents, unlinkableEvents };
}

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
  /**
   * SAVED items — rows in the `scans` table, which is the user's collection
   * (it has item_name, thrift_price, sold_price and a status lifecycle), not a
   * log of scans performed. Kept for save-rate and Data Quality only; nothing
   * that claims to count scans reads this.
   */
  allSaved: ScanRow[];
  /** scan_completed events with no user_id: real scans, attributable to nobody. */
  anonymousScans: number;
  /** Every analytics row the loader returned, before any scope or window. */
  eventsLoaded: number;
  /**
   * Unfiltered sets, for the two features that must see past the scope:
   * the User Explorer (any user, whole history) and integrity checks that
   * prove nothing excluded leaked in. Every metric section ignores these.
   */
  rawEvents: Ev[];
  rawUsage: Map<string, UsageRow>;
  rawSaved: ScanRow[];
  allProfileRows: ProfileRow[];
  internalIds?: Set<string>;
  link: DeviceLink;
  /** Exact database count, for the loader-integrity check. Undefined = unverified. */
  eventsInDatabase?: number;
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
  const [savedRows, usageRows, authUsers, profileRows] = await Promise.all([
    fetchAll<ScanRow>("scans", "user_id, created_at"),   // saved items — see V4Data.allSaved
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
  /**
   * SCANS come from scan_completed events — one per successful analysis,
   * timestamped, with the user attached.
   *
   * This previously read the `scans` table, which holds SAVED items. Anyone
   * who scanned, hit a paywall and paid before saving anything showed 0 scans
   * before paying — including people converted by generate_listings and
   * deep_analysis, which cannot be reached without scanning. Checked against
   * production before this change: every such converter has 1+ completed
   * scans before paying on this source, and 0 on the old one for three of
   * the four.
   *
   * Derived from the events already loaded: no extra query, and the cohort
   * filter (which runs on `events` above) applies automatically.
   */
  const cohortScans: ScanRow[] = events
    .filter(e => e.event_name === "scan_completed" && !!e.user_id)
    .map(e => ({ user_id: e.user_id, created_at: e.created_at }));
  const anonymousScans = b.events.filter(e => e.event_name === "scan_completed" && !e.user_id).length;
  const cohortSaved = savedRows.filter(sc => !!sc.user_id && keep.has(sc.user_id));
  const windowedEvents = events.filter(e => inWindow(window, e.created_at));
  const windowedScans = cohortScans.filter(sc => inWindow(window, sc.created_at));

  return {
    window, allEvents: events, allScans: cohortScans, allSaved: cohortSaved, anonymousScans,
    eventsLoaded: b.events.length, eventsInDatabase: b.eventsInDatabase,
    rawEvents: b.events,
    rawUsage: new Map(usageRows.map(u => [u.user_id, u])),
    rawSaved: savedRows,
    allProfileRows: profileRows,
    internalIds: b.internalIds,
    link: buildDeviceLink(b.events),
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
  const w = d.window;

  /**
   * New users INSIDE the selected window — the number this section exists to
   * answer, and the one that was missing.
   *
   * Acquisition is the one section where the window applies to PROFILES
   * rather than to events: "how many users did I gain between these dates" is
   * a question about signups, not activity. loadV4Data deliberately leaves
   * profiles unwindowed because every other section needs the whole cohort,
   * so the filter belongs here.
   *
   * The fixed 7d/30d cards stay alongside, explicitly labelled, so current
   * momentum is still visible while a historical range is selected.
   */
  const inRange = w.startMs === null
    ? profiles
    : profiles.filter(p => inWindow(w, p.created_at));

  const newSince = (days: number) => profiles.filter(p => p.created_at >= iso(ago(now, days))).length;
  const todayDay = dayOf(iso(now));
  const activeToday = new Set(
    d.allEvents.filter(e => e.user_id && dayOf(e.created_at) === todayDay).map(e => e.user_id!),
  ).size;
  const activeSince = (days: number) => new Set(
    d.allEvents.filter(e => e.user_id && e.created_at >= iso(ago(now, days))).map(e => e.user_id!),
  ).size;

  /**
   * The trend spans the SELECTED window, not a fixed 30 days. An unbounded
   * window falls back to the last 30 days, because an all-time daily chart is
   * unreadable and would grow without limit.
   */
  const days: string[] = [];
  if (w.fromDay && w.toDay) {
    let cursor: string | null = w.fromDay;
    // Hard stop at 370 so a multi-year custom range cannot build a huge array.
    for (let guard = 0; cursor && cursor <= w.toDay && guard < 370; guard++) {
      days.push(cursor);
      cursor = addCentralDays(cursor, 1);
    }
  } else {
    for (let i = 29; i >= 0; i--) days.push(dayOf(iso(ago(now, i))));
  }

  const newByDay = new Map(days.map(x => [x, 0]));
  const activeByDay = new Map(days.map(x => [x, new Set<string>()]));
  for (const p of profiles) { const k = dayOf(p.created_at); if (newByDay.has(k)) newByDay.set(k, newByDay.get(k)! + 1); }
  for (const e of d.base.events) {
    if (!e.user_id) continue;
    const k = dayOf(e.created_at);
    activeByDay.get(k)?.add(e.user_id);
  }

  /**
   * Peak signup day and the per-day average, over the window's days.
   *
   * The average divides by the number of DAYS IN THE WINDOW, not by the days
   * that happen to have signups — otherwise a week with one busy day and six
   * empty ones would report that busy day's figure as its average.
   */
  let peakDay: string | null = null, peakCount = 0;
  for (const day of days) {
    const n = newByDay.get(day) ?? 0;
    if (n > peakCount) { peakCount = n; peakDay = day; }
  }
  const windowDays = w.fromDay && w.toDay ? centralDaysBetween(w.fromDay, w.toDay) : days.length;

  // Cumulative growth across the charted days.
  let cum = 0;
  const sorted = [...profiles].sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const cumulative = days.map(day => {
    while (cum < sorted.length && dayOf(sorted[cum].created_at) <= day) cum++;
    return { day, users: cum };
  });

  return {
    totalUsers: exact(profiles.length),

    // ── The selected window ──────────────────────────────────────────────
    newInRange: exact(inRange.length, w.startMs === null
      ? "all available" : `signups between ${w.fromDay} and ${w.toDay}`),
    rangeLabel: w.label,
    rangeDays: windowDays,
    signupsPerDay: { value: windowDays > 0 ? inRange.length / windowDays : null, trust: "DERIVED" as Trust, d: windowDays },
    peakSignupDay: peakDay,
    peakSignupCount: exact(peakCount),
    /** How many of the eligible cohort signed up during the window. */
    shareOfCohort: derived(inRange.length, profiles.length, "of all users in scope"),

    // ── Fixed windows, independent of the selection ──────────────────────
    newToday: exact(profiles.filter(p => dayOf(p.created_at) === dayOf(iso(now))).length),
    new7: exact(newSince(7)), new30: exact(newSince(30)),
    /**
     * "Today" means the Central calendar day, as it does for "New today"
     * beside it. activeSince(1) is a rolling 24 hours — at 9am that counts
     * last night's users as "today", which put two definitions of the same
     * word in one grid. 7d and 30d stay rolling, and are labelled as such.
     */
    dau: exact(activeToday), wau: exact(activeSince(7)), mau: exact(activeSince(30)),
    dauMau: derived(activeToday, activeSince(30)),

    /**
     * Scan volume from scan_completed. The Executive "Scans 7d" card read a
     * V3 field (scans7 / last7) that V3 never returned, so it was always "—".
     */
    scansToday: exact(d.allScans.filter(sc => dayOf(sc.created_at) === todayDay).length),
    scans7: exact(d.allScans.filter(sc => sc.created_at >= iso(ago(now, 7))).length),
    scans30: exact(d.allScans.filter(sc => sc.created_at >= iso(ago(now, 30))).length),
    scansInRange: exact(d.scans.length, "scan_completed inside the selected window"),

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
  /**
   * How far this row can be trusted, and why. See journeyQuality().
   *   EXACT    — every join complete
   *   PARTIAL  — some underlying data missing; counts are floors
   *   INFERRED — key facts come from current state, not events
   *   CONFLICT — sources disagree (e.g. a scan-only paywall with no scan)
   */
  quality: "EXACT" | "PARTIAL" | "INFERRED" | "CONFLICT";
  qualityReasons: string[];
  /** Signed-out scans on this user's device before paying. Not in scansBeforePay. */
  linkedScansBeforePay: number;
}

/**
 * Paywalls that can only be reached AFTER a scan: Generate Listings and Deep
 * Analysis sit on a scan's results, and the scan limit appears only once the
 * allowance is used. A purchase converted on one of these with no scan
 * recorded before it is a contradiction between sources, not a quirk.
 */
export const SCAN_REQUIRED_PAYWALLS = new Set(["generate_listings", "deep_analysis", "scan_limit"]);

export interface JourneyInput {
  userId: string;
  profileCreatedAt: string;
  evs: Ev[];               // this user's own events, ascending, full history
  scans: string[];         // scan_completed timestamps, ascending
  saved: string[];         // saved-item timestamps, ascending
  linked: Ev[];            // device-linked signed-out events
  sharedDevice: boolean;
  plan: PlanState;
  usage?: UsageRow;
  auth?: AuthUser;
  prof?: ProfileRow;
}

const isPaidEvent = (e: Ev) => e.event_name === "paywall_purchase_completed" || e.event_name === "scan_pack_purchase_completed";

/**
 * One user's journey to payment — the single definition shared by Paid User
 * Journeys and the User Explorer, so "converting paywall" or "scans before
 * pay" can never mean two different things on the same page.
 *
 * Returns null for someone who is not a payer.
 */
export function buildJourney(x: JourneyInput): PaidJourney | null {
  const { evs } = x;
  const paidEvents = evs.filter(isPaidEvent);
  const subEvent = paidEvents.some(e => e.event_name === "paywall_purchase_completed");
  const holdsPacks = (x.usage?.pack_scan_balance ?? 0) > 0;
  // Paying = a server-confirmed subscription event, OR a current plan, OR a
  // pack balance. An Apple-approved pack event alone is not enough — the
  // server may have refused it (sandbox / environment mismatch).
  if (!subEvent && x.plan === "free" && !holdsPacks) return null;

  const first = paidEvents[0] ?? null;
  const firstAt = first?.created_at ?? null;
  // "Before" is inclusive of the purchase instant but never the paid event
  // itself: the paywall that opened and the purchase_started that preceded a
  // completion often share its second, and a strict `<` dropped the
  // converting paywall from the purchaser's own history.
  const before = (ev: Ev) => !!firstAt && ev !== first && ev.created_at <= firstAt && !isPaidEvent(ev);

  const prePaywalls = evs.filter(e => e.event_name === "paywall_opened" && before(e));
  const preStart = [...evs].reverse().find(e => e.event_name === "paywall_purchase_started" && before(e));
  // Direct attribution: the completed event carries its own source. The last
  // purchase_started before it must agree, or it is UNKNOWN rather than guessed.
  const completedSrc = first ? metaStr(first, "paywall_source") : null;
  const startSrc = preStart ? metaStr(preStart, "paywall_source") : null;
  const converting = first?.event_name === "scan_pack_purchase_completed" ? "scan_store"
    : (completedSrc && (!startSrc || startSrc === completedSrc)) ? completedSrc : null;

  const firstSeen = evs[0]?.created_at ?? null;
  const scansBefore = firstAt ? x.scans.filter(t => t < firstAt) : x.scans;
  const preEvs = firstAt ? evs.filter(before) : evs;
  const kind = !first ? (x.plan === "free" ? "scan_pack" : x.plan)
    : first.event_name === "scan_pack_purchase_completed" ? "scan_pack"
    : (metaStr(first, "selected_plan") as "monthly" | "annual" | null) ?? "unknown";
  const h = (a: string | null, b: string | null) => (a && b) ? (Date.parse(b) - Date.parse(a)) / 3_600_000 : null;
  const linkedScansBeforePay = x.linked.filter(e => e.event_name === "scan_completed" && (!firstAt || e.created_at < firstAt)).length;
  const savedBeforePay = firstAt ? x.saved.filter(t => t < firstAt).length : x.saved.length;

  const j: PaidJourney = {
    userId: x.userId, displayName: x.prof?.display_name ?? x.prof?.username ?? null, email: x.auth?.email ?? null,
    currentPlan: x.plan, firstPaidProduct: first ? (metaStr(first, "product_id") ?? metaStr(first, "selected_plan")) : x.usage?.subscription_product_id ?? null,
    firstPaidKind: kind,
    // Only meaningful for pack purchases: did the server actually grant?
    packGrantConfirmed: kind === "scan_pack" ? holdsPacks : null,
    firstPurchaseAt: firstAt, latestPaidEventAt: paidEvents.at(-1)?.created_at ?? null,
    firstSeenAt: firstSeen, accountCreatedAt: x.auth?.created_at ?? null, profileCreatedAt: x.profileCreatedAt,
    firstScanAt: x.scans[0] ?? null, firstPaywallAt: evs.find(e => e.event_name === "paywall_opened")?.created_at ?? null,
    latestActivityAt: evs.at(-1)?.created_at ?? null,
    hoursFirstSeenToPay: h(firstSeen, firstAt), hoursAccountToPay: h(x.auth?.created_at ?? x.profileCreatedAt, firstAt),
    hoursFirstScanToPay: h(x.scans[0] ?? null, firstAt), hoursFirstPaywallToPay: h(prePaywalls[0]?.created_at ?? null, firstAt),
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
    sameSession: !!first && !!first.session_id && evs.some(e => e.session_id === first.session_id && e.event_name === "paywall_opened"),
    quality: "EXACT", qualityReasons: [], linkedScansBeforePay,
  };
  const q = journeyQuality(j, {
    hasPurchaseEvent: !!first,
    restored: evs.some(e => e.event_name === "paywall_restore_completed"),
    savedBeforePay, sharedDevice: x.sharedDevice,
    // null or "" = written without a version. undefined = the column was not
    // loaded at all, which is not the same thing and is not counted.
    missingVersion: evs.filter(e => e.app_version === null || e.app_version === "").length,
  });
  j.quality = q.quality; j.qualityReasons = q.reasons;
  return j;
}

/**
 * Worst finding wins: CONFLICT > INFERRED > PARTIAL > EXACT. Every reason is
 * kept, so the badge's tooltip says exactly what is wrong.
 */
export function journeyQuality(j: PaidJourney, ctx: {
  hasPurchaseEvent: boolean; restored: boolean; savedBeforePay: number;
  sharedDevice: boolean; missingVersion: number;
}): { quality: PaidJourney["quality"]; reasons: string[] } {
  const conflict: string[] = [], inferred: string[] = [], partial: string[] = [];
  const scanless = j.scansBeforePay === 0 && j.linkedScansBeforePay === 0;
  if (j.convertingPaywall && SCAN_REQUIRED_PAYWALLS.has(j.convertingPaywall) && scanless) {
    if (ctx.savedBeforePay > 0) {
      partial.push(`Converted on ${j.convertingPaywall}, which needs a scan; no scan event is recorded, but ${ctx.savedBeforePay} saved item(s) exist — the scan likely predates analytics.`);
    } else {
      conflict.push(`Converted on ${j.convertingPaywall}, which can only be reached after a scan, but no scan is recorded before payment.`);
    }
  }
  if (!ctx.hasPurchaseEvent) {
    inferred.push(ctx.restored
      ? "No purchase event — the plan appears to come from a restore. Timing and paywall unknown."
      : "No purchase event — known from the current plan only. Timing and converting paywall unknown.");
  } else if (!j.convertingPaywall) {
    inferred.push("The purchase and the preceding purchase start name different paywalls, so the converting paywall is unknown.");
  }
  if (ctx.sharedDevice) partial.push("This account shares a device with another account, so signed-out activity on it cannot be attributed.");
  if (j.linkedScansBeforePay > 0) partial.push(`${j.linkedScansBeforePay} signed-out scan(s) on this device before payment are linked by device and not counted in Scans.`);
  if (ctx.missingVersion > 0) partial.push(`${ctx.missingVersion} event(s) have no app version.`);
  const quality = conflict.length ? "CONFLICT" : inferred.length ? "INFERRED" : partial.length ? "PARTIAL" : "EXACT";
  return { quality, reasons: [...conflict, ...inferred, ...partial] };
}

/** Every user with any confirmed purchase, with the full pre-purchase story. */
export function getPaidJourneys(d: V4Data) {
  /**
   * The range picks WHICH conversions are shown; it never limits how far back
   * each one's story goes.
   *
   * History is therefore built from the UNWINDOWED, cohort-filtered events and
   * scans. Building it from the windowed set (as this did before) cut every
   * journey off at the range start: scans before pay, paywalls seen, sessions
   * and the first paywall all silently lost whatever happened earlier.
   */
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.allEvents) { if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e); }
  for (const l of evsByUser.values()) l.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const scansByUser = new Map<string, string[]>();
  for (const s of d.allScans) { if (s.user_id) (scansByUser.get(s.user_id) ?? scansByUser.set(s.user_id, []).get(s.user_id)!).push(s.created_at); }
  for (const l of scansByUser.values()) l.sort();
  const bounded = d.window.startMs !== null;

  const savedByUser = new Map<string, string[]>();
  for (const sv of d.allSaved ?? []) { if (sv.user_id) (savedByUser.get(sv.user_id) ?? savedByUser.set(sv.user_id, []).get(sv.user_id)!).push(sv.created_at); }
  for (const l of savedByUser.values()) l.sort();

  const journeys: PaidJourney[] = [];
  for (const p of d.base.profiles) {
    const j = buildJourney({
      userId: p.id, profileCreatedAt: p.created_at,
      evs: evsByUser.get(p.id) ?? [], scans: scansByUser.get(p.id) ?? [], saved: savedByUser.get(p.id) ?? [],
      linked: d.link?.byUser.get(p.id) ?? [], sharedDevice: d.link?.sharedDeviceUsers.has(p.id) ?? false,
      plan: currentPlan(d, p.id), usage: d.usage.get(p.id), auth: d.auth.get(p.id), prof: d.profiles.get(p.id),
    });
    if (!j) continue;
    /**
     * Selection by FIRST purchase date.
     *
     * In a bounded range, a row appears only if this user's first purchase
     * falls inside it. Users who bought earlier are current subscribers, not
     * conversions in this period. A payer with no purchase event at all cannot
     * be dated, so they appear only when the range is unbounded.
     */
    if (bounded && (!j.firstPurchaseAt || !inWindow(d.window, j.firstPurchaseAt))) continue;
    journeys.push(j);
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
  /**
   * Current-plan cohorts describe users AS THEY ARE NOW: lifetime totals plus
   * fixed today / 7d / 30d windows measured from the present. All of that
   * must read the full timeline. Reading the date-windowed set (as before)
   * made "active 7d" zero whenever a past range was selected, and labelled a
   * week's scans as a lifetime total. Range-based cohort activity is a
   * separate, explicitly-labelled metric, not a side effect of these.
   */
  const { counts } = scanStatsAll(d);
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.allEvents) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e);
  const scans7 = new Map<string, number>(), scans30 = new Map<string, number>();
  const t7 = iso(ago(d.now, 7)), t30 = iso(ago(d.now, 30));
  for (const s of d.allScans) { if (!s.user_id) continue; if (s.created_at >= t7) scans7.set(s.user_id, (scans7.get(s.user_id) ?? 0) + 1); if (s.created_at >= t30) scans30.set(s.user_id, (scans30.get(s.user_id) ?? 0) + 1); }

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

/**
 * Activity, speed to first scan, and delayed activation for current Free
 * users.
 *
 * Every timed window counts only users old enough for it to have passed —
 * someone who signed up an hour ago is not a "no" for "first scan within 7
 * days". Day 0 is the signup's Central calendar day.
 */
function freeTiming(d: V4Data, free: Array<{ id: string; created_at: string }>, first: Map<string, string>) {
  const now = d.now.getTime();
  const today = dayOf(iso(d.now));
  const active = (days: number) => {
    const since = iso(ago(d.now, days));
    const ids = new Set(d.allEvents.filter(e => e.user_id && e.created_at >= since).map(e => e.user_id!));
    return free.filter(p => ids.has(p.id)).length;
  };
  const within = (ms: number, label: string) => {
    let eligible = 0, hit = 0;
    for (const p of free) {
      const start = Date.parse(p.created_at);
      if (!Number.isFinite(start) || start + ms > now) continue;
      eligible++;
      const f = first.get(p.id);
      if (f && Date.parse(f) - start <= ms && Date.parse(f) >= start) hit++;
    }
    return derived(hit, eligible, label);
  };
  let sameDayEligible = 0, sameDay = 0, missedDay0 = 0, delayed = 0;
  for (const p of free) {
    const signupDay = dayOf(p.created_at);
    if (signupDay >= today) continue;                       // day 0 not over yet
    sameDayEligible++;
    const f = first.get(p.id);
    if (f && dayOf(f) === signupDay) { sameDay++; continue; }
    missedDay0++;
    if (f && dayOf(f) > signupDay) delayed++;
  }
  return {
    active7: exact(active(7)), active30: exact(active(30)),
    firstScanWithin10m: within(10 * 60_000, "first scan within 10 minutes of signup"),
    firstScanSameDay: derived(sameDay, sameDayEligible, "first scan on the signup day (Central)"),
    firstScanWithin24h: within(DAY, "first scan within 24 hours"),
    firstScanWithin7d: within(7 * DAY, "first scan within 7 days"),
    /**
     * "Never activated" and "activated late" look identical on day 0. Of the
     * users who did not scan on their signup day, how many came back and did.
     */
    delayedActivation: derived(delayed, missedDay0, "did not scan on day 0, scanned later"),
    stillNotActivated: exact(missedDay0 - delayed, "did not scan on day 0, and still have not"),
  };
}

export function getFreeBehaviour(d: V4Data) {
  /**
   * LIFETIME, so all of the cohort's scans — never the date window. These
   * cards describe where current Free users stand overall ("how many free
   * scans do people actually use"); restricting them to a week would label a
   * week's count as a lifetime one.
   */
  const { counts, first } = scanStatsAll(d);
  const free = d.base.profiles.filter(p => currentPlan(d, p.id) === "free");
  const lifetime = free.map(p => counts.get(p.id) ?? 0);
  const b = { "0": 0, "1": 0, "2–5": 0, "6–10": 0, "11–14": 0, "15+": 0 };
  for (const n of lifetime) { if (n === 0) b["0"]++; else if (n === 1) b["1"]++; else if (n <= 5) b["2–5"]++; else if (n <= 10) b["6–10"]++; else if (n <= 14) b["11–14"]++; else b["15+"]++; }
  const evsByUser = new Map<string, Set<string>>();
  for (const e of d.allEvents) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, new Set()).get(e.user_id)!).add(dayOf(e.created_at));
  const activeDays = free.map(p => evsByUser.get(p.id)?.size ?? 0);
  /**
   * Pair each user's first scan with THAT user's signup.
   *
   * The previous version filtered out users who never scanned and then
   * indexed back into the unfiltered list, so after the first gap every scan
   * was matched to someone else's signup date and the median was meaningless.
   */
  const hrsToFirst: number[] = [];
  for (const p of free) {
    const f = first.get(p.id);
    if (!f) continue;
    const h = (Date.parse(f) - Date.parse(p.created_at)) / 3_600_000;
    if (Number.isFinite(h) && h >= 0) hrsToFirst.push(h);
  }
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
    reached2Plus: derived(lifetime.filter(n => n >= 2).length, free.length),
    lifetimeP75: percentile(lifetime, 0.75), lifetimeP90: percentile(lifetime, 0.9),
    lifetimeMax: lifetime.length ? Math.max(...lifetime) : null,
    ...freeTiming(d, free, first),
    balanceHistoryNote: "Historical free-scan balance is not stored; only the current ledger state is known. Post-cutover, balances are captured on each paywall impression.",
  };
}

// ── Retention (anchored on first ACTIVITY) ──────────────────────────────────

/**
 * The retention cohort, built in ONE pass: each user's anchor (first active
 * Central day), every day they were active, and their earliest event — which
 * the date-range filter needs. The earliest event used to be found by
 * rescanning every event for every user, which grows quadratically.
 */
function retentionBase(d: V4Data) {
  const firstDay = new Map<string, string>(), days = new Map<string, Set<string>>(), earliest = new Map<string, string>();
  for (const e of d.allEvents) {
    if (!e.user_id) continue;
    const day = dayOf(e.created_at);
    const f = firstDay.get(e.user_id); if (!f || day < f) firstDay.set(e.user_id, day);
    (days.get(e.user_id) ?? days.set(e.user_id, new Set()).get(e.user_id)!).add(day);
    const x = earliest.get(e.user_id); if (!x || e.created_at < x) earliest.set(e.user_id, e.created_at);
  }
  // Restrict the COHORT (not the returns) to users who first appeared in range.
  if (d.window.startMs !== null) {
    for (const uid of [...firstDay.keys()]) {
      const x = earliest.get(uid);
      if (!x || !inWindow(d.window, x)) { firstDay.delete(uid); days.delete(uid); }
    }
  }
  return { firstDay, days, today: dayOf(iso(d.now)) };
}

/** Day-N retention over a cohort, optionally narrowed to a segment. */
function retentionCalc(b: ReturnType<typeof retentionBase>, n: number, include: (uid: string) => boolean = () => true) {
  // DST-safe: Central days are not all 24h, so stepping by milliseconds from
  // a UTC midnight would drift by an hour twice a year and mis-bucket a return.
  const addDays = (day: string, k: number) => addCentralDays(day, k) ?? day;
  let eligible = 0, returned = 0;
  for (const [uid, f] of b.firstDay) {
    if (!include(uid)) continue;
    if (addDays(f, n + 1) > b.today) continue;
    eligible++;
    if (b.days.get(uid)!.has(addDays(f, n))) returned++;
  }
  return { ...derived(returned, eligible), smallSample: eligible < SMALL_SAMPLE };
}

export function getRetentionV2(d: V4Data) {
  /**
   * COHORT semantics. The window selects users whose FIRST activity fell
   * inside it; their return events are then read from the unwindowed set, so
   * D7 can be observed even when a three-day range is selected.
   */
  const b = retentionBase(d);
  const calc = (n: number) => retentionCalc(b, n);
  return {
    anchor: "first analytics event (Central calendar day)",
    timezone: DASHBOARD_TZ_LABEL,
    cohortWindow: d.window.startMs === null ? null : { from: d.window.fromDay, to: d.window.toDay, label: d.window.label },
    semantics: "Retention cohort: users first active during the selected range. Follow-up activity extends beyond the range end.",
    d1: calc(1), d3: calc(3), d7: calc(7), d14: calc(14), d30: calc(30), cohortUsers: b.firstDay.size,
  };
}

/**
 * Retention by segment — with every segment defined by FIRST-DAY behaviour.
 *
 * Segmenting by lifetime totals would be circular: coming back is how people
 * pile up scans and decide to pay, so "users with 5+ scans retain better"
 * would be true by construction and say nothing. Asking what someone did on
 * their first day, then whether they returned, is a real question.
 */
export function getRetentionSegments(d: V4Data) {
  const b = retentionBase(d);
  const day0Scans = new Map<string, number>(), paidDay0 = new Set<string>();
  for (const e of d.allEvents) {
    if (!e.user_id) continue;
    const f = b.firstDay.get(e.user_id); if (!f) continue;
    const day = dayOf(e.created_at);
    if (e.event_name === "scan_completed" && day === f) day0Scans.set(e.user_id, (day0Scans.get(e.user_id) ?? 0) + 1);
    if (e.event_name === "paywall_purchase_completed" && day <= f) paidDay0.add(e.user_id);
  }
  const scans0 = (u: string) => day0Scans.get(u) ?? 0;
  const segments: Array<{ key: string; label: string; include: (u: string) => boolean }> = [
    { key: "all", label: "Everyone", include: () => true },
    { key: "scanned0", label: "Scanned on day 0", include: u => scans0(u) >= 1 },
    { key: "noscan0", label: "No scan on day 0", include: u => scans0(u) === 0 },
    { key: "scans3", label: "3+ scans on day 0", include: u => scans0(u) >= 3 },
    { key: "scans5", label: "5+ scans on day 0", include: u => scans0(u) >= 5 },
    { key: "paid0", label: "Paid by end of day 0", include: u => paidDay0.has(u) },
    { key: "free0", label: "Not paid by end of day 0", include: u => !paidDay0.has(u) },
  ];
  return {
    rows: segments.map(sg => ({
      key: sg.key, label: sg.label,
      users: [...b.firstDay.keys()].filter(sg.include).length,
      d1: retentionCalc(b, 1, sg.include), d3: retentionCalc(b, 3, sg.include), d7: retentionCalc(b, 7, sg.include),
      d14: retentionCalc(b, 14, sg.include), d30: retentionCalc(b, 30, sg.include),
    })),
    note: "Segments use first-day behaviour only. Segmenting by lifetime totals would be circular — returning is how people accumulate scans and purchases.",
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
    { feature: "Progress tab", accessed: count("progress_tab_opened") || null, paywallTriggered: null, completed: null, completedUsers: users(e => e.event_name.startsWith("progress_") || e.event_name.startsWith("brand_") || e.event_name.startsWith("diamond_")), note: "accessed only" },
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
      scansInWindow: exact(d.scans.length, "scan_completed inside the activity window"),
      scansAllTime: exact((d.allScans ?? d.scans).length),
    },
    /**
     * Where the scan numbers come from, and the gaps that remain. Scans are
     * scan_completed events; saved items are rows in the `scans` table, which
     * the dashboard counted as scans until this was corrected.
     */
    scanSources: {
      scansCompleted: exact((d.allScans ?? []).length, "scan_completed events, users in scope — the scan count"),
      savedItems: exact((d.allSaved ?? []).length, "rows in the scans table — the user's saved collection, NOT scans performed"),
      saveRate: derived((d.allSaved ?? []).length, (d.allScans ?? []).length, "saved items per completed scan"),
      anonymousScans: exact(d.anonymousScans ?? 0, "scan_completed with no user_id — real scans, attributable to no one, excluded from per-user metrics"),
    },
    /**
     * Loader integrity, checked on every page load. If the rows loaded differ
     * from the exact count in the database, the loader skipped or duplicated
     * rows and every event-based number on this page is suspect.
     */
    loader: loaderIntegrity(d.eventsLoaded, d.eventsInDatabase),
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
      ...(() => { const l = loaderIntegrity(d.eventsLoaded, d.eventsInDatabase);
                  return l.status === "duplicated" || l.status === "skipped" ? [`Loader integrity: ${l.note}`] : []; })(),
      ...(all.some(e => e.event_name === PW_EVENTS.completed && !e.user_id) ? ["purchase_completed rows with no user_id"] : []),
      ...(c.configured && post.length > 0 && withSnap.length === 0 ? ["Cutover configured but no events carry a snapshot — client build may not be live"] : []),
    ],
    revenueCatHistoryNote: "RevenueCat webhook events are stored via claim_revenuecat_event/finish_revenuecat_event, but the table name and timestamp columns are defined only in Supabase, not in this repo. Subscription renewal/cancellation history is therefore not reconstructed here. Current plan comes from account_usage.",
  };
}

// ── Cost (carried from V3, relabelled) ──────────────────────────────────────

export function getUnitEconomics(d: V4Data, v3Cost: any) {
  /**
   * Spend in the SELECTED RANGE, for the users in SCOPE, estimated from their
   * own activity at V3's published per-action rates.
   *
   * This read `v3Cost.estimatedSpend` / `totalEstimatedUsd` — fields V3 has
   * never returned (it returns cost30 / cost7 / costToday) — so the card was
   * always blank. Computing it here instead of renaming the read also means
   * it follows the scope and the dates like everything around it; V3's own
   * figure covers every user regardless of selection and stays visible below
   * as the platform-wide view.
   *
   * Rates come from V3 (which reads the ESTIMATED_*_COST_USD env vars), so the
   * two can never disagree about what a scan costs. No rates, no estimate —
   * never a guessed default.
   */
  const rates = v3Cost && !isErrLike(v3Cost) ? v3Cost.rates : null;
  const rate = (k: string) => (rates && typeof rates[k] === "number" ? rates[k] : null);
  const NORMAL = rate("NORMAL"), HUNT = rate("HUNT"), LISTING = rate("LISTING");

  const evs = d.base.events;                       // windowed + cohort
  const count = (name: string) => evs.filter(e => e.event_name === name).length;
  const scansInRange = d.scans.length;             // scan_completed, windowed
  const huntInRange = count("hunt_scan_started");
  const listingsInRange = count("listing_generated");
  const spend = NORMAL !== null && HUNT !== null && LISTING !== null
    ? scansInRange * NORMAL + huntInRange * HUNT + listingsInRange * LISTING
    : null;
  const activeInRange = new Set(evs.filter(e => e.user_id).map(e => e.user_id!)).size;
  const scans30 = d.allScans.filter(s => s.created_at >= iso(ago(d.now, 30))).length;

  return {
    estimatedSpend: { value: spend, trust: "ESTIMATED" as Trust,
      note: spend === null ? "cost rates unavailable" : "in range, users in scope" },
    costPerScan: { value: spend !== null && scansInRange ? spend / scansInRange : null, trust: "ESTIMATED" as Trust, d: scansInRange },
    costPerUser: { value: spend !== null && d.base.profiles.length ? spend / d.base.profiles.length : null, trust: "ESTIMATED" as Trust, d: d.base.profiles.length },
    costPerActiveUser: { value: spend !== null && activeInRange ? spend / activeInRange : null, trust: "ESTIMATED" as Trust, d: activeInRange },
    scansInRange: exact(scansInRange),
    scans30: exact(scans30),
    marginNote: "Contribution margin not calculated: Apple proceeds and exact revenue are not available server-side.",
    v3: v3Cost,
  };
}

/**
 * Rows loaded vs rows in the database.
 *
 * The count is taken AFTER the load, and the app writes events continuously,
 * so the database may be a few rows ahead of what was loaded — that is new
 * activity, not loss. Anything beyond that is flagged:
 *   loaded > database      → rows were DUPLICATED (impossible otherwise)
 *   database ahead by > 5  → rows were SKIPPED
 */
export const LOADER_TOLERANCE = 5;
export function loaderIntegrity(loaded: number | undefined, inDb: number | undefined) {
  if (loaded === undefined || inDb === undefined) {
    return { loaded: exact(loaded ?? null), inDatabase: { value: null, trust: "NOT_TRACKED" as Trust, available: false, note: "count query failed — unverified" },
             status: "unverified" as const, note: "Could not verify: the exact-count query failed." };
  }
  const gap = inDb - loaded;
  const status = loaded > inDb ? "duplicated" as const : gap > LOADER_TOLERANCE ? "skipped" as const : "ok" as const;
  const note = status === "ok"
    ? (gap === 0 ? "Every row loaded." : `${gap} row(s) written during the load — new activity, not loss.`)
    : status === "duplicated"
      ? `${loaded - inDb} more row(s) loaded than exist — rows were counted twice.`
      : `${gap} row(s) missing from the load — rows were skipped.`;
  return { loaded: exact(loaded), inDatabase: exact(inDb), gap, status, note };
}

const isErrLike = (x: any) => !!x && typeof x === "object" && typeof x.error === "string";

// ── First-session funnel ────────────────────────────────────────────────────

/** Event names the app will emit for the two untracked funnel steps. */
export const HOME_EVENT = "home_viewed";
export const CAMERA_EVENT = "camera_opened";

export interface FunnelStage {
  key: string; label: string;
  /** Users (or devices) who reached this stage — directly, or implied by a later one. */
  reached: number;
  /** Of those, how many have the stage's own event. The gap is implied. */
  observed: number;
  conversion: Metric | null;           // reached ÷ previous reached
  medianMinutesFromPrev: number | null; // first occurrence → first occurrence
  tracked: boolean;
  note?: string;
}

/**
 * Build a strictly nested funnel from per-entity stage timestamps.
 *
 * "Reached" is monotone by construction: anyone seen at a later stage
 * necessarily got past every earlier one (you cannot complete a scan you
 * never started), so a missing earlier event is IMPLIED rather than counted
 * as a drop-off. The observed count beside it shows how often the event is
 * actually there — the difference is missing instrumentation, not lost users.
 */
function nestedFunnel(
  stages: Array<{ key: string; label: string; tracked: boolean; note?: string }>,
  entities: Array<Record<string, string | null>>,   // stage key → first timestamp
): FunnelStage[] {
  const tracked = stages.filter(st => st.tracked);
  const furthest = entities.map(en => {
    let f = -1;
    tracked.forEach((st, i) => { if (en[st.key]) f = i; });
    return f;
  });
  const out: FunnelStage[] = [];
  let prevReached: number | null = null, prevKey: string | null = null;
  let ti = 0;
  for (const st of stages) {
    if (!st.tracked) {
      out.push({ key: st.key, label: st.label, reached: 0, observed: 0, conversion: null, medianMinutesFromPrev: null, tracked: false, note: st.note });
      continue;
    }
    const idx = ti++;
    const reached = furthest.filter(f => f >= idx).length;
    const observed = entities.filter(en => !!en[st.key]).length;
    const gaps: number[] = [];
    if (prevKey) for (const en of entities) {
      const a = en[prevKey], b = en[st.key];
      if (a && b && b >= a) gaps.push((Date.parse(b) - Date.parse(a)) / 60_000);
    }
    out.push({ key: st.key, label: st.label, reached, observed,
      conversion: prevReached === null ? null : derived(reached, prevReached),
      medianMinutesFromPrev: median(gaps), tracked: true, note: st.note });
    prevReached = reached; prevKey = st.key;
  }
  return out;
}

const firstOf = (evs: Ev[], pred: (e: Ev) => boolean): string | null => {
  let t: string | null = null;
  for (const e of evs) if (pred(e) && (!t || e.created_at < t)) t = e.created_at;
  return t;
};

/**
 * WHERE new users stop, in the order the app actually runs:
 *
 *   BEFORE the account (by device — there is no user yet)
 *     onboarding started → quiz finished → create account tapped → account
 *   AFTER the account (by user, acquired in the selected range)
 *     account → offer shown → onboarding finished (offer answered) →
 *     [home] → [camera] → photo → analysis → scan completed → 2nd → 3rd
 *
 * The offer comes BEFORE onboarding_completed: that event fires on the
 * offer's outcome and carries it (pro / free / activation_pending), which is
 * an exact Continue Free count for the onboarding offer in every era.
 *
 * Home and camera have no events; they are shown, and labelled, rather than
 * skipped. Saving a scan is reported beside the funnel, not in it — scanning
 * without saving is normal, and a nested "saved" stage would wrongly drop
 * people who simply scan.
 */
export function getFirstSessionFunnel(d: V4Data) {
  // ── Before the account: devices ──────────────────────────────────────
  const launchAt = d.cohort?.at ?? null;
  const devices = new Map<string, Ev[]>();
  for (const e of d.rawEvents ?? []) {
    if (!e.anonymous_id) continue;
    (devices.get(e.anonymous_id) ?? devices.set(e.anonymous_id, []).get(e.anonymous_id)!).push(e);
  }
  const deviceRows: Array<Record<string, string | null>> = [];
  for (const evs of devices.values()) {
    const started = firstOf(evs, e => e.event_name === "onboarding_started");
    if (!started) continue;
    if (launchAt && started < launchAt) continue;           // scope: post-launch devices only
    if (d.window.startMs !== null && !inWindow(d.window, started)) continue;
    deviceRows.push({
      started,
      quiz: firstOf(evs, e => e.event_name === "onboarding_quiz_completed"),
      tapped: firstOf(evs, e => e.event_name === "onboarding_create_account_tapped" || e.event_name === "onboarding_login_tapped"),
      account: firstOf(evs, e => !!e.user_id),
    });
  }
  const before = nestedFunnel([
    { key: "started", label: "Onboarding started", tracked: true },
    { key: "quiz", label: "Quiz finished", tracked: true },
    { key: "tapped", label: "Create account / log in tapped", tracked: true },
    { key: "account", label: "Signed in to an account", tracked: true, note: "the device later wrote an event as a signed-in user" },
  ], deviceRows);

  // ── After the account: users acquired in range ───────────────────────
  const cohort = d.window.startMs === null ? d.base.profiles : d.base.profiles.filter(p => inWindow(d.window, p.created_at));
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.allEvents) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e);
  const outcomes = { pro: 0, free: 0, activation_pending: 0, unknown: 0 };
  let savedAny = 0, completedAny = 0, failedNoScan = 0, submittedNoScan = 0;
  const userRows: Array<Record<string, string | null>> = cohort.map(p => {
    const evs = [...(evsByUser.get(p.id) ?? []), ...(d.link?.byUser.get(p.id) ?? [])];
    const scans = evs.filter(e => e.event_name === "scan_completed").map(e => e.created_at).sort();
    const done = evs.filter(e => e.event_name === "onboarding_completed").sort((a, b) => a.created_at < b.created_at ? -1 : 1)[0];
    if (done) {
      const o = metaStr(done, "outcome");
      if (o === "pro" || o === "free" || o === "activation_pending") outcomes[o]++; else outcomes.unknown++;
    }
    const submitted = firstOf(evs, e => e.event_name === "scan_submitted");
    if (scans.length) { completedAny++; if (evs.some(e => e.event_name === "scan_saved")) savedAny++; }
    else if (submitted) { submittedNoScan++; if (evs.some(e => e.event_name === "scan_failed")) failedNoScan++; }
    return {
      account: d.auth.get(p.id)?.created_at ?? p.created_at,
      offer: firstOf(evs, e => e.event_name === "paywall_opened" && metaStr(e, "paywall_source") === "onboarding_offer"),
      onboarded: done?.created_at ?? null,
      photo: firstOf(evs, e => e.event_name === "scan_started"),
      analysis: submitted,
      scan1: scans[0] ?? null, scan2: scans[1] ?? null, scan3: scans[2] ?? null,
    };
  });
  /**
   * Home and camera have no events YET. Their names are fixed here so the
   * app can emit them; once any row with that name exists, the stage turns
   * on by itself — users who reached a later stage still imply it, so older
   * users without the event are not counted as drop-offs.
   */
  const raw = d.rawEvents ?? [];
  const homeTracked = raw.some(e => e.event_name === HOME_EVENT);
  const cameraTracked = raw.some(e => e.event_name === CAMERA_EVENT);
  for (let i = 0; i < userRows.length; i++) {
    const p = cohort[i];
    const evs = [...(evsByUser.get(p.id) ?? []), ...(d.link?.byUser.get(p.id) ?? [])];
    userRows[i].home = firstOf(evs, e => e.event_name === HOME_EVENT);
    userRows[i].camera = firstOf(evs, e => e.event_name === CAMERA_EVENT);
  }
  const after = nestedFunnel([
    { key: "account", label: "Account created", tracked: true },
    { key: "offer", label: "Onboarding offer shown", tracked: true },
    { key: "onboarded", label: "Onboarding finished (offer answered)", tracked: true },
    { key: "home", label: "Home reached", tracked: homeTracked, note: homeTracked ? HOME_EVENT : `no event yet — will read ${HOME_EVENT}` },
    // The app emits camera_opened on the camera SCREEN, which shows the
    // permission prompt until access is granted — so this step includes
    // people who reached the prompt and declined.
    { key: "camera", label: "Camera opened", tracked: cameraTracked, note: cameraTracked ? `${CAMERA_EVENT} — camera screen, permission prompt included` : `no event yet — will read ${CAMERA_EVENT}` },
    { key: "photo", label: "Photo captured", tracked: true, note: "scan_started" },
    { key: "analysis", label: "Analysis started", tracked: true, note: "scan_submitted" },
    { key: "scan1", label: "Scan completed", tracked: true },
    { key: "scan2", label: "Second scan", tracked: true },
    { key: "scan3", label: "Third scan", tracked: true },
  ], userRows);

  return {
    before, after, devices: deviceRows.length, users: cohort.length,
    offerOutcomes: outcomes,
    side: {
      saved: derived(savedAny, completedAny, "users who completed a scan and saved at least one"),
      analysisNoScan: exact(submittedNoScan, "started an analysis but never completed a scan"),
      failedNoScan: exact(failedNoScan, "…of whom at least one analysis failed"),
    },
    gaps: [...(homeTracked ? [] : ["Home reached"]), ...(cameraTracked ? [] : ["Camera opened"])],
    note: "Before the account is counted by device; after it, by user acquired in the selected range, followed forward. A missing earlier event is implied by a later one rather than counted as a drop-off.",
  };
}

// ── Feature adoption & conversion ───────────────────────────────────────────

/**
 * Do payers use features more than non-payers? OBSERVED ASSOCIATION ONLY.
 *
 * The trap this avoids: Generate Listings and Deep Analysis are Pro features,
 * so payers use them BECAUSE they paid. Counting their use after payment
 * would "show" Pro features driving conversion by construction. So for
 * payers, only use BEFORE their first subscription purchase counts; for
 * everyone else, use so far.
 *
 * Gated features are split into "hit the paywall" (an attempt) and "used" —
 * the paywall is not usage. Payers known only from their plan have no
 * purchase moment and are left out, with their count shown.
 */
export function getFeatureAdoption(d: V4Data) {
  const journeys = new Map(allJourneys(d).map(j => [j.userId, j]));
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.allEvents) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e);

  const pw = (src: string) => (e: Ev) => e.event_name === "paywall_opened" && metaStr(e, "paywall_source") === src;
  const named = (...names: string[]) => (e: Ev) => names.includes(e.event_name);
  const features: Array<{ key: string; label: string; test: (evs: Ev[]) => boolean }> = [
    { key: "scan1", label: "1+ scan", test: evs => evs.filter(named("scan_completed")).length >= 1 },
    { key: "scan3", label: "3+ scans", test: evs => evs.filter(named("scan_completed")).length >= 3 },
    { key: "scan5", label: "5+ scans", test: evs => evs.filter(named("scan_completed")).length >= 5 },
    { key: "listings_paywall", label: "Generate Listings — hit the paywall", test: evs => evs.some(pw("generate_listings")) },
    { key: "listings", label: "Generate Listings — generated", test: evs => evs.some(named("listing_generated")) },
    { key: "deep_paywall", label: "Deep Analysis — hit the paywall", test: evs => evs.some(pw("deep_analysis")) },
    { key: "hunt", label: "Hunt Mode", test: evs => evs.some(named("hunt_mode_opened", "hunt_started")) },
    { key: "saved", label: "Saved a scan", test: evs => evs.some(named("scan_saved")) },
    { key: "progress", label: "Progress tab", test: evs => evs.some(named("progress_tab_opened")) },
    { key: "brands", label: "Brand Compendium", test: evs => evs.some(named("brand_compendium_opened", "brand_detail_opened")) },
    { key: "diamonds", label: "Diamonds", test: evs => evs.some(named("diamonds_opened", "diamond_detail_opened")) },
    { key: "achievements", label: "Achievements", test: evs => evs.some(named("achievements_opened")) },
    { key: "sold", label: "Logged a sale", test: evs => evs.some(e => e.event_name === "flip_status_changed" && metaStr(e, "status") === "sold") },
    { key: "store", label: "Opened the Scan Store", test: evs => evs.some(named("scan_store_opened")) },
  ];

  let paid = 0, unpaid = 0, undated = 0;
  const people: Array<{ paid: boolean; evs: Ev[] }> = [];
  for (const p of d.base.profiles) {
    const j = journeys.get(p.id);
    if (j && !j.firstPurchaseAt) { undated++; continue; }
    const isPaid = !!j?.firstPurchaseAt && j.firstPaidKind !== "scan_pack";
    const all = evsByUser.get(p.id) ?? [];
    const evs = isPaid ? all.filter(e => e.created_at < j!.firstPurchaseAt!) : all;
    people.push({ paid: isPaid, evs });
    if (isPaid) paid++; else unpaid++;
  }
  return {
    rows: features.map(f => {
      let pu = 0, nu = 0;
      for (const x of people) if (f.test(x.evs)) { if (x.paid) pu++; else nu++; }
      return { key: f.key, label: f.label,
        paidUsed: derived(pu, paid, "of paid users, before paying"), unpaidUsed: derived(nu, unpaid, "of non-paid users"),
        paidRateUsers: derived(pu, pu + nu, "paid rate among users of this"),
        paidRateNonUsers: derived(paid - pu, (paid - pu) + (unpaid - nu), "paid rate among non-users") };
    }),
    paid, unpaid, undated,
    label: "Observed association — not causation.",
    note: "Paid users' activity counts only BEFORE their first subscription purchase, so Pro features used after paying cannot inflate the association.",
  };
}

// ── Paywall intelligence ────────────────────────────────────────────────────

/**
 * Per-paywall value, on top of the existing per-paywall table: repeat
 * viewers, selection → purchase, what it takes before someone buys there,
 * purchases by pricing era with an ESTIMATED revenue, and where each paywall
 * sits in buyers' journeys (first seen / converting / last before paying).
 */
export function getPaywallIntelligence(d: V4Data, env: NodeJS.ProcessEnv = process.env) {
  const eras = getPricingEras(env);
  const evs = d.base.events;                         // windowed + cohort
  const journeys = getPaidJourneys(d).journeys;      // selected by first purchase in range
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.allEvents) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e);
  const sources = PAYWALL_SOURCES.filter(x => x !== "dev_preview");
  const role = new Map<string, { first: number; converting: number; last: number }>();
  for (const src of sources) role.set(src, { first: 0, converting: 0, last: 0 });
  for (const j of journeys) {
    if (j.firstPaywallSource && role.has(j.firstPaywallSource)) role.get(j.firstPaywallSource)!.first++;
    if (j.convertingPaywall && role.has(j.convertingPaywall)) role.get(j.convertingPaywall)!.converting++;
    if (j.lastPaywallBeforePay && role.has(j.lastPaywallBeforePay)) role.get(j.lastPaywallBeforePay)!.last++;
  }
  const rows = sources.map(src => {
    const opens = evs.filter(e => e.event_name === "paywall_opened" && metaStr(e, "paywall_source") === src);
    const perViewer = new Map<string, number>();
    for (const e of opens) { const k = e.user_id ?? e.anonymous_id ?? ""; if (k) perViewer.set(k, (perViewer.get(k) ?? 0) + 1); }
    const selections = evs.filter(e => e.event_name === "paywall_plan_selected" && metaStr(e, "paywall_source") === src).length;
    const buys = evs.filter(e => e.event_name === "paywall_purchase_completed" && metaStr(e, "paywall_source") === src);
    const byEra = { v1: 0, v2: 0 } as Record<string, number>;
    let revenue = 0;
    for (const b of buys) {
      const era = eraAt(eras, b.created_at); if (!era) continue;
      byEra[era.id] = (byEra[era.id] ?? 0) + 1;
      revenue += eraPrice(era, metaStr(b, "selected_plan")) ?? 0;
    }
    const convertedHere = journeys.filter(j => j.convertingPaywall === src && j.firstPurchaseAt);
    const imprBefore: number[] = [], hrsFromFirst: number[] = [];
    for (const j of convertedHere) {
      const mine = (evsByUser.get(j.userId) ?? []).filter(e => e.event_name === "paywall_opened" && metaStr(e, "paywall_source") === src && e.created_at <= j.firstPurchaseAt!);
      imprBefore.push(mine.length);
      const first = mine.reduce<string | null>((a, e) => !a || e.created_at < a ? e.created_at : a, null);
      if (first) hrsFromFirst.push((Date.parse(j.firstPurchaseAt!) - Date.parse(first)) / 3_600_000);
    }
    const r = role.get(src)!;
    return {
      source: src, impressions: opens.length, uniqueViewers: perViewer.size,
      repeatViewers: [...perViewer.values()].filter(n => n > 1).length,
      selections, purchases: buys.length,
      selectionToPurchase: derived(buys.length, selections),
      medianImpressionsBeforePurchase: median(imprBefore),
      medianHoursFirstImpressionToPurchase: median(hrsFromFirst),
      purchasesByEra: byEra,
      revenueEstimate: { value: revenue, trust: "ESTIMATED" as Trust, note: "list price, USD, first period" },
      firstSeenFor: r.first, convertingFor: r.converting, lastBeforeFor: r.last,
    };
  }).sort((a, b) => b.revenueEstimate.value! - a.revenueEstimate.value! || b.purchases - a.purchases || b.impressions - a.impressions);
  return { rows, buyers: journeys.length, currentEra: currentEra(eras, d.now)?.label ?? null,
    note: "Revenue is ESTIMATED at each era's list price. First / converting / last count paying users selected by first purchase in range." };
}

// ── Distributions ───────────────────────────────────────────────────────────

/**
 * Percentile by linear interpolation between closest ranks (the method
 * Excel's PERCENTILE.INC and numpy's default use). P50 equals median() above,
 * so the two can never disagree on the same page.
 */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const h = (s.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}

export function distribution(xs: number[]) {
  return {
    n: xs.length, mean: mean(xs), median: percentile(xs, 0.5),
    p25: percentile(xs, 0.25), p75: percentile(xs, 0.75), p90: percentile(xs, 0.9), p95: percentile(xs, 0.95),
    max: xs.length ? Math.max(...xs) : null,
  };
}

/** Per-user activity, computed once and shared by distributions and power users. */
function perUserActivity(d: V4Data, rates: { NORMAL: number; HUNT: number; LISTING: number } | null) {
  const t7 = iso(ago(d.now, 7)), t30 = iso(ago(d.now, 30));
  const by = new Map<string, { lifetime: number; s7: number; s30: number; sessions: Set<string>; days: Set<string>;
    listings: number; hunts: number; huntScans: number; last: string | null }>();
  const row = (uid: string) => by.get(uid) ?? by.set(uid, { lifetime: 0, s7: 0, s30: 0, sessions: new Set(), days: new Set(),
    listings: 0, hunts: 0, huntScans: 0, last: null }).get(uid)!;
  for (const p of d.base.profiles) row(p.id);
  for (const sc of d.allScans) {
    if (!sc.user_id || !by.has(sc.user_id)) continue;
    const r = row(sc.user_id); r.lifetime++; if (sc.created_at >= t7) r.s7++; if (sc.created_at >= t30) r.s30++;
  }
  for (const e of d.allEvents) {
    if (!e.user_id || !by.has(e.user_id)) continue;
    const r = row(e.user_id);
    if (e.session_id) r.sessions.add(e.session_id);
    r.days.add(dayOf(e.created_at));
    if (e.event_name === "listing_generated") r.listings++;
    if (e.event_name === "hunt_started") r.hunts++;
    if (e.event_name === "hunt_scan_started") r.huntScans++;
    if (!r.last || e.created_at > r.last) r.last = e.created_at;
  }
  const cost = (r: { lifetime: number; huntScans: number; listings: number }) =>
    rates ? r.lifetime * rates.NORMAL + r.huntScans * rates.HUNT + r.listings * rates.LISTING : null;
  return { by, cost };
}

/**
 * Distributions by CURRENT plan. Means alone mislead here: one heavy Annual
 * user can carry the whole Annual mean, so every figure comes with its
 * median and upper percentiles. Free users' lifetime scans are capped by the
 * free allowance, which shapes their distribution on its own.
 */
export function getUsageDistributions(d: V4Data, rates: { NORMAL: number; HUNT: number; LISTING: number } | null) {
  const { by, cost } = perUserActivity(d, rates);
  const build = (plan: PlanState) => {
    const rows = d.base.profiles.filter(p => currentPlan(d, p.id) === plan).map(p => by.get(p.id)!);
    return {
      users: rows.length,
      lifetime: distribution(rows.map(r => r.lifetime)),
      scans7: distribution(rows.map(r => r.s7)),
      scans30: distribution(rows.map(r => r.s30)),
      sessions: distribution(rows.map(r => r.sessions.size)),
      activeDays: distribution(rows.map(r => r.days.size)),
      listings: distribution(rows.map(r => r.listings)),
      hunts: distribution(rows.map(r => r.hunts)),
      cost: rates ? distribution(rows.map(r => cost(r)!)) : null,
    };
  };
  // Typed keys, so callers can read .free / .monthly / .annual directly.
  return {
    free: build("free"), monthly: build("monthly"), annual: build("annual"),
    method: "Percentiles by linear interpolation between ranks (as Excel PERCENTILE.INC). P50 = median.",
    note: `CURRENT plan. Free users' lifetime scans are capped by the ${FREE_LIFETIME_SCANS}-scan free allowance.`,
  };
}

// ── Power users ─────────────────────────────────────────────────────────────

export const POWER_THRESHOLDS = [10, 25, 50, 100];
export const POWER_TABLE_SIZE = 20;

export function getPowerUsers(d: V4Data, rates: { NORMAL: number; HUNT: number; LISTING: number } | null) {
  const { by, cost } = perUserActivity(d, rates);
  const total = d.base.profiles.length;
  const rows = d.base.profiles.map(p => {
    const r = by.get(p.id)!; const prof = d.profiles.get(p.id);
    return { userId: p.id, user: prof?.display_name ?? prof?.username ?? null, plan: currentPlan(d, p.id),
      scans7: r.s7, scans30: r.s30, lifetime: r.lifetime, sessions: r.sessions.size, activeDays: r.days.size,
      listings: r.listings, hunts: r.hunts, lastActive: r.last, cost: cost(r) };
  });
  // Most active recently first; lifetime breaks ties, then ID so the order is stable.
  rows.sort((a, b) => b.scans30 - a.scans30 || b.lifetime - a.lifetime || a.userId.localeCompare(b.userId));
  const tiers = POWER_THRESHOLDS.map(t => {
    const inTier = rows.filter(r => r.lifetime >= t);
    const mix = { free: 0, monthly: 0, annual: 0 } as Record<PlanState, number>;
    for (const r of inTier) mix[r.plan]++;
    return { threshold: t, users: derived(inTier.length, total, `${t}+ lifetime scans`), mix };
  });
  return { top: rows.filter(r => r.lifetime > 0).slice(0, POWER_TABLE_SIZE), tiers, total };
}

// ── Free → Paid ─────────────────────────────────────────────────────────────

export const FREE_TO_PAID_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "0", min: 0, max: 0 }, { label: "1", min: 1, max: 1 }, { label: "2–3", min: 2, max: 3 },
  { label: "4–5", min: 4, max: 5 }, { label: "6–10", min: 6, max: 10 }, { label: "11–14", min: 11, max: 14 },
  { label: `${FREE_LIFETIME_SCANS}+ (exhausted)`, min: FREE_LIFETIME_SCANS, max: Infinity },
];

/** The journey builder over a user's FULL history, with no date-range selection. */
function allJourneys(d: V4Data): PaidJourney[] {
  const unbounded = { ...d, window: resolveAnalysisWindow({ preset: "all" }, d.cohort?.scope ?? "post_launch", d.now) } as V4Data;
  return getPaidJourneys(unbounded).journeys;
}

/**
 * Does using free scans go with paying?
 *
 * For payers: scans BEFORE their first subscription purchase — scans after
 * paying are never counted here. For everyone else: scans so far. Both come
 * straight from scan_completed, so the counts are exact; no historical
 * balance has to be reconstructed.
 *
 * Point-in-time: someone at 3 scans today who will pay at scan 6 counts as an
 * unpaid "2–3" for now. Payers known only from their current plan have no
 * purchase moment to measure against and are left out, with their count shown.
 */
export function getFreeToPaid(d: V4Data) {
  const journeys = new Map(allJourneys(d).map(j => [j.userId, j]));
  const scanCounts = new Map<string, number>();
  for (const sc of d.allScans) if (sc.user_id) scanCounts.set(sc.user_id, (scanCounts.get(sc.user_id) ?? 0) + 1);
  const paywallViews = new Map<string, number>();
  for (const e of d.allEvents) if (e.user_id && e.event_name === "paywall_opened") paywallViews.set(e.user_id, (paywallViews.get(e.user_id) ?? 0) + 1);

  type Acc = { users: number; paid: number; monthly: number; annual: number; hrs: number[]; views: number[]; conv: Map<string, number> };
  const acc: Acc[] = FREE_TO_PAID_BUCKETS.map(() => ({ users: 0, paid: 0, monthly: 0, annual: 0, hrs: [], views: [], conv: new Map() }));
  let undatedPayers = 0;
  for (const p of d.base.profiles) {
    const j = journeys.get(p.id);
    const paidSub = !!j && !!j.firstPurchaseAt && j.firstPaidKind !== "scan_pack";
    if (j && !j.firstPurchaseAt) { undatedPayers++; continue; }
    const n = paidSub ? j!.scansBeforePay : (scanCounts.get(p.id) ?? 0);
    const i = FREE_TO_PAID_BUCKETS.findIndex(b => n >= b.min && n <= b.max);
    const a = acc[i];
    a.users++;
    if (paidSub) {
      a.paid++;
      if (j!.firstPaidKind === "monthly") a.monthly++;
      if (j!.firstPaidKind === "annual") a.annual++;
      if (j!.hoursAccountToPay !== null) a.hrs.push(j!.hoursAccountToPay);
      a.views.push(j!.paywallImpressionsBeforePay);
      const c = j!.convertingPaywall ?? "UNKNOWN"; a.conv.set(c, (a.conv.get(c) ?? 0) + 1);
    } else {
      a.views.push(paywallViews.get(p.id) ?? 0);
    }
  }
  return {
    buckets: FREE_TO_PAID_BUCKETS.map((b, i) => {
      const a = acc[i];
      const top = [...a.conv.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
      return { label: b.label, users: a.users, paid: a.paid, conversion: derived(a.paid, a.users),
        monthly: a.monthly, annual: a.annual, medianHoursToPay: median(a.hrs), meanPaywallViews: mean(a.views),
        topConvertingPaywall: top ? top[0] : null };
    }),
    undatedPayers,
    note: "Scans BEFORE the first subscription purchase for payers; scans so far for everyone else. Point-in-time, users in scope, full history.",
  };
}

// ── Pricing experiments ─────────────────────────────────────────────────────

/**
 * Days after signup within which a conversion counts. Fixed, so an era whose
 * users are newer is not penalised for having had less time. Most FlipStart
 * conversions happen at the onboarding offer on day 0, so seven days loses
 * little and removes the bias.
 */
export const PRICING_CONVERSION_DAYS = 7;

/**
 * Observational comparison of pricing eras — association, never causation:
 * the eras also differ in season, traffic, app version and everything else
 * that changed over time.
 *
 * Two kinds of number, kept apart:
 *   COHORT — users who signed up in the era and whose whole 7-day window
 *            also lies inside it. Activation, paid conversion and revenue per
 *            user. Users whose week straddles the boundary are excluded from
 *            both eras and counted.
 *   FLOW   — everything that HAPPENED in the era: paywall views, purchase
 *            starts and completions, plan mix, estimated gross.
 *
 * Revenue is ESTIMATED from list prices in USD: first-period gross, before
 * refunds, renewals and non-US storefront pricing. Subscription purchases
 * only — scan-pack purchase events are test-contaminated.
 */
export function getPricingExperiments(d: V4Data, env: NodeJS.ProcessEnv = process.env) {
  const eras = getPricingEras(env);
  const fee = getAppleFeeRate(env);
  const now = d.now.getTime();
  const windowMs = PRICING_CONVERSION_DAYS * DAY;
  const journeys = new Map(allJourneys(d).map(j => [j.userId, j]));
  const scanTimes = new Map<string, string[]>();
  for (const sc of d.allScans) if (sc.user_id) (scanTimes.get(sc.user_id) ?? scanTimes.set(sc.user_id, []).get(sc.user_id)!).push(sc.created_at);

  const purchases = d.allEvents.filter(e => e.event_name === "paywall_purchase_completed");
  const inEra = (era: PricingEra, t: string) => eraAt(eras, t)?.id === era.id;

  const rows = eras.map(era => {
    const endMs = era.endsAt ? Date.parse(era.endsAt) : Infinity;
    let acquired = 0, eligible = 0, straddling = 0, tooNew = 0, activated7 = 0, paid7 = 0, revenue7 = 0, everScanned = 0;
    for (const p of d.base.profiles) {
      const acquiredAt = d.auth.get(p.id)?.created_at ?? p.created_at;
      if (!inEra(era, acquiredAt)) continue;
      acquired++;
      const scans = scanTimes.get(p.id) ?? [];
      if (scans.length) everScanned++;
      const startMs = Date.parse(acquiredAt), stopMs = startMs + windowMs;
      if (stopMs > now) { tooNew++; continue; }
      if (stopMs > endMs) { straddling++; continue; }
      eligible++;
      if (scans.some(t => Date.parse(t) < stopMs)) activated7++;
      const j = journeys.get(p.id);
      if (j?.firstPurchaseAt && j.firstPaidKind !== "scan_pack" && Date.parse(j.firstPurchaseAt) < stopMs) {
        paid7++;
        const priceEra = eraAt(eras, j.firstPurchaseAt);
        const price = priceEra ? eraPrice(priceEra, j.firstPaidKind) : null;
        if (price !== null) revenue7 += price;
      }
    }

    const evs = d.allEvents.filter(e => inEra(era, e.created_at));
    const viewers = new Set(evs.filter(e => e.event_name === "paywall_opened" && e.user_id).map(e => e.user_id!));
    const eraPurchases = purchases.filter(e => inEra(era, e.created_at));
    const purchasers = new Set(eraPurchases.map(e => e.user_id).filter(Boolean) as string[]);
    const viewerBuyers = [...purchasers].filter(u => viewers.has(u)).length;
    const monthly = eraPurchases.filter(e => metaStr(e, "selected_plan") === "monthly").length;
    const annual = eraPurchases.filter(e => metaStr(e, "selected_plan") === "annual").length;
    const gross = monthly * era.monthlyUsd + annual * era.annualUsd;
    const firstBuys = [...journeys.values()].filter(j => j.firstPurchaseAt && j.firstPaidKind !== "scan_pack" && inEra(era, j.firstPurchaseAt));
    const hrs = firstBuys.map(j => j.hoursAccountToPay).filter((h): h is number => h !== null);

    return {
      era,
      // cohort
      acquired: exact(acquired, "signups in the era"),
      eligible, straddling, tooNew,
      activation7: derived(activated7, eligible, `scanned within ${PRICING_CONVERSION_DAYS} days of signup`),
      paid7: derived(paid7, eligible, `subscribed within ${PRICING_CONVERSION_DAYS} days of signup`),
      revenuePerUser7: { value: eligible ? revenue7 / eligible : null, trust: "ESTIMATED" as Trust, d: eligible },
      revenuePer100: { value: eligible ? (revenue7 / eligible) * 100 : null, trust: "ESTIMATED" as Trust, d: eligible },
      everScanned: derived(everScanned, acquired, "ever scanned — not time-adjusted"),
      // flow
      activeUsers: exact(new Set(evs.filter(e => e.user_id).map(e => e.user_id!)).size),
      paywallViewers: exact(viewers.size),
      purchaseStarts: exact(evs.filter(e => e.event_name === "paywall_purchase_started").length),
      purchases: exact(eraPurchases.length),
      viewerToPaid: derived(viewerBuyers, viewers.size, "paywall viewers in the era who bought in the era"),
      startToPurchase: derived(eraPurchases.length, evs.filter(e => e.event_name === "paywall_purchase_started").length),
      monthly: exact(monthly), annual: exact(annual),
      annualShare: derived(annual, monthly + annual, "annual share of purchases"),
      grossEstimate: { value: gross, trust: "ESTIMATED" as Trust, note: "list price, USD, first period" },
      netEstimate: { value: gross * (1 - fee), trust: "ESTIMATED" as Trust, note: `after Apple's ${Math.round(fee * 100)}%` },
      revenuePerViewer: { value: viewers.size ? gross / viewers.size : null, trust: "ESTIMATED" as Trust, d: viewers.size },
      timeToPay: { mean: mean(hrs), median: median(hrs), d: hrs.length },
      scansBeforePay: { mean: mean(firstBuys.map(j => j.scansBeforePay)), median: median(firstBuys.map(j => j.scansBeforePay)), d: firstBuys.length },
      paywallsBeforePay: { mean: mean(firstBuys.map(j => j.paywallImpressionsBeforePay)), d: firstBuys.length },
    };
  });

  const [v1, v2] = rows;
  const pts = (a: Metric, b: Metric) => a.value !== null && b.value !== null ? (b.value - a.value) * 100 : null;
  const cur = currentEra(eras, d.now);
  return {
    eras: rows,
    comparison: {
      activationPts: pts(v1.activation7, v2.activation7),
      paidPts: pts(v1.paid7, v2.paid7),
      viewerToPaidPts: pts(v1.viewerToPaid, v2.viewerToPaid),
      revenuePer100Delta: v1.revenuePer100.value !== null && v2.revenuePer100.value !== null ? v2.revenuePer100.value - v1.revenuePer100.value : null,
    },
    currentEraId: cur?.id ?? null,
    appleFeeRate: fee,
    conversionDays: PRICING_CONVERSION_DAYS,
    boundaryAssumed: eras.some(e => e.assumed),
    notes: ERA_NOTES,
    caveat: "Observational association, not causation: the eras also differ in season, traffic and app version.",
  };
}

// ── App versions ────────────────────────────────────────────────────────────

/** "2.10.0" sorts above "2.9.3". Anything that is not a version sorts last. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  const okA = pa.every(Number.isFinite), okB = pb.every(Number.isFinite);
  if (okA !== okB) return okA ? -1 : 1;
  if (!okA) return a.localeCompare(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return y - x;          // newest first
  }
  return 0;
}

/**
 * Releases compared, using each EVENT's own app_version — never today's
 * version applied backwards.
 *
 * Two views:
 *   ACTIVITY — what happened on each version: users, scans per user, failure
 *              rate, paywall → purchase, feature use.
 *   COHORT   — users whose FIRST version was this one: 7-day activation and
 *              paid conversion (full window only, as in pricing), D1 and D7.
 * Versions are marketing versions (e.g. 2.1.1); two builds that share one
 * cannot be told apart. The date range does not apply — versions are their
 * own time periods.
 */
export function getAppVersions(d: V4Data) {
  const unbounded = { ...d, window: resolveAnalysisWindow({ preset: "all" }, d.cohort?.scope ?? "post_launch", d.now) } as V4Data;
  const ver = (e: Ev) => (e.app_version && e.app_version.trim()) || null;
  const evs = d.allEvents;
  const missing = evs.filter(e => !ver(e)).length;

  // First version per user, from their earliest versioned event.
  const firstVer = new Map<string, { v: string; at: string }>();
  for (const e of evs) {
    const v = ver(e); if (!e.user_id || !v) continue;
    const cur = firstVer.get(e.user_id);
    if (!cur || e.created_at < cur.at) firstVer.set(e.user_id, { v, at: e.created_at });
  }
  const versions = [...new Set(evs.map(ver).filter((v): v is string => !!v))].sort(compareVersions);
  const windowMs = 7 * DAY, now = d.now.getTime();
  const scanTimes = new Map<string, number[]>();
  for (const sc of d.allScans) if (sc.user_id) (scanTimes.get(sc.user_id) ?? scanTimes.set(sc.user_id, []).get(sc.user_id)!).push(Date.parse(sc.created_at));
  const firstBuy = new Map<string, number>();
  for (const e of evs) if (e.user_id && e.event_name === "paywall_purchase_completed") {
    const t = Date.parse(e.created_at); const c = firstBuy.get(e.user_id); if (c === undefined || t < c) firstBuy.set(e.user_id, t);
  }
  const rb = retentionBase(unbounded);
  // Map lookups, not list scans — this runs once per user.
  const created = new Map(d.base.profiles.map(p => [p.id, p.created_at]));
  const acctAt = (uid: string) => Date.parse(d.auth.get(uid)?.created_at ?? created.get(uid) ?? "");

  const rows = versions.map(v => {
    const on = evs.filter(e => ver(e) === v);
    const users = new Set(on.filter(e => e.user_id).map(e => e.user_id!));
    const active = new Set(on.filter(e => e.user_id && inWindow(d.window, e.created_at)).map(e => e.user_id!));
    const completed = on.filter(e => e.event_name === "scan_completed").length;
    const failed = on.filter(e => e.event_name === "scan_failed").length;
    const viewers = new Set(on.filter(e => e.event_name === "paywall_opened" && e.user_id).map(e => e.user_id!));
    const buyers = new Set(on.filter(e => e.event_name === "paywall_purchase_completed" && e.user_id).map(e => e.user_id!));
    const cohort = [...firstVer.entries()].filter(([, x]) => x.v === v).map(([u]) => u);
    let eligible = 0, act7 = 0, paid7 = 0;
    for (const u of cohort) {
      const start = acctAt(u); if (!Number.isFinite(start) || start + windowMs > now) continue;
      eligible++;
      if ((scanTimes.get(u) ?? []).some(t => t < start + windowMs)) act7++;
      const b = firstBuy.get(u); if (b !== undefined && b < start + windowMs) paid7++;
    }
    const inCohort = (u: string) => firstVer.get(u)?.v === v;
    return {
      version: v,
      users: exact(users.size), activeInRange: exact(active.size),
      scansPerUser: { value: users.size ? completed / users.size : null, trust: "DERIVED" as Trust, d: users.size },
      failedScanRate: derived(failed, completed + failed, "failed ÷ (completed + failed) on this version"),
      paywallToPurchase: derived([...buyers].filter(u => viewers.has(u)).length, viewers.size),
      listingsPerUser: { value: users.size ? on.filter(e => e.event_name === "listing_generated").length / users.size : null, trust: "DERIVED" as Trust, d: users.size },
      huntsPerUser: { value: users.size ? on.filter(e => e.event_name === "hunt_started").length / users.size : null, trust: "DERIVED" as Trust, d: users.size },
      newUsers: exact(cohort.length, "users whose first version this was"),
      activation7: derived(act7, eligible), paid7: derived(paid7, eligible),
      d1: retentionCalc(rb, 1, inCohort), d7: retentionCalc(rb, 7, inCohort),
    };
  });
  const withEvents = new Set(evs.filter(e => e.user_id).map(e => e.user_id!));
  const usersWithoutVersion = d.base.profiles.filter(p => !firstVer.has(p.id) && withEvents.has(p.id)).length;
  return {
    rows,
    missingEvents: derived(missing, evs.length, "events with no app_version"),
    usersWithoutVersion: exact(usersWithoutVersion),
    note: "Each event is counted under the version it was written on. Marketing versions only — builds sharing a version are indistinguishable.",
  };
}

// ── Acquisition source ──────────────────────────────────────────────────────

/**
 * Metadata keys read as an acquisition source if the app ever writes them.
 * Explicit names only — "source" alone already means paywall_source and
 * entry_source elsewhere, so it is never guessed at.
 */
export const ACQUISITION_KEYS = ["acquisition_source", "utm_source", "utm_campaign", "utm_medium", "creator", "referrer"];

/**
 * Where users came from — to the extent the data says so, and no further.
 *
 * Today no event carries a source, so this reports the gap and is ready to
 * parse one the day it appears. Nothing is inferred from usernames or
 * timing. Cost per acquisition needs spend data the dashboard does not
 * have, so CAC stays not tracked.
 *
 * What IS real: the onboarding quiz. People state their goal and experience
 * level, which segments activation and conversion by self-reported intent —
 * clearly labelled as intent, not as channel.
 */
export function getAcquisitionSource(d: V4Data, env: NodeJS.ProcessEnv = process.env) {
  const eras = getPricingEras(env);
  const journeys = new Map(allJourneys(d).map(j => [j.userId, j]));
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.allEvents) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e);
  for (const l of evsByUser.values()) l.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const now = d.now.getTime(), windowMs = 7 * DAY;
  const created = new Map(d.base.profiles.map(p => [p.id, p.created_at]));

  // Per user: 7-day eligibility, activation, conversion, estimated revenue.
  const outcome = (uid: string, createdAt: string) => {
    const start = Date.parse(d.auth.get(uid)?.created_at ?? createdAt);
    const eligible = Number.isFinite(start) && start + windowMs <= now;
    const evs = evsByUser.get(uid) ?? [];
    const act = evs.some(e => e.event_name === "scan_completed" && Date.parse(e.created_at) < start + windowMs);
    const j = journeys.get(uid);
    const paid = !!j?.firstPurchaseAt && j.firstPaidKind !== "scan_pack" && Date.parse(j.firstPurchaseAt) < start + windowMs;
    const era = paid ? eraAt(eras, j!.firstPurchaseAt) : null;
    return { eligible, act, paid, revenue: era ? eraPrice(era, j!.firstPaidKind) ?? 0 : 0 };
  };
  type Agg = { users: number; eligible: number; act: number; paid: number; revenue: number };
  const tally = (groups: Map<string, string[]>) => [...groups.entries()].map(([key, uids]) => {
    const a: Agg = { users: uids.length, eligible: 0, act: 0, paid: 0, revenue: 0 };
    for (const u of uids) {
      const o = outcome(u, created.get(u) ?? "");
      if (!o.eligible) continue;
      a.eligible++; if (o.act) a.act++; if (o.paid) { a.paid++; a.revenue += o.revenue; }
    }
    return { key, users: a.users, activation7: derived(a.act, a.eligible), paid7: derived(a.paid, a.eligible),
      revenue: { value: a.revenue, trust: "ESTIMATED" as Trust },
      revenuePerUser: { value: a.eligible ? a.revenue / a.eligible : null, trust: "ESTIMATED" as Trust, d: a.eligible },
      revenuePerPaidUser: { value: a.paid ? a.revenue / a.paid : null, trust: "ESTIMATED" as Trust, d: a.paid } };
  }).sort((x, y) => y.users - x.users || x.key.localeCompare(y.key));

  // Acquisition source — only if the data carries one.
  const bySource = new Map<string, string[]>();
  let sourceEvents = 0;
  for (const p of d.base.profiles) {
    for (const e of evsByUser.get(p.id) ?? []) {
      const k = ACQUISITION_KEYS.find(k => metaStr(e, k));
      if (!k) continue;
      sourceEvents++;
      const v = metaStr(e, k)!.trim().toLowerCase();
      (bySource.get(v) ?? bySource.set(v, []).get(v)!).push(p.id);
      break;
    }
  }
  // Self-reported intent from the onboarding quiz.
  const answer = (uid: string, key: string) => {
    for (const e of evsByUser.get(uid) ?? []) if (e.event_name === "onboarding_completed") { const v = metaStr(e, key); if (v) return v; }
    for (const e of d.link?.byUser.get(uid) ?? []) if (e.event_name === "onboarding_quiz_completed") { const v = metaStr(e, key); if (v) return v; }
    return null;
  };
  const group = (key: string) => {
    const m = new Map<string, string[]>();
    for (const p of d.base.profiles) { const v = answer(p.id, key) ?? "(not answered)"; (m.get(v) ?? m.set(v, []).get(v)!).push(p.id); }
    return m;
  };
  return {
    tracked: bySource.size > 0,
    sources: bySource.size ? tally(bySource) : [],
    sourceEvents,
    keysRead: ACQUISITION_KEYS,
    cac: { value: null, trust: "NOT_TRACKED" as Trust, available: false, note: "needs marketing spend, which the dashboard does not have" },
    byGoal: tally(group("primary_goal")),
    byExperience: tally(group("experience_level")),
    note: "Intent segments are self-reported onboarding answers — who people say they are, not where they came from. 7-day windows, full window only.",
  };
}

// ── Cost by plan ────────────────────────────────────────────────────────────

/**
 * Estimated AI cost by CURRENT plan, and — for subscribers — an estimated
 * monthly contribution: what they pay per month after Apple's fee, minus
 * their estimated AI cost over the last 30 days.
 *
 * Price is the list price of the era of the user's FIRST purchase (what they
 * signed up at). Annual is spread over 12 months. Subscribers with no
 * purchase event cannot be priced and are left out, counted. This is a
 * contribution estimate, never profit: it ignores refunds, taxes, renewals
 * at a different price and every cost but AI.
 */
export function getCostByPlan(d: V4Data, rates: { NORMAL: number; HUNT: number; LISTING: number } | null, env: NodeJS.ProcessEnv = process.env) {
  if (!rates) return { available: false, note: "Cost rates unavailable — no estimate is made without them." };
  const eras = getPricingEras(env), fee = getAppleFeeRate(env);
  const t30 = iso(ago(d.now, 30));
  const life = new Map<string, number>(), last30 = new Map<string, number>(), scans = new Map<string, number>();
  const unit = (e: Ev) => e.event_name === "scan_completed" ? rates.NORMAL : e.event_name === "hunt_scan_started" ? rates.HUNT
    : e.event_name === "listing_generated" ? rates.LISTING : 0;
  for (const e of d.allEvents) {
    if (!e.user_id) continue;
    const c = unit(e); if (!c) continue;
    life.set(e.user_id, (life.get(e.user_id) ?? 0) + c);
    if (e.created_at >= t30) last30.set(e.user_id, (last30.get(e.user_id) ?? 0) + c);
    if (e.event_name === "scan_completed") scans.set(e.user_id, (scans.get(e.user_id) ?? 0) + 1);
  }
  const journeys = new Map(allJourneys(d).map(j => [j.userId, j]));
  const plans: PlanState[] = ["free", "monthly", "annual"];
  const out: Record<string, any> = {};
  let unpriced = 0;
  for (const plan of plans) {
    const ids = d.base.profiles.filter(p => currentPlan(d, p.id) === plan).map(p => p.id);
    const costs = ids.map(u => life.get(u) ?? 0);
    const totalScans = ids.reduce((a, u) => a + (scans.get(u) ?? 0), 0);
    const total = costs.reduce((a, b) => a + b, 0);
    let contribution: any = null;
    if (plan !== "free") {
      const per: number[] = [];
      for (const u of ids) {
        const j = journeys.get(u);
        const era = j?.firstPurchaseAt ? eraAt(eras, j.firstPurchaseAt) : null;
        if (!era) { unpriced++; continue; }
        const price = plan === "monthly" ? era.monthlyUsd : era.annualUsd / 12;
        per.push(price * (1 - fee) - (last30.get(u) ?? 0));
      }
      contribution = {
        users: per.length, mean: mean(per), median: median(per), total: per.reduce((a, b) => a + b, 0),
        negative: per.filter(x => x < 0).length, trust: "ESTIMATED" as Trust,
      };
    }
    out[plan] = {
      users: ids.length, totalCost: { value: total, trust: "ESTIMATED" as Trust },
      perUser: distribution(costs), scans: exact(totalScans),
      costPerScan: { value: totalScans ? total / totalScans : null, trust: "ESTIMATED" as Trust, d: totalScans },
      cost30Total: { value: ids.reduce((a, u) => a + (last30.get(u) ?? 0), 0), trust: "ESTIMATED" as Trust },
      contribution,
    };
  }
  return {
    available: true, free: out.free, monthly: out.monthly, annual: out.annual, unpriced, appleFeeRate: fee, rates,
    note: `Estimated monthly contribution = list price at the user's purchase era × (1 − ${Math.round(fee * 100)}%), annual ÷ 12, minus estimated AI cost over the last 30 days. Not profit.`,
  };
}

// ── Data Integrity ──────────────────────────────────────────────────────────

export type IssueSeverity = "CONFLICT" | "WARNING" | "INFO";
export interface IntegrityIssue {
  userId: string | null;
  user: string | null;
  type: string;
  label: string;
  severity: IssueSeverity;
  sourceA: string;
  sourceB: string;
  at: string | null;
  notes: string;
}

/** Same-user, same-product purchase events this close together are duplicates. */
export const DUPLICATE_PURCHASE_WINDOW_MS = 10 * 60_000;
/**
 * An event this much earlier than the account is a real problem; anything
 * smaller is the gap between the device writing the row and Supabase
 * creating the account, not a contradiction.
 */
export const BEFORE_ACCOUNT_TOLERANCE_MS = 60_000;

/**
 * Contradictions between sources, surfaced before anything else is trusted.
 *
 * Runs over the users IN SCOPE and their FULL history — the date range is
 * deliberately ignored, because a problem with someone's data is still a
 * problem when it happened last month.
 *
 * Three things are kept apart on purpose:
 *   CONFLICT — sources that must agree, don't
 *   WARNING  — data is missing or suspect, numbers may be floors
 *   INFO     — looks odd, has an innocent explanation; never counted against health
 * And a fourth bucket that is NOT an issue at all: behaviour that only looks
 * like a contradiction (scanning without saving), reported so it is not
 * mistaken for one.
 */
export function getDataIntegrity(d: V4Data) {
  const issues: IntegrityIssue[] = [];
  const nameOf = (uid: string) => {
    const p = d.profiles.get(uid);
    return p?.display_name ?? p?.username ?? null;
  };
  const evsByUser = new Map<string, Ev[]>();
  for (const e of d.allEvents) if (e.user_id) (evsByUser.get(e.user_id) ?? evsByUser.set(e.user_id, []).get(e.user_id)!).push(e);
  for (const l of evsByUser.values()) l.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const scanTimes = new Map<string, string[]>();
  for (const sc of d.allScans) if (sc.user_id) (scanTimes.get(sc.user_id) ?? scanTimes.set(sc.user_id, []).get(sc.user_id)!).push(sc.created_at);
  for (const l of scanTimes.values()) l.sort();
  const savedTimes = new Map<string, string[]>();
  for (const sv of d.allSaved ?? []) if (sv.user_id) (savedTimes.get(sv.user_id) ?? savedTimes.set(sv.user_id, []).get(sv.user_id)!).push(sv.created_at);
  for (const l of savedTimes.values()) l.sort();
  const linkedScans = (uid: string) => (d.link?.byUser.get(uid) ?? []).filter(e => e.event_name === "scan_completed");

  let scannedNeverSaved = 0, scannedUsers = 0;

  for (const p of d.base.profiles) {
    const uid = p.id;
    const user = nameOf(uid);
    const evs = evsByUser.get(uid) ?? [];
    const scans = scanTimes.get(uid) ?? [];
    const saved = savedTimes.get(uid) ?? [];
    const linked = linkedScans(uid);
    const add = (i: Omit<IntegrityIssue, "userId" | "user">) => issues.push({ userId: uid, user, ...i });
    const scannedBy = (t: string) => scans.some(st => st <= t) || linked.some(e => e.created_at <= t);
    const savedBy = (t: string) => saved.some(st => st <= t);

    if (scans.length) { scannedUsers++; if (!saved.length) scannedNeverSaved++; }

    // 1 · A scan-only paywall seen before any scan.
    const flaggedSources = new Set<string>();
    for (const e of evs) {
      if (e.event_name !== "paywall_opened") continue;
      const src = metaStr(e, "paywall_source");
      if (!src || !SCAN_REQUIRED_PAYWALLS.has(src) || flaggedSources.has(src) || scannedBy(e.created_at)) continue;
      flaggedSources.add(src);
      if (savedBy(e.created_at)) {
        add({ type: "scan_paywall_no_scan_event", label: `${src} paywall without a scan event`, severity: "WARNING",
          sourceA: `paywall_opened · ${src}`, sourceB: "saved item exists, no scan_completed", at: e.created_at,
          notes: "A saved item shows a scan happened; its event is missing — the scan likely predates analytics." });
      } else {
        add({ type: "scan_paywall_no_scan", label: `${src} paywall before any scan`, severity: "CONFLICT",
          sourceA: `paywall_opened · ${src}`, sourceB: "no scan_completed, no saved item", at: e.created_at,
          notes: "This paywall can only be reached after a scan, but no scan is recorded before it." });
      }
    }

    // 2 · A listing generated before any scan.
    const firstListing = evs.find(e => e.event_name === "listing_generated");
    if (firstListing && !scannedBy(firstListing.created_at)) {
      add({ type: "listing_no_scan", label: "Listing generated before any scan",
        severity: savedBy(firstListing.created_at) ? "WARNING" : "CONFLICT",
        sourceA: "listing_generated", sourceB: savedBy(firstListing.created_at) ? "saved item exists, no scan_completed" : "no scan_completed, no saved item",
        at: firstListing.created_at, notes: "Listings are generated from a scan's result." });
    }

    // 3 · Saved items with no scan events at all.
    if (saved.length && !scans.length) {
      add({ type: "saved_no_scan_events", label: "Saved items but no scan events",
        severity: linked.length ? "INFO" : "WARNING",
        sourceA: `${saved.length} saved item(s)`, sourceB: linked.length ? `${linked.length} signed-out scan(s) linked by device` : "0 scan_completed",
        at: saved[0], notes: linked.length ? "The scans ran while signed out on this device." : "Scans predate analytics, ran signed-out on a shared device, or their events were lost." });
    }

    // 4 · Plan state vs purchase history.
    const plan = currentPlan(d, uid);
    const purchases = evs.filter(e => e.event_name === "paywall_purchase_completed");
    if (plan !== "free" && purchases.length === 0) {
      const restored = evs.some(e => e.event_name === "paywall_restore_completed");
      add({ type: "plan_without_purchase", label: `Current ${plan} with no purchase event`,
        severity: restored ? "INFO" : "WARNING",
        sourceA: `account_usage · ${plan}`, sourceB: restored ? "paywall_restore_completed" : "no paywall_purchase_completed",
        at: d.usage.get(uid)?.subscription_period_start ?? null,
        notes: restored ? "Restored on this account rather than bought here." : "Bought before analytics, outside the app, or the confirmation event was lost. Server-side purchase records are not readable from this dashboard yet." });
    }
    if (plan === "free" && purchases.length > 0) {
      add({ type: "purchase_without_plan", label: "Purchase event but currently Free", severity: "INFO",
        sourceA: "paywall_purchase_completed", sourceB: "account_usage · free", at: purchases[0].created_at,
        notes: "Expired, cancelled, refunded, or a sandbox purchase that lapsed." });
    }

    // 5 · Duplicate purchase events.
    const purchaseLike = evs.filter(isPaidEvent);
    for (let i = 1; i < purchaseLike.length; i++) {
      const a = purchaseLike[i - 1], b = purchaseLike[i];
      const keyA = `${a.event_name}|${metaStr(a, "selected_plan") ?? metaStr(a, "product_id") ?? ""}`;
      const keyB = `${b.event_name}|${metaStr(b, "selected_plan") ?? metaStr(b, "product_id") ?? ""}`;
      if (keyA === keyB && Date.parse(b.created_at) - Date.parse(a.created_at) <= DUPLICATE_PURCHASE_WINDOW_MS) {
        add({ type: "duplicate_purchase", label: "Duplicate purchase event", severity: "WARNING",
          sourceA: `${a.event_name} @ ${a.created_at}`, sourceB: `${b.event_name} @ ${b.created_at}`, at: b.created_at,
          notes: "Two identical purchase events within 10 minutes — purchase counts may be inflated." });
        break;
      }
    }

    // 6 · Activity before the account existed. Compared with the AUTH account,
    //     not the profile row: the profile is written at the username step,
    //     after sign-in, so every Google/Apple user would otherwise be flagged.
    const authAt = d.auth.get(uid)?.created_at;
    if (authAt && evs.length && Date.parse(evs[0].created_at) < Date.parse(authAt) - BEFORE_ACCOUNT_TOLERANCE_MS) {
      add({ type: "event_before_account", label: "Activity before the account was created", severity: "WARNING",
        sourceA: `first event @ ${evs[0].created_at}`, sourceB: `auth account @ ${authAt}`, at: evs[0].created_at,
        notes: "Clock skew on the device, or events attributed to the wrong account." });
    }

    // 7 · The ledger says MORE free scans were used than were ever recorded.
    //     The reverse (more events than ledger) is normal: the ledger started
    //     later and subscription counts reset each period.
    const freeUsed = d.usage.get(uid)?.free_scans_used ?? 0;
    if (plan === "free" && freeUsed > scans.length + linked.length) {
      add({ type: "ledger_ahead_of_events", label: "Ledger counts more scans than were recorded", severity: "WARNING",
        sourceA: `account_usage · ${freeUsed} free scans used`, sourceB: `${scans.length + linked.length} scan_completed`, at: null,
        notes: "Scan events are missing for this user — the dashboard undercounts them." });
    }

    // 8 · Shared device.
    if (d.link?.sharedDeviceUsers.has(uid)) {
      const dev = d.link.sharedDevices.find(x => x.users.includes(uid));
      add({ type: "shared_device", label: "Device shared with other accounts", severity: "INFO",
        sourceA: `anonymous_id ${dev?.anonymousId.slice(0, 8) ?? "?"}…`, sourceB: `${(dev?.users.length ?? 1) - 1} other account(s)`, at: null,
        notes: "Usually a test device. Signed-out activity on it is not attributed to anyone." });
    }
  }

  // ── Event-level counts (not per user) ──────────────────────────────────
  const raw = d.rawEvents ?? [];
  const knownProfiles = new Set((d.allProfileRows ?? []).map(p => p.id));
  const orphans = raw.filter(e => e.user_id && knownProfiles.size > 0 && !knownProfiles.has(e.user_id)).length;
  const internalLeak = d.internalIds ? d.base.profiles.filter(p => d.internalIds!.has(p.id)).length : null;
  const versionLoaded = raw.some(e => e.app_version !== undefined);

  const counts = {
    eventsTotal: exact(raw.length),
    anonymousEvents: exact(d.link?.anonymousEvents ?? 0, "rows with no user_id — written while signed out"),
    linkedByDevice: exact(d.link?.linkedEvents ?? 0, "attributable: the device only ever signed in as one account"),
    ambiguousDevice: exact(d.link?.ambiguousEvents ?? 0, "device shared by several accounts — not attributed"),
    unlinkable: exact(d.link?.unlinkableEvents ?? 0, "device never signed in — cannot be attributed"),
    missingSession: exact(raw.filter(e => !e.session_id).length),
    missingVersion: versionLoaded
      ? exact(raw.filter(e => e.app_version === null || e.app_version === "").length)
      : { value: null, trust: "NOT_TRACKED" as Trust, available: false, note: "app_version not loaded" },
    missingRoute: versionLoaded
      ? exact(raw.filter(e => !e.route).length, "most events are not tied to a screen route by design")
      : { value: null, trust: "NOT_TRACKED" as Trust, available: false, note: "route not loaded" },
    orphanEvents: exact(orphans, "user_id with no profile row at all"),
    internalExcluded: d.internalIds === undefined
      ? { value: null, trust: "NOT_TRACKED" as Trust, available: false, note: "is_internal column missing" }
      : exact(d.internalIds.size, "internal/test accounts excluded from every number"),
    internalLeaked: internalLeak === null ? null : exact(internalLeak, "internal accounts found in scope — must be 0"),
    sharedDevices: exact(d.link?.sharedDevices.length ?? 0),
  };

  /**
   * Scan sources side by side. They measure different things, so they are
   * not expected to match — the note says why, instead of a red flag.
   */
  const ledgerTotal = d.base.profiles.reduce((a, p) => {
    const u = d.usage.get(p.id); return a + (u?.free_scans_used ?? 0) + (u?.subscription_scans_used ?? 0);
  }, 0);
  const reconciliation = [
    { source: "scan_completed events", value: d.allScans.length, meaning: "Scans performed. The dashboard's scan count." },
    { source: "Saved items (scans table)", value: (d.allSaved ?? []).length, meaning: "Items kept in a collection — a subset of scans, plus items saved before analytics existed." },
    { source: "Ledger (account_usage)", value: ledgerTotal, meaning: "Free scans used plus THIS period's subscription scans. Resets each billing period, so lower than lifetime." },
  ];

  const sev = { CONFLICT: 0, WARNING: 1, INFO: 2 } as const;
  issues.sort((a, b) => sev[a.severity] - sev[b.severity] || (b.at ?? "").localeCompare(a.at ?? ""));
  const usersWithProblems = new Set(issues.filter(i => i.severity !== "INFO").map(i => i.userId));
  const inScope = d.base.profiles.length;
  const loader = loaderIntegrity(d.eventsLoaded, d.eventsInDatabase);

  return {
    issues,
    conflicts: issues.filter(i => i.severity === "CONFLICT").length,
    warnings: issues.filter(i => i.severity === "WARNING").length,
    infos: issues.filter(i => i.severity === "INFO").length,
    /**
     * Health = in-scope users with no CONFLICT or WARNING ÷ in-scope users.
     * A defensible denominator: every user either has a problem or does not.
     * INFO items are explained oddities and do not count against it.
     */
    health: derived(inScope - usersWithProblems.size, inScope, "in-scope users with no conflicts or warnings"),
    counts, reconciliation, loader,
    behaviour: {
      scannedNeverSaved: exact(scannedNeverSaved, "scanned but never saved anything"),
      saveRate: derived((d.allSaved ?? []).length, d.allScans.length, "saved items per completed scan"),
      note: "Scanning without saving is normal behaviour, not an integrity issue.",
    },
    scopeNote: "Checks cover users in the current scope and their full history; the date range does not apply.",
  };
}

// ── User Explorer ───────────────────────────────────────────────────────────

export interface ExplorerParams { query?: string; uid?: string }
export const EXPLORER_MAX_RESULTS = 25;
export const EXPLORER_TIMELINE_LIMIT = 400;
const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept only well-formed input; anything else is ignored, never echoed back raw. */
export function parseExplorerParams(q: unknown, uid: unknown): ExplorerParams {
  const query = typeof q === "string" ? q.trim().slice(0, 200) : "";
  const id = typeof uid === "string" && UID_RE.test(uid.trim()) ? uid.trim().toLowerCase() : "";
  return { query: query || undefined, uid: id || undefined };
}

/**
 * Search across EVERY profile — pre-launch, internal and ghost included —
 * because the Explorer is for looking someone up, not for counting. Matches
 * display name, username and email (substring, case-insensitive) and user ID
 * (prefix).
 */
export function searchUsers(d: V4Data, query: string) {
  const q = query.toLowerCase();
  const out: Array<{ userId: string; displayName: string | null; username: string | null; email: string | null;
    createdAt: string; plan: PlanState; inScope: boolean; internal: boolean }> = [];
  for (const p of d.allProfileRows ?? []) {
    const email = d.auth.get(p.id)?.email ?? null;
    const hit = (p.display_name ?? "").toLowerCase().includes(q) || (p.username ?? "").toLowerCase().includes(q)
      || (email ?? "").toLowerCase().includes(q) || p.id.toLowerCase().startsWith(q);
    if (!hit) continue;
    const u = d.rawUsage?.get(p.id);
    out.push({ userId: p.id, displayName: p.display_name, username: p.username, email, createdAt: p.created_at,
      plan: u ? derivePlan(u, d.now) : "free", inScope: d.base.profileIds.has(p.id), internal: !!d.internalIds?.has(p.id) });
    if (out.length >= EXPLORER_MAX_RESULTS) break;
  }
  return out;
}

/**
 * One user's entire history — scope and date range deliberately do not
 * apply. Built from the RAW events so a pre-launch or internal account can
 * still be inspected, with its status shown rather than hidden.
 */
export function exploreUser(d: V4Data, uid: string, rates: { NORMAL: number; HUNT: number; LISTING: number } | null) {
  const prof = (d.allProfileRows ?? []).find(p => p.id === uid);
  if (!prof) return null;
  const evs = (d.rawEvents ?? []).filter(e => e.user_id === uid).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const linked = d.link?.byUser.get(uid) ?? [];
  const usage = d.rawUsage?.get(uid);
  const auth = d.auth.get(uid);
  const plan: PlanState = usage ? derivePlan(usage, d.now) : "free";
  const scans = evs.filter(e => e.event_name === "scan_completed").map(e => e.created_at);
  const saved = (d.rawSaved ?? []).filter(sv => sv.user_id === uid).map(sv => sv.created_at).sort();
  const count = (name: string) => evs.filter(e => e.event_name === name).length;
  const since = (days: number) => iso(ago(d.now, days));
  const versions = evs.map(e => e.app_version).filter((v): v is string => !!v);

  const journey = buildJourney({
    userId: uid, profileCreatedAt: prof.created_at, evs, scans, saved, linked,
    sharedDevice: d.link?.sharedDeviceUsers.has(uid) ?? false, plan, usage, auth, prof,
  });

  const limit = plan === "monthly" ? MONTHLY_SCANS : plan === "annual" ? ANNUAL_SCANS : null;
  const cost = rates
    ? scans.length * rates.NORMAL + count("hunt_scan_started") * rates.HUNT + count("listing_generated") * rates.LISTING
    : null;

  /**
   * Timeline: the user's own events, the device-linked signed-out events
   * (tagged), and the two account-creation moments, in one ascending list.
   * Capped to the most recent rows so a heavy user cannot produce a page
   * that never finishes rendering; the cap is stated, not silent.
   */
  type Row = { at: string; event: string; detail: string; linked: boolean };
  const describe = (e: Ev) => {
    const parts: string[] = [];
    for (const k of ["paywall_source", "selected_plan", "product_id", "errorType", "entry_source", "primary_goal", "reason", "brand", "category"]) {
      const v = metaStr(e, k); if (v) parts.push(`${k.replace(/_/g, " ")}: ${v}`);
    }
    return parts.join(" · ");
  };
  const rows: Row[] = [
    ...evs.map(e => ({ at: e.created_at, event: e.event_name, detail: describe(e), linked: false })),
    ...linked.map(e => ({ at: e.created_at, event: e.event_name, detail: describe(e), linked: true })),
  ];
  if (auth?.created_at) rows.push({ at: auth.created_at, event: "account_created", detail: "auth account", linked: false });
  rows.push({ at: prof.created_at, event: "profile_created", detail: "username saved", linked: false });
  rows.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  const timeline = rows.slice(-EXPLORER_TIMELINE_LIMIT);

  return {
    identity: {
      userId: uid, displayName: prof.display_name, username: prof.username, email: auth?.email ?? null,
      accountCreated: auth?.created_at ?? null, profileCreated: prof.created_at,
      plan, product: usage?.subscription_product_id ?? null, periodEnd: usage?.subscription_period_end ?? null,
      inScope: d.base.profileIds.has(uid), internal: !!d.internalIds?.has(uid),
      sharedDevice: d.link?.sharedDeviceUsers.has(uid) ?? false,
      firstVersion: versions[0] ?? null, lastVersion: versions.at(-1) ?? null,
      firstActive: evs[0]?.created_at ?? null, lastActive: evs.at(-1)?.created_at ?? null,
    },
    balance: {
      freeRemaining: usage ? Math.max(0, FREE_LIFETIME_SCANS - (usage.free_scans_used ?? 0)) : FREE_LIFETIME_SCANS,
      freeUsed: usage?.free_scans_used ?? 0,
      packBalance: usage?.pack_scan_balance ?? 0,
      subscriptionUsed: usage?.subscription_scans_used ?? 0,
      subscriptionLimit: limit,
      hasLedgerRow: !!usage,
    },
    usage: {
      lifetimeScans: scans.length,
      scans7: scans.filter(t => t >= since(7)).length,
      scans30: scans.filter(t => t >= since(30)).length,
      failedScans: count("scan_failed"),
      linkedScans: linked.filter(e => e.event_name === "scan_completed").length,
      savedItems: saved.length,
      sessions: new Set(evs.map(e => e.session_id).filter(Boolean)).size,
      activeDays: new Set(evs.map(e => dayOf(e.created_at))).size,
      listings: count("listing_generated"),
      huntOpens: count("hunt_mode_opened"),
      huntCompletions: count("hunt_ended"),
      progressOpens: count("progress_tab_opened"),
      scanStoreOpens: count("scan_store_opened"),
      // Deep Analysis has no "opened" event — only its paywall is tracked.
      deepAnalysisOpens: null as number | null,
      deepAnalysisPaywalls: evs.filter(e => e.event_name === "paywall_opened" && metaStr(e, "paywall_source") === "deep_analysis").length,
    },
    monetization: {
      firstPaywall: (() => { const e = evs.find(x => x.event_name === "paywall_opened"); return e ? metaStr(e, "paywall_source") : null; })(),
      paywallImpressions: count("paywall_opened"),
      planSelections: count("paywall_plan_selected"),
      purchaseStarts: count("paywall_purchase_started"),
      purchaseCompletions: count("paywall_purchase_completed"),
      cancellations: count("paywall_purchase_cancelled"),
      restores: count("paywall_restore_completed"),
      journey,
    },
    costEstimate: cost,
    timeline,
    timelineTotal: rows.length,
  };
}

// ── Founder Attention ───────────────────────────────────────────────────────

export interface AttentionItem {
  level: "critical" | "warning" | "opportunity" | "info";
  icon: string;
  title: string;
  detail: string;
  anchor: string;
}

/**
 * Rules over numbers already on the page — no model, no guessing. Each rule
 * states its threshold so it can be read and argued with. At most five,
 * most urgent first.
 */
export const ATTENTION_RULES = {
  activationBelow: 0.5,      // fewer than half have scanned
  activationMinUsers: 10,    // below this, a rate is too noisy to call out
  powerUserScans30d: 25,
  funnelMinEntrants: 10,     // a stage needs this many entrants before its drop counts
  funnelDropAtLeast: 0.3,    // and must lose at least this share
};

export function getFounderAttention(m: any): AttentionItem[] {
  const out: AttentionItem[] = [];
  const ok = (x: any) => x && typeof x === "object" && !("error" in x && typeof x.error === "string");
  const di = m.dataIntegrity, act = m.activation, pj = m.paidJourneys, pu = m.powerUserPeak;

  if (ok(di) && (di.loader?.status === "skipped" || di.loader?.status === "duplicated")) {
    out.push({ level: "critical", icon: "🚨", title: "Loader integrity failed",
      detail: `${di.loader.note} Every event-based number on this page is suspect until this is resolved.`, anchor: "dq" });
  }
  if (ok(di) && di.conflicts > 0) {
    const ex = di.issues.find((i: IntegrityIssue) => i.severity === "CONFLICT");
    out.push({ level: "warning", icon: "⚠️", title: `${di.conflicts} analytics conflict${di.conflicts === 1 ? "" : "s"}`,
      detail: ex ? `e.g. ${ex.user ?? "a user"}: ${ex.label.toLowerCase()}.` : "Sources disagree.", anchor: "integrity" });
  }
  if (ok(act)) {
    const total = act.lifecycle?.[0]?.users ?? 0, scanned = act.lifecycle?.[1]?.users ?? 0;
    if (total >= ATTENTION_RULES.activationMinUsers && scanned / total < ATTENTION_RULES.activationBelow) {
      out.push({ level: "warning", icon: "⚠️", title: "Activation bottleneck",
        detail: `${total - scanned} of ${total} users acquired in this range have never completed a scan.`, anchor: "act" });
    }
  }
  if (ok(pj)) {
    const neverScanned = (pj.journeys ?? []).filter((j: PaidJourney) => !j.firstScanAt).length;
    if (neverScanned > 0) {
      out.push({ level: "info", icon: "💡", title: `${neverScanned} paying user${neverScanned === 1 ? " has" : "s have"} never completed a scan`,
        detail: "They paid — mostly at the onboarding offer — but have not used the core feature yet.", anchor: "paid" });
    }
  }
  const fs = m.firstSession;
  if (ok(fs)) {
    // The single worst step after the account, among stages with enough entrants.
    let worst: { from: string; to: string; lost: number; of: number; share: number } | null = null;
    const tracked = (fs.after ?? []).filter((st: FunnelStage) => st.tracked);
    for (let i = 1; i < tracked.length; i++) {
      const prev = tracked[i - 1].reached, cur = tracked[i].reached;
      if (prev < ATTENTION_RULES.funnelMinEntrants) continue;
      const share = (prev - cur) / prev;
      if (share >= ATTENTION_RULES.funnelDropAtLeast && (!worst || share > worst.share)) {
        worst = { from: tracked[i - 1].label, to: tracked[i].label, lost: prev - cur, of: prev, share };
      }
    }
    if (worst) {
      out.push({ level: "warning", icon: "📉", title: `Biggest drop-off: ${worst.from} → ${worst.to}`,
        detail: `${worst.lost} of ${worst.of} users (${(worst.share * 100).toFixed(0)}%) stop here.`, anchor: "funnel" });
    }
    const b = fs.before ?? [];
    const started = b[0]?.reached ?? 0, signedIn = b.at(-1)?.reached ?? 0;
    if (started >= ATTENTION_RULES.funnelMinEntrants && (started - signedIn) / started >= ATTENTION_RULES.funnelDropAtLeast) {
      out.push({ level: "warning", icon: "🚪", title: "Onboarding loses people before sign-up",
        detail: `${started - signedIn} of ${started} devices started onboarding and never signed in.`, anchor: "funnel" });
    }
  }
  const cb = m.costByPlan;
  if (ok(cb) && cb.available) {
    const neg = (cb.monthly?.contribution?.negative ?? 0) + (cb.annual?.contribution?.negative ?? 0);
    if (neg > 0) {
      out.push({ level: "info", icon: "💸", title: `${neg} subscriber${neg === 1 ? "" : "s"} cost more in AI than they pay per month`,
        detail: "Estimated: list price after Apple's fee, minus estimated AI cost over the last 30 days.", anchor: "costplan" });
    }
  }
  const pr = m.pricing;
  if (ok(pr)) {
    const cur = pr.eras?.find((e: any) => e.era.id === pr.currentEraId);
    if (cur && cur.paid7.d > 0) {
      const small = cur.paid7.d < 20 ? `, n=${cur.paid7.d} — small sample` : `, n=${cur.paid7.d}`;
      out.push({ level: "info", icon: "📈", title: `${cur.era.label}: ${cur.paid7.n} of ${cur.paid7.d} subscribed within ${pr.conversionDays} days`,
        detail: `${((cur.paid7.value ?? 0) * 100).toFixed(1)}% 7-day paid conversion${small}. Observational, not causal.`, anchor: "pricing" });
    }
  }
  if (pu && pu.scans30 >= ATTENTION_RULES.powerUserScans30d) {
    out.push({ level: "opportunity", icon: "🔥", title: "Power user",
      detail: `${pu.user ?? "One user"} (${pu.plan}) completed ${pu.scans30} scans in the last 30 days.`, anchor: "explorer" });
  }
  const order = { critical: 0, warning: 1, opportunity: 2, info: 3 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 5);
}

/**
 * The Executive section's headline set — one number per question, each
 * saying which window it uses, taken from the sections that own them.
 */
export function getExecutiveCore(m: any) {
  const ok = (x: any) => x && typeof x === "object" && !(typeof x.error === "string");
  const pick = (x: any, f: (x: any) => any) => ok(x) ? f(x) ?? null : null;
  const pr = ok(m.pricing) ? m.pricing : null;
  const cur = pr?.eras?.find((e: any) => e.era.id === pr.currentEraId) ?? null;
  return {
    newUsers7: pick(m.acquisition, a => a.new7),
    activation: pick(m.activation, a => a.activationRate),
    wau: pick(m.acquisition, a => a.wau),
    payingUsers: pick(m.monetization, mo => mo.totalPaying),
    viewerToPurchase: pick(m.monetization, mo => mo.viewToPurchase),
    d7: pick(m.retentionV2, r => r.d7),
    pricingEraLabel: cur?.era.label ?? null,
    pricingConversion: cur ? cur.paid7 : null,
    topUserScans30: ok(m.powerUserPeak) && m.powerUserPeak ? m.powerUserPeak.scans30 : null,
  };
}

/** The single most active user in scope over the last 30 days. */
export function getPowerUserPeak(d: V4Data) {
  const t30 = iso(ago(d.now, 30));
  const counts = new Map<string, number>();
  for (const sc of d.allScans) if (sc.user_id && sc.created_at >= t30) counts.set(sc.user_id, (counts.get(sc.user_id) ?? 0) + 1);
  let top: string | null = null, n = 0;
  for (const [uid, c] of counts) if (c > n) { n = c; top = uid; }
  if (!top) return null;
  const p = d.profiles.get(top);
  return { userId: top, user: p?.display_name ?? p?.username ?? null, plan: currentPlan(d, top), scans30: n };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function getFounderDashboardV4Metrics(
  v3Metrics: any,
  scope: Scope = "post_launch",
  env: NodeJS.ProcessEnv = process.env,
  rangeParams: { preset?: unknown; from?: unknown; to?: unknown } = {},
  /** The route's single load, shared with V3. Loaded here only if absent. */
  preloaded?: BaseData,
  explorerParams: ExplorerParams = {},
) {
  const cutover = getCutover(env);
  const cohort = getLaunchCohort(scope, env);
  const window = resolveAnalysisWindow(rangeParams, scope, new Date(), env);
  let d: V4Data;
  try { d = await loadV4Data(preloaded, scope, env, window); }
  catch (e: any) { return { ...v3Metrics, v4: null, v4Error: e?.message ?? "failed to load V4 data", cutover, cohort, window }; }

  const safe = <T,>(name: string, fn: () => T): T | { error: string } => { try { return fn(); } catch (e: any) { return { error: `${name}: ${e?.message ?? e}` }; } };
  const paywalls = safe("paywalls", () => getPaywalls(d, cutover));
  const journeys = safe("paidJourneys", () => getPaidJourneys(d));
  const rates = v3Metrics?.cost && !isErrLike(v3Metrics.cost) ? v3Metrics.cost.rates ?? null : null;
  const explorer = await safeAsync("userExplorer", () => getExplorer(d, explorerParams, rates));
  const out: any = {
    ...v3Metrics,
    cutover, cohort, window,
    dataIntegrity: safe("dataIntegrity", () => getDataIntegrity(d)),
    powerUserPeak: safe("powerUserPeak", () => getPowerUserPeak(d)),
    pricing: safe("pricing", () => getPricingExperiments(d, env)),
    freeToPaid: safe("freeToPaid", () => getFreeToPaid(d)),
    distributions: safe("distributions", () => getUsageDistributions(d, rates)),
    powerUsers: safe("powerUsers", () => getPowerUsers(d, rates)),
    firstSession: safe("firstSession", () => getFirstSessionFunnel(d)),
    featureAdoption: safe("featureAdoption", () => getFeatureAdoption(d)),
    paywallIntel: safe("paywallIntel", () => getPaywallIntelligence(d, env)),
    retentionSegments: safe("retentionSegments", () => getRetentionSegments(d)),
    appVersions: safe("appVersions", () => getAppVersions(d)),
    acquisitionSource: safe("acquisitionSource", () => getAcquisitionSource(d, env)),
    costByPlan: safe("costByPlan", () => getCostByPlan(d, rates, env)),
    userExplorer: explorer,
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
  // Last: these read the finished metrics, never raw data, so they can only
  // ever restate what the page itself shows.
  out.executiveCore = safe("executiveCore", () => getExecutiveCore(out));
  out.founderAttention = safe("founderAttention", () => getFounderAttention(out));
  return out;
}

async function safeAsync<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try { return await fn(); } catch (e: any) { return { error: `${name}: ${e?.message ?? e}` }; }
}

/**
 * Collection counts for ONE selected user — three small count queries, run
 * only when a user is selected. Each failure degrades to null on its own.
 */
async function collectionCounts(uid: string) {
  const one = async (table: string) => {
    try { return await countRows(table, { col: "user_id", eq: uid }); } catch { return null; }
  };
  const [achievements, brands, diamonds] = await Promise.all([
    one("user_achievements"), one("user_brand_discoveries"), one("user_diamond_discoveries"),
  ]);
  return { achievements, brands, diamonds };
}

async function getExplorer(d: V4Data, params: ExplorerParams, rates: any) {
  const results = params.query ? searchUsers(d, params.query) : null;
  const user = params.uid ? exploreUser(d, params.uid, rates) : null;
  const collections = user ? await collectionCounts(params.uid!) : null;
  return {
    // The query is echoed back only so the search box keeps its text; it is
    // escaped at render and never placed in a URL.
    query: params.query ?? null,
    results,
    selectedUid: params.uid ?? null,
    user: user ? { ...user, collections } : null,
    notFound: !!params.uid && !user,
  };
}