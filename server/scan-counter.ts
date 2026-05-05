/**
 * server/scan-counter.ts
 *
 * Global daily scan counter for FlipStart beta.
 * Stored in-memory + persisted to a JSON file so it survives server restarts.
 * Resets automatically at UTC midnight.
 *
 * Design goals:
 * - Atomic increment to prevent race conditions
 * - File-backed so Railway restarts don't lose the count
 * - Easy to swap for Redis/DB later by swapping this module only
 */

import fs   from 'fs';
import path from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

export const GLOBAL_DAILY_SCAN_LIMIT = 200;

// Store file lives in /tmp on Railway (writable, survives between requests,
// wiped on new deploys — acceptable for daily counter)
const STORE_PATH = path.join(process.env.TMPDIR ?? '/tmp', 'flipstart-scan-counter.json');

// ─── Types ────────────────────────────────────────────────────────────────────

interface CounterStore {
  date:  string;   // UTC date string e.g. "2026-05-04"
  count: number;
}

// ─── In-memory state ──────────────────────────────────────────────────────────

let store: CounterStore = loadStore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);  // "YYYY-MM-DD"
}

function loadStore(): CounterStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CounterStore;
    // If the stored date is today, use it; otherwise start fresh
    if (parsed.date === todayUTC()) return parsed;
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }
  return { date: todayUTC(), count: 0 };
}

function saveStore(): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store), 'utf8');
  } catch (err) {
    // Non-fatal — in-memory state still works
    console.warn('[scan-counter] could not persist store:', err);
  }
}

/** Refresh in-memory store on every request in case date rolled over */
function refreshIfNewDay(): void {
  const today = todayUTC();
  if (store.date !== today) {
    console.log(`[scan-counter] new day (${today}), resetting count`);
    store = { date: today, count: 0 };
    saveStore();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Try to increment the global scan counter.
 * Returns true if the scan is allowed, false if the limit is reached.
 * This is the single gate — call it before any AI work.
 */
export function tryIncrementScanCount(): boolean {
  refreshIfNewDay();
  if (store.count >= GLOBAL_DAILY_SCAN_LIMIT) {
    console.log(`[scan-counter] BLOCKED — limit ${GLOBAL_DAILY_SCAN_LIMIT} reached (${store.count} used)`);
    return false;
  }
  store.count += 1;
  saveStore();
  console.log(`[scan-counter] scan ${store.count}/${GLOBAL_DAILY_SCAN_LIMIT} allowed`);
  return true;
}

/** Returns current stats — used by the frontend pill and debugging. */
export function getScanStats(): {
  globalDailyLimit:        number;
  globalScansUsedToday:    number;
  globalScansRemainingToday: number;
  resetTime:               string;
} {
  refreshIfNewDay();
  const remaining = Math.max(0, GLOBAL_DAILY_SCAN_LIMIT - store.count);
  // Next midnight UTC
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);

  return {
    globalDailyLimit:          GLOBAL_DAILY_SCAN_LIMIT,
    globalScansUsedToday:      store.count,
    globalScansRemainingToday: remaining,
    resetTime:                 tomorrow.toISOString(),
  };
}