/**
 * server/founderLeaderboard.ts
 *
 * The Hunt Leaderboard on the Founder Dashboard. Four sections:
 *
 *   Leaderboard            who opens it, which boards, and whether opening it
 *                          is followed by Hunting
 *   Leaderboard boards     who is ranked this week, the XP spread, past weeks
 *   Leaderboard integrity  how many Hunt scans were reduced or left out, and why
 *   Leaderboard review     Hunts that awarded 1,000+ XP (with photos), open
 *                          reports, and the buttons that act on them
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 * Usage comes from the app's `leaderboard_*` events. Everything about XP,
 * Hunts, scans and reports comes from the SERVER's own tables (hunts,
 * hunt_scans, leaderboard_weekly, profile_reports), which the app cannot
 * write. No number here is taken from anything a phone claimed about XP.
 *
 * ── What it cannot tell you ─────────────────────────────────────────────────
 * "Viewers Hunt more" is a comparison of two groups who chose differently, not
 * an experiment: keen hunters are also the people most likely to open a
 * leaderboard. The before/after card (the same people, 14 days each side of
 * their first open) is the fairer read, and still not proof. The page says so.
 *
 * Every loader part fails on its own. A failure is reported in its section,
 * never read as zero.
 */
import { fetchAll } from "./founderMetrics";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { centralDay } from "./dashboardDates";
import { RANK_LADDER, rankIndexFor } from "../shared/hunt/ranks";
import { getLeaderboardStore } from "./leaderboard/store";
import { invalidateLeaderboardCache } from "./leaderboard/view";
import type { V4Data, Metric } from "./founderMetricsV4";

type Ev = V4Data["rawEvents"][number];

const DAY = 86_400_000;
/** A Hunt at or above this is listed for review. */
export const REVIEW_XP = 1000;
export const REVIEW_HUNTS = 25;
export const REVIEW_ITEMS_PER_HUNT = 6;
/** A big find: profit above this needs the evidence gate (shared/hunt/xpRules). */
export const BIG_FIND_PROFIT = 250;
/** Kept for almost nothing, worth a lot: worth a look. */
export const ANOMALY_MAX_PRICE = 0.5, ANOMALY_MIN_RESALE = 100;
/** How many accounts from the top of the Weekly board get an evidence summary. */
export const LEADERS_CHECKED = 20;
/** Hunts per request when reading a leader's scored scans: 3 × 300 scored scans stays under one request's 1,000 rows. */
export const LEADER_HUNTS_PER_READ = 3;
export const CONVERSION_DAYS = 7;
export const BEFORE_AFTER_DAYS = 14;
const PHOTO_BUCKET = "scan-photos";
const PHOTO_LINK_SECONDS = 3600;

export const LB_EVENTS = {
  opened: "leaderboard_opened", tab: "leaderboard_tab_selected", viewed: "leaderboard_viewed",
  startHunt: "leaderboard_start_hunt_clicked", track: "leaderboard_level_track_viewed",
  report: "leaderboard_report_submitted", block: "leaderboard_user_blocked",
} as const;
export const BOARD_LABEL: Record<string, string> = { weekly: "Weekly XP", all_time: "All-Time", best_hunt: "Best Hunt" };
export const SOURCE_LABEL: Record<string, string> = { hunt: "Hunt button", home: "Home card", hunt_complete: "Hunt complete", other: "Other" };
export const REASON_TEXT: Record<string, string> = {
  duplicate_photo: "Same photo as an earlier scan of theirs", shared_image: "Photo seen on other accounts",
  library_photo: "Photo picked from the library", screen_flag: "Photo of a screen or listing",
  soft_fail: "Low-confidence scan they continued with", repeat_item: "Same valued item again (30 days)",
  no_photo_hash: "Photo could not be fingerprinted",
  no_camera: "Big find: not an in-app camera photo", no_secondPhoto: "Big find: no tag or detail photo",
  no_uniqueImage: "Big find: photo not unique", no_notScreen: "Big find: screen or listing flag",
  no_confidentId: "Big find: not a confident ID",
};

// ── Loading ──────────────────────────────────────────────────────────────────

export interface HuntRow {
  user_id: string; hunt_id: string; completed_at: string; week_start: string;
  xp: number; qualifies: boolean; best_hunt_score: number;
  scan_count: number; kept_count: number; duration_ms: number | string;
  result?: any;
}
export interface LbScanRow {
  analysis_id: string; user_id: string; hunt_id: string; scanned_at: string;
  photo_count: number; capture_front: string | null; capture_kind: string | null;
  brand: string | null; category: string | null; resale: number | string | null;
  kept: boolean | null; thrift_price: number | string | null;
  final_status: string | null; final_rating: string | null; status_reasons: string[] | null;
  counted_profit: number | string | null;
}
export interface OpenReport {
  user_id: string; username: string | null; display_name: string | null; reason: string;
  reporters: number | string; first_report: string; last_report: string; hidden_now: boolean | null; picture: string | null;
}
export interface IdentityLite {
  user_id: string; public_name: string | null; name_status: string | null; avatar_url: string | null;
  avatar_status: string | null; name_hidden: boolean; avatar_hidden: boolean;
}

