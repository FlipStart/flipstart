/**
 * server/leaderboard/weeklyResults.ts
 *
 * The weekly "reset" job.
 *
 * Nothing is actually reset: the Weekly board reads the current week, and a new
 * week simply starts empty (Monday 00:00 America/Los_Angeles, worked out only
 * in Postgres). What a finished week needs is its final result written down
 * before later changes (a deleted or excluded account) can shift it. Postgres
 * does that in leaderboard_close_finished_weeks(); this file only asks it to,
 * when the server starts and every 30 minutes after.
 *
 * Safe by construction:
 *   - asking twice, or from two server instances at once, freezes a week once
 *   - a missed run (deploy, crash) is caught up by the next one, however late,
 *     because weekly XP for past weeks is kept and no longer changes
 *   - a failure never throws: it is logged once and tried again next time
 */
import { getLeaderboardStore, type ClosedWeek } from "./store.js";

export const WEEKLY_RESULTS_EVERY_MS = 30 * 60_000;
export const WEEKLY_RESULTS_FIRST_RUN_MS = 20_000;     // after boot, out of the way of startup

let warned = false;
let running = false;

/** One pass. Returns the weeks frozen, or null when it could not run. */
export async function closeFinishedWeeks(): Promise<ClosedWeek[] | null> {
  if (running) return null;                            // a slow pass is never doubled up
  running = true;
  try {
    const store = getLeaderboardStore();
    if (!store) return null;
    const closed = await store.closeFinishedWeeks();
    if (closed == null) {
      if (!warned) {
        warned = true;
        console.warn("[leaderboard] could not freeze finished weeks (has hunt_leaderboard_phase4.sql been run?). Will keep trying.");
      }
      return null;
    }
    warned = false;
    for (const w of closed) {
      console.log(`[leaderboard] week of ${String(w.week_start).slice(0, 10)} frozen: ${Number(w.hunters) || 0} hunters`);
    }
    return closed;
  } catch (err) {
    if (!warned) { warned = true; console.warn("[leaderboard] freezing finished weeks failed:", err instanceof Error ? err.message : err); }
    return null;
  } finally {
    running = false;
  }
}

let timers: Array<ReturnType<typeof setTimeout>> = [];

/** Start the job. Calling it again does nothing. The timers never keep the process alive. */
export function startWeeklyResultsJob(): void {
  if (timers.length > 0) return;
  const first = setTimeout(() => { void closeFinishedWeeks(); }, WEEKLY_RESULTS_FIRST_RUN_MS);
  const every = setInterval(() => { void closeFinishedWeeks(); }, WEEKLY_RESULTS_EVERY_MS);
  (first as any).unref?.(); (every as any).unref?.();
  timers = [first, every];
}

/** Tests only. */
export function __resetWeeklyResultsJobForTests(): void {
  for (const t of timers) { clearTimeout(t as any); clearInterval(t as any); }
  timers = []; warned = false; running = false;
}