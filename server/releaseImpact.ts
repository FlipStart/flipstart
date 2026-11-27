/**
 * server/releaseImpact.ts
 *
 * Founder Dashboard V5 — Release Impact: did the new version make things
 * better than the one before it?
 *
 * Three bases, because one comparison can't answer all three questions
 * honestly (approved in Phase 0):
 *
 *   1. NEW USERS, by the version they started on — activation, paying,
 *      retention. Users whose first event was on the baseline version and who
 *      signed up in the window BEFORE the release, against users whose first
 *      event was on the new version and who signed up in the matched window
 *      AFTER it. A force update moves every existing user onto the new
 *      version, so only first-version cohorts compare like with like.
 *   2. ACTIVITY on each version — reliability and engagement: what happened
 *      on the baseline before the release vs on the new version after it,
 *      over windows of the same length.
 *   3. AI ENGINE, by prompt version and model — scan outcomes from the
 *      server. Prompts and models change on the server independently of app
 *      releases, so they are their own axis.
 *
 * Honesty rules, all enforced here rather than in the page:
 *   • every cell carries its n; below 30 it is NOISY
 *   • a cohort metric only counts users old enough for it (a 7-day number
 *     needs 7 days); none old enough → IMMATURE, some → PARTIAL with how many
 *   • a metric the baseline version never recorded is NOT TRACKED, never 0%
 *   • better/worse is only called when both sides have n ≥ 30 AND the
 *     difference clears a two-proportion test at 95%; otherwise "too few to
 *     call" or "no clear change". No colour without that.
 *
 * Configuration (Railway env, all optional):
 *   RELEASE_IMPACT_VERSION   the release being judged; default: the highest
 *                            version seen in events
 *   RELEASE_IMPACT_AT        when it went live on the App Store (ISO). Until
 *                            set, the first event on that version is used and
 *                            the page says so — that is often a TestFlight build
 *   RELEASE_IMPACT_BASELINE  the version it replaced; default: the earlier
 *                            version most users were on in the 28 days before
 *
 * Pure apart from loadOutcomeVersions(). The date range on the page does not
 * apply: the comparison sets its own matched windows.
 */
import { fetchAll } from "./founderMetrics";
import { centralDay, addCentralDays } from "./dashboardDates";

export const NOISY_BELOW = 30;
export const MAX_WINDOW_DAYS = 28;
const HOUR = 3_600_000, DAY = 86_400_000;
const Z95 = 1.96;

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface RIEvent {
  user_id: string | null;
  event_name: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  app_version?: string | null;
}

export interface OutcomeVersionRow {
  created_at: string;
  kind: "ok" | "soft" | "hard";
  failure_group: string | null;
  confidence_tier: string | null;
  duration_ms: number | null;
  prompt_version?: string | null;
  model?: string | null;
}

export type LoadedOutcomeVersions =
  | { ok: true; versionsRecorded: boolean; rows: OutcomeVersionRow[] }
  | { ok: false; note: string };

export interface ReleaseInput {
  /** Every event in scope, unwindowed. */
  events: RIEvent[];
  /** Account creation per user (auth, else profile). */
  accountCreatedAt: (uid: string) => string | null | undefined;
  /** First SUBSCRIPTION purchase per user (scan packs excluded, as in Pricing). */
  firstSubscriptionAt: (uid: string) => string | null | undefined;
  outcomes: LoadedOutcomeVersions;
  now: Date;
  env?: NodeJS.ProcessEnv;
}