export interface LbData {
  /** Every server-awarded Hunt, without its breakdown. */
  hunts: HuntRow[];
  /** Hunt scans made in the selected range. */
  scans: LbScanRow[];
  weekly: Array<{ user_id: string; week_start: string; xp: number }>;
  /** The running week, as Postgres defines it. */
  live: { weekStart: string; weekEndsAt: string } | null;
  weeks: Array<{ week_start: string; closed_at: string; hunters: number; total_xp: number | string }>;
  winners: Array<{ week_start: string; position: number; user_id: string; xp: number }>;
  bigHunts: HuntRow[];
  bigScans: LbScanRow[];
  /** This week's Hunt scans for the accounts at the top of the Weekly board, by account. */
  leaderScans: Map<string, LbScanRow[]>;
  /** storage path -> a link that works for an hour. */
  photos: Map<string, string>;
  reports: OpenReport[];
  identity: Map<string, IdentityLite>;
  excluded: Set<string>;
  founding: number | null;
  /** Part name -> what went wrong. A part listed here has no data, not zero. */
  errors: Record<string, string>;
}

const HUNT_COLS = "user_id,hunt_id,completed_at,week_start,xp,qualifies,best_hunt_score,scan_count,kept_count,duration_ms";
const SCAN_COLS = "analysis_id,user_id,hunt_id,scanned_at,photo_count,capture_front,capture_kind,brand,category,resale," +
  "kept,thrift_price,final_status,final_rating,status_reasons,counted_profit";

/** Where a scan's photo is stored (server/photoPersistence.ts). Almost always .jpg; a library pick can be .png. */
export const photoPath = (userId: string, analysisId: string, slot: "front" | "tag" | "detail", ext: "jpg" | "png" = "jpg") =>
  `${userId}/${analysisId}/${slot}.${ext}`;
/** The link for a scan photo, whichever of the two file types it was stored as. */
export const photoLink = (photos: Map<string, string>, userId: string, analysisId: string, slot: "front" | "tag" | "detail"): string | null =>
  photos.get(photoPath(userId, analysisId, slot)) ?? photos.get(photoPath(userId, analysisId, slot, "png")) ?? null;

/** The kept items of a Hunt worth looking at first: highest counted profit, then resale. */
export function reviewItems(scans: LbScanRow[], hunt: Pick<HuntRow, "user_id" | "hunt_id">, limit = REVIEW_ITEMS_PER_HUNT): LbScanRow[] {
  return scans
    .filter(s => s.user_id === hunt.user_id && s.hunt_id === hunt.hunt_id && s.kept === true)
    .sort((a, b) => n0(b.counted_profit) - n0(a.counted_profit) || n0(b.resale) - n0(a.resale) || a.analysis_id.localeCompare(b.analysis_id))
    .slice(0, limit);
}

