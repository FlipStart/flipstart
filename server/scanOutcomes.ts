/**
 * server/scanOutcomes.ts
 *
 * One row per scan in Supabase `scan_outcomes` (Phase 6 of the scan-failure
 * plan): how it ended, why, at what confidence, and — for a soft fail — what
 * the user chose. The founder dashboard's Scan Reliability section reads it.
 *
 * ── What gets a row ─────────────────────────────────────────────────────────
 *   ok    — a normal result, with its confidence tier (for calibration)
 *   soft  — a result FlipStart couldn't stand behind (shared/scanFailure.ts)
 *   hard  — no result, with the server's reason code
 *
 * Only for a VERIFIED user. analyzeFast is a public endpoint, so recording
 * unauthenticated requests would let anyone fill the table. Those users still
 * see a fail screen, and the app's own scan_failed event records it.
 * Duplicate requests (a retry joining a running scan) are skipped: the
 * original request records the outcome.
 *
 * ── One row per attempt ─────────────────────────────────────────────────────
 * Keyed on (user_id, attempt_id), so automatic retries of one item update one
 * row instead of adding several. A result always wins over a failure: a retry
 * that times out after another try already returned a result never turns that
 * result back into a failure.
 *
 * ── Never in the way ────────────────────────────────────────────────────────
 * Fire-and-forget: nothing here is awaited by a scan, and every error is
 * swallowed. If the table doesn't exist yet (the SQL hasn't been run), writes
 * pause for ten minutes at a time with one warning in the log.
 *
 * Privacy: the user's id and the scan's own fields only. No email, no photo,
 * no item text, no typed context.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { failureGroup, isScanFailReason, scanSoftFail, type ScanFailReason } from "../shared/scanFailure.js";

export const SCAN_OUTCOMES_TABLE = "scan_outcomes";

export type OutcomeKind = "ok" | "soft" | "hard";
/**
 * charged     — a scan was used
 * held        — a soft fail waiting for Continue anyway
 * not_charged — nothing was used (failures, "no item", declined, expired)
 * unknown     — the charge couldn't be settled (a confirm or release failed)
 */
export type OutcomeCharge = "charged" | "held" | "not_charged" | "unknown";
export type OutcomeResolution = "continued" | "declined";

export interface ScanOutcomeRow {
  user_id: string;
  attempt_id: string;
  kind: OutcomeKind;
  /** Hard: a ScanFailReason. Soft: a SoftFail. Ok: null. */
  reason: string | null;
  /** Hard only: failure / blocked / stopped. */
  failure_group: string | null;
  confidence_tier: "high" | "medium" | "low" | null;
  match_confidence: number | null;
  scan_issue: string | null;
  photo_problems: string[];
  photo_count: number;
  route: "v1" | "legacy";
  charge: OutcomeCharge;
  resolution: OutcomeResolution | null;
  resolved_at: string | null;
  /** The app holds soft-fail charges (new app) rather than charging at once (app 2.1). */
  holds_charges: boolean;
  duration_ms: number;
  updated_at: string;
}

// ── Pure: build a row ───────────────────────────────────────────────────────

export interface OutcomeContext {
  owner: string | null;
  attemptId: string;
  photoCount: number;
  route: "v1" | "legacy";
  holdsCharges: boolean;
  startedAt: number;
  /** Set by settleCharge: only a request that settled a result records it. */
  charge?: OutcomeCharge;
}

const TIERS = new Set(["high", "medium", "low"]);
const PROBLEMS = new Set(["blurry", "too_dark", "too_far", "glare", "cut_off"]);

function str(x: unknown, max = 40): string | null {
  return typeof x === "string" && x.length > 0 ? x.slice(0, max) : null;
}

