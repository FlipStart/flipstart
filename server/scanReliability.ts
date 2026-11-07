/**
 * server/scanReliability.ts
 *
 * The founder dashboard's Scan Reliability section (Phase 6 of the
 * scan-failure plan). Hard failures and low-confidence results are kept
 * apart: one is FlipStart breaking, the other is FlipStart being unsure.
 *
 * Two sources, each counted where it is authoritative:
 *   scan_outcomes   — every scan the SERVER saw: results with their tier,
 *                     soft fails with the user's choice, hard failures with
 *                     the reason code. One row per scan attempt.
 *   analytics_events — what the APP showed. The only record of scans that
 *                     never reached the server (offline, or our server down),
 *                     and the only record from users who aren't signed in.
 *
 * Every user is counted: no internal or cohort filter. Rows are limited to
 * the dashboard's selected date window only.
 */
import { fetchAll } from "./founderMetrics";
import type { AnalysisWindow } from "./founderMetricsV4";

export interface OutcomeRow {
  created_at: string;
  /** Last write. A restarted scan (after buying scans) reuses its attempt id, so a hold's age starts here. */
  updated_at?: string | null;
  kind: "ok" | "soft" | "hard";
  reason: string | null;
  failure_group: string | null;
  confidence_tier: string | null;
  charge: string;
  resolution: string | null;
  holds_charges: boolean | null;
  photo_count: number | null;
  duration_ms: number | null;
}

export interface EventLike {
  event_name: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  user_id?: string | null;
  anonymous_id?: string | null;
}

/**
 * Every fail screen the app can show, in the order the dashboard lists ties.
 * The server screen is split by cause, because each cause has its own
 * wording and its own fix.
 */
export const FAIL_SCREENS: ReadonlyArray<{ key: string; label: string; group: "Unsure result" | "Didn't run" | "Account" }> = [
  { key: "cannot_identify",      label: "Couldn't identify",            group: "Unsure result" },
  { key: "low_confidence",       label: "Low confidence",               group: "Unsure result" },
  { key: "multiple_items",       label: "Several items",                group: "Unsure result" },
  { key: "photo_problem",        label: "Photo problem",                group: "Unsure result" },
  { key: "no_item",              label: "No item found",                group: "Unsure result" },
  { key: "timeout",              label: "Took too long",                group: "Didn't run" },
  { key: "offline",              label: "Phone offline",                group: "Didn't run" },
  { key: "server:server_down",   label: "Server down (Railway)",        group: "Didn't run" },
  { key: "server:restarting",    label: "Server restarting (deploy)",   group: "Didn't run" },
  { key: "server:ai_busy",       label: "AI overloaded",                group: "Didn't run" },
  { key: "server:ai_failed",     label: "AI couldn't finish",           group: "Didn't run" },
  { key: "server:account_check", label: "Couldn't check account",       group: "Didn't run" },
  { key: "server:unknown",       label: "Unknown server problem",       group: "Didn't run" },
  { key: "photo_load_failed",    label: "Photo didn't load",            group: "Didn't run" },
  { key: "sign_in",              label: "Sign in again",                group: "Account" },
  { key: "out_of_scans",         label: "Out of scans",                 group: "Account" },
  { key: "pro_feature",          label: "Pro feature",                  group: "Account" },
  { key: "app_outdated",         label: "Update needed",                group: "Account" },
];

/** Which fail screen an event was for. Null for app 2.1 events, which don't say. */
export function failScreenKey(e: EventLike): string | null {
  const m = e.metadata ?? {};
  const screen = typeof m.screen === "string" ? m.screen : null;
  if (!screen) return null;
  if (screen === "server") {
    const cause = typeof m.cause === "string" ? m.cause : "unknown";
    return `server:${cause}`;
  }
  return screen;
}

export interface FailScreenRow {
  key: string; label: string; group: string;
  shown: number; users: number;
  /** Share of every fail screen shown in the range. */
  share: number | null;
  lastShown: string | null;
}

/**
 * Every fail screen, most shown first, including ones nobody hit (so a
 * screen at zero is visibly zero, not missing). Counts scan_failed and
 * scan_blocked — one event per screen shown — from every user.
 * Screens not in FAIL_SCREENS (a newer app) are listed too, under their code.
 */