export async function loadLeaderboardData(window: { startMs: number | null }): Promise<LbData> {
  const out: LbData = {
    hunts: [], scans: [], weekly: [], live: null, weeks: [], winners: [], bigHunts: [], bigScans: [], leaderScans: new Map(),
    photos: new Map(), reports: [], identity: new Map(), excluded: new Set(), founding: null, errors: {},
  };
  const sb: any = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase not configured");
  const since = window.startMs != null ? new Date(window.startMs).toISOString() : null;
  const recentWeeks = new Date(Date.now() - 70 * DAY).toISOString().slice(0, 10);
  const part = async <T>(name: string, fn: () => Promise<T>, apply: (v: T) => void) => {
    try { apply(await fn()); } catch (e: any) { out.errors[name] = `${name}: ${e?.message ?? e}`; }
  };
  const direct = async (q: any): Promise<any[]> => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  await Promise.all([
    part("hunts", () => fetchAll<HuntRow>("hunts", HUNT_COLS, { order: ["completed_at", "user_id", "hunt_id"] }), v => { out.hunts = v; }),
    part("scans", () => fetchAll<LbScanRow>("hunt_scans", SCAN_COLS, {
      ...(since ? { gte: { col: "scanned_at", val: since } } : {}), order: ["scanned_at", "analysis_id"], maxRows: 100_000,
    }), v => { out.scans = v; }),
    part("weekly", () => fetchAll<{ user_id: string; week_start: string; xp: number }>("leaderboard_weekly", "user_id,week_start,xp", {
      gte: { col: "week_start", val: recentWeeks }, order: ["week_start", "user_id"],
    }), v => { out.weekly = v; }),
    part("live", async () => {
      const store = getLeaderboardStore();
      const page = store ? await store.page("weekly", null, 0, 1) : null;
      if (!page) throw new Error("leaderboard_page did not answer");
      return { weekStart: String(page.week_start).slice(0, 10), weekEndsAt: String(page.week_ends_at) };
    }, v => { out.live = v; }),
    part("weeks", () => fetchAll<LbData["weeks"][number]>("weekly_results_weeks", "week_start,closed_at,hunters,total_xp", { order: ["week_start"] }), v => { out.weeks = v; }),
    part("winners", () => direct(sb.from("weekly_results").select("week_start,position,user_id,xp").lte("position", 3)
      .order("week_start", { ascending: false }).order("position", { ascending: true }).limit(36)), v => { out.winners = v; }),
    part("reports", () => fetchAll<OpenReport>("leaderboard_open_reports",
      "user_id,username,display_name,reason,reporters,first_report,last_report,hidden_now,picture"), v => { out.reports = v; }),
    part("identity", () => fetchAll<IdentityLite>("leaderboard_identity",
      "user_id,public_name,name_status,avatar_url,avatar_status,name_hidden,avatar_hidden", { order: ["user_id"] }),
      v => { out.identity = new Map(v.map(r => [r.user_id, r])); }),
    part("excluded", () => fetchAll<{ user_id: string; leaderboard_status: string | null }>("xp_profiles", "user_id,leaderboard_status", { order: ["user_id"] }),
      v => { out.excluded = new Set(v.filter(r => r.leaderboard_status === "excluded").map(r => r.user_id)); }),
    part("founding", () => fetchAll<{ user_id: string }>("founding_hunters", "user_id", { order: ["user_id"] }), v => { out.founding = v.length; }),
    part("review", async () => {
      const big: HuntRow[] = await direct(sb.from("hunts").select(`${HUNT_COLS},result`).gte("xp", REVIEW_XP)
        .order("completed_at", { ascending: false }).limit(REVIEW_HUNTS));
      // The kept items worth looking at first, asked for Hunt by Hunt: one request
      // returns at most 1,000 rows, and 25 big Hunts can hold far more scans than that.
      const scans: LbScanRow[] = (await Promise.all(big.map(h => direct(sb.from("hunt_scans").select(SCAN_COLS)
        .eq("user_id", h.user_id).eq("hunt_id", h.hunt_id).eq("kept", true)
        .order("counted_profit", { ascending: false, nullsFirst: false }).order("analysis_id", { ascending: true })
        .limit(REVIEW_ITEMS_PER_HUNT))))).flat();
      // Links for the photos of the items that will be shown. A missing photo is simply absent.
      const paths: string[] = [];
      for (const h of big) for (const s of reviewItems(scans, h)) {
        const slots = Number(s.photo_count) > 1 ? (["front", "tag", "detail"] as const) : (["front"] as const);
        for (const slot of slots) paths.push(photoPath(s.user_id, s.analysis_id, slot), photoPath(s.user_id, s.analysis_id, slot, "png"));
      }
      const photos = new Map<string, string>();
      for (let i = 0; i < paths.length; i += 100) {
        try {
          const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(paths.slice(i, i + 100), PHOTO_LINK_SECONDS);
          for (const r of data ?? []) if (r?.signedUrl && r.path && !r.error) photos.set(String(r.path), String(r.signedUrl));
        } catch { /* photos are a help, not a requirement */ }
      }
      return { big, scans, photos };
    }, v => { out.bigHunts = v.big; out.bigScans = v.scans; out.photos = v.photos; }),
  ]);

  // Second step, because it needs the first: what this week's leaders' XP is made of.
  // A leader who split fakes across many small Hunts never reaches the 1,000 XP
  // review list, so the top of the Weekly board gets its own evidence summary.
  await part("leaders", async () => {
    if (out.errors.weekly || out.errors.live || out.errors.hunts || !out.live) return new Map<string, LbScanRow[]>();
    const week = out.live.weekStart;
    const top = out.weekly.filter(r => String(r.week_start).slice(0, 10) === week && n0(r.xp) > 0)
      .sort((a, b) => n0(b.xp) - n0(a.xp) || a.user_id.localeCompare(b.user_id)).slice(0, LEADERS_CHECKED).map(r => r.user_id);
    const byUser = new Map<string, LbScanRow[]>();
    await Promise.all(top.map(async uid => {
      const huntIds = out.hunts.filter(h => h.user_id === uid && String(h.week_start).slice(0, 10) === week).map(h => h.hunt_id);
      const rows: LbScanRow[] = [];
      // Only scans that were scored (a finished Hunt scores at most 300), three
      // Hunts per request: never more than 900 rows, so no request can come back
      // cut short at the 1,000 a single request may return.
      for (let i = 0; i < huntIds.length; i += LEADER_HUNTS_PER_READ) {
        rows.push(...await direct(sb.from("hunt_scans").select(SCAN_COLS).eq("user_id", uid).in("hunt_id", huntIds.slice(i, i + LEADER_HUNTS_PER_READ))
          .not("final_status", "is", null).order("analysis_id", { ascending: true }).limit(1000)));
      }
      byUser.set(uid, rows);
    }));
    return byUser;
  }, v => { out.leaderScans = v; });
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function n0(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const ms = (iso: string): number => Date.parse(iso);
const meta = (e: Ev, k: string): unknown => (e.metadata && typeof e.metadata === "object") ? e.metadata[k] : undefined;
const metaStr = (e: Ev, k: string): string | null => { const v = meta(e, k); return typeof v === "string" ? v : null; };
const exact = (value: number | null, extra: Partial<Metric> = {}): Metric => ({ value, trust: "EXACT", ...extra } as Metric);
const rateOf = (n: number, d: number, extra: Partial<Metric> = {}): Metric => ({ value: d ? n / d : null, trust: "DERIVED", n, d, ...extra } as Metric);
const meanOf = (xs: number[], extra: Partial<Metric> = {}): Metric =>
  ({ value: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, trust: "DERIVED", d: xs.length, ...extra } as Metric);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const userName = (d: V4Data, uid: string): string | null => {
  const p = d.profiles.get(uid);
  return p?.display_name ?? p?.username ?? null;
};
const need = (lb: LbData, ...parts: string[]) => { for (const p of parts) if (lb.errors[p]) throw new Error(lb.errors[p]); };
const countBy = <T,>(xs: T[], key: (x: T) => string | null): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) { const k = key(x); if (k) out[k] = (out[k] ?? 0) + 1; }
  return out;
};
const notYet = (note = "Starts with the leaderboard app build"): Metric => ({ value: null, trust: "NOT_TRACKED", available: false, note } as Metric);
const inScope = (d: V4Data, uid: string | null | undefined): uid is string => !!uid && d.base.profileIds.has(uid);

