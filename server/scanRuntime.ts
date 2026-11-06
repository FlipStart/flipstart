/**
 * server/scanRuntime.ts
 *
 * Phase 2 of the scan-failure plan: a scan never runs past the app's 45 s,
 * and a scan the user never gets is never charged.
 *
 * ── The budget ──────────────────────────────────────────────────────────────
 * The app keeps one 45 s clock for the whole scan, retries included, and sends
 * how much of it is left with every request (deadlineMs). The server stops
 * work 5 s before that runs out, leaving time for the answer to reach the
 * phone, and never works on one request for more than 40 s. App 2.1 sends no
 * deadline and gets the 40 s cap.
 *
 * When time runs out the AI call is aborted, the scan is refunded (it is
 * still only reserved), and the request fails with "timed out … you weren't
 * charged". Charging happens only after assertLive() passes, so a scan that
 * finishes late is never charged.
 *
 * ── One scan, one run ───────────────────────────────────────────────────────
 * A retry re-sends the same scanAttemptId. If that scan is still running in
 * this process, the retry waits for it and gets the same answer — before,
 * it was told "already being processed" and the app gave up or tried again.
 *
 * ── Cancel ──────────────────────────────────────────────────────────────────
 * At 45 s the app calls cancelAnalysis. A running scan is stopped and
 * refunded. A scan that was already finished and charged — the answer was
 * just slow to arrive — is handed back instead, so the user is never charged
 * for a result they don't get. (refund_scan only undoes a reservation, never
 * a charge, which is why a charged scan is delivered rather than reversed.)
 *
 * Memory only, like the result cache in routers.ts: Railway runs one
 * instance, and losing this on restart costs at most the old behaviour.
 */
import { beginWork } from "./shutdown.js";

export const APP_SCAN_BUDGET_MS = 45_000;
export const SERVER_MAX_SCAN_MS = 40_000;
export const DELIVERY_MARGIN_MS = 5_000;
/** Less than this left and starting the AI is pointless. */
export const MIN_SCAN_MS = 3_000;
const MEMORY_TTL_MS = 10 * 60_000;
const MEMORY_MAX = 500;

export type StopReason = "timeout" | "cancelled";

export class ScanStopped extends Error {
  constructor(public readonly reason: StopReason) {
    super(reason === "timeout"
      ? "Scan timed out, so we stopped it. You weren't charged."
      : "Scan cancelled. You weren't charged.");
    this.name = "ScanStopped";
  }
  /** Read by the client today through the message; Phase 4 adds real codes. */
  get code(): string { return this.reason === "timeout" ? "SCAN_TIMEOUT" : "SCAN_CANCELLED"; }
}

/**
 * A retry that joined a running scan ran out of its own time. It stopped
 * nothing, so it makes no claim about charging: the app asks cancel, which
 * knows. ("timed out" keeps app 2.1 treating it as a timeout.)
 */
export class JoinTimeout extends Error {
  constructor() {
    super("Scan timed out while waiting for it to finish.");
    this.name = "JoinTimeout";
  }
  get code(): string { return "SCAN_JOIN_TIMEOUT"; }
}

/**
 * How long the server may work on this request. 0 means "don't start": the
 * app's clock is nearly out and nothing could arrive in time.
 */
export function scanBudgetMs(clientRemainingMs?: number | null): number {
  const n = typeof clientRemainingMs === "number" ? clientRemainingMs : Number.NaN;
  const fromClient = Number.isFinite(n) && n > 0
    ? Math.min(n, APP_SCAN_BUDGET_MS) - DELIVERY_MARGIN_MS
    : SERVER_MAX_SCAN_MS;
  const budget = Math.min(SERVER_MAX_SCAN_MS, fromClient);
  return budget >= MIN_SCAN_MS ? budget : 0;
}

export interface ScanRun {
  readonly owner: string;
  readonly attemptId: string;
  /** Passed to the AI call; aborted on timeout or cancel. */
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  readonly stopReason: StopReason | null;
  /** Rejects with ScanStopped when the run is stopped. Race work that cannot be aborted against it. */
  readonly stopped: Promise<never>;
  /** Throws ScanStopped if the run was stopped or is past its deadline. Call right before charging. */
  assertLive(): void;
  /** The scan succeeded; `charged` says whether a scan was consumed. */
  succeed(payload: unknown, charged: boolean): void;
  /**
   * The scan failed. `refunded`: this run's reservation was handed back.
   * `charged`: a scan was consumed before the failure (cancel then won't
   * claim "nothing charged").
   */
  fail(err: unknown, refunded: boolean, charged?: boolean): void;
}

interface RunState extends ScanRun {
  key: string;
  result: Promise<unknown>;
  settledOutcome: Promise<"succeeded" | "failed">;
  readonly settled: boolean;
  readonly chargedThenFailed: boolean;
  payload?: unknown;
  stop(reason: StopReason): void;
}

const runs = new Map<string, RunState>();
const completed = new Map<string, { at: number; payload: unknown; charged: boolean }>();
const refunds = new Map<string, { at: number; count: number }>();

const runKey = (owner: string, attemptId: string, ctxHash: string | null) =>
  `${owner}\u0000${attemptId}\u0000${ctxHash ?? ""}`;
const attemptKey = (owner: string, attemptId: string) => `${owner}\u0000${attemptId}`;

function remember<T extends { at: number }>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= MEMORY_MAX) {
    const cutoff = Date.now() - MEMORY_TTL_MS;
    for (const [k, v] of map) if (v.at < cutoff) map.delete(k);
    while (map.size >= MEMORY_MAX) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
  map.set(key, value);
}

function fresh<T extends { at: number }>(map: Map<string, T>, key: string): T | null {
  const v = map.get(key);
  if (!v) return null;
  if (Date.now() - v.at > MEMORY_TTL_MS) { map.delete(key); return null; }
  return v;
}