export function rankFailScreens(events: EventLike[]): { rows: FailScreenRow[]; total: number; olderApp: Array<{ key: string; count: number }> } {
  const shown = events.filter(e => e.event_name === "scan_failed" || e.event_name === "scan_blocked");
  const by = new Map<string, { n: number; who: Set<string>; last: string | null }>();
  const olderApp: EventLike[] = [];
  for (const e of shown) {
    const k = failScreenKey(e);
    if (!k) { if (e.event_name === "scan_failed") olderApp.push(e); continue; }
    const b = by.get(k) ?? { n: 0, who: new Set<string>(), last: null };
    b.n++;
    const who = e.user_id || e.anonymous_id;
    if (who) b.who.add(who);
    if (!b.last || e.created_at > b.last) b.last = e.created_at;
    by.set(k, b);
  }
  const total = [...by.values()].reduce((a, b) => a + b.n, 0) + olderApp.length;
  const known = new Map(FAIL_SCREENS.map((s, i) => [s.key, { ...s, order: i }]));
  const keys = [...new Set([...FAIL_SCREENS.map(s => s.key), ...by.keys()])];
  const rows = keys.map(k => {
    const b = by.get(k);
    const meta = known.get(k);
    return {
      key: k, label: meta?.label ?? k, group: meta?.group ?? "Other",
      shown: b?.n ?? 0, users: b?.who.size ?? 0,
      share: total > 0 ? (b?.n ?? 0) / total : null,
      lastShown: b?.last ?? null,
      order: meta?.order ?? 999,
    };
  }).sort((a, b) => b.shown - a.shown || a.order - b.order)
    .map(({ order: _o, ...r }) => r);
  const ot = new Map<string, number>();
  for (const e of olderApp) {
    const t = typeof e.metadata?.errorType === "string" ? (e.metadata.errorType as string) : "unknown";
    ot.set(t, (ot.get(t) ?? 0) + 1);
  }
  return { rows, total, olderApp: [...ot.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count) };
}

/** Plain-word names for the dashboard. Unknown codes show as themselves. */
export const REASON_LABEL: Record<string, string> = {
  timeout: "Took too long (45 s)",
  ai_busy: "AI overloaded / unreachable",
  ai_failed: "AI gave no usable answer",
  server_error: "Server error",
  server_restarting: "Server restarting (deploy)",
  account_check_failed: "Couldn't read account / balance",
  sign_in: "Needs sign-in",
  out_of_scans: "Out of scans",
  pro_third_photo: "Third photo needs Pro",
  pro_ai_context: "AI Context needs Pro",
  app_outdated: "App outdated",
  cancelled: "User cancelled",
  cannot_identify: "Couldn't identify",
  low_confidence: "Low confidence",
  multiple_items: "Several items",
  photo_problem: "Photo problem",
  no_item: "No item found",
  offline: "Phone offline",
  server: "Server issue",
  server_down: "Server down (Railway)",
  photo_load_failed: "Photo didn't load",
};

/** A held soft fail with no choice after this long was abandoned; the hold expired and the scan went back. */
export const ABANDONED_AFTER_MS = 10 * 60_000;

export const SCAN_OUTCOME_COLUMNS =
  "id, created_at, updated_at, kind, reason, failure_group, confidence_tier, charge, resolution, holds_charges, photo_count, duration_ms";

export type LoadedOutcomes = { configured: true; rows: OutcomeRow[] } | { configured: false; note: string };

export async function loadScanOutcomes(window: AnalysisWindow): Promise<LoadedOutcomes> {
  try {
    const rows = await fetchAll<OutcomeRow>("scan_outcomes", SCAN_OUTCOME_COLUMNS, {
      gte: window.startMs !== null ? { col: "created_at", val: new Date(window.startMs).toISOString() } : undefined,
      order: ["created_at", "id"],
    });
    return { configured: true, rows };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/scan_outcomes/.test(msg) && /does not exist|could not find|schema cache/i.test(msg)) {
      return { configured: false, note: "The scan_outcomes table doesn't exist yet. Run drizzle/sql/scan_outcomes.sql in the Supabase SQL editor." };
    }
    throw e;
  }
}

const inRange = (w: AnalysisWindow, iso: string) => {
  if (w.startMs === null || w.endMs === null) return true;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= w.startMs && t < w.endMs;
};

export interface Rate { n: number; d: number; value: number | null }
const rate = (n: number, d: number): Rate => ({ n, d, value: d > 0 ? n / d : null });