function huntsByUser(d: V4Data, lb: LbData): Map<string, HuntRow[]> {
  const m = new Map<string, HuntRow[]>();
  for (const h of lb.hunts) {
    if (!inScope(d, h.user_id)) continue;
    (m.get(h.user_id) ?? m.set(h.user_id, []).get(h.user_id)!).push(h);
  }
  for (const list of m.values()) list.sort((a, b) => ms(a.completed_at) - ms(b.completed_at));
  return m;
}

// ── 1. Leaderboard: usage and what follows ───────────────────────────────────

export function getLeaderboardUsage(d: V4Data, lb: LbData) {
  const ever = d.rawEvents.some(e => e.event_name === LB_EVENTS.opened);
  const evs = d.base.events.filter(e => e.event_name.startsWith("leaderboard_") && inScope(d, e.user_id));
  const of = (name: string) => evs.filter(e => e.event_name === name);
  const opens = of(LB_EVENTS.opened), views = of(LB_EVENTS.viewed), tabs = of(LB_EVENTS.tab);
  const clicks = of(LB_EVENTS.startHunt), reports = of(LB_EVENTS.report), blocks = of(LB_EVENTS.block);
  const viewers = new Set(opens.map(e => e.user_id!));

  // Came back on another day (Central), inside the range.
  const daysByUser = new Map<string, Set<string>>();
  for (const e of opens) (daysByUser.get(e.user_id!) ?? daysByUser.set(e.user_id!, new Set()).get(e.user_id!)!).add(centralDay(new Date(e.created_at)));
  const repeat = [...daysByUser.values()].filter(s => s.size >= 2).length;

  const boards = (["weekly", "all_time", "best_hunt"] as const).map(b => {
    const v = views.filter(e => metaStr(e, "board") === b);
    const unranked = v.filter(e => meta(e, "ranked") === false).length;
    return {
      board: b, label: BOARD_LABEL[b], views: v.length, viewers: new Set(v.map(e => e.user_id!)).size,
      tabSelections: tabs.filter(e => metaStr(e, "board") === b).length,
      openedOn: opens.filter(e => metaStr(e, "board") === b).length,
      unrankedViews: unranked,
    };
  });

  // Start Hunt, then a Hunt the server awarded within 7 days. The first click per person.
  const hunts = lb.errors.hunts ? null : huntsByUser(d, lb);
  const firstClick = new Map<string, number>();
  for (const e of clicks) { const t = ms(e.created_at); if (!firstClick.has(e.user_id!) || t < firstClick.get(e.user_id!)!) firstClick.set(e.user_id!, t); }
  const firstOpen = new Map<string, number>();
  for (const e of opens) { const t = ms(e.created_at); if (!firstOpen.has(e.user_id!) || t < firstOpen.get(e.user_id!)!) firstOpen.set(e.user_id!, t); }
  const huntedWithin = (uid: string, from: number) =>
    !!hunts && (hunts.get(uid) ?? []).some(h => { const t = ms(h.completed_at); return t > from && t <= from + CONVERSION_DAYS * DAY; });
  const convert = (first: Map<string, number>): Metric => {
    if (!ever) return notYet();
    if (!hunts) return { value: null, trust: "NOT_TRACKED", available: false, note: lb.errors.hunts } as Metric;
    const n = [...first].filter(([u, t]) => huntedWithin(u, t)).length;
    const stillOpen = [...first].filter(([u, t]) => !huntedWithin(u, t) && d.now.getTime() - t < CONVERSION_DAYS * DAY).length;
    return rateOf(n, first.size, stillOpen ? { note: `${stillOpen} still inside their ${CONVERSION_DAYS} days` } : {});
  };

  const g = (x: Metric): Metric => (ever ? x : notYet());
  return {
    ever,
    viewers: g(exact(viewers.size)),
    opens: g(exact(opens.length)),
    opensPerViewer: g(meanOf([...countByMap(opens).values()])),
    repeatViewers: g(rateOf(repeat, viewers.size, { note: "opened it on 2+ days in the range" })),
    returnVisits: g(rateOf(opens.filter(e => meta(e, "return_visit") === true).length, opens.filter(e => typeof meta(e, "return_visit") === "boolean").length,
      { note: "opens on a phone that had opened it before" })),
    sources: Object.entries(countBy(opens, e => metaStr(e, "source") ?? "other"))
      .map(([source, n]) => ({ source, label: SOURCE_LABEL[source] ?? source, opens: n })).sort((a, b) => b.opens - a.opens),
    boards,
    startHuntClicks: g(exact(clicks.length)),
    startHuntClickers: g(rateOf(firstClick.size, viewers.size, { note: "of people who opened it" })),
    startHuntUnranked: g(rateOf(clicks.filter(e => meta(e, "unranked") === true).length, clicks.length, { note: "clicks made while not ranked" })),
    clickToHunt: convert(firstClick),
    openToHunt: convert(firstOpen),
    reports: g(exact(reports.length)),
    reportsByReason: countBy(reports, e => metaStr(e, "reason")),
    blocks: g(exact(blocks.length)),
    levelTrackViews: g(exact(of(LB_EVENTS.track).length)),
    conversionDays: CONVERSION_DAYS,
  };
}
function countByMap(evs: Ev[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of evs) if (e.user_id) m.set(e.user_id, (m.get(e.user_id) ?? 0) + 1);
  return m;
}