/** The run for this exact scan (same user, attempt and camera note), if one is going. */
export function findRun(owner: string, attemptId: string, ctxHash: string | null): ScanRun | null {
  return runs.get(runKey(owner, attemptId, ctxHash)) ?? null;
}

/**
 * Wait for a run someone else started. The joiner's own budget can end its
 * wait early (JoinTimeout) but never stops the run itself.
 */
export async function joinRun(run: ScanRun, budgetMs: number): Promise<unknown> {
  const state = run as RunState;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      state.result,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JoinTimeout()), Math.max(0, budgetMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function beginRun(opts: {
  owner: string; attemptId: string; ctxHash: string | null; budgetMs: number;
}): ScanRun {
  const key = runKey(opts.owner, opts.attemptId, opts.ctxHash);
  const controller = new AbortController();
  const endWork = beginWork();
  const deadlineAt = Date.now() + Math.max(0, opts.budgetMs);

  let resolveResult!: (v: unknown) => void;
  let rejectResult!: (e: unknown) => void;
  const result = new Promise<unknown>((res, rej) => { resolveResult = res; rejectResult = rej; });
  result.catch(() => {});   // joiners handle it; no unhandled rejection when nobody joined

  let resolveOutcome!: (v: "succeeded" | "failed") => void;
  const settledOutcome = new Promise<"succeeded" | "failed">(res => { resolveOutcome = res; });

  let rejectStopped!: (e: unknown) => void;
  const stopped = new Promise<never>((_, rej) => { rejectStopped = rej; });
  stopped.catch(() => {});

  let stopReason: StopReason | null = null;
  let settled = false;
  let chargedThenFailed = false;

  const stop = (reason: StopReason) => {
    if (stopReason || settled) return;
    stopReason = reason;
    const err = new ScanStopped(reason);
    controller.abort(err);
    rejectStopped(err);
  };

  const timer = setTimeout(() => stop("timeout"), Math.max(0, opts.budgetMs));
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }

  const finish = () => {
    settled = true;
    clearTimeout(timer);
    if (runs.get(key) === state) runs.delete(key);
    endWork();
  };

  const state: RunState = {
    key,
    owner: opts.owner,
    attemptId: opts.attemptId,
    signal: controller.signal,
    deadlineAt,
    get stopReason() { return stopReason; },
    get settled() { return settled; },
    get chargedThenFailed() { return chargedThenFailed; },
    stopped,
    result,
    settledOutcome,
    stop,
    assertLive() {
      if (!stopReason && Date.now() > deadlineAt) stop("timeout");
      if (stopReason) throw new ScanStopped(stopReason);
    },
    succeed(payload: unknown, charged: boolean) {
      if (settled) return;
      state.payload = payload;
      // Kept whether or not a scan was charged (an allow-list scan isn't), so
      // cancel and a late retry can always hand over a finished result.
      remember(completed, attemptKey(opts.owner, opts.attemptId), { at: Date.now(), payload, charged });
      finish();
      resolveResult(payload);
      resolveOutcome("succeeded");
    },
    fail(err: unknown, refunded: boolean, charged = false) {
      if (settled) return;
      chargedThenFailed = charged;
      if (refunded) {
        const k = attemptKey(opts.owner, opts.attemptId);
        const prev = fresh(refunds, k);
        remember(refunds, k, { at: Date.now(), count: (prev?.count ?? 0) + 1 });
      }
      finish();
      rejectResult(err);
      resolveOutcome("failed");
    },
  };

  runs.set(key, state);
  return state;
}

/**
 * The idempotency key to reserve this scan under.
 *
 * The first try uses the app's attempt id. If this process has refunded that
 * reservation (a timeout, cancel or AI failure), a retry reserves under a new
 * key, so it can neither be mistaken for the refunded one nor get stuck behind
 * it. Charges stay at most one per success.
 */
export function ledgerKey(owner: string, attemptId: string): string {
  const r = fresh(refunds, attemptKey(owner, attemptId));
  return r && r.count > 0 ? `${attemptId}~r${r.count}` : attemptId;
}

/** A finished result for this attempt, kept so cancel and late retries can hand it over. */
export function completedResult(owner: string, attemptId: string): unknown | null {
  return fresh(completed, attemptKey(owner, attemptId))?.payload ?? null;
}

export type CancelOutcome =
  | { status: "completed"; result: unknown }
  /** Stopped, and every run for it settled without a result: nothing charged. */
  | { status: "cancelled" }
  /** Told to stop, but a run hadn't settled in time (e.g. mid-commit): unknown. */
  | { status: "stopping" }
  | { status: "not_running" };

/**
 * Stop this user's scan. Waits briefly for the run to settle so the answer is
 * the truth: either nothing was charged, or the finished result is returned.
 */
export async function cancelScan(owner: string, attemptId: string, waitMs = 4_000): Promise<CancelOutcome> {
  const mine = [...runs.values()].filter(r => r.owner === owner && r.attemptId === attemptId);
  if (mine.length > 0) {
    for (const r of mine) r.stop("cancelled");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(mine.map(r => r.settledOutcome)),
      new Promise<void>(res => { timer = setTimeout(res, waitMs); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  const done = completedResult(owner, attemptId);
  if (done) return { status: "completed", result: done };
  if (mine.length === 0) return { status: "not_running" };
  return mine.every(r => r.settled && !r.chargedThenFailed) ? { status: "cancelled" } : { status: "stopping" };
}

/** Tests only. */
export function __resetScanRuntimeForTests(): void {
  for (const r of runs.values()) r.stop("cancelled");
  runs.clear();
  completed.clear();
  refunds.clear();
}