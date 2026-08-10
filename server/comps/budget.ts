/**
 * server/comps/budget.ts
 *
 * FlipStart's own spend ceiling on the metered SoldComps quota.
 *
 * Deliberately independent of the provider's subscription limits and normally
 * set LOWER. Relying on the provider dashboard alone means the first signal
 * that something is looping is the bill — these counters are the thing that
 * actually stops a runaway before it costs money.
 *
 * ── Now DURABLE (public launch) ──────────────────────────────────────────────
 * These counters used to live in a plain object. Acceptable while one founder
 * triggered every request; unsafe the moment ordinary users could reach it:
 *
 *   - a Railway redeploy reset the count to zero, handing users a fresh budget
 *     several times a day
 *   - two instances each kept their own ceiling, doubling the real cap
 *   - so the configured limit was not the limit, and the only true ceiling was
 *     the provider subscription — exactly what this file exists to avoid
 *
 * Persisted with the same pattern as cache.ts: DATA_DIR, atomic
 * write-then-rename, coalesced writes, SIGTERM flush.
 *
 * ── Per-user cap ────────────────────────────────────────────────────────────
 * A global cap alone does not stop ONE user consuming it. On a 2,000-request
 * tier, five people scanning forty items a day exhaust the month before anyone
 * else gets a single comp. The per-user daily cap makes the pool shared rather
 * than first-come.
 *
 * Counts are RESERVED before the provider call and released if the call never
 * happened, so a crash mid-flight cannot leak budget.
 */

import fs from "node:fs";
import path from "node:path";

export type BudgetWindow = "daily" | "monthly" | "user";

export interface BudgetState {
  dailyUsed: number;
  dailyLimit: number;
  dailyResetsAt: number;
  monthlyUsed: number;
  monthlyLimit: number;
  monthlyResetsAt: number;
}

/** Conservative defaults. An unset variable must not mean "unlimited" — that is
 *  the failure mode this file exists to prevent. */
const DEFAULT_DAILY = 50;
const DEFAULT_MONTHLY = 500;

/**
 * Read the first of several accepted names.
 *
 * Both the short and long forms are honoured because a budget variable that is
 * silently ignored is the worst possible failure here: it looks configured, and
 * you only discover it was not when the real spend arrives. Accepting either
 * name costs nothing and removes a whole class of typo.
 */
function envInt(names: string[], fallback: number): number {
  for (const name of names) {
    const v = (process.env[name] ?? "").trim();
    if (!v) continue;
    const raw = Number.parseInt(v, 10);
    if (Number.isFinite(raw) && raw >= 0) return raw;
    // Present but malformed — fail closed to the safe default rather than
    // treating garbage as "unlimited".
    console.warn(`[comps] ${name}="${v}" is not a valid number; using ${fallback}`);
    return fallback;
  }
  return fallback;
}

/** Per-user daily ceiling. Generous for a real thrifter, low enough that one
 *  heavy user or a runaway client cannot drain a shared monthly pool. */
const DEFAULT_PER_USER_DAILY = 15;

const PER_USER_NAMES = [
  "SOLD_COMPS_PER_USER_DAILY_BUDGET",
  "SOLD_COMPS_PER_USER_DAILY",
  "COMPS_PER_USER_DAILY",
];

const DAILY_NAMES = [
  "SOLD_COMPS_DAILY_BUDGET",
  "SOLD_COMPS_DAILY_REQUEST_BUDGET",
  "COMPS_DAILY_BUDGET",
];
const MONTHLY_NAMES = [
  "SOLD_COMPS_MONTHLY_BUDGET",
  "SOLD_COMPS_MONTHLY_REQUEST_BUDGET",
  "COMPS_MONTHLY_BUDGET",
];

/** Which variable name actually supplied each limit. Surfaced by comps.status so
 *  a misconfiguration is visible instead of silent. */
export function budgetSource(): { daily: string | null; monthly: string | null } {
  const found = (names: string[]) => names.find(n => (process.env[n] ?? "").trim()) ?? null;
  return { daily: found(DAILY_NAMES), monthly: found(MONTHLY_NAMES) };
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function startOfUtcMonth(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

interface BudgetFile {
  version: 1;
  dayKey: number; dayCount: number;
  monthKey: number; monthCount: number;
  /** userId -> { dayKey, count }. Cleared when the UTC day rolls. */
  perUser: Record<string, { dayKey: number; count: number }>;
}

const DATA_DIR = process.env.DATA_DIR ?? "/tmp";
const FILE = path.join(DATA_DIR, "flipstart-comps-budget.json");

const counters: BudgetFile = {
  version: 1,
  dayKey: 0, dayCount: 0,
  monthKey: 0, monthCount: 0,
  perUser: {},
};

let loaded = false;
let pending = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): void {
  if (loaded) return;
  loaded = true;
  if (!process.env.DATA_DIR) {
    console.warn("[comps] DATA_DIR not set — budget counters will NOT survive redeploy.");
  }
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as BudgetFile;
      if (raw?.version === 1) {
        counters.dayKey     = raw.dayKey ?? 0;
        counters.dayCount   = raw.dayCount ?? 0;
        counters.monthKey   = raw.monthKey ?? 0;
        counters.monthCount = raw.monthCount ?? 0;
        counters.perUser    = raw.perUser ?? {};
        console.log(`[comps] budget restored — ${counters.dayCount} today, ${counters.monthCount} this month`);
      }
    }
  } catch (e) {
    // Start at zero rather than refuse every request. Over-spending one window
    // is recoverable; a hard outage on a corrupt file is not.
    console.error("[comps] budget load failed, starting at zero:", (e as Error).message);
  }
}

