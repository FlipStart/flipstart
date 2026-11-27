/**
 * server/executiveKpis.ts
 *
 * Founder Dashboard V5 — Phase 2: the Executive tab's KPI set.
 *
 * Purpose: open the dashboard and know how the company is doing in under a
 * minute. So: 18 tiles in 7 groups, nothing else by default; everything else
 * one click away under "More metrics" or on its own tab.
 *
 * Every tile uses a FIXED window and says which, so the tab is never blank on
 * the default range and reads the same every morning:
 *   • "7d"            the last 7 days, rolling
 *   • "now"           current state
 *   • latest cohort   the most recent group of people old enough for the
 *                     number (a 7-day activation rate needs people who signed
 *                     up 7–14 days ago). Never a cohort still filling up.
 * The date range at the top applies to the other tabs, not this one.
 *
 * Definitions are the approved ones:
 *   activation        first completed scan within 7 days of signing up
 *   immediate act.    first completed scan within 24 hours
 *   paywall → buy     paywall viewers in the window who bought in it
 *   paid within 7d    the current pricing era's 7-day cohort (as Pricing)
 *   fail screens      what the user saw (app events), never blended with
 *                     server outcomes
 *   Hunt              opens and starts from app events; completions from the
 *                     server's hunts table, joined on the Hunt id
 *
 * n floors (Phase 0): every rate shows its n; under 30 it is labelled noisy.
 * Nothing on this tab is coloured better or worse; that's Release Impact's job.
 *
 * Pure: takes the page's own events and loaded rows, reads nothing itself.
 */
import { centralDay, addCentralDays, formatDayLabel } from "./dashboardDates";
import { NOISY_BELOW } from "./releaseImpact";

const HOUR = 3_600_000, DAY = 86_400_000;

export type TileFmt = "num" | "pct" | "usd" | "usd4" | "hrs" | "dec";
export type TileTrust = "EXACT" | "DERIVED" | "ESTIMATED" | "NOT_TRACKED" | "PARTIAL";
export interface Tile {
  key: string;
  label: string;
  /** Which window this number covers, in words. */
  window: string;
  value: number | null;
  fmt: TileFmt;
  trust: TileTrust;
  /** Rates: hits / out of. Counts and averages: d = how many it rests on. */
  n?: number;
  d?: number;
  noisy?: boolean;
  /** Why the value is missing, or anything the reader must know. */
  note?: string;
}
export interface TileGroup { key: string; label: string; tiles: Tile[] }

export interface ExecEvent {
  user_id: string | null;
  event_name: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  app_version?: string | null;
}
export interface ExecHunt { user_id: string; hunt_id: string; completed_at: string; scan_count: number }

/** Metric-shaped values the page has already computed elsewhere. */
interface M { value: number | null; trust?: string; n?: number; d?: number; available?: boolean; note?: string }

export interface ExecInput {
  /** Every event in scope, unwindowed. */
  events: ExecEvent[];
  /** Accounts in scope, with their creation time. */
  accounts: Array<{ id: string; created_at: string }>;
  /** Server-completed Hunts for accounts in scope; null when the table couldn't be read. */
  hunts: ExecHunt[] | null;
  /** Per-action AI cost rates (the same ones Cost uses); null = no estimate. */
  rates: { NORMAL: number; HUNT: number; LISTING: number } | null;
  /** The release Release Impact is judging, for the adoption tile. */
  targetVersion: string | null;
  /** Already on the page: reused so a number never disagrees with its own tab. */
  newUsers7: M | null;
  activeUsers7: M | null;
  payingUsers: M | null;
  monthly: M | null;
  annual: M | null;
  purchases7: M | null;
  pricingPaid7: (M & { label?: string | null }) | null;
  now: Date;
}

// ── Small helpers ────────────────────────────────────────────────────────────