/**
 * Hunt users who have opened the leaderboard, against Hunt users who never
 * have. Lifetime, in scope. Retention is anchored on each person's first
 * server-awarded Hunt: "active again 7+ days later" (any app event).
 */
export function getLeaderboardImpact(d: V4Data, lb: LbData) {
  need(lb, "hunts");
  const ever = d.rawEvents.some(e => e.event_name === LB_EVENTS.opened);
  const hunts = huntsByUser(d, lb);
  const firstOpen = new Map<string, number>();
  const lastEvent = new Map<string, number>();
  for (const e of d.rawEvents) {
    if (!inScope(d, e.user_id)) continue;
    const t = ms(e.created_at);
    if (t > (lastEvent.get(e.user_id) ?? 0)) lastEvent.set(e.user_id, t);
    if (e.event_name === LB_EVENTS.opened && (!firstOpen.has(e.user_id) || t < firstOpen.get(e.user_id)!)) firstOpen.set(e.user_id, t);
  }
  const now = d.now.getTime();
  const group = (label: string, users: string[]) => {
    const lists = users.map(u => hunts.get(u)!);
    const all = lists.flat();
    const retained = (days: number): Metric => {
      const mature = users.filter(u => now - ms(hunts.get(u)![0].completed_at) >= days * DAY);
      const back = mature.filter(u => (lastEvent.get(u) ?? 0) >= ms(hunts.get(u)![0].completed_at) + days * DAY);
      return rateOf(back.length, mature.length);
    };
    return {
      label, users: users.length,
      huntsPerUser: meanOf(lists.map(l => l.length)),
      scansPerHunt: meanOf(all.map(h => n0(h.scan_count))),
      xpPerHunt: meanOf(all.map(h => n0(h.xp))),
      repeatRate: rateOf(lists.filter(l => l.length >= 2).length, users.length),
      d7: retained(7), d30: retained(30),
    };
  };
  const hunters = [...hunts.keys()];
  const viewers = hunters.filter(u => firstOpen.has(u));
  const others = hunters.filter(u => !firstOpen.has(u));

  // The same people, before and after their first open.
  const span = BEFORE_AFTER_DAYS * DAY;
  const mature = viewers.filter(u => now - firstOpen.get(u)! >= span);
  const before: number[] = [], after: number[] = [];
  let more = 0, fewer = 0;
  for (const u of mature) {
    const t = firstOpen.get(u)!;
    const b = hunts.get(u)!.filter(h => { const c = ms(h.completed_at); return c >= t - span && c < t; }).length;
    const a = hunts.get(u)!.filter(h => { const c = ms(h.completed_at); return c >= t && c < t + span; }).length;
    before.push(b); after.push(a);
    if (a > b) more++; else if (a < b) fewer++;
  }
  return {
    ever,
    hunters: hunters.length,
    groups: [group("Opened the leaderboard", viewers), group("Never opened it", others)],
    beforeAfter: {
      days: BEFORE_AFTER_DAYS, users: mature.length,
      before: meanOf(before), after: meanOf(after), more, fewer, same: mature.length - more - fewer,
      waiting: viewers.length - mature.length,
    },
  };
}

// ── 2. Boards ────────────────────────────────────────────────────────────────

/**
 * What a set of Hunt scans is made of, for someone deciding whether a score
 * looks real. Counts only: it does not judge. A kept item scanned with a single
 * photo is the normal case for ordinary finds; a week of thousands of XP made
 * ONLY of single-photo items just under the big-find line is what to look at.
 */
export function evidenceSummary(scans: LbScanRow[]) {
  const judged = scans.filter(s => !!s.final_status);
  const counted = judged.filter(s => s.kept === true && s.final_status === "normal");
  const sum = (xs: LbScanRow[]) => Math.round(xs.reduce((a, s) => a + n0(s.counted_profit), 0) * 100) / 100;
  const has = (r: string) => judged.filter(s => (s.status_reasons ?? []).includes(r)).length;
  const profit = sum(counted);
  const onePhotoProfit = sum(counted.filter(s => n0(s.photo_count) < 2));
  return {
    scans: judged.length,
    kept: judged.filter(s => s.kept === true).length,
    countedProfit: profit,
    onePhotoProfit,
    onePhotoShare: profit > 0 ? onePhotoProfit / profit : null,
    /** Kept, counted, and just under the line where evidence starts to be needed. */
    nearLine: counted.filter(s => n0(s.counted_profit) > BIG_FIND_PROFIT * 0.8 && n0(s.counted_profit) <= BIG_FIND_PROFIT).length,
    reduced: judged.filter(s => s.final_status === "reduced").length,
    excluded: judged.filter(s => s.final_status === "excluded").length,
    screenFlags: has("screen_flag"), sharedImages: has("shared_image"), duplicatePhotos: has("duplicate_photo"),
    libraryPhotos: has("library_photo"),
    cappedBigFinds: judged.filter(s => (s.status_reasons ?? []).some(r => r.startsWith("no_") && r !== "no_photo_hash")).length,
  };
}

