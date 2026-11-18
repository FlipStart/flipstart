/**
 * server/founderHuntJourney.ts
 *
 * Three Founder Dashboard sections:
 *
 *   Hunt XP              — who has earned XP, how much, streaks, top hunters.
 *   Hunt Levels          — how many accounts sit on each animal rank.
 *   Last 50 New Phones   — one row per phone, newest first: onboarding,
 *                          account, paywalls, scans, saves, Hunt, brands,
 *                          XP, purchases.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 * XP and rank come from `xp_profiles`. It holds CURRENT totals only, so the
 * lifetime cards ignore the date range. Rank is recomputed from total XP with
 * the same ladder the app uses (shared/hunt/ranks.ts, one copy for the app,
 * the server and this dashboard) rather than trusting the stored rank name.
 *
 * "XP earned in range" and "rank-ups in range" come from the SERVER's record
 * of every Hunt it scored (the `hunts` table, written in the same transaction
 * as the XP ledger), as soon as it holds one. Before that (the server tables
 * not created yet, or no Hunt scored yet) they fall back to the app's
 * `hunt_xp_awarded` event, and say which source they used. The app's event
 * misses Hunts finished offline; the server's record cannot.
 *
 * Streaks are the WEEKLY streak the server keeps (the one that pays XP) once
 * its columns exist; before that, the old daily streak.
 *
 * Brands unlocked come from `user_brand_discoveries` (the Brand Compendium),
 * counted as distinct brands per account.
 *
 * ── Phones ──────────────────────────────────────────────────────────────────
 * A phone is an analytics `anonymous_id`. It lives in AsyncStorage, so a
 * reinstall is a new phone. Its journey is every event written on it plus,
 * when exactly one account ever signed in on it, that account's events from
 * other phones after this phone's first open. A phone that signed into an
 * account created well before its first open is a reinstall or a new device
 * for an existing user, and is labelled so; the summary counts only new
 * people. Like the User Explorer, this section ignores scope and date range.
 */
import { fetchAll } from "./founderMetrics";
import { derivePlan } from "./monetization/policy";
import { centralDay } from "./dashboardDates";
// THE ladder: the same constant the app and Hunt completion use.
import { RANK_LADDER, rankIndexFor } from "../shared/hunt/ranks";
import type { V4Data, Metric } from "./founderMetricsV4";
import type { LbData } from "./founderLeaderboard";

type Ev = V4Data["rawEvents"][number];

const DAY = 86_400_000;
/** An account created up to this long before a phone's first open still counts as made on that phone. */
export const NEW_ACCOUNT_TOLERANCE_MS = 10 * 60_000;
export const NEW_PHONES_LIMIT = 50;
export const TOP_HUNTERS = 10;
export const XP_EVENT = "hunt_xp_awarded";
export const STEP_EVENT = "onboarding_step_viewed";

/** The shared ladder (shared/hunt/ranks.ts). Not a copy. */
export const HUNT_RANKS: ReadonlyArray<{ xp: number; rank: string }> = RANK_LADDER;
export { rankIndexFor };

// ── Loading ──────────────────────────────────────────────────────────────────

export interface XpRow {
  user_id: string;
  total_xp: number | string | null;
  current_rank: string | null;
  completed_hunts: number | string | null;
  hunt_streak: number | string | null;
  last_hunt_date: string | null;
  /** Server-kept (hunt_xp_phase1.sql). Undefined before those columns exist. */
  week_streak?: number | string | null;
  last_streak_week?: string | null;
}

export interface HuntData {
  xp: XpRow[];
  /** Distinct Brand Compendium brands per account. */
  brandsByUser: Map<string, number>;
  xpError?: string;
  brandsError?: string;
}