/** The row for a delivered result, or null when this request didn't settle one (a replay). */
export function rowForResult(c: OutcomeContext, payload: any, now = Date.now()): ScanOutcomeRow | null {
  if (!c.owner || !c.charge || !payload || typeof payload !== "object") return null;
  const v1 = payload?.identification?.v1 ?? null;
  const soft = scanSoftFail(payload);
  const tier = str(v1?.confidenceTier);
  const mc = payload?.risk_analysis?.match_confidence;
  const problems = Array.isArray(v1?.photoProblems)
    ? [...new Set((v1.photoProblems as unknown[]).map(String).filter(p => PROBLEMS.has(p)))]
    : [];
  return {
    user_id: c.owner,
    attempt_id: c.attemptId,
    kind: soft ? "soft" : "ok",
    reason: soft,
    failure_group: null,
    confidence_tier: tier && TIERS.has(tier) ? (tier as "high" | "medium" | "low") : null,
    match_confidence: typeof mc === "number" && Number.isFinite(mc) ? Math.round(Math.max(0, Math.min(100, mc))) : null,
    scan_issue: str(v1?.scanIssue),
    photo_problems: problems,
    photo_count: c.photoCount,
    route: c.route,
    charge: c.charge,
    resolution: null,
    resolved_at: null,
    holds_charges: c.holdsCharges,
    duration_ms: Math.max(0, now - c.startedAt),
    updated_at: new Date(now).toISOString(),
  };
}

/** The row for a failed request, or null when it isn't recorded (no verified user, a duplicate). */
export function rowForError(c: OutcomeContext, err: unknown, now = Date.now()): ScanOutcomeRow | null {
  if (!c.owner) return null;
  const raw = (err as { scanReason?: unknown } | null)?.scanReason;
  let reason: ScanFailReason = isScanFailReason(raw) ? raw : "server_error";
  // The app stopped waiting (its 45 s clock, or errors) and asked us to stop:
  // that is a scan that took too long, not the user pressing Cancel.
  if (reason === "cancelled" && appGaveUp(c.owner, c.attemptId, now)) reason = "timeout";
  const group = failureGroup(reason);
  if (group === "duplicate") return null;
  return {
    user_id: c.owner,
    attempt_id: c.attemptId,
    kind: "hard",
    reason,
    failure_group: group,
    confidence_tier: null,
    match_confidence: null,
    scan_issue: null,
    photo_problems: [],
    photo_count: c.photoCount,
    route: c.route,
    // A failure after a charge is possible only if the delivery itself broke.
    charge: c.charge === "charged" ? "charged" : "not_charged",
    resolution: null,
    resolved_at: null,
    holds_charges: c.holdsCharges,
    duration_ms: Math.max(0, now - c.startedAt),
    updated_at: new Date(now).toISOString(),
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

type Sink = {
  upsert(row: ScanOutcomeRow): Promise<{ error?: { code?: string; message?: string } | null }>;
  resolve(owner: string, attemptId: string, patch: Partial<ScanOutcomeRow>): Promise<{ error?: { code?: string; message?: string } | null }>;
};

function supabaseSink(): Sink | null {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  return {
    upsert: (row) => sb.from(SCAN_OUTCOMES_TABLE).upsert(row, { onConflict: "user_id,attempt_id" }),
    // Only a soft fail has a choice to record.
    resolve: (owner, attemptId, patch) => sb.from(SCAN_OUTCOMES_TABLE).update(patch)
      .eq("user_id", owner).eq("attempt_id", attemptId).eq("kind", "soft"),
  };
}

let sinkOverride: Sink | null | undefined;
const PAUSE_MS = 10 * 60_000;
let pausedUntil = 0;

/** What this process last wrote for an attempt, so a failure never overwrites a result. */
const lastKind = new Map<string, { kind: OutcomeKind; at: number }>();
const MEMORY_MS = 30 * 60_000;
/** Writes for one attempt run in order: a resolution never lands before its row. */
const chains = new Map<string, Promise<void>>();

/**
 * Attempts the app gave up on (cancelAnalysis with why "gave_up"), so their
 * "cancelled" stop is recorded as a timeout. Kept briefly: the stop lands
 * within seconds of the request.
 */
const gaveUp = new Map<string, number>();
const GAVE_UP_MS = 2 * 60_000;

export function noteAppGaveUp(owner: string, attemptId: string, now = Date.now()): void {
  if (gaveUp.size > 1000) for (const [k, at] of gaveUp) if (now - at > GAVE_UP_MS) gaveUp.delete(k);
  gaveUp.set(keyOf(owner, attemptId), now);
}

function appGaveUp(owner: string, attemptId: string, now: number): boolean {
  const at = gaveUp.get(keyOf(owner, attemptId));
  return at !== undefined && now - at < GAVE_UP_MS;
}

/**
 * New rows per user per day. A scan refused early (a third photo on Free,
 * say) costs nothing to send, so without a cap one account could fill the
 * table with fresh attempt ids. Far above any real day of scanning; updates
 * to an attempt already recorded don't count.
 */
export const MAX_NEW_ROWS_PER_OWNER_PER_DAY = 300;
const newRows = new Map<string, { day: number; n: number }>();

function underCap(owner: string, now: number): boolean {
  const day = Math.floor(now / 86_400_000);
  const c = newRows.get(owner);
  if (!c || c.day !== day) { newRows.set(owner, { day, n: 1 }); return true; }
  if (c.n >= MAX_NEW_ROWS_PER_OWNER_PER_DAY) return false;
  c.n++;
  return true;
}

const keyOf = (owner: string, attemptId: string) => `${owner}\u0000${attemptId}`;

function missingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205"
    || /relation .*scan_outcomes.* does not exist|could not find the table/i.test(e.message ?? "");
}

function enqueue(key: string, job: (sink: Sink) => Promise<{ error?: { code?: string; message?: string } | null }>, what: string): Promise<void> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    if (Date.now() < pausedUntil) return;
    const sink = sinkOverride === undefined ? supabaseSink() : sinkOverride;
    if (!sink) return;
    try {
      const { error } = await job(sink);
      if (error) {
        if (missingTable(error)) {
          pausedUntil = Date.now() + PAUSE_MS;
          console.warn(`[scanOutcomes] table "${SCAN_OUTCOMES_TABLE}" not found — run drizzle/sql/scan_outcomes.sql. Paused 10 min.`);
        } else {
          console.warn(`[scanOutcomes] ${what} failed: ${error.code ?? ""} ${error.message ?? ""}`.trim());
        }
      }
    } catch (e) {
      console.warn(`[scanOutcomes] ${what} threw:`, e instanceof Error ? e.message : String(e));
    }
  });
  chains.set(key, next);
  void next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
  return next;
}