/**
 * When one of this week's leaders is worth your eyes. Three plain rules, in one
 * place so the table, its badges and the "needs attention" list cannot disagree.
 *
 *   bigWeek   weekly XP this high is a great week or not a real one. Either way
 *             you want to see it. An ordinary Hunt earns about 150 to 200 XP.
 *   onePhoto  over $1,000 of counted profit, nearly all of it from items scanned
 *             with a single photo
 *   nearLine  several kept items just under the $250 line, where evidence starts
 *             to be needed
 *
 * None of these says "cheater". They say "look at the photos".
 */
export const LOOK_WEEKLY_XP = 3000;
export const LOOK_ONE_PHOTO_SHARE = 0.9;
export const LOOK_ONE_PHOTO_PROFIT = 1000;
export const LOOK_NEAR_LINE = 4;

export interface LeaderLook { bigWeek: boolean; onePhoto: boolean; nearLine: boolean; any: boolean }
export function leaderLook(xp: number, e: ReturnType<typeof evidenceSummary> | null): LeaderLook {
  const bigWeek  = n0(xp) >= LOOK_WEEKLY_XP;
  const onePhoto = !!e && (e.onePhotoShare ?? 0) >= LOOK_ONE_PHOTO_SHARE && e.countedProfit >= LOOK_ONE_PHOTO_PROFIT;
  const nearLine = !!e && e.nearLine >= LOOK_NEAR_LINE;
  return { bigWeek, onePhoto, nearLine, any: bigWeek || onePhoto || nearLine };
}

export const XP_BUCKETS: Array<[string, number, number]> = [
  ["1–99", 1, 99], ["100–299", 100, 299], ["300–999", 300, 999], ["1,000–4,999", 1000, 4999], ["5,000+", 5000, Infinity],
];

export function getLeaderboardBoards(d: V4Data, lb: LbData) {
  need(lb, "weekly", "live", "hunts");
  const week = lb.live!.weekStart;
  const visible = (uid: string) => inScope(d, uid) && !lb.excluded.has(uid);
  const thisWeek = lb.weekly.filter(r => String(r.week_start).slice(0, 10) === week && n0(r.xp) > 0 && visible(r.user_id));
  const xps = thisWeek.map(r => n0(r.xp)).sort((a, b) => b - a);
  const hunts = huntsByUser(d, lb);
  const accounts = d.base.profileIds.size;
  const top = [...thisWeek].sort((a, b) => n0(b.xp) - n0(a.xp) || a.user_id.localeCompare(b.user_id)).slice(0, 10)
    .map((r, i) => {
      const mine = (hunts.get(r.user_id) ?? []).filter(h => String(h.week_start).slice(0, 10) === week);
      // What that XP is made of. Null when it could not be read: never shown as "clean".
      const evidence = lb.errors.leaders || !lb.leaderScans.has(r.user_id) ? null : evidenceSummary(lb.leaderScans.get(r.user_id)!);
      return {
        position: i + 1, userId: r.user_id, name: userName(d, r.user_id), xp: n0(r.xp),
        hunts: mine.length, biggestHunt: mine.length ? Math.max(...mine.map(h => n0(h.xp))) : 0,
        evidence, look: leaderLook(n0(r.xp), evidence),
      };
    });
  const bestQualifiers = [...hunts].filter(([u, l]) => visible(u) && l.some(h => h.qualifies && n0(h.best_hunt_score) > 0)).length;
  const weekIds = new Set(lb.weeks.map(w => String(w.week_start).slice(0, 10)));
  return {
    weekStart: week, weekEndsAt: lb.live!.weekEndsAt,
    rankedThisWeek: rateOf(thisWeek.length, hunts.size, { note: "of accounts that have ever finished a server-scored Hunt" }),
    rankedOfAccounts: rateOf(thisWeek.length, accounts, { note: "of all accounts in scope" }),
    weeklyXpTotal: exact(xps.reduce((a, b) => a + b, 0)),
    weeklyXpTop: exact(xps.length ? xps[0] : null),
    weeklyXpMedian: { value: median(xps), trust: "DERIVED", d: xps.length } as Metric,
    distribution: XP_BUCKETS.map(([label, lo, hi]) => ({ label, hunters: xps.filter(x => x >= lo && x <= hi).length })),
    top,
    bestHuntQualifiers: exact(bestQualifiers),
    excluded: exact(lb.errors.excluded ? null : lb.excluded.size),
    foundingHunters: exact(lb.founding),
    pastWeeks: lb.errors.weeks ? null : [...lb.weeks].sort((a, b) => String(b.week_start).localeCompare(String(a.week_start))).slice(0, 8).map(w => ({
      weekStart: String(w.week_start).slice(0, 10), hunters: n0(w.hunters), totalXp: n0(w.total_xp), closedAt: w.closed_at,
      winners: lb.winners.filter(x => String(x.week_start).slice(0, 10) === String(w.week_start).slice(0, 10))
        .sort((a, b) => a.position - b.position).map(x => ({ position: x.position, userId: x.user_id, name: userName(d, x.user_id), xp: n0(x.xp) })),
    })),
    pastWeeksError: lb.errors.weeks ?? null,
    // A finished week with XP that was never frozen means the server job is not running.
    unfrozenWeeks: lb.errors.weeks ? null
      : [...new Set(lb.weekly.map(r => String(r.week_start).slice(0, 10)))].filter(w => w < week && !weekIds.has(w)).sort(),
  };
}