/** scan_outcomes since a time, with prompt_version/model when the table has them. */
export async function loadOutcomeVersions(sinceIso: string): Promise<LoadedOutcomeVersions> {
  const base = "id, created_at, kind, failure_group, confidence_tier, duration_ms";
  const opts = { gte: { col: "created_at", val: sinceIso }, order: ["created_at", "id"] };
  const missingTable = (m: string) => /relation .*scan_outcomes.* does not exist|42P01|PGRST205/i.test(m);
  try {
    return { ok: true, versionsRecorded: true, rows: await fetchAll<OutcomeVersionRow>("scan_outcomes", `${base}, prompt_version, model`, opts) };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (missingTable(msg)) return { ok: false, note: "scan_outcomes doesn't exist yet, so there are no server-side scan numbers." };
    // The 2.2.2 columns aren't there yet: read the rest, say versions aren't recorded.
    if (/prompt_version|model/i.test(msg)) {
      try { return { ok: true, versionsRecorded: false, rows: await fetchAll<OutcomeVersionRow>("scan_outcomes", base, opts) }; }
      catch (e2: any) { return { ok: false, note: `scan_outcomes couldn't be read: ${String(e2?.message ?? e2).slice(0, 160)}` }; }
    }
    return { ok: false, note: `scan_outcomes couldn't be read: ${msg.slice(0, 160)}` };
  }
}

// ── Versions and windows ─────────────────────────────────────────────────────