function flushNow(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pending === 0) return;
  pending = 0;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(counters));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error("[comps] budget flush failed:", (e as Error).message);
  }
}

/** Coalesced, but on a SHORT 500ms window — a lost budget write is real money,
 *  unlike a lost cache write which merely costs one refetch. */
function scheduleSave(): void {
  pending++;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, 500);
  if (typeof (flushTimer as { unref?: () => void }).unref === "function") {
    (flushTimer as unknown as { unref: () => void }).unref();
  }
}

let hooked = false;
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => { flushNow(); process.exit(0); });
  }
  process.once("beforeExit", flushNow);
}

function roll(now: number): void {
  load(); hookExit();
  const dk = startOfUtcDay(now);
  const mk = startOfUtcMonth(now);
  let changed = false;
  if (counters.dayKey !== dk) {
    counters.dayKey = dk; counters.dayCount = 0;
    counters.perUser = {};          // per-user counts are daily
    changed = true;
  }
  if (counters.monthKey !== mk) { counters.monthKey = mk; counters.monthCount = 0; changed = true; }
  if (changed) scheduleSave();
}

export function budgetState(now = Date.now()): BudgetState {
  roll(now);
  return {
    dailyUsed: counters.dayCount,
    dailyLimit: envInt(DAILY_NAMES, DEFAULT_DAILY),
    dailyResetsAt: counters.dayKey + 86_400_000,
    monthlyUsed: counters.monthCount,
    monthlyLimit: envInt(MONTHLY_NAMES, DEFAULT_MONTHLY),
    monthlyResetsAt: new Date(Date.UTC(
      new Date(counters.monthKey).getUTCFullYear(),
      new Date(counters.monthKey).getUTCMonth() + 1, 1)).getTime(),
  };
}

export interface BudgetCheck {
  allowed: boolean;
  window?: BudgetWindow;
  state: BudgetState;
}

/**
 * Reserve one request.
 *
 * Daily is checked before monthly on purpose: a daily breach is the earlier and
 * more actionable signal, and reporting "monthly exhausted" when the day cap is
 * what actually stopped you would send a founder looking in the wrong place.
 */
export function reserveRequest(userId?: string | null, now = Date.now()): BudgetCheck {
  const s = budgetState(now);
  // Per-user FIRST: a heavy user hitting their own ceiling must not be told the
  // shared pool is empty, because it is not.
  if (userId) {
    const perUserLimit = envInt(PER_USER_NAMES, DEFAULT_PER_USER_DAILY);
    const rec = counters.perUser[userId];
    const used = rec && rec.dayKey === counters.dayKey ? rec.count : 0;
    if (used >= perUserLimit) return { allowed: false, window: "user", state: s };
  }
  if (s.dailyUsed >= s.dailyLimit)   return { allowed: false, window: "daily", state: s };
  if (s.monthlyUsed >= s.monthlyLimit) return { allowed: false, window: "monthly", state: s };

  counters.dayCount++; counters.monthCount++;
  if (userId) {
    const rec = counters.perUser[userId];
    counters.perUser[userId] = rec && rec.dayKey === counters.dayKey
      ? { dayKey: counters.dayKey, count: rec.count + 1 }
      : { dayKey: counters.dayKey, count: 1 };
  }
  scheduleSave();
  return { allowed: true, state: budgetState(now) };
}

/** Return a reservation that was never spent — the request short-circuited
 *  before reaching the provider. */
export function releaseRequest(userId?: string | null): void {
  if (counters.dayCount > 0) counters.dayCount--;
  if (counters.monthCount > 0) counters.monthCount--;
  if (userId) {
    const rec = counters.perUser[userId];
    if (rec && rec.dayKey === counters.dayKey && rec.count > 0) {
      counters.perUser[userId] = { dayKey: rec.dayKey, count: rec.count - 1 };
    }
  }
  scheduleSave();
}


/** Test seam only. */
export function __resetBudget(): void {
  counters.dayKey = 0; counters.dayCount = 0;
  counters.monthKey = 0; counters.monthCount = 0;
  counters.perUser = {};
  loaded = true;   // tests never touch disk
}

/** Per-user usage today. Founder diagnostics only. */
export function perUserUsage(userId: string): number {
  load();
  const rec = counters.perUser[userId];
  return rec && rec.dayKey === counters.dayKey ? rec.count : 0;
}