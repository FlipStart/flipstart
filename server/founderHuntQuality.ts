/**
 * server/founderHuntQuality.ts
 *
 * Founder Dashboard V5 — Phase 5: the numbers behind the Hunt and Quality tabs.
 *
 * ── Where each number comes from ────────────────────────────────────────────
 *   Opens, starts, the Hunt demo      the app's events (hunt_*, hunt_onboarding_*)
 *   Completed Hunts, items, repeats   the SERVER's hunts table, which only holds
 *                                     Hunts it scored. A start is an app event,
 *                                     a completion is a server row; the two are
 *                                     joined on the Hunt id (approved, Phase 0).
 *   Fail screens, retries, ratings    the app's events: what the user saw
 *   Trust                             scan_feedback_submitted
 *   Sold comps                        hunt_sold_comps_result (Hunt items only)
 *
 * The scan failure headline here is the Executive tile's definition exactly —
 * scan_failed minus soft fails the user continued past, over that plus
 * scan_completed — just over the selected dates. The server's own record
 * (scan_outcomes) is shown under it, separately labelled, never blended.
 *
 * Pure: everything is passed in. Nothing here reads a database.
 */
import { centralDay, addCentralDays } from "./dashboardDates";
import type { Metric } from "./founderMetricsV4";

const DAY = 86_400_000;

export interface QEvent {
  event_name: string;
  created_at: string;
  user_id?: string | null;
  anonymous_id?: string | null;
  metadata?: Record<string, unknown> | null;
}
export interface QHunt {
  user_id: string; hunt_id: string; completed_at: string;
  scan_count: number | string | null; kept_count: number | string | null;
  duration_ms?: number | string | null; xp?: number | string | null;
}
export interface QWindow { startMs: number | null; endMs: number | null }

// ── Small helpers ────────────────────────────────────────────────────────────