function sweep(now: number) {
  if (lastKind.size < 500) return;
  for (const [k, v] of lastKind) if (now - v.at > MEMORY_MS) lastKind.delete(k);
}

/** Record a row. Returns the write's promise for tests; callers never await it. */
export function writeOutcome(row: ScanOutcomeRow | null, now = Date.now()): Promise<void> {
  if (!row) return Promise.resolve();
  const key = keyOf(row.user_id, row.attempt_id);
  const prev = lastKind.get(key);
  if (row.kind === "hard" && prev && now - prev.at < MEMORY_MS && prev.kind !== "hard") return Promise.resolve();
  if (!prev && !underCap(row.user_id, now)) return Promise.resolve();
  lastKind.set(key, { kind: row.kind, at: now });
  sweep(now);
  return enqueue(key, s => s.upsert(row), "upsert");
}

/** The user's choice on a soft-fail screen. */
export function resolveOutcome(owner: string | null, attemptId: string, resolution: OutcomeResolution, charge?: OutcomeCharge, now = Date.now()): Promise<void> {
  if (!owner || !attemptId) return Promise.resolve();
  const patch: Partial<ScanOutcomeRow> = {
    resolution, resolved_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  };
  if (charge) patch.charge = charge;
  return enqueue(keyOf(owner, attemptId), s => s.resolve(owner, attemptId, patch), "resolve");
}

/** A tracker for one analyzeFast request. */
export function startOutcome(input: {
  scanAttemptId?: string; tagImageBase64?: string; detailImageBase64?: string; chargeOnContinue?: boolean;
}, now = Date.now()): OutcomeContext {
  const id = (input.scanAttemptId ?? "").trim().slice(0, 200);
  return {
    owner: null,
    attemptId: id || `none-${randomUUID()}`,
    photoCount: 1 + (input.tagImageBase64 ? 1 : 0) + (input.detailImageBase64 ? 1 : 0),
    route: "legacy",
    holdsCharges: input.chargeOnContinue === true,
    startedAt: now,
  };
}

/** Resolves once every pending write has finished. Tests only. */
export async function __settleOutcomesForTests(): Promise<void> {
  while (chains.size) await Promise.all([...chains.values()]);
}

export function __setOutcomeSinkForTests(s: Sink | null | undefined): void {
  sinkOverride = s; pausedUntil = 0; lastKind.clear(); chains.clear(); gaveUp.clear(); newRows.clear();
}