/** Ascending: "2.10.0" after "2.9.3". Non-numeric versions sort first and never win "highest". */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  const okA = pa.every(Number.isFinite), okB = pb.every(Number.isFinite);
  if (okA !== okB) return okA ? 1 : -1;
  if (!okA) return a.localeCompare(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const ver = (e: RIEvent) => (typeof e.app_version === "string" && e.app_version.trim()) || null;

export interface Span { start: number; end: number }
export interface ReleaseConfig {
  target: string | null;
  baseline: string | null;
  releaseAt: string | null;
  releaseAtSource: "env" | "first_seen" | null;
  baselineSource: "env" | "most_used" | null;
  /** Matched window length, in days (fractional). 0 = nothing to compare yet. */
  windowDays: number;
  pre: Span | null;
  post: Span | null;
  /** Things the reader must know before trusting the page. */
  problems: string[];
}

export function releaseConfig(events: RIEvent[], env: NodeJS.ProcessEnv, now: Date): ReleaseConfig {
  const problems: string[] = [];
  const versions = [...new Set(events.map(ver).filter((v): v is string => !!v))].sort(cmpVersion);
  const envTarget = env.RELEASE_IMPACT_VERSION?.trim() || null;
  const target = envTarget ?? versions[versions.length - 1] ?? null;
  const out: ReleaseConfig = { target, baseline: null, releaseAt: null, releaseAtSource: null, baselineSource: null, windowDays: 0, pre: null, post: null, problems };
  if (!target) { problems.push("No events carry an app version yet, so there is nothing to compare."); return out; }

  // When it went live.
  const rawAt = env.RELEASE_IMPACT_AT?.trim();
  let at: number | null = null;
  if (rawAt) {
    const t = Date.parse(rawAt);
    if (Number.isFinite(t)) { at = t; out.releaseAtSource = "env"; }
    else problems.push(`RELEASE_IMPACT_AT ("${rawAt.slice(0, 40)}") isn't a date. Use an ISO time like 2026-11-30T18:00:00-06:00.`);
  }
  if (at === null) {
    const first = events.filter(e => ver(e) === target).reduce<string | null>((m, e) => (!m || e.created_at < m ? e.created_at : m), null);
    if (first) {
      at = Date.parse(first); out.releaseAtSource = "first_seen";
      problems.push(`Release time not set, so the comparison starts at the first event on ${target}, which is often a TestFlight build. Set RELEASE_IMPACT_AT on Railway to when ${target} went live on the App Store.`);
    } else {
      problems.push(`No events on ${target} yet.`);
      return out;
    }
  }
  out.releaseAt = new Date(at).toISOString();
  const elapsed = now.getTime() - at;
  if (elapsed <= 0) { problems.push(`${target} isn't live yet (release time is in the future).`); return out; }

  const L = Math.min(elapsed, MAX_WINDOW_DAYS * DAY);
  out.windowDays = L / DAY;
  out.pre = { start: at - L, end: at };
  out.post = { start: at, end: at + L };

  // What it replaced.
  const envBase = env.RELEASE_IMPACT_BASELINE?.trim() || null;
  if (envBase) { out.baseline = envBase; out.baselineSource = "env"; }
  else {
    const lookback = { start: at - MAX_WINDOW_DAYS * DAY, end: at };
    const usersOn = new Map<string, Set<string>>();
    for (const e of events) {
      const v = ver(e); if (!v || !e.user_id || v === target || cmpVersion(v, target) > 0) continue;
      const t = Date.parse(e.created_at); if (!(t >= lookback.start && t < lookback.end)) continue;
      (usersOn.get(v) ?? usersOn.set(v, new Set()).get(v)!).add(e.user_id);
    }
    const best = [...usersOn.entries()].sort((a, b) => b[1].size - a[1].size || cmpVersion(b[0], a[0]))[0];
    if (best) { out.baseline = best[0]; out.baselineSource = "most_used"; }
    else problems.push(`No earlier version had users in the ${MAX_WINDOW_DAYS} days before ${target}, so there's no baseline. Set RELEASE_IMPACT_BASELINE to choose one.`);
  }
  if (out.windowDays < 1) problems.push(`${target} has been live under a day. Every number here is early.`);
  return out;
}

// ── Cells and comparisons ────────────────────────────────────────────────────

export type CellStatus = "complete" | "partial" | "immature" | "not_tracked" | "none";
export interface Cell {
  value: number | null;
  /** Rates: hits / eligible. */
  n?: number;
  d?: number;
  /** Cohort size before the maturity cut. */
  total?: number;
  status: CellStatus;
  noisy: boolean;
  /** When the first user reaches the horizon (immature cells). */
  matureOn?: string | null;
  note?: string;
}
export type Call = "better" | "worse" | "no_clear_change" | "too_few" | "not_comparable" | "no_test";
export interface CompareRow {
  key: string;
  label: string;
  kind: "rate" | "hours" | "per_user" | "count";
  better: "higher" | "lower" | null;
  base: Cell;
  target: Cell;
  /** target − base: percentage points for rates, raw units otherwise. Null when not comparable. */
  change: number | null;
  call: Call;
  help?: string;
}

const none = (note?: string): Cell => ({ value: null, status: "none", noisy: false, note });
const notTracked = (note: string): Cell => ({ value: null, status: "not_tracked", noisy: false, note });

function rateCell(n: number, d: number, total?: number, matureOn?: string | null): Cell {
  if (total !== undefined && total === 0) return none("no users in this cohort");
  if (d === 0) return { value: null, n: 0, d: 0, total, status: total ? "immature" : "none", noisy: false, matureOn: matureOn ?? null };
  return { value: n / d, n, d, total, status: total !== undefined && d < total ? "partial" : "complete", noisy: d < NOISY_BELOW, matureOn: matureOn ?? null };
}

/** Two-proportion z-test at 95%. Only called when both sides have n ≥ 30. */
export function propTest(n1: number, d1: number, n2: number, d2: number): { z: number; significant: boolean } {
  const p = (n1 + n2) / (d1 + d2);
  const se = Math.sqrt(p * (1 - p) * (1 / d1 + 1 / d2));
  if (!(se > 0)) return { z: 0, significant: false };
  const z = (n2 / d2 - n1 / d1) / se;
  return { z, significant: Math.abs(z) >= Z95 };
}

export function compare(key: string, label: string, kind: CompareRow["kind"], better: CompareRow["better"], base: Cell, target: Cell, help?: string): CompareRow {
  const row: CompareRow = { key, label, kind, better, base, target, change: null, call: "not_comparable", help };
  if (base.value === null || target.value === null) return row;
  row.change = kind === "rate" ? (target.value - base.value) * 100 : target.value - base.value;
  // Volumes depend on how many people showed up, not on the release: no verdict.
  if (kind === "count") { row.call = "no_test"; return row; }
  if (kind !== "rate" || base.d === undefined || target.d === undefined || base.n === undefined || target.n === undefined) {
    row.call = base.noisy || target.noisy ? "too_few" : "no_test";
    return row;
  }
  if (base.d < NOISY_BELOW || target.d < NOISY_BELOW) { row.call = "too_few"; return row; }
  const t = propTest(base.n, base.d, target.n, target.d);
  if (!t.significant || !better) { row.call = t.significant ? "no_test" : "no_clear_change"; return row; }
  const up = target.value > base.value;
  row.call = (better === "higher") === up ? "better" : "worse";
  return row;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const inSpan = (s: Span, iso: string) => { const t = Date.parse(iso); return t >= s.start && t < s.end; };

// ── Basis 1: new users by first version ─────────────────────────────────────

interface UserIndex {
  firstVersion: Map<string, string>;
  scanTimes: Map<string, number[]>;
  activeDays: Map<string, Set<string>>;
  firstDay: Map<string, string>;
}

function indexUsers(events: RIEvent[]): UserIndex {
  const firstVersion = new Map<string, string>(), firstVersionAt = new Map<string, string>();
  const scanTimes = new Map<string, number[]>(), activeDays = new Map<string, Set<string>>(), firstDay = new Map<string, string>();
  for (const e of events) {
    if (!e.user_id) continue;
    const v = ver(e);
    if (v) { const at = firstVersionAt.get(e.user_id); if (!at || e.created_at < at) { firstVersionAt.set(e.user_id, e.created_at); firstVersion.set(e.user_id, v); } }
    if (e.event_name === "scan_completed") (scanTimes.get(e.user_id) ?? scanTimes.set(e.user_id, []).get(e.user_id)!).push(Date.parse(e.created_at));
    const day = centralDay(e.created_at);
    if (day) {
      (activeDays.get(e.user_id) ?? activeDays.set(e.user_id, new Set()).get(e.user_id)!).add(day);
      const f = firstDay.get(e.user_id); if (!f || day < f) firstDay.set(e.user_id, day);
    }
  }
  for (const l of scanTimes.values()) l.sort((a, b) => a - b);
  return { firstVersion, scanTimes, activeDays, firstDay };
}

interface CohortSide {
  users: number;
  act24: Cell; act7: Cell; second7: Cell; hoursToFirst: Cell; paid7: Cell; d1: Cell; d7: Cell;
}

function cohortSide(version: string, span: Span, users: string[], ix: UserIndex, input: ReleaseInput): CohortSide {
  const now = input.now.getTime();
  const created = (u: string) => Date.parse(input.accountCreatedAt(u) ?? "");
  const members = users.filter(u => ix.firstVersion.get(u) === version && inSpan(span, input.accountCreatedAt(u) ?? ""));
  const firstMature = (h: number) => {
    const t = members.map(created).filter(Number.isFinite).sort((a, b) => a - b)[0];
    return t === undefined ? null : new Date(t + h).toISOString();
  };
  const horizon = (h: number, hit: (u: string, start: number) => boolean): Cell => {
    let n = 0, d = 0;
    for (const u of members) {
      const s = created(u); if (!Number.isFinite(s) || s + h > now) continue;
      d++; if (hit(u, s)) n++;
    }
    return rateCell(n, d, members.length, firstMature(h));
  };
  const scansWithin = (u: string, s: number, h: number) => (ix.scanTimes.get(u) ?? []).filter(t => t >= s - HOUR && t < s + h).length;
  // Matched to the 7-day horizon, so a cohort only days old can't look faster
  // just because its slow scanners haven't scanned yet.
  const hours: number[] = [];
  for (const u of members) {
    const s = created(u); if (!Number.isFinite(s) || s + 7 * DAY > now) continue;
    const f = (ix.scanTimes.get(u) ?? []).find(t => t >= s - HOUR && t < s + 7 * DAY);
    if (f !== undefined) hours.push(Math.max(0, (f - s) / HOUR));
  }
  const hoursCell: Cell = members.length === 0 ? none("no users in this cohort")
    : hours.length ? { value: median(hours), d: hours.length, total: members.length, status: "complete", noisy: hours.length < NOISY_BELOW }
    : { value: null, d: 0, total: members.length, status: "immature", noisy: false, matureOn: firstMature(7 * DAY) };

  const today = centralDay(input.now);
  const retention = (k: number): Cell => {
    let n = 0, d = 0, total = 0, earliest: string | null = null;
    for (const u of members) {
      const f = ix.firstDay.get(u); if (!f) continue;
      total++;
      const due = addCentralDays(f, k + 1);
      if (!due) continue;
      if (due > today) { if (!earliest || due < earliest) earliest = due; continue; }
      d++; if (ix.activeDays.get(u)!.has(addCentralDays(f, k) ?? "")) n++;
    }
    return rateCell(n, d, total, earliest);
  };
  return {
    users: members.length,
    act24: horizon(DAY, (u, s) => scansWithin(u, s, DAY) >= 1),
    act7: horizon(7 * DAY, (u, s) => scansWithin(u, s, 7 * DAY) >= 1),
    second7: horizon(7 * DAY, (u, s) => scansWithin(u, s, 7 * DAY) >= 2),
    hoursToFirst: hoursCell,
    paid7: horizon(7 * DAY, (u, s) => { const p = Date.parse(input.firstSubscriptionAt(u) ?? ""); return Number.isFinite(p) && p < s + 7 * DAY; }),
    d1: retention(1), d7: retention(7),
  };
}

// ── Basis 2: activity on each version ───────────────────────────────────────

const RATINGS = ["STRONG_BUY", "BUY", "RISKY_BUY", "SKIP"] as const;

interface ActivitySide {
  activeUsers: Cell; attempts: Cell; visibleFailure: Cell; scansPerUser: Cell; paywallToPurchase: Cell;
  saveRate: Cell; huntsPerUser: Cell; crashesPer100: Cell;
  ratingMix: { total: number; counts: Record<string, number> } | null;
}

function activitySide(version: string, span: Span, events: RIEvent[]): ActivitySide {
  const on = events.filter(e => ver(e) === version && inSpan(span, e.created_at));
  const users = new Set(on.filter(e => e.user_id).map(e => e.user_id!));
  const count = (name: string) => on.filter(e => e.event_name === name).length;
  const completed = count("scan_completed");
  // A continued soft fail logs both events; it ended in a result.
  const continued = on.filter(e => e.event_name === "scan_completed" && e.metadata?.continuedAfterSoftFail === true).length;
  const failed = Math.max(0, count("scan_failed") - continued);
  const attempts = completed + failed;
  const viewers = new Set(on.filter(e => e.event_name === "paywall_opened" && e.user_id).map(e => e.user_id!));
  const buyers = new Set(on.filter(e => e.event_name === "paywall_purchase_completed" && e.user_id).map(e => e.user_id!));
  const perUser = (x: number): Cell => users.size ? { value: x / users.size, d: users.size, status: "complete", noisy: users.size < NOISY_BELOW } : none("no active users");
  const shown = on.filter(e => e.event_name === "scan_completed" && typeof e.metadata?.recommendation_shown === "string" && (RATINGS as readonly string[]).includes(e.metadata!.recommendation_shown as string));
  const counts: Record<string, number> = Object.fromEntries(RATINGS.map(r => [r, 0]));
  for (const e of shown) counts[e.metadata!.recommendation_shown as string]++;
  return {
    activeUsers: { value: users.size, status: "complete", noisy: users.size < NOISY_BELOW, d: users.size },
    attempts: { value: attempts, status: "complete", noisy: attempts < NOISY_BELOW, d: attempts },
    visibleFailure: attempts ? rateCell(failed, attempts) : none("no scan attempts"),
    scansPerUser: perUser(completed),
    paywallToPurchase: viewers.size ? rateCell([...buyers].filter(u => viewers.has(u)).length, viewers.size) : none("no paywall viewers"),
    saveRate: completed ? rateCell(Math.min(count("scan_saved"), completed), completed) : none("no completed scans"),
    huntsPerUser: perUser(count("hunt_started")),
    crashesPer100: users.size ? { value: (count("screen_crashed") / users.size) * 100, d: users.size, status: "complete", noisy: users.size < NOISY_BELOW } : none("no active users"),
    ratingMix: shown.length ? { total: shown.length, counts } : null,
  };
}

// ── Basis 3: AI engine by prompt and model ──────────────────────────────────

export interface EngineRow {
  promptVersion: string | null;
  model: string | null;
  label: string;
  attempts: number;
  results: number;
  failureRate: Cell;
  softRate: Cell;
  highConfidence: Cell;
  medianSeconds: Cell;
  firstSeen: string;
  lastSeen: string;
}

function engineRows(rows: OutcomeVersionRow[], span: Span): EngineRow[] {
  const groups = new Map<string, OutcomeVersionRow[]>();
  for (const r of rows) {
    if (!inSpan(span, r.created_at)) continue;
    const k = `${r.prompt_version ?? ""}\u0000${r.model ?? ""}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()].map(([k, rs]): EngineRow => {
    const [pv, model] = k.split("\u0000");
    const results = rs.filter(r => r.kind === "ok" || r.kind === "soft");
    const failures = rs.filter(r => r.kind === "hard" && r.failure_group === "failure");
    const attempts = results.length + failures.length;
    const secs = results.map(r => r.duration_ms).filter((x): x is number => typeof x === "number" && x >= 0).map(x => x / 1000);
    const times = rs.map(r => r.created_at).sort();
    const label = !pv && !model ? "Not recorded (scans before the 2.2.2 server)" : `${pv || "?"} · ${model || "?"}`;
    return {
      promptVersion: pv || null, model: model || null, label,
      attempts, results: results.length,
      failureRate: attempts ? rateCell(failures.length, attempts) : none(),
      softRate: results.length ? rateCell(results.filter(r => r.kind === "soft").length, results.length) : none(),
      highConfidence: results.length ? rateCell(results.filter(r => r.confidence_tier === "high").length, results.length) : none(),
      medianSeconds: secs.length ? { value: median(secs), d: secs.length, status: "complete" as const, noisy: secs.length < NOISY_BELOW } : none(),
      firstSeen: times[0], lastSeen: times[times.length - 1],
    };
  }).sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : b.lastSeen < a.lastSeen ? -1 : 0));
}

// ── The whole comparison ─────────────────────────────────────────────────────

export const RULES = [
  "Every number shows how many people or scans it rests on (n).",
  `Under ${NOISY_BELOW}, a number is marked noisy and never called better or worse.`,
  "A number that needs time (7-day activation, D7) only counts users old enough for it: none yet is immature, some is partial.",
  "Something the old version never recorded is shown as not tracked, never as 0%.",
  `Better or worse is only called when both sides have ${NOISY_BELOW}+ and the gap clears a standard 95% test. Otherwise: no clear change.`,
];

export function buildReleaseImpact(input: ReleaseInput) {
  const env = input.env ?? process.env;
  const config = releaseConfig(input.events, env, input.now);
  const ready = !!(config.target && config.pre && config.post);
  const base = config.baseline;

  const ix = indexUsers(input.events);
  const users = [...ix.firstVersion.keys()];
  const empty = (): CohortSide => ({ users: 0, act24: none(), act7: none(), second7: none(), hoursToFirst: none(), paid7: none(), d1: none(), d7: none() });
  const cB = ready && base ? cohortSide(base, config.pre!, users, ix, input) : empty();
  const cT = ready ? cohortSide(config.target!, config.post!, users, ix, input) : empty();

  const cohorts: CompareRow[] = [
    compare("newUsers", "New users", "count", null,
      { value: cB.users, status: "complete", noisy: cB.users < NOISY_BELOW, d: cB.users },
      { value: cT.users, status: "complete", noisy: cT.users < NOISY_BELOW, d: cT.users },
      "Signed up in the window and started on this version."),
    compare("act24", "First scan within 24h", "rate", "higher", cB.act24, cT.act24, "Immediate activation: did the app give value quickly?"),
    compare("act7", "Activation (first scan within 7 days)", "rate", "higher", cB.act7, cT.act7, "The canonical activation definition."),
    compare("second7", "Second scan within 7 days", "rate", "higher", cB.second7, cT.second7),
    compare("hoursToFirst", "Median time to first scan (hours)", "hours", "lower", cB.hoursToFirst, cT.hoursToFirst,
      "Users who scanned within 7 days of signing up, and are 7+ days old."),
    compare("paid7", "Paid within 7 days (subscription)", "rate", "higher", cB.paid7, cT.paid7, "Scan packs excluded, as in Pricing."),
    compare("d1", "D1 retention", "rate", "higher", cB.d1, cT.d1, "Active the Central day after their first day."),
    compare("d7", "D7 retention", "rate", "higher", cB.d7, cT.d7, "Active on the 7th Central day after their first day."),
  ];

  const aB = ready && base ? activitySide(base, config.pre!, input.events) : null;
  const aT = ready ? activitySide(config.target!, config.post!, input.events) : null;
  const pick = (a: ActivitySide | null, k: keyof Omit<ActivitySide, "ratingMix">): Cell => a ? a[k] : none();
  const activity: CompareRow[] = [
    compare("activeUsers", "Active users", "count", null, pick(aB, "activeUsers"), pick(aT, "activeUsers")),
    compare("attempts", "Scan attempts", "count", null, pick(aB, "attempts"), pick(aT, "attempts")),
    compare("visibleFailure", "Scans that ended on a fail screen", "rate", "lower", pick(aB, "visibleFailure"), pick(aT, "visibleFailure"),
      "What the user saw: fail screens ÷ (results + fail screens), from the app's own events. A soft fail they continued past counts as a result."),
    compare("scansPerUser", "Scans per active user", "per_user", "higher", pick(aB, "scansPerUser"), pick(aT, "scansPerUser")),
    compare("saveRate", "Scans saved", "rate", "higher", pick(aB, "saveRate"), pick(aT, "saveRate")),
    compare("paywallToPurchase", "Paywall viewers who purchased", "rate", "higher", pick(aB, "paywallToPurchase"), pick(aT, "paywallToPurchase"),
      "Viewers on this version in the window who bought in it."),
    compare("huntsPerUser", "Hunts started per active user", "per_user", "higher", pick(aB, "huntsPerUser"), pick(aT, "huntsPerUser")),
    compare("crashesPer100", "Crash screens per 100 active users", "per_user", "lower", pick(aB, "crashesPer100"), pick(aT, "crashesPer100")),
  ];

  // The shown rating only exists from 2.2.2. The old side is NOT TRACKED, not 0.
  const ratingMix = ready ? {
    base: aB?.ratingMix ?? null, target: aT?.ratingMix ?? null,
    baseNote: aB?.ratingMix ? null : `Not tracked on ${base ?? "the baseline"}: the rating users saw was first recorded in 2.2.2.`,
  } : null;

  // AI engine: the whole comparison span, both windows together.
  let engine: { status: "ok" | "unavailable"; versionsRecorded: boolean; note: string | null; rows: EngineRow[] };
  if (!ready) engine = { status: "unavailable", versionsRecorded: false, note: null, rows: [] };
  else if (!input.outcomes.ok) engine = { status: "unavailable", versionsRecorded: false, note: input.outcomes.note, rows: [] };
  else {
    const span = { start: config.pre!.start, end: config.post!.end };
    engine = {
      status: "ok", versionsRecorded: input.outcomes.versionsRecorded,
      note: input.outcomes.versionsRecorded ? null : "scan_outcomes has no prompt_version / model columns yet: run drizzle/sql/prelaunch_2_2_2.sql. Until then every scan shows as not recorded.",
      rows: engineRows(input.outcomes.rows, span),
    };
  }

  const byKey = (rows: CompareRow[], k: string) => rows.find(r => r.key === k)!;
  return {
    config,
    ready,
    cohorts,
    activity,
    ratingMix,
    engine,
    /** The four tiles on Executive. */
    strip: [byKey(cohorts, "act7"), byKey(cohorts, "paid7"), byKey(cohorts, "d1"), byKey(activity, "visibleFailure")],
    rules: RULES,
  };
}

export type ReleaseImpact = ReturnType<typeof buildReleaseImpact>;