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
 * In-memory and process-local. That is a real limitation and an intentional
 * trade for Phase 0: it means a redeploy resets the counters, and it means the
 * ceiling is per-instance rather than global. Both are acceptable while a
 * single founder triggers every request by hand; neither would be acceptable
 * once ordinary users can reach this path, and the note in Phase 1 should be to
 * move these to durable storage before that happens.
 *
 * Counts are RESERVED before the provider call and released if the call never
 * happened, so a crash mid-flight cannot leak budget.
 */

export type BudgetWindow = "daily" | "monthly";

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

const counters = {
  dayKey: 0, dayCount: 0,
  monthKey: 0, monthCount: 0,
};

function roll(now: number): void {
  const dk = startOfUtcDay(now);
  const mk = startOfUtcMonth(now);
  if (counters.dayKey !== dk) { counters.dayKey = dk; counters.dayCount = 0; }
  if (counters.monthKey !== mk) { counters.monthKey = mk; counters.monthCount = 0; }
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
export function reserveRequest(now = Date.now()): BudgetCheck {
  const s = budgetState(now);
  if (s.dailyUsed >= s.dailyLimit)   return { allowed: false, window: "daily", state: s };
  if (s.monthlyUsed >= s.monthlyLimit) return { allowed: false, window: "monthly", state: s };
  counters.dayCount++; counters.monthCount++;
  return { allowed: true, state: budgetState(now) };
}

/** Return a reservation that was never spent — the request short-circuited
 *  before reaching the provider. */
export function releaseRequest(): void {
  if (counters.dayCount > 0) counters.dayCount--;
  if (counters.monthCount > 0) counters.monthCount--;
}


/** Test seam only. */
export function __resetBudget(): void {
  counters.dayKey = 0; counters.dayCount = 0;
  counters.monthKey = 0; counters.monthCount = 0;
}