/** Two queries. Each fails on its own; a failure is reported, never read as zero. */
export async function loadHuntData(): Promise<HuntData> {
  const out: HuntData = { xp: [], brandsByUser: new Map() };
  const XP_COLS = "user_id, total_xp, current_rank, completed_hunts, hunt_streak, last_hunt_date";
  const [xp, brands] = await Promise.allSettled([
    // The weekly-streak columns arrive with hunt_xp_phase1.sql. Without them, the old columns alone.
    fetchAll<XpRow>("xp_profiles", `${XP_COLS}, week_streak, last_streak_week`, { order: ["user_id"] })
      .catch(() => fetchAll<XpRow>("xp_profiles", XP_COLS, { order: ["user_id"] })),
    fetchAll<{ user_id: string | null; brand_id: string | null }>("user_brand_discoveries",
      "user_id, brand_id", { order: ["user_id", "brand_id"] }),
  ]);
  if (xp.status === "fulfilled") out.xp = xp.value;
  else out.xpError = `xp_profiles: ${xp.reason?.message ?? xp.reason}`;
  if (brands.status === "fulfilled") out.brandsByUser = countBrands(brands.value);
  else out.brandsError = `user_brand_discoveries: ${brands.reason?.message ?? brands.reason}`;
  return out;
}

export function countBrands(rows: Array<{ user_id: string | null; brand_id: string | null }>): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.user_id || !r.brand_id) continue;
    (sets.get(r.user_id) ?? sets.set(r.user_id, new Set()).get(r.user_id)!).add(r.brand_id);
  }
  return new Map([...sets].map(([u, s]) => [u, s.size]));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const n0 = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const meta = (e: Ev, k: string): unknown => (e.metadata && typeof e.metadata === "object") ? e.metadata[k] : undefined;
const metaStr = (e: Ev, k: string): string | null => { const v = meta(e, k); return typeof v === "string" ? v : null; };
const metaNum = (e: Ev, k: string): number | null => { const v = meta(e, k); return typeof v === "number" && Number.isFinite(v) ? v : null; };
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const userName = (d: V4Data, uid: string): string | null => {
  const p = d.profiles.get(uid);
  return p?.display_name ?? p?.username ?? null;
};
const exact = (value: number | null, extra: Partial<Metric> = {}): Metric => ({ value, trust: "EXACT", ...extra } as Metric);
const rateOf = (n: number, d: number): Metric => ({ value: d ? n / d : null, trust: "DERIVED", n, d } as Metric);

/** Rows for accounts in the current scope. */
function scopedXp(d: V4Data, h: HuntData): XpRow[] {
  if (h.xpError) throw new Error(h.xpError);
  return h.xp.filter(r => d.base.profileIds.has(r.user_id));
}

/** XP-awarded events, in range, plus whether the app has ever sent one. */
function xpEvents(d: V4Data) {
  const ever = d.rawEvents.some(e => e.event_name === XP_EVENT);
  const inRange = d.base.events.filter(e => e.event_name === XP_EVENT && !!e.user_id);
  return { ever, inRange };
}

/** One Hunt the server scored, with the account's XP either side of it. */
export interface ServerAward { userId: string; at: string; xp: number; before: number; after: number; rankedUp: boolean; rankAfter: string }

/**
 * Server-scored Hunts in the selected range, for accounts in scope. Null when
 * the server holds none yet (so the caller can fall back to the app's event).
 *
 * The totals either side of a Hunt are worked back from the account's XP today:
 * today's total minus everything earned after that Hunt.
 */
export function serverAwards(d: V4Data, h: HuntData, lb: LbData | null | undefined): ServerAward[] | null {
  if (!lb || lb.errors.hunts || h.xpError) return null;
  const mine = lb.hunts.filter(x => d.base.profileIds.has(x.user_id));
  if (mine.length === 0) return null;
  const total = new Map(h.xp.map(r => [r.user_id, n0(r.total_xp)]));
  const byUser = new Map<string, typeof mine>();
  for (const x of mine) (byUser.get(x.user_id) ?? byUser.set(x.user_id, []).get(x.user_id)!).push(x);
  const { startMs, endMs } = d.window;
  const out: ServerAward[] = [];
  for (const [uid, list] of byUser) {
    list.sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));   // newest first
    let after = total.get(uid) ?? list.reduce((a, x) => a + n0(x.xp), 0);
    for (const x of list) {
      const xp = n0(x.xp), before = Math.max(0, after - xp), t = Date.parse(x.completed_at);
      if ((startMs == null || t >= startMs) && (endMs == null || t < endMs)) {
        out.push({ userId: uid, at: x.completed_at, xp, before, after, rankedUp: rankIndexFor(after) > rankIndexFor(before), rankAfter: HUNT_RANKS[rankIndexFor(after)].rank });
      }
      after = before;
    }
  }
  return out;
}