// ── 3. Integrity ─────────────────────────────────────────────────────────────

export function getLeaderboardIntegrity(d: V4Data, lb: LbData) {
  need(lb, "scans", "hunts");
  // Only scans whose Hunt was finished have a verdict.
  const scans = lb.scans.filter(s => inScope(d, s.user_id) && !!s.final_status);
  const open = lb.scans.filter(s => inScope(d, s.user_id) && !s.final_status).length;
  const by = (st: string) => scans.filter(s => s.final_status === st).length;
  const has = (s: LbScanRow, r: string) => Array.isArray(s.status_reasons) && s.status_reasons.includes(r);
  const reasons: Record<string, number> = {};
  for (const s of scans) for (const r of s.status_reasons ?? []) reasons[r] = (reasons[r] ?? 0) + 1;

  const kept = scans.filter(s => s.kept === true);
  const capped = kept.filter(s => (s.status_reasons ?? []).some(r => r.startsWith("no_") && r !== "no_photo_hash"));
  const gated = kept.filter(s => s.final_status === "normal" && n0(s.counted_profit) > BIG_FIND_PROFIT);
  const anomalies = kept.filter(s => s.thrift_price != null && Number(s.thrift_price) <= ANOMALY_MAX_PRICE && n0(s.resale) >= ANOMALY_MIN_RESALE);

  const startMs = d.window.startMs, endMs = d.window.endMs;
  const hunts = lb.hunts.filter(h => inScope(d, h.user_id) && (startMs == null || ms(h.completed_at) >= startMs) && (endMs == null || ms(h.completed_at) < endMs));
  return {
    scans: exact(scans.length, open ? { note: `${open} more in Hunts not finished yet` } : {}),
    normal: rateOf(by("normal"), scans.length),
    reduced: rateOf(by("reduced"), scans.length, { note: "took part, earned no value XP" }),
    excluded: rateOf(by("excluded"), scans.length, { note: "earned nothing" }),
    reasons: Object.entries(reasons).map(([reason, n]) => ({ reason, label: REASON_TEXT[reason] ?? reason, scans: n })).sort((a, b) => b.scans - a.scans),
    bigFindsGated: exact(gated.length, { note: `kept, over $${BIG_FIND_PROFIT} profit` }),
    bigFindsCapped: exact(capped.length, { note: `over $${BIG_FIND_PROFIT} profit, evidence missing` }),
    cappedShare: rateOf(capped.length, capped.length + gated.length),
    sharedImages: exact(scans.filter(s => has(s, "shared_image")).length),
    duplicatePhotos: exact(scans.filter(s => has(s, "duplicate_photo")).length),
    screenFlags: exact(scans.filter(s => has(s, "screen_flag")).length),
    libraryPhotos: exact(scans.filter(s => has(s, "library_photo")).length),
    priceAnomalies: exact(anomalies.length, { note: `kept at $${ANOMALY_MAX_PRICE.toFixed(2)} or less, resale $${ANOMALY_MIN_RESALE}+` }),
    anomalyRows: anomalies.sort((a, b) => n0(b.resale) - n0(a.resale)).slice(0, 15).map(s => ({
      userId: s.user_id, name: userName(d, s.user_id), at: s.scanned_at, item: [s.brand, s.category].filter(Boolean).join(" · ") || "—",
      thriftPrice: Number(s.thrift_price), resale: n0(s.resale), countedProfit: n0(s.counted_profit), status: s.final_status,
    })),
    hunts: exact(hunts.length),
    huntXp: exact(hunts.reduce((a, h) => a + n0(h.xp), 0)),
    qualifying: rateOf(hunts.filter(h => h.qualifies).length, hunts.length),
    bigHunts: exact(hunts.filter(h => n0(h.xp) >= REVIEW_XP).length, { note: "listed under Leaderboard review" }),
  };
}

// ── 4. Review ────────────────────────────────────────────────────────────────
// Not scoped and not ranged: a cheater or a bad picture is shown whoever it is.

