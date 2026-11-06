/**
 * server/shutdown.ts
 *
 * One place that decides how the server stops on a Railway redeploy.
 *
 * ── Before ──────────────────────────────────────────────────────────────────
 * Four modules (persist, analysisStore, comps cache, comps budget) each hooked
 * SIGTERM, flushed their file and called process.exit(0) straight away. Any
 * scan still running died mid-flight: the user got an error, and the AI call
 * had already been paid for.
 *
 * ── Now ─────────────────────────────────────────────────────────────────────
 * On SIGTERM:
 *   1. flush every registered file immediately — exactly what happened before,
 *      so nothing written up to this moment can be lost, whatever comes next;
 *   2. refuse NEW scans (isDraining) so the drain cannot be extended forever;
 *   3. wait for scans already running to finish and their answers to be
 *      sent — at most 45 s, and never past Railway's own draining window;
 *   4. flush again (scans that just finished wrote results) and exit.
 *
 * Railway sends SIGKILL after RAILWAY_DEPLOYMENT_DRAINING_SECONDS, which is
 * 3 s by default. With the default the drain is effectively skipped and this
 * behaves like before; set the variable (50 is right for a 45 s scan) for
 * running scans to finish.
 */

type Flusher = (reason: string) => void;

const flushers = new Map<string, Flusher>();
let installed = false;
let draining = false;
let active = 0;
let idleWaiters: Array<() => void> = [];

/** Longest scan the app waits for. Nothing needs more drain time than this. */
export const MAX_DRAIN_MS = 45_000;
/** Railway's default SIGTERM → SIGKILL window when the variable is unset. */
export const RAILWAY_DEFAULT_DRAINING_MS = 3_000;
/** Kept back from Railway's window for the final flush and exit. */
export const FINAL_FLUSH_MARGIN_MS = 2_000;

/** Register a flush to run on shutdown. Replaces any earlier one of the same name. */
export function onShutdownFlush(name: string, fn: Flusher): void {
  flushers.set(name, fn);
  install();
}

/** True once SIGTERM has arrived. New scans are refused while draining. */
export function isDraining(): boolean {
  return draining;
}

/** Count a unit of work (a running scan). Call the returned function exactly when it ends. */
export function beginWork(): () => void {
  active++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active = Math.max(0, active - 1);
    if (active === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const w of waiters) w();
    }
  };
}

/**
 * Count an HTTP request as running work until its response has been sent (or
 * the connection drops). Used for scan requests: counting only the scan would
 * let the process exit in the moment between charging a scan and writing the
 * answer, and the user would be charged for a result they never got.
 */
export function trackResponse(res: { once(event: "finish" | "close", fn: () => void): unknown }): void {
  const end = beginWork();
  res.once("finish", end);
  res.once("close", end);
}

export function activeWork(): number {
  return active;
}

/** How long to wait for running scans, given Railway's draining window. */
export function drainBudgetMs(env: Record<string, string | undefined> = process.env): number {
  const s = Number((env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS ?? "").trim());
  const windowMs = Number.isFinite(s) && s > 0 ? s * 1000 : RAILWAY_DEFAULT_DRAINING_MS;
  return Math.max(0, Math.min(MAX_DRAIN_MS, windowMs - FINAL_FLUSH_MARGIN_MS));
}

function flushAll(reason: string): void {
  for (const [name, fn] of flushers) {
    try { fn(reason); } catch (e) {
      console.error(`[shutdown] flush ${name} failed:`, e instanceof Error ? e.message : String(e));
    }
  }
}

/** Exported for tests; production reaches it through the signal handlers. */
export async function shutdown(
  signal: string,
  opts: { exit?: (code: number) => void; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  if (draining) return;
  draining = true;
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  flushAll(signal);

  const budget = drainBudgetMs(opts.env);
  if (active > 0 && budget > 0) {
    console.log(`[shutdown] ${signal}: waiting up to ${budget}ms for ${active} running scan(s)`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      new Promise<void>(resolve => { idleWaiters.push(resolve); }),
      new Promise<void>(resolve => { timer = setTimeout(resolve, budget); }),
    ]);
    if (timer) clearTimeout(timer);
  }

  flushAll(`${signal}-final`);
  console.log(`[shutdown] ${signal}: exiting with ${active} scan(s) still running`);
  exit(0);
}

function install(): void {
  if (installed) return;
  installed = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => { void shutdown(sig); });
  }
  process.once("beforeExit", () => flushAll("beforeExit"));
}

/** Tests only: return to a fresh state. */
export function __resetShutdownForTests(): void {
  draining = false;
  active = 0;
  idleWaiters = [];
}