function tally<T>(xs: T[], key: (x: T) => string | null | undefined): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const x of xs) { const k = key(x) || "unknown"; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export interface SoftRow {
  reason: string; count: number;
  continued: number; declined: number; abandoned: number; open: number;
  /**
   * Charged the moment the result came back, so no choice was recorded:
   * app 2.1 (can't hold a charge), or a user past the daily cap of uncharged
   * soft fails.
   */
  chargedAtOnce: number;
  /** Not charged and no choice recorded: "no item" (handed straight back), or a scan that was never going to be charged. */
  noChoice: number;
  continueRate: Rate;
}

export function buildScanReliability(
  loaded: LoadedOutcomes, events: EventLike[], window: AnalysisWindow, now = Date.now(),
) {
  const evs = events.filter(e => inRange(window, e.created_at));
  const failedEvents = evs.filter(e => e.event_name === "scan_failed");
  const str = (e: EventLike, k: string) => { const v = e.metadata?.[k]; return typeof v === "string" ? v : null; };
  /** The new app says which screen; app 2.1 only says errorType. */
  const screenOf = (e: EventLike) => str(e, "screen") ?? str(e, "errorType");
  const app = {
    failedEvents: failedEvents.length,
    byScreen: tally(failedEvents, screenOf),
    /** Never reached the server, so absent from scan_outcomes. */
    offline: failedEvents.filter(e => screenOf(e) === "offline").length,
    serverDown: failedEvents.filter(e => str(e, "cause") === "server_down").length,
    actions: tally(evs.filter(e => e.event_name === "scan_fail_action"), e => str(e, "action")),
    blocked: tally(evs.filter(e => e.event_name === "scan_blocked"), e => str(e, "screen")),
    /** Every fail screen, most shown first. */
    screens: rankFailScreens(evs),
  };

  if (!loaded.configured) return { configured: false as const, note: loaded.note, app };

  const rows = loaded.rows.filter(r => inRange(window, r.created_at));
  const results = rows.filter(r => r.kind === "ok" || r.kind === "soft");
  const soft = rows.filter(r => r.kind === "soft");
  const hard = rows.filter(r => r.kind === "hard");
  const failures = hard.filter(r => r.failure_group === "failure");
  const blocked = hard.filter(r => r.failure_group === "blocked");
  const stopped = hard.filter(r => r.failure_group === "stopped");
  const attempts = results.length + failures.length;

  const tiers = { high: 0, medium: 0, low: 0, none: 0 };
  for (const r of results) {
    const t = r.confidence_tier;
    if (t === "high" || t === "medium" || t === "low") tiers[t]++; else tiers.none++;
  }

  const softByReason: SoftRow[] = tally(soft, r => r.reason).map(({ key, count }) => {
    const of = soft.filter(r => (r.reason || "unknown") === key);
    const held = of.filter(r => r.resolution === null && r.charge === "held");
    const age = (r: OutcomeRow) => now - Date.parse(r.updated_at || r.created_at);
    const row: SoftRow = {
      reason: key, count,
      continued: of.filter(r => r.resolution === "continued").length,
      declined: of.filter(r => r.resolution === "declined").length,
      abandoned: held.filter(r => age(r) >= ABANDONED_AFTER_MS).length,
      open: held.filter(r => age(r) < ABANDONED_AFTER_MS).length,
      chargedAtOnce: of.filter(r => r.resolution === null && r.charge === "charged").length,
      noChoice: of.filter(r => r.resolution === null && r.charge === "not_charged").length,
      continueRate: rate(0, 0),
    };
    row.continueRate = rate(row.continued, row.continued + row.declined + row.abandoned);
    return row;
  });
  const sum = (k: keyof SoftRow) => softByReason.reduce((a, r) => a + (r[k] as number), 0);
  const continued = sum("continued"), declined = sum("declined"), abandoned = sum("abandoned");

  return {
    configured: true as const,
    app,
    attempts,
    results: results.length,
    failures: failures.length,
    failureRate: rate(failures.length, attempts),
    soft: soft.length,
    softRate: rate(soft.length, results.length),
    tiers,
    failuresByReason: tally(failures, r => r.reason).map(x => ({ ...x, share: rate(x.count, attempts) })),
    blockedByReason: tally(blocked, r => r.reason),
    stopped: stopped.length,
    softByReason,
    continueRate: rate(continued, continued + declined + abandoned),
    chargedAtOnce: sum("chargedAtOnce"),
    note: "One row per scan attempt: automatic retries of the same item count once. A continued soft fail is a result the user chose to see; it still counts as a soft fail here.",
  };
}

export type ScanReliability = ReturnType<typeof buildScanReliability>;