export function getLeaderboardReview(d: V4Data, lb: LbData, message?: string | null) {
  const who = (uid: string) => ({
    userId: uid, name: userName(d, uid), excluded: lb.excluded.has(uid), internal: !!d.internalIds?.has(uid),
    identity: lb.identity.get(uid) ?? null,
  });
  const bigHunts = lb.errors.review ? null : lb.bigHunts.map(h => {
    const r = h.result && typeof h.result === "object" ? h.result : {};
    const totalBefore = n0(r.previousTotalXp), totalAfter = n0(r.newTotalXp);
    return {
      ...who(h.user_id), huntId: h.hunt_id, at: h.completed_at, xp: n0(h.xp), qualifies: h.qualifies === true,
      scans: n0(h.scan_count), kept: n0(h.kept_count), minutes: Math.round(n0(h.duration_ms) / 60_000),
      cappedBigFinds: n0(r.cappedBigFinds), xpProfit: n0(r.xpProfit), grade: typeof r.grade === "string" ? r.grade : null,
      rankBefore: RANK_LADDER[rankIndexFor(totalBefore)].rank, rankAfter: RANK_LADDER[rankIndexFor(totalAfter)].rank,
      breakdown: (Array.isArray(r.breakdown) ? r.breakdown : [])
        .filter((b: any) => b && typeof b.label === "string" && Number(b.xp) > 0)
        .sort((a: any, b: any) => Number(b.xp) - Number(a.xp)).slice(0, 5)
        .map((b: any) => ({ label: String(b.label), detail: typeof b.detail === "string" ? b.detail : null, xp: Number(b.xp) })),
      items: reviewItems(lb.bigScans, h).map(s => ({
        item: [s.brand, s.category].filter(Boolean).join(" · ") || "—",
        thriftPrice: s.thrift_price == null ? null : Number(s.thrift_price), resale: n0(s.resale), countedProfit: n0(s.counted_profit),
        status: s.final_status, rating: s.final_rating, capture: s.capture_front, photoCount: n0(s.photo_count),
        reasons: (s.status_reasons ?? []).map(x => REASON_TEXT[x] ?? x),
        photos: (["front", "tag", "detail"] as const).map(slot => photoLink(lb.photos, s.user_id, s.analysis_id, slot)).filter((u): u is string => !!u),
      })),
    };
  });
  const reports = lb.errors.reports ? null : lb.reports.map(r => ({
    ...who(r.user_id), reason: r.reason, reporters: n0(r.reporters), first: r.first_report, last: r.last_report,
    hiddenNow: r.hidden_now === true, picture: r.picture, profileName: r.display_name ?? r.username ?? null,
  }));
  const excluded = lb.errors.excluded ? null : [...lb.excluded].sort().map(who);
  return {
    message: message ?? null,
    bigHunts, bigHuntsError: lb.errors.review ?? null, reviewXp: REVIEW_XP, limit: REVIEW_HUNTS,
    reports, reportsError: lb.errors.reports ?? null,
    excluded, excludedError: lb.errors.excluded ?? null,
  };
}

// ── The buttons ──────────────────────────────────────────────────────────────

export const LB_ACTIONS = ["exclude", "include", "avatar_ok", "avatar_remove", "name_ok", "name_remove", "close_cheating", "reclose_week"] as const;
export type LbAction = typeof LB_ACTIONS[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What to call for an action. Null = not a valid request. Pure, so it can be tested without a database. */
export function actionCall(action: unknown, userId: unknown, week: unknown): { fn: string; args: Record<string, unknown> } | null {
  if (typeof action !== "string" || !(LB_ACTIONS as readonly string[]).includes(action)) return null;
  if (action === "reclose_week") {
    return typeof week === "string" && DATE.test(week) ? { fn: "leaderboard_reclose_week", args: { p_week: week } } : null;
  }
  if (typeof userId !== "string" || !UUID.test(userId)) return null;
  switch (action as LbAction) {
    case "exclude":        return { fn: "leaderboard_set_excluded", args: { p_user_id: userId, p_excluded: true } };
    case "include":        return { fn: "leaderboard_set_excluded", args: { p_user_id: userId, p_excluded: false } };
    case "avatar_ok":      return { fn: "leaderboard_review_avatar", args: { p_user_id: userId, p_ok: true } };
    case "avatar_remove":  return { fn: "leaderboard_review_avatar", args: { p_user_id: userId, p_ok: false } };
    case "name_ok":        return { fn: "leaderboard_review_name", args: { p_user_id: userId, p_ok: true } };
    case "name_remove":    return { fn: "leaderboard_review_name", args: { p_user_id: userId, p_ok: false } };
    case "close_cheating": return { fn: "leaderboard_close_cheating_reports", args: { p_user_id: userId } };
    default:               return null;
  }
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;

/**
 * Run one founder action. Always answers with a sentence for the page; never
 * throws. The caller has already checked FOUNDER_DASHBOARD_SECRET.
 */
export async function runLeaderboardAction(
  input: { action: unknown; userId?: unknown; week?: unknown }, rpc?: Rpc,
): Promise<{ ok: boolean; message: string }> {
  const call = actionCall(input.action, input.userId, input.week);
  if (!call) return { ok: false, message: "That action was not understood. Nothing was changed." };
  try {
    let run = rpc;
    if (!run) {
      const sb: any = getSupabaseAdmin();
      if (!sb) return { ok: false, message: "Supabase is not configured. Nothing was changed." };
      run = (fn, args) => sb.rpc(fn, args);
    }
    const { data, error } = await run(call.fn, call.args);
    if (error) {
      const denied = /permission denied/i.test(error.message ?? "");
      console.warn(`[leaderboard] founder action ${String(input.action)} failed:`, error.message);
      return { ok: false, message: denied
        ? "Permission denied: run hunt_leaderboard_phase5.sql in Supabase, then try again. Nothing was changed."
        : `That did not work (${error.message ?? "unknown error"}). Nothing was changed.` };
    }
    invalidateLeaderboardCache();                      // the app sees it on its next fetch
    const text = Array.isArray(data) ? data[0] : data;
    console.log(`[leaderboard] founder action ${String(input.action)} target=${String(input.userId ?? input.week).slice(0, 36)}`);
    return { ok: true, message: typeof text === "string" && text ? text : "Done." };
  } catch (e: any) {
    console.warn(`[leaderboard] founder action ${String(input.action)} threw:`, e?.message ?? e);
    return { ok: false, message: "That did not work. Nothing was changed." };
  }
}