// ── Hunt XP ──────────────────────────────────────────────────────────────────

export function getHuntXp(d: V4Data, h: HuntData, lb?: LbData | null) {
  const rows = scopedXp(d, h);
  const accounts = d.base.profileIds.size;
  const xpOf = (r: XpRow) => n0(r.total_xp);
  const withXp = rows.filter(r => xpOf(r) > 0);
  const xps = withXp.map(xpOf);
  const total = xps.reduce((a, b) => a + b, 0);

  const huntsOf = (r: XpRow) => n0(r.completed_hunts);
  const hunters = rows.filter(r => huntsOf(r) > 0);

  const today = centralDay(d.now), yesterday = centralDay(new Date(d.now.getTime() - DAY));
  // The weekly streak (the one that pays XP) once the server keeps it and says which week it is.
  // It is alive if the last streak week is this week or last week. Before that: the old daily streak.
  const weekNow = lb && !lb.errors.live && lb.live ? lb.live.weekStart : null;
  const weekly = !!weekNow && rows.some(r => r.week_streak !== undefined);
  const lastWeek = weekNow ? new Date(Date.parse(`${weekNow}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10) : null;
  const streakOf = (r: XpRow) => weekly ? n0(r.week_streak) : n0(r.hunt_streak);
  const isLive = (r: XpRow) => weekly
    ? n0(r.week_streak) > 0 && !!r.last_streak_week && String(r.last_streak_week).slice(0, 10) >= lastWeek!
    : n0(r.hunt_streak) > 0 && !!r.last_hunt_date && r.last_hunt_date.slice(0, 10) >= yesterday;
  const live = rows.filter(isLive);
  const liveStreaks = live.map(streakOf);

  const stale = rows.filter(r => r.current_rank && r.current_rank !== HUNT_RANKS[rankIndexFor(xpOf(r))].rank).length;

  const top = [...withXp].sort((a, b) => xpOf(b) - xpOf(a) || a.user_id.localeCompare(b.user_id)).slice(0, TOP_HUNTERS)
    .map(r => ({
      userId: r.user_id, name: userName(d, r.user_id), xp: xpOf(r),
      rank: HUNT_RANKS[rankIndexFor(xpOf(r))].rank, rankNumber: rankIndexFor(xpOf(r)) + 1,
      hunts: huntsOf(r), streak: streakOf(r), lastHunt: r.last_hunt_date,
      streakLive: isLive(r),
    }));

  // In range: the server's own record when it has one, else the app's event.
  const server = serverAwards(d, h, lb);
  const ev = server
    ? { ever: true, inRange: [] as Ev[] }
    : xpEvents(d);
  const earned = server ? server.map(a => a.xp) : ev.inRange.map(e => n0(metaNum(e, "xp_earned")));
  const earnedUsers = server
    ? new Set(server.filter(a => a.xp > 0).map(a => a.userId))
    : new Set(ev.inRange.filter(e => n0(metaNum(e, "xp_earned")) > 0).map(e => e.user_id!));
  const awards = server ? server.length : ev.inRange.length;
  const notYet = { available: false, note: "Starts with the app build after 2.2 (hunt_xp_awarded)" };

  return {
    accounts,
    xpRows: rows.length,
    withXp: rateOf(withXp.length, accounts),
    totalXp: exact(total),
    meanXp: { value: xps.length ? total / xps.length : null, trust: "DERIVED", d: xps.length } as Metric,
    medianXp: { value: median(xps), trust: "DERIVED", d: xps.length } as Metric,
    maxXp: exact(xps.length ? Math.max(...xps) : null),
    huntsCompleted: exact(rows.reduce((a, r) => a + huntsOf(r), 0)),
    hunters: rateOf(hunters.length, accounts),
    liveStreaks: exact(live.length, { note: weekly ? `hunted in the week of ${lastWeek} or since` : `last hunt ${yesterday} or later` }),
    longestLiveStreak: exact(liveStreaks.length ? Math.max(...liveStreaks) : null),
    streakUnit: weekly ? "weeks" : "days",
    inRangeSource: server ? "server" : "app",
    weekStart: weekNow,
    staleRankNames: stale,
    top,
    events: {
      ever: ev.ever,
      xpInRange: ev.ever ? exact(earned.reduce((a, b) => a + b, 0)) : ({ value: null, trust: "NOT_TRACKED", ...notYet } as Metric),
      awardsInRange: ev.ever ? exact(awards) : ({ value: null, trust: "NOT_TRACKED", ...notYet } as Metric),
      earnersInRange: ev.ever ? exact(earnedUsers.size) : ({ value: null, trust: "NOT_TRACKED", ...notYet } as Metric),
      perHunt: ev.ever
        ? ({ value: awards ? earned.reduce((a, b) => a + b, 0) / awards : null, trust: "DERIVED", d: awards } as Metric)
        : ({ value: null, trust: "NOT_TRACKED", ...notYet } as Metric),
    },
    today,
  };
}

// ── Hunt Levels ──────────────────────────────────────────────────────────────

export function getHuntLevels(d: V4Data, h: HuntData, lb?: LbData | null) {
  const rows = scopedXp(d, h);
  const counts = HUNT_RANKS.map(() => 0);
  let zeroXp = 0;
  for (const r of rows) {
    const xp = n0(r.total_xp);
    if (xp === 0) zeroXp++;
    counts[rankIndexFor(xp)]++;
  }
  const server = serverAwards(d, h, lb);
  const ev = server ? { ever: true, inRange: [] as Ev[] } : xpEvents(d);
  const upsByRank = new Map<string, number>();
  let rankUps = 0;
  // One Hunt can cross several ranks; it counts once, under the rank it landed on.
  for (const a of server ?? []) {
    if (!a.rankedUp) continue;
    rankUps++;
    upsByRank.set(a.rankAfter, (upsByRank.get(a.rankAfter) ?? 0) + 1);
  }
  for (const e of ev.inRange) {
    if (meta(e, "ranked_up") !== true) continue;
    rankUps++;
    const to = metaStr(e, "rank_after");
    if (to) upsByRank.set(to, (upsByRank.get(to) ?? 0) + 1);
  }
  const withXpIdx = rows.filter(r => n0(r.total_xp) > 0).map(r => rankIndexFor(n0(r.total_xp)));
  const highest = withXpIdx.length ? Math.max(...withXpIdx) : null;
  // The lower middle account's actual rank — never an average of two ranks nobody holds.
  const sortedIdx = [...withXpIdx].sort((a, b) => a - b);
  const med = sortedIdx.length ? sortedIdx[Math.floor((sortedIdx.length - 1) / 2)] : null;
  return {
    xpRows: rows.length,
    zeroXp,
    ladder: HUNT_RANKS.map((r, i) => ({
      number: i + 1, rank: r.rank, fromXp: r.xp, toXp: i + 1 < HUNT_RANKS.length ? HUNT_RANKS[i + 1].xp - 1 : null,
      users: counts[i], share: rows.length ? counts[i] / rows.length : null,
      rankUpsInRange: ev.ever ? upsByRank.get(r.rank) ?? 0 : null,
    })),
    highest: highest === null ? null : { number: highest + 1, rank: HUNT_RANKS[highest].rank },
    medianRank: med === null ? null : { number: med + 1, rank: HUNT_RANKS[med].rank },
    rankUpsInRange: ev.ever ? exact(rankUps) : ({ value: null, trust: "NOT_TRACKED", available: false, note: "Starts with the app build after 2.2" } as Metric),
    eventsEver: ev.ever,
    inRangeSource: server ? "server" : "app",
  };
}

// ── Last 50 new phones ───────────────────────────────────────────────────────

export interface PhoneRow {
  anonymousId: string;
  firstSeen: string;
  lastSeen: string;
  firstVersion: string | null;
  onboarding: {
    started: boolean; quiz: boolean; tapped: "create" | "login" | null;
    completed: string | null;        // outcome, or "done" with no outcome
    skippedSignedIn: boolean;
    maxStep: number | null; totalSteps: number | null; maxStepName: string | null;
  };
  account: null | {
    userId: string; name: string | null; createdAt: string | null;
    kind: "new" | "existing"; sharedWith: number;
  };
  paywalls: number; firstPaywall: string | null;
  scans: number; saved: number;
  huntOpens: number; huntsDone: number;
  brands: number | null;
  xp: number | null; rank: string | null;
  subscriptions: string[]; packs: number; planNow: string | null;
  /** The furthest step reached, for a one-word read of the row. */
  reached: string;
}

export function getNewPhones(d: V4Data, h: HuntData, limit = NEW_PHONES_LIMIT) {
  const byPhone = new Map<string, Ev[]>();
  const usersByPhone = new Map<string, string[]>();   // in order first seen
  const eventsByUser = new Map<string, Ev[]>();
  for (const e of d.rawEvents) {
    if (e.user_id) (eventsByUser.get(e.user_id) ?? eventsByUser.set(e.user_id, []).get(e.user_id)!).push(e);
    if (!e.anonymous_id) continue;
    (byPhone.get(e.anonymous_id) ?? byPhone.set(e.anonymous_id, []).get(e.anonymous_id)!).push(e);
  }
  const byTime = (a: Ev, b: Ev) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  const phones = [...byPhone.entries()].map(([id, evs]) => {
    evs.sort(byTime);
    const users: string[] = [];
    for (const e of evs) if (e.user_id && !users.includes(e.user_id)) users.push(e.user_id);
    usersByPhone.set(id, users);
    return { id, evs, first: evs[0].created_at };
  }).sort((a, b) => a.first < b.first ? 1 : a.first > b.first ? -1 : a.id.localeCompare(b.id)).slice(0, limit);

  const xpByUser = new Map(h.xp.map(r => [r.user_id, r]));
  const stepsTracked = d.rawEvents.some(e => e.event_name === STEP_EVENT);

  const rows: PhoneRow[] = phones.map(p => {
    const users = usersByPhone.get(p.id) ?? [];
    const uid = users[0] ?? null;
    const shared = users.length > 1;
    // The journey: this phone, plus (one account only) that account elsewhere after first open.
    let evs = p.evs;
    if (uid && !shared) {
      const elsewhere = (eventsByUser.get(uid) ?? []).filter(e => e.anonymous_id !== p.id && e.created_at >= p.first);
      if (elsewhere.length) evs = [...p.evs, ...elsewhere].sort(byTime);
    }
    const has = (name: string) => evs.some(e => e.event_name === name);
    const count = (name: string) => evs.filter(e => e.event_name === name).length;

    const steps = evs.filter(e => e.event_name === STEP_EVENT);
    let maxStep: number | null = null, totalSteps: number | null = null, maxStepName: string | null = null;
    for (const e of steps) {
      const s = metaNum(e, "step_number");
      if (s === null) continue;
      if (maxStep === null || s > maxStep) { maxStep = s; maxStepName = metaStr(e, "step"); }
      totalSteps = metaNum(e, "total_steps") ?? totalSteps;
    }
    const tappedEv = evs.find(e => e.event_name === "onboarding_create_account_tapped" || e.event_name === "onboarding_login_tapped");
    const doneEv = evs.find(e => e.event_name === "onboarding_completed");

    let account: PhoneRow["account"] = null;
    if (uid) {
      const createdAt = d.auth.get(uid)?.created_at ?? d.profiles.get(uid)?.created_at ?? null;
      const createdMs = createdAt ? Date.parse(createdAt) : NaN;
      const kind = Number.isFinite(createdMs) && createdMs < Date.parse(p.first) - NEW_ACCOUNT_TOLERANCE_MS ? "existing" : "new";
      account = { userId: uid, name: userName(d, uid), createdAt, kind, sharedWith: users.length - 1 };
    }

    const pw = evs.filter(e => e.event_name === "paywall_opened");
    const subs = evs.filter(e => e.event_name === "paywall_purchase_completed").map(e => metaStr(e, "selected_plan") ?? "subscription");
    const xpRow = uid ? xpByUser.get(uid) : undefined;
    const xp = uid && !h.xpError ? n0(xpRow?.total_xp) : null;
    const usage = uid ? d.rawUsage.get(uid) : undefined;
    const planNow = uid ? (usage ? derivePlan(usage, d.now) : "free") : null;

    const row: PhoneRow = {
      anonymousId: p.id,
      firstSeen: p.first,
      lastSeen: evs[evs.length - 1].created_at,
      firstVersion: evs.find(e => !!e.app_version)?.app_version ?? null,
      onboarding: {
        started: has("onboarding_started"), quiz: has("onboarding_quiz_completed"),
        tapped: tappedEv ? (tappedEv.event_name === "onboarding_login_tapped" ? "login" : "create") : null,
        completed: doneEv ? (metaStr(doneEv, "outcome") ?? "done") : null,
        skippedSignedIn: has("onboarding_skipped_signed_in"),
        maxStep, totalSteps, maxStepName,
      },
      account,
      paywalls: pw.length, firstPaywall: pw.length ? metaStr(pw[0], "paywall_source") : null,
      scans: count("scan_completed"), saved: count("scan_saved"),
      huntOpens: count("hunt_mode_opened"), huntsDone: count("hunt_ended"),
      brands: uid && !h.brandsError ? h.brandsByUser.get(uid) ?? 0 : null,
      xp, rank: xp !== null ? HUNT_RANKS[rankIndexFor(xp)].rank : null,
      subscriptions: [...new Set(subs)], packs: count("scan_pack_purchase_completed"), planNow,
      reached: "",
    };
    row.reached = reachedOf(row);
    return row;
  });

  // Summary: brand-new people only — reinstalls and shared test phones are listed but not counted.
  const fresh = rows.filter(r => !r.account || (r.account.kind === "new" && r.account.sharedWith === 0));
  const c = (f: (r: PhoneRow) => boolean) => fresh.filter(f).length;
  const summary = {
    phones: rows.length,
    newPeople: fresh.length,
    reinstalls: rows.filter(r => r.account?.kind === "existing").length,
    shared: rows.filter(r => (r.account?.sharedWith ?? 0) > 0).length,
    onboardingStarted: c(r => r.onboarding.started),
    quiz: c(r => r.onboarding.quiz),
    account: c(r => !!r.account),
    scanned: c(r => r.scans > 0),
    saved: c(r => r.saved > 0),
    paywall: c(r => r.paywalls > 0),
    hunted: c(r => r.huntOpens > 0),
    brands: c(r => (r.brands ?? 0) > 0),
    xp: c(r => (r.xp ?? 0) > 0),
    paid: c(r => r.subscriptions.length > 0 || r.packs > 0),
  };
  return {
    rows, summary, stepsTracked, limit,
    oldest: rows.length ? rows[rows.length - 1].firstSeen : null,
    brandsError: h.brandsError ?? null, xpError: h.xpError ?? null,
  };
}

function reachedOf(r: PhoneRow): string {
  if (r.subscriptions.length || r.packs) return "Paid";
  if (r.huntsDone > 0) return "Hunted";
  if (r.scans > 0) return "Scanned";
  if (r.account) return "Account";
  if (r.onboarding.tapped) return "Tapped sign-up";
  if (r.onboarding.quiz) return "Quiz";
  if (r.onboarding.started) return "Onboarding";
  return "Opened";
}