const t = (iso: string) => Date.parse(iso);
const within = (iso: string, from: number, to: number) => { const x = t(iso); return x >= from && x < to; };
/** A rate tile. `whenEmpty` explains a blank; it never shows next to a real number. */
const rate = (key: string, label: string, window: string, n: number, d: number, whenEmpty?: string): Tile =>
  ({ key, label, window, value: d > 0 ? n / d : null, fmt: "pct", trust: "DERIVED", n, d, noisy: d > 0 && d < NOISY_BELOW,
     note: d === 0 ? (whenEmpty ?? "nobody in this window yet") : undefined });
const fromMetric = (key: string, label: string, window: string, m: M | null, fmt: TileFmt = "num"): Tile => {
  if (!m || m.available === false) return { key, label, window, value: null, fmt, trust: "NOT_TRACKED", note: m?.note ?? "unavailable for this load" };
  const isRate = m.n !== undefined && m.d !== undefined;
  return { key, label, window, value: m.value, fmt: isRate ? "pct" : fmt, trust: (m.trust as TileTrust) ?? "EXACT",
    n: m.n, d: m.d, noisy: isRate ? (m.d! > 0 && m.d! < NOISY_BELOW) : undefined, note: m.note };
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
/** "Nov 9 – Nov 15" for a span of instants, in Central days. */
const span = (from: number, toExclusive: number) => {
  const a = formatDayLabel(centralDay(new Date(from))).replace(/, \d{4}$/, "");
  const b = formatDayLabel(centralDay(new Date(toExclusive - 1))).replace(/, \d{4}$/, "");
  return a === b ? a : `${a} – ${b}`;
};
const dayLabel = (day: string) => formatDayLabel(day).replace(/, \d{4}$/, "");

// ── Activation: one definition, shared ───────────────────────────────────────

/**
 * The approved activation definitions, over any group of new accounts. Used by
 * Executive (latest cohorts) and Growth → Activation (people who signed up in
 * the selected range), so the two can never define it differently. Only people
 * old enough for a number count towards it; `total` says how many there were.
 *   act24     a completed scan within 24h of signing up
 *   act7      a completed scan within 7 days (the canonical definition)
 *   second7   two completed scans within 7 days
 *   hours     median hours to the first scan, among people 7+ days old who
 *             scanned within 7 days (so a young group can't look faster)
 * A scan up to an hour before the account's timestamp counts: the first scan
 * can land a moment before signup is recorded.
 */
export interface ActivationRates {
  total: number;
  act24: { n: number; d: number };
  act7: { n: number; d: number };
  second7: { n: number; d: number };
  hours: { median: number | null; d: number };
}
export function activationFor(accounts: Array<{ id: string; created_at: string }>, scanTimes: Map<string, number[]>, now: number): ActivationRates {
  const out: ActivationRates = { total: accounts.length, act24: { n: 0, d: 0 }, act7: { n: 0, d: 0 }, second7: { n: 0, d: 0 }, hours: { median: null, d: 0 } };
  const hours: number[] = [];
  for (const a of accounts) {
    const s = Date.parse(a.created_at); if (!Number.isFinite(s)) continue;
    const mine = (scanTimes.get(a.id) ?? []).filter(x => x >= s - HOUR).sort((p, q) => p - q);
    if (s + DAY <= now) { out.act24.d++; if (mine.some(x => x < s + DAY)) out.act24.n++; }
    if (s + 7 * DAY <= now) {
      const in7 = mine.filter(x => x < s + 7 * DAY);
      out.act7.d++; out.second7.d++;
      if (in7.length >= 1) { out.act7.n++; hours.push(Math.max(0, (in7[0] - s) / HOUR)); }
      if (in7.length >= 2) out.second7.n++;
    }
  }
  out.hours = { median: median(hours), d: hours.length };
  return out;
}

// ── The KPI set ──────────────────────────────────────────────────────────────

export function buildExecutiveKpis(x: ExecInput): { groups: TileGroup[]; more: Tile[]; windowsNote: string } {
  const now = x.now.getTime(), t7 = now - 7 * DAY;
  const ev = x.events;
  const last7 = ev.filter(e => within(e.created_at, t7, now + 1));

  // Per-user scan times and active Central days, from every event in scope.
  const scans = new Map<string, number[]>(), days = new Map<string, Set<string>>(), firstDay = new Map<string, string>();
  for (const e of ev) {
    if (!e.user_id) continue;
    if (e.event_name === "scan_completed") (scans.get(e.user_id) ?? scans.set(e.user_id, []).get(e.user_id)!).push(t(e.created_at));
    const day = centralDay(e.created_at); if (!day) continue;
    (days.get(e.user_id) ?? days.set(e.user_id, new Set()).get(e.user_id)!).add(day);
    const f = firstDay.get(e.user_id); if (!f || day < f) firstDay.set(e.user_id, day);
  }
  const signedUp = (from: number, to: number) => x.accounts.filter(a => within(a.created_at, from, to));

  // ── Growth ──
  const adoption = (() => {
    const label = x.targetVersion ? `${x.targetVersion} adoption` : "New version adoption";
    if (!x.targetVersion) return { key: "adoption", label, window: "active users · 7d", value: null, fmt: "pct", trust: "NOT_TRACKED", note: "no app version recorded yet" } as Tile;
    const latest = new Map<string, { at: string; v: string | null }>();
    for (const e of last7) {
      if (!e.user_id) continue;
      const cur = latest.get(e.user_id);
      if (!cur || e.created_at > cur.at) latest.set(e.user_id, { at: e.created_at, v: e.app_version?.trim() || null });
    }
    const on = [...latest.values()].filter(l => l.v === x.targetVersion).length;
    return rate("adoption", label, "active users · 7d, by their latest event", on, latest.size);
  })();

  // ── Activation: the latest cohorts old enough ──
  const c24from = now - 8 * DAY, c24to = now - DAY;
  const a24 = activationFor(signedUp(c24from, c24to), scans, now);
  const act24 = rate("act24", "First scan within 24h", `signed up ${span(c24from, c24to)}`, a24.act24.n, a24.act24.d);
  const c7from = now - 14 * DAY, c7to = now - 7 * DAY;
  const a7 = activationFor(signedUp(c7from, c7to), scans, now);
  const act7 = rate("act7", "Activation 7d", `signed up ${span(c7from, c7to)}`, a7.act7.n, a7.act7.d);
  const second7 = rate("second7", "Second scan within 7d", `signed up ${span(c7from, c7to)}`, a7.second7.n, a7.second7.d);
  const medianFirst: Tile = { key: "hoursToFirst", label: "Median time to first scan", window: `signed up ${span(c7from, c7to)}`,
    value: a7.hours.median, fmt: "hrs", trust: "DERIVED", d: a7.hours.d, noisy: a7.hours.d > 0 && a7.hours.d < NOISY_BELOW,
    note: a7.hours.d ? undefined : "nobody in this window scanned yet" };

  // ── Monetization ──
  const viewers = new Set(last7.filter(e => e.event_name === "paywall_opened" && e.user_id).map(e => e.user_id!));
  const buyers = new Set(last7.filter(e => e.event_name === "paywall_purchase_completed" && e.user_id).map(e => e.user_id!));
  const pwBuy = rate("paywallToPurchase", "Paywall → purchase", "viewers · 7d who bought in it",
    [...buyers].filter(u => viewers.has(u)).length, viewers.size, "no paywall viewers in the last 7 days");
  const paid7 = fromMetric("paid7", "Paid within 7d", x.pricingPaid7?.label ? `${x.pricingPaid7.label} cohort` : "current pricing cohort", x.pricingPaid7);

  // ── Retention: the latest complete Central-day cohorts ──
  const today = centralDay(x.now);
  const retention = (key: string, label: string, k: number): Tile => {
    // First active day F with F + k + 1 ≤ today, over the most recent 7 such days.
    const newest = addCentralDays(today, -(k + 1)), oldest = newest ? addCentralDays(newest, -6) : null;
    if (!newest || !oldest) return { key, label, window: "", value: null, fmt: "pct", trust: "NOT_TRACKED" };
    let n = 0, d = 0;
    for (const [u, f] of firstDay) {
      if (f < oldest || f > newest) continue;
      d++; if (days.get(u)!.has(addCentralDays(f, k) ?? "")) n++;
    }
    return rate(key, label, `first active ${dayLabel(oldest)} – ${dayLabel(newest)}`, n, d);
  };
  const d1 = retention("d1", "D1 retention", 1);
  const d7 = retention("d7", "D7 retention", 7);
  const d30 = retention("d30", "D30 retention", 30);

  // ── Quality ──
  const completed7 = last7.filter(e => e.event_name === "scan_completed");
  const continued7 = completed7.filter(e => e.metadata?.continuedAfterSoftFail === true).length;
  const failed7 = Math.max(0, last7.filter(e => e.event_name === "scan_failed").length - continued7);
  const failScreens = rate("failScreens", "Scans ending on a fail screen", "app events · 7d", failed7, completed7.length + failed7,
    "no scan attempts in the last 7 days");
  const fb = ev.filter(e => e.event_name === "scan_feedback_submitted" && within(e.created_at, now - 30 * DAY, now + 1));
  const rating = (e: ExecEvent) => String(e.metadata?.feedback_rating ?? e.metadata?.accuracyRating ?? "");
  const acc = fb.filter(e => rating(e) === "accurate").length, som = fb.filter(e => rating(e) === "somewhat").length;
  const bad = fb.filter(e => ["bad", "inaccurate"].includes(rating(e))).length;
  const rated = acc + som + bad;
  const trust: Tile = { key: "trust", label: "Trust score", window: "feedback · 30d", value: rated ? (acc + 0.5 * som) / rated : null, fmt: "pct",
    trust: "DERIVED", n: undefined, d: rated, noisy: rated > 0 && rated < NOISY_BELOW,
    note: rated ? undefined : "no feedback in the last 30 days" };

  // ── Hunt ──
  const openers = new Set(last7.filter(e => e.event_name === "hunt_mode_opened" && e.user_id).map(e => e.user_id!));
  const starters = new Set(last7.filter(e => e.event_name === "hunt_started" && e.user_id).map(e => e.user_id!));
  const openStart = rate("huntOpenStart", "Hunt open → start", "users · 7d", [...starters].filter(u => openers.has(u)).length, openers.size,
    "nobody opened Hunt Mode in the last 7 days");
  let completion: Tile, repeat: Tile, scansPerHunt: Tile;
  if (!x.hunts) {
    const na = (key: string, label: string): Tile => ({ key, label, window: "", value: null, fmt: "pct", trust: "NOT_TRACKED", note: "the hunts table couldn't be read" });
    completion = na("huntCompletion", "Hunt completion"); repeat = na("huntRepeat", "Second Hunt within 7d");
    scansPerHunt = { ...na("scansPerHunt", "Scans per Hunt"), fmt: "dec" };
  } else {
    // Started in the 7 days that ended a day ago, so a Hunt still in progress isn't counted as abandoned.
    const done = new Set(x.hunts.map(h => `${h.user_id}\u0000${h.hunt_id}`));
    const started = ev.filter(e => e.event_name === "hunt_started" && e.user_id && within(e.created_at, now - 8 * DAY, now - DAY));
    const withId = started.filter(e => typeof e.metadata?.hunt_id === "string" && e.metadata.hunt_id);
    completion = rate("huntCompletion", "Hunt completion", `started ${span(now - 8 * DAY, now - DAY)}`,
      withId.filter(e => done.has(`${e.user_id}\u0000${e.metadata!.hunt_id}`)).length, withId.length,
      started.length && !withId.length ? "these Hunts came from an app too old to send a Hunt id" : "no Hunts started in this window");
    if (withId.length && withId.length < started.length) completion.note = `${started.length - withId.length} started on an older app without a Hunt id, left out`;
    // Each hunter's first completed Hunt, then whether a second followed within 7 days.
    const byUser = new Map<string, number[]>();
    for (const h of x.hunts) (byUser.get(h.user_id) ?? byUser.set(h.user_id, []).get(h.user_id)!).push(t(h.completed_at));
    let rn = 0, rd = 0;
    for (const times of byUser.values()) {
      times.sort((a, b) => a - b);
      const first = times[0];
      if (!(first >= now - 14 * DAY && first < now - 7 * DAY)) continue;
      rd++; if (times.some(v => v > first && v <= first + 7 * DAY)) rn++;
    }
    repeat = rate("huntRepeat", "Second Hunt within 7d", `first Hunt ${span(now - 14 * DAY, now - 7 * DAY)}`, rn, rd,
      "nobody finished a first Hunt in this window");
    const recent = x.hunts.filter(h => within(h.completed_at, t7, now + 1)).map(h => Number(h.scan_count)).filter(Number.isFinite);
    scansPerHunt = { key: "scansPerHunt", label: "Scans per Hunt (median)", window: "completed · 7d", value: median(recent), fmt: "dec",
      trust: "EXACT", d: recent.length, noisy: recent.length > 0 && recent.length < NOISY_BELOW, note: recent.length ? undefined : "no Hunts completed in the last 7 days" };
  }

  // ── Economics: estimated, the same formula as Cost, over 7 days ──
  const count7 = (name: string) => last7.filter(e => e.event_name === name).length;
  const spend = x.rates ? completed7.length * x.rates.NORMAL + count7("hunt_scan_started") * x.rates.HUNT + count7("listing_generated") * x.rates.LISTING : null;
  const cost7: Tile = { key: "cost7", label: "AI cost", window: "7d · estimated", value: spend, fmt: "usd", trust: x.rates ? "ESTIMATED" : "NOT_TRACKED",
    note: x.rates ? "from usage × rate card, not a bill" : "cost rates unavailable" };
  const perScan: Tile = { key: "costPerScan", label: "AI cost per scan", window: "7d · estimated", value: spend !== null && completed7.length ? spend / completed7.length : null,
    fmt: "usd4", trust: x.rates ? "ESTIMATED" : "NOT_TRACKED", d: completed7.length, note: !completed7.length ? "no scans in the last 7 days" : undefined };

  const groups: TileGroup[] = [
    { key: "growth", label: "Growth", tiles: [fromMetric("new7", "New users", "7d", x.newUsers7), fromMetric("active7", "Active users", "7d", x.activeUsers7), adoption] },
    { key: "activation", label: "Activation", tiles: [act7, act24, second7] },
    { key: "monetization", label: "Monetization", tiles: [fromMetric("paying", "Paying users", "now", x.payingUsers), pwBuy, paid7] },
    { key: "retention", label: "Retention", tiles: [d1, d7] },
    { key: "quality", label: "Quality", tiles: [failScreens, trust] },
    { key: "hunt", label: "Hunt", tiles: [openStart, completion, repeat] },
    { key: "economics", label: "Economics", tiles: [cost7, perScan] },
  ];
  const more: Tile[] = [
    fromMetric("purchases7", "Purchases", "7d", x.purchases7),
    { key: "attempts7", label: "Scan attempts", window: "app events · 7d", value: completed7.length + failed7, fmt: "num", trust: "EXACT" },
    medianFirst,
    d30,
    scansPerHunt,
    fromMetric("monthly", "Monthly subscribers", "now", x.monthly),
    fromMetric("annual", "Annual subscribers", "now", x.annual),
  ];
  return {
    groups, more,
    windowsNote: "Each number names its own window: the last 7 days, now, or the most recent group of people old enough for it. The date range at the top doesn't change this tab. Trust score = (accurate + ½ somewhat) ÷ rated, as on Scan Trust. AI cost is estimated from usage × the cost rate card, not billed amounts.",
  };
}

export type ExecutiveKpis = ReturnType<typeof buildExecutiveKpis>;