const ms = (s: string) => { const t = Date.parse(s); return Number.isFinite(t) ? t : NaN; };
const inWin = (w: QWindow, s: string) => {
  if (w.startMs === null) return true;
  const t = ms(s);
  return Number.isFinite(t) && t >= w.startMs && (w.endMs === null || t < w.endMs);
};
const str = (e: QEvent, k: string): string | null => { const v = e.metadata?.[k]; return typeof v === "string" && v ? v : null; };
const numOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const nonNeg = (v: unknown) => Math.max(0, numOf(v) ?? 0);
const has = (e: QEvent, k: string) => !!e.metadata && Object.prototype.hasOwnProperty.call(e.metadata, k);
const exact = (value: number | null, note?: string): Metric => ({ value, trust: "EXACT", note });
const derived = (n: number, d: number, note?: string): Metric => ({ value: d > 0 ? n / d : null, trust: "DERIVED", n, d, note });
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
/** Nearest-rank percentile. */
export const percentile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const people = (evs: QEvent[]) => new Set(evs.filter(e => e.user_id).map(e => e.user_id!));
const tally = (xs: QEvent[], key: (e: QEvent) => string | null) => {
  const m = new Map<string, { count: number; who: Set<string> }>();
  for (const e of xs) {
    const k = key(e) ?? "unknown";
    const b = m.get(k) ?? m.set(k, { count: 0, who: new Set() }).get(k)!;
    b.count++; if (e.user_id) b.who.add(e.user_id);
  }
  return [...m.entries()].map(([k, b]) => ({ key: k, count: b.count, people: b.who.size }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};
const huntKey = (uid: string, hid: string) => `${uid}\u0000${hid}`;
/** A rate whose people need time to become countable (retention-style): n/d of the old enough, of total. */
export interface MaturingRate { value: number | null; trust: "DERIVED"; n: number; d: number; total: number; firstDue: string | null }

// ═══════════════════════════════════════════════════════════════════════════
// HUNT
// ═══════════════════════════════════════════════════════════════════════════

export const HUNT_DEMO = {
  offered: "hunt_onboarding_offered", started: "hunt_onboarding_started", step: "hunt_onboarding_step_completed",
  skipped: "hunt_onboarding_skipped", dismissed: "hunt_onboarding_dismissed", exited: "hunt_onboarding_exited",
  completed: "hunt_onboarding_completed", replayed: "hunt_onboarding_replayed",
  startReal: "hunt_onboarding_start_real_hunt_clicked", done: "hunt_onboarding_done_clicked",
} as const;
/** A Hunt started less than this long ago may still be running, so it isn't counted as unfinished. */
export const HUNT_GRACE_MS = DAY;

export interface HuntInput {
  /** Scoped events in the selected dates. */
  events: QEvent[];
  /** Scoped events, every date: what people did after the range started. */
  allEvents: QEvent[];
  /** Server-scored Hunts for accounts in scope, every date. Null: the table couldn't be read. */
  hunts: QHunt[] | null;
  window: QWindow;
  now: number;
}

export function buildHunt(x: HuntInput) {
  const { events, allEvents, window, now } = x;
  const named = (n: string) => events.filter(e => e.event_name === n);

  // ── Usage, in the selected dates ──
  const openers = people(named("hunt_mode_opened"));
  const starters = people(named("hunt_started"));
  const huntsInRange = x.hunts ? x.hunts.filter(h => inWin(window, h.completed_at)) : null;
  const usage = {
    openers: exact(openers.size),
    starters: exact(starters.size),
    openToStart: derived([...starters].filter(u => openers.has(u)).length, openers.size, "people"),
    started: exact(named("hunt_started").length),
    completed: huntsInRange ? exact(huntsInRange.length) : null,
    hunters: huntsInRange ? exact(new Set(huntsInRange.map(h => h.user_id)).size) : null,
  };

  // ── How each Hunt started in the range ended ──
  // Starts at least a day old only: one started this morning may still be running.
  const starts = named("hunt_started").filter(e => e.user_id);
  const withId = starts.filter(e => str(e, "hunt_id"));
  const settled = withId.filter(e => ms(e.created_at) <= now - HUNT_GRACE_MS);
  const serverDone = new Set((x.hunts ?? []).map(h => huntKey(h.user_id, h.hunt_id)));
  const endedAs = new Map<string, string>();
  for (const e of allEvents) if (e.event_name === "hunt_ended" && e.user_id && str(e, "hunt_id")) {
    const k = huntKey(e.user_id, str(e, "hunt_id")!);
    // "saved" wins over "discarded" if both were somehow logged.
    if (str(e, "outcome") === "saved" || !endedAs.has(k)) endedAs.set(k, str(e, "outcome") ?? "unknown");
  }
  const ends = { completed: 0, savedNotScored: 0, discarded: 0, noEnd: 0 };
  for (const e of settled) {
    const k = huntKey(e.user_id!, str(e, "hunt_id")!);
    if (serverDone.has(k)) ends.completed++;
    else if (endedAs.get(k) === "saved") ends.savedNotScored++;
    else if (endedAs.get(k) === "discarded") ends.discarded++;
    else ends.noEnd++;
  }
  const completion = x.hunts ? {
    rate: derived(ends.completed, settled.length, "started a day or more ago"),
    ends,
    settled: settled.length,
    tooRecent: withId.length - settled.length,
    noId: starts.length - withId.length,
  } : null;

  // ── Second Hunt within 7 and 30 days of the first ──
  // People whose first-ever scored Hunt fell in the range. Only people whose
  // first Hunt is old enough are counted; the rest wait, like retention.
  let repeat: { d7: MaturingRate; d30: MaturingRate; firstHunters: number } | null = null;
  if (x.hunts) {
    const byUser = new Map<string, number[]>();
    for (const h of x.hunts) {
      const t = ms(h.completed_at);
      if (Number.isFinite(t)) (byUser.get(h.user_id) ?? byUser.set(h.user_id, []).get(h.user_id)!).push(t);
    }
    const firsts: Array<{ t1: number; t2: number | null }> = [];
    for (const ts of byUser.values()) {
      ts.sort((a, b) => a - b);
      if (inWin(window, new Date(ts[0]).toISOString())) firsts.push({ t1: ts[0], t2: ts.length > 1 ? ts[1] : null });
    }
    const within = (days: number): MaturingRate => {
      let n = 0, d = 0, firstDue: string | null = null;
      for (const f of firsts) {
        if (now - f.t1 < days * DAY) {
          const due = centralDay(new Date(f.t1 + days * DAY));
          if (!firstDue || due < firstDue) firstDue = due;
          continue;
        }
        d++;
        if (f.t2 !== null && f.t2 - f.t1 <= days * DAY) n++;
      }
      return { value: d ? n / d : null, trust: "DERIVED", n, d, total: firsts.length, firstDue };
    };
    repeat = { d7: within(7), d30: within(30), firstHunters: firsts.length };
  }

  // ── What a finished Hunt looks like (server rows in the range) ──
  let items: null | Record<string, any> = null;
  if (huntsInRange) {
    const scans = huntsInRange.map(h => nonNeg(h.scan_count));
    const kept = huntsInRange.map(h => nonNeg(h.kept_count));
    const removed = huntsInRange.map((h, i) => Math.max(0, scans[i] - kept[i]));
    const mins = huntsInRange.map(h => numOf(h.duration_ms)).filter((v): v is number => v !== null && v >= 0).map(v => v / 60_000);
    const xp = huntsInRange.map(h => numOf(h.xp)).filter((v): v is number => v !== null);
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    items = {
      hunts: huntsInRange.length,
      scansMedian: { value: median(scans), trust: "EXACT", d: scans.length } as Metric,
      keptMedian: { value: median(kept), trust: "EXACT", d: kept.length } as Metric,
      removedMedian: { value: median(removed), trust: "EXACT", d: removed.length } as Metric,
      removedMean: { value: mean(removed), trust: "DERIVED", d: removed.length } as Metric,
      removedShare: derived(sum(removed), sum(scans)),
      noneKept: derived(kept.filter(k => k === 0).length, huntsInRange.length),
      minutesMedian: { value: median(mins), trust: "EXACT", d: mins.length } as Metric,
      xpMedian: { value: median(xp), trust: "EXACT", d: xp.length } as Metric,
      totals: { scanned: sum(scans), kept: sum(kept), removed: sum(removed) },
    };
  }

  return {
    usage, completion, repeat, items,
    demo: buildHuntDemo(x),
    detail: buildHuntDetail(events),
    huntsReadable: !!x.hunts,
  };
}

/**
 * The guided Hunt demo (lib/huntOnboardingAnalytics.ts), first runs only.
 *
 * The group is everyone who was shown the welcome, or began the demo, in the
 * selected dates. Each step counts those people doing it at or after that
 * moment, up to now — so recent people have had less time, as the page says.
 * Replays (the "How Hunt Mode works" button) are counted on their own.
 */
export function buildHuntDemo(x: HuntInput) {
  const { allEvents, events } = x;
  const ever = allEvents.some(e => e.event_name.startsWith("hunt_onboarding_"));
  const replay = (e: QEvent) => e.metadata?.replay === true;
  const firstRun = (e: QEvent) => !replay(e);
  const entry = new Map<string, number>();
  for (const e of events) {
    if (!e.user_id) continue;
    if (e.event_name === HUNT_DEMO.offered || (e.event_name === HUNT_DEMO.started && firstRun(e))) {
      const t = ms(e.created_at);
      if (Number.isFinite(t) && (!entry.has(e.user_id) || t < entry.get(e.user_id)!)) entry.set(e.user_id, t);
    }
  }
  // Each person's events from their entry on, oldest first.
  const after = new Map<string, QEvent[]>();
  for (const e of allEvents) {
    if (!e.user_id || !entry.has(e.user_id)) continue;
    if (ms(e.created_at) < entry.get(e.user_id)!) continue;
    (after.get(e.user_id) ?? after.set(e.user_id, []).get(e.user_id)!).push(e);
  }
  for (const list of after.values()) list.sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const serverHunts = new Map<string, number[]>();
  for (const h of x.hunts ?? []) if (entry.has(h.user_id)) (serverHunts.get(h.user_id) ?? serverHunts.set(h.user_id, []).get(h.user_id)!).push(ms(h.completed_at));

  const firstAt = (uid: string, name: string, pred: (e: QEvent) => boolean = () => true): number | null => {
    const e = (after.get(uid) ?? []).find(v => v.event_name === name && pred(v));
    return e ? ms(e.created_at) : null;
  };
  const realStartAfter = (uid: string, t: number) => (after.get(uid) ?? []).some(e => e.event_name === "hunt_started" && ms(e.created_at) >= t);
  const realDoneAfter = (uid: string, t: number) => (serverHunts.get(uid) ?? []).some(v => v >= t);

  const cohort = [...entry.keys()];
  const startedDemo = cohort.filter(u => firstAt(u, HUNT_DEMO.started, firstRun) !== null);
  const finishedAt = new Map(cohort.map(u => [u, firstAt(u, HUNT_DEMO.completed, firstRun)] as const));
  const finished = cohort.filter(u => finishedAt.get(u) !== null);
  const realAfterDemo = finished.filter(u => realStartAfter(u, finishedAt.get(u)!));
  const doneAfterDemo = x.hunts ? finished.filter(u => realDoneAfter(u, finishedAt.get(u)!)) : null;
  const tappedReal = finished.filter(u => firstAt(u, HUNT_DEMO.startReal, firstRun) !== null);
  const tappedDone = finished.filter(u => firstAt(u, HUNT_DEMO.done, firstRun) !== null);
  const skipped = cohort.filter(u => firstAt(u, HUNT_DEMO.skipped) !== null);
  const dismissed = cohort.filter(u => firstAt(u, HUNT_DEMO.dismissed) !== null);
  const exited = startedDemo.filter(u => finishedAt.get(u) === null && firstAt(u, HUNT_DEMO.exited, firstRun) !== null);

  // Paths, one per person: finished > left early > skipped > nothing yet.
  const pathOf = (u: string) => finishedAt.get(u) !== null ? "finished" : exited.includes(u) ? "left" : skipped.includes(u) ? "skipped" : "none";
  const PATHS: Array<[string, string]> = [["finished", "Finished the demo"], ["left", "Left the demo early"], ["skipped", "Skipped it"], ["none", "Saw it, no answer yet"]];
  const paths = PATHS.map(([key, label]) => {
    const who = cohort.filter(u => pathOf(u) === key);
    return {
      key, label, people: who.length,
      startedReal: derived(who.filter(u => realStartAfter(u, entry.get(u)!)).length, who.length),
      finishedReal: x.hunts ? derived(who.filter(u => realDoneAfter(u, entry.get(u)!)).length, who.length) : null,
    };
  });

  // Step by step, first runs: who completed each step, and where people left.
  const stepPeople = new Map<number, { step: string; who: Set<string> }>();
  const exitPeople = new Map<number, { step: string; who: Set<string> }>();
  const reasons = new Map<string, number>();
  let totalSteps: number | null = null;
  const durations: number[] = [];
  for (const [uid, list] of after) for (const e of list) {
    if (!firstRun(e)) continue;
    const n = numOf(e.metadata?.step_number);
    const ts = numOf(e.metadata?.total_steps);
    if (ts !== null && ts > 0) totalSteps = Math.max(totalSteps ?? 0, ts);
    if (e.event_name === HUNT_DEMO.step && n !== null) {
      const b = stepPeople.get(n) ?? stepPeople.set(n, { step: str(e, "step") ?? `step ${n}`, who: new Set() }).get(n)!;
      b.who.add(uid);
    }
    if (e.event_name === HUNT_DEMO.exited && exited.includes(uid)) {
      const k = n ?? 0;
      const b = exitPeople.get(k) ?? exitPeople.set(k, { step: str(e, "step") ?? (n === null ? "unknown" : `step ${n}`), who: new Set() }).get(k)!;
      b.who.add(uid);
      const r = str(e, "reason") ?? "unknown";
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    if (e.event_name === HUNT_DEMO.completed) {
      const d = numOf(e.metadata?.duration_ms);
      if (d !== null && d >= 0) durations.push(d / 1000);
    }
  }
  const steps = [...stepPeople.entries()].sort((a, b) => a[0] - b[0])
    .map(([n, b]) => ({ number: n, step: b.step, people: b.who.size, share: startedDemo.length ? b.who.size / startedDemo.length : null }));
  const exitsByStep = [...exitPeople.entries()].sort((a, b) => b[1].who.size - a[1].who.size || a[0] - b[0])
    .map(([n, b]) => ({ number: n || null, step: b.step, people: b.who.size }));

  // Replays: the tutorial asked for again, in the selected dates.
  const rp = events.filter(e => e.event_name === HUNT_DEMO.replayed);
  return {
    tracked: ever,
    people: cohort.length,
    funnel: [
      { stage: "Saw the Hunt welcome or began the demo", users: cohort.length },
      { stage: "Began the demo", users: startedDemo.length },
      { stage: "Finished the demo", users: finished.length },
      { stage: "Started a real Hunt afterwards", users: realAfterDemo.length },
      ...(doneAfterDemo ? [{ stage: "Finished a real Hunt afterwards", users: doneAfterDemo.length, note: "scored by the server" }] : []),
    ],
    completion: derived(finished.length, startedDemo.length, "of those who began"),
    tappedReal: derived(tappedReal.length, finished.length, "of those who finished"),
    tappedDone: exact(tappedDone.length),
    skipped: derived(skipped.length, cohort.length), dismissed: exact(dismissed.length),
    exited: derived(exited.length, startedDemo.length, "of those who began"),
    secondsMedian: { value: median(durations), trust: "EXACT", d: durations.length } as Metric,
    paths, steps, exitsByStep, totalSteps,
    exitReasons: [...reasons.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    replays: { taps: rp.length, people: people(rp).size,
      runs: events.filter(e => e.event_name === HUNT_DEMO.started && replay(e)).length,
      finished: events.filter(e => e.event_name === HUNT_DEMO.completed && replay(e)).length },
    note: "First runs only; replays are counted separately. The group is everyone shown the Hunt welcome, or who began the demo, in the selected dates; each later step counts what they did from then until now, so people from the last few days have had less time. The demo's own scans and saves are never sent, so nothing in the demo counts as real Hunting.",
  };
}

/** The finer Hunt events, kept one click down: removals, restores, price edits, comps, errors. */
export function buildHuntDetail(events: QEvent[]) {
  const named = (n: string) => events.filter(e => e.event_name === n);
  const row = (label: string, name: string) => { const evs = named(name); return { label, event: name, count: evs.length, people: people(evs).size }; };
  return {
    rows: [
      row("Hunt scans started", "hunt_scan_started"),
      row("Items kept (saved to the Hunt)", "hunt_item_saved"),
      row("Items removed", "hunt_item_removed"),
      row("Removed items restored", "hunt_item_restored"),
      row("Prices edited", "hunt_item_price_edited"),
      row("Sold comps scrolled into view", "hunt_sold_comps_viewed"),
      row("Saved Hunts reopened", "hunt_bundle_opened"),
      row("Items opened from Hunt history", "hunt_history_item_opened"),
    ],
    ended: tally(named("hunt_ended"), e => str(e, "outcome")),
    destination: tally(named("hunt_scan_destination_chosen"), e => str(e, "choice")),
    restoredFrom: tally(named("hunt_item_restored"), e => str(e, "from")),
    errors: tally(named("hunt_error"), e => str(e, "stage")),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY
// ═══════════════════════════════════════════════════════════════════════════

export const RATING_LABEL: Record<string, string> = { STRONG_BUY: "Strong Buy", BUY: "Buy", RISKY_BUY: "Risky Buy", SKIP: "Skip" };
const RATINGS = ["STRONG_BUY", "BUY", "RISKY_BUY", "SKIP"];
/** An automatic retry and the scan's ending are joined if the ending comes within this long. */
export const RETRY_JOIN_MS = 90_000;
export const DAILY_DAYS = 14;

/**
 * Scans as the user experienced them. `events`: scoped, in the selected dates
 * — the same population the Executive tile reads.
 */
export function buildScanQuality(events: QEvent[], window: QWindow, now: number) {
  const named = (n: string) => events.filter(e => e.event_name === n);
  const completedEv = named("scan_completed");
  const failedEv = named("scan_failed");
  const continued = completedEv.filter(e => e.metadata?.continuedAfterSoftFail === true);
  const fails = Math.max(0, failedEv.length - continued.length);
  const attempts = completedEv.length + fails;

  // Which fail screens were continued past (new app: joined on attemptId).
  const continuedIds = new Set(continued.map(e => str(e, "attemptId")).filter(Boolean) as string[]);
  const endedOnFail = failedEv.filter(e => !(str(e, "attemptId") && continuedIds.has(str(e, "attemptId")!)));
  const scanners = people([...completedEv, ...failedEv]);
  const softShown = failedEv.filter(e => str(e, "kind") === "soft");
  const kinds = {
    soft: softShown.length,
    softContinued: continued.length,
    hard: failedEv.filter(e => str(e, "kind") === "hard").length,
    photo: failedEv.filter(e => !str(e, "kind") && str(e, "screen") === "photo_load_failed").length,
    olderApp: failedEv.filter(e => !str(e, "kind") && str(e, "screen") !== "photo_load_failed").length,
  };

  // ── Automatic retries ──
  // scan_auto_retry carries no attempt id, so each scan's first retry is joined
  // to the same phone's next scan ending within RETRY_JOIN_MS.
  const actor = (e: QEvent) => e.user_id || e.anonymous_id || null;
  const endings = new Map<string, QEvent[]>();
  for (const e of [...completedEv, ...failedEv]) {
    const a = actor(e); if (!a) continue;
    (endings.get(a) ?? endings.set(a, []).get(a)!).push(e);
  }
  for (const l of endings.values()) l.sort((p, q) => ms(p.created_at) - ms(q.created_at));
  const firstRetries = named("scan_auto_retry").filter(e => (numOf(e.metadata?.attempt) ?? 1) === 1);
  const outcome = { result: 0, failed: 0, unknown: 0 };
  for (const r of firstRetries) {
    const t = ms(r.created_at);
    const next = (endings.get(actor(r) ?? "") ?? []).find(e => ms(e.created_at) >= t && ms(e.created_at) - t <= RETRY_JOIN_MS);
    if (!next) outcome.unknown++;
    else if (next.event_name === "scan_completed") outcome.result++;
    else outcome.failed++;
  }
  const hardRetried = failedEv.filter(e => str(e, "kind") === "hard" && (numOf(e.metadata?.autoRetries) ?? 0) >= 1).length;
  const retries = {
    scans: firstRetries.length,
    events: named("scan_auto_retry").length,
    share: derived(firstRetries.length, attempts, "of scan attempts"),
    rescued: derived(outcome.result, firstRetries.length, "of retried scans"),
    outcome,
    hardRetried,
    byReason: tally(firstRetries, e => str(e, "reason")).map(({ key, count }) => ({ key, count })),
  };

  // ── Day by day (Central), the most recent days of the range ──
  const lastDay = centralDay(new Date(Math.min(now, window.endMs ?? now) - 1));
  const firstDay = window.startMs === null ? null : centralDay(new Date(window.startMs));
  const days: string[] = [];
  for (let k = 0; k < DAILY_DAYS; k++) {
    const day = addCentralDays(lastDay, -k);
    if (!day || (firstDay && day < firstDay)) break;
    days.push(day);
  }
  const daily = days.map(day => {
    const c = completedEv.filter(e => centralDay(e.created_at) === day);
    const f = Math.max(0, failedEv.filter(e => centralDay(e.created_at) === day).length - c.filter(e => e.metadata?.continuedAfterSoftFail === true).length);
    return { day, completed: c.length, failScreens: f, rate: c.length + f ? f / (c.length + f) : null };
  });

  return {
    attempts: exact(attempts),
    completed: exact(completedEv.length),
    failScreens: exact(fails),
    failRate: derived(fails, attempts),
    peopleHit: derived(people(endedOnFail).size, scanners.size, "of people who scanned"),
    kinds,
    retries,
    daily,
    rating: buildRatingMix(events),
  };
}

/** The rating each result opened with, and the rating on screen when saved (2.2.2's recommendation_shown). */
export function buildRatingMix(events: QEvent[]) {
  const completed = events.filter(e => e.event_name === "scan_completed");
  const tracked = completed.filter(e => has(e, "recommendation_shown"));
  const rows = (evs: QEvent[]) => {
    const counted = evs.filter(e => RATINGS.includes(str(e, "recommendation_shown") ?? ""));
    return RATINGS.map(k => {
      const n = counted.filter(e => str(e, "recommendation_shown") === k).length;
      return { key: k, label: RATING_LABEL[k], count: n, share: counted.length ? n / counted.length : null };
    });
  };
  const saved = events.filter(e => e.event_name === "scan_saved" && has(e, "recommendation_shown"));
  const basis = (b: string) => saved.filter(e => str(e, "rating_price_basis") === b);
  return {
    tracked: tracked.length > 0,
    atOpen: rows(tracked),
    rated: tracked.filter(e => RATINGS.includes(str(e, "recommendation_shown") ?? "")).length,
    notWorkedOut: tracked.filter(e => !RATINGS.includes(str(e, "recommendation_shown") ?? "")).length,
    olderApp: completed.length - tracked.length,
    serverSent: tracked.filter(e => str(e, "recommendation_server")).length,
    atSave: {
      saves: saved.length,
      all: rows(saved),
      entered: rows(basis("entered")),
      suggested: rows(basis("suggested")),
      enteredCount: basis("entered").length,
    },
    note: "The rating a result opened with is worked out on the phone at FlipStart's suggested buy price, before any price is typed — exactly what the results screen shows first. The rating when saved is whatever was on screen at that moment, at a price the user typed or the suggested one. Recorded from app 2.2.2; older apps don't send it.",
  };
}

const TRUST_RATING = (e: QEvent) => String(e.metadata?.feedback_rating ?? e.metadata?.accuracyRating ?? "");
/** "STRONG BUY" (the results screen's wording) or "STRONG_BUY" → STRONG_BUY. */
const ratingKey = (v: unknown) => typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, "_") : "";

/** Scan trust from user feedback, in the selected dates. Score = (accurate + ½ somewhat) ÷ rated, as on Executive. */
export function buildTrust(events: QEvent[]) {
  const fb = events.filter(e => e.event_name === "scan_feedback_submitted");
  const completed = events.filter(e => e.event_name === "scan_completed").length;
  const score = (evs: QEvent[]) => {
    const acc = evs.filter(e => TRUST_RATING(e) === "accurate").length;
    const som = evs.filter(e => TRUST_RATING(e) === "somewhat").length;
    const bad = evs.filter(e => ["bad", "inaccurate"].includes(TRUST_RATING(e))).length;
    const rated = acc + som + bad;
    return { accurate: acc, somewhat: som, bad, rated, score: rated ? (acc + 0.5 * som) / rated : null };
  };
  const all = score(fb);
  const group = (key: (e: QEvent) => string) => {
    const m = new Map<string, QEvent[]>();
    for (const e of fb) { const k = key(e) || "Unknown"; (m.get(k) ?? m.set(k, []).get(k)!).push(e); }
    return [...m.entries()].map(([k, evs]) => ({ key: k, ...score(evs) })).filter(r => r.rated > 0).sort((a, b) => b.rated - a.rated || a.key.localeCompare(b.key));
  };
  const byRatingRaw = group(e => ratingKey(e.metadata?.recommendation));
  const byRating = [...RATINGS.map(k => byRatingRaw.find(r => r.key === k) ?? { key: k, accurate: 0, somewhat: 0, bad: 0, rated: 0, score: null }),
    ...byRatingRaw.filter(r => !RATINGS.includes(r.key))]
    .map(r => ({ ...r, label: RATING_LABEL[r.key] ?? (r.key === "Unknown" ? "Not recorded" : r.key) }));
  const byCategory = group(e => String(e.metadata?.category ?? ""));
  return {
    total: fb.length,
    ...all,
    scoreMetric: { value: all.score, trust: "DERIVED", d: all.rated } as Metric,
    feedbackRate: derived(fb.length, completed, "of results shown"),
    byRating,
    byCategory,
    byBrand: group(e => String(e.metadata?.brand ?? "")),
    worst: byCategory.filter(c => c.rated >= 2).sort((a, b) => (a.score ?? 1) - (b.score ?? 1) || b.rated - a.rated).slice(0, 8),
    decisions: tally(fb.filter(e => str(e, "buy_decision")), e => str(e, "buy_decision")).map(({ key, count }) => ({ key, count })),
    decisionsUnanswered: fb.filter(e => !str(e, "buy_decision")).length,
    recent: fb.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).map(e => ({
      date: e.created_at, item: str(e, "item_title"), brand: str(e, "brand"), category: str(e, "category"),
      rating: TRUST_RATING(e) || null, shown: RATING_LABEL[ratingKey(e.metadata?.recommendation)] ?? str(e, "recommendation"),
      aiValue: numOf(e.metadata?.estimated_resale_value), userValue: numOf(e.metadata?.user_corrected_value),
      noteLength: numOf(e.metadata?.feedback_text_length),
    })),
  };
}

/**
 * Sold comps on Hunt items (hunt_sold_comps_result). Only live searches say
 * anything about the search itself; a saved snapshot reopened is counted apart.
 */
export function buildSoldComps(events: QEvent[]) {
  const res = events.filter(e => e.event_name === "hunt_sold_comps_result");
  const live = res.filter(e => str(e, "source") === "live");
  const outcome = (k: string) => live.filter(e => str(e, "outcome") === k);
  const loaded = outcome("loaded");
  const counts = loaded.map(e => numOf(e.metadata?.comp_count)).filter((v): v is number => v !== null);
  const strongish = loaded.filter(e => (numOf(e.metadata?.exact) ?? 0) + (numOf(e.metadata?.strong) ?? 0) > 0).length;
  const secs = live.map(e => numOf(e.metadata?.duration_ms)).filter((v): v is number => v !== null && v >= 0).map(v => v / 1000);
  return {
    tracked: res.length > 0,
    searches: exact(live.length),
    found: derived(loaded.length, live.length),
    none: derived(outcome("empty").length, live.length),
    unavailable: derived(outcome("unavailable").length, live.length),
    exactOrStrong: derived(strongish, loaded.length, "of searches with results"),
    compsMedian: { value: median(counts), trust: "EXACT", d: counts.length } as Metric,
    secondsMedian: { value: median(secs), trust: "EXACT", d: secs.length } as Metric,
    secondsP90: { value: percentile(secs, 0.9), trust: "EXACT", d: secs.length } as Metric,
    reopened: res.filter(e => str(e, "source") === "snapshot").length,
    byAvailability: tally(live.filter(e => str(e, "outcome") !== "loaded"), e => str(e, "availability")).map(({ key, count }) => ({ key, count })),
    viewed: exact(events.filter(e => e.event_name === "hunt_sold_comps_viewed").length),
  };
}