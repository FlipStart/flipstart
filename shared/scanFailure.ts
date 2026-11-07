/**
 * shared/scanFailure.ts
 *
 * Why a scan didn't end on a normal result, in one vocabulary that the server
 * (which knows the cause) and the app (which picks the screen) share.
 *
 * ── Two kinds of failure ────────────────────────────────────────────────────
 * HARD — no result at all. The server attaches a ScanFailReason to the error
 *        (tRPC `error.data.scanReason`, see server/_core/trpc.ts). The message
 *        text stays exactly what app 2.1 already matches on.
 * SOFT — a result came back, but FlipStart can't stand behind it: it couldn't
 *        identify the item, identified it only partly, found several items
 *        with none clear, or the photo itself was the problem. scanSoftFail()
 *        decides this from the result, and BOTH sides call it, so the server
 *        never holds a charge for a result the app shows as normal, or the
 *        other way round.
 *
 * ── Charging soft fails ─────────────────────────────────────────────────────
 * A soft fail is charged only if the user taps "Continue anyway". The server
 * keeps the scan reserved and marks the result `chargePending`; the app then
 * confirms (Continue) or releases (Back, Retake). An app that never answers —
 * closed, crashed — leaves the reservation to expire, which returns the scan.
 */

/** Sent by the server on a hard failure. */
export type ScanFailReason =
  | "sign_in"               // the account couldn't be verified
  | "account_check_failed"  // the account or scan balance couldn't be read
  | "out_of_scans"
  | "pro_third_photo"       // a third photo sent without Pro
  | "pro_ai_context"        // AI Context sent without Pro
  | "app_outdated"          // a build missing fields the server requires
  | "server_restarting"     // a deploy is draining this server
  | "scan_in_progress"      // a duplicate of a scan still running
  | "timeout"               // stopped at the 45 s budget — stopped and refunded
  | "join_timeout"          // a retry stopped WAITING for a scan still running; says nothing about its charge
  | "cancelled"
  | "ai_busy"               // the AI provider is overloaded or unreachable
  | "ai_failed"             // the AI answered, but not with a usable analysis
  | "server_error";         // anything else on our side

export const SCAN_FAIL_REASONS: readonly ScanFailReason[] = [
  "sign_in", "account_check_failed", "out_of_scans", "pro_third_photo", "pro_ai_context",
  "app_outdated", "server_restarting", "scan_in_progress", "timeout", "join_timeout", "cancelled",
  "ai_busy", "ai_failed", "server_error",
];

export function isScanFailReason(x: unknown): x is ScanFailReason {
  return typeof x === "string" && (SCAN_FAIL_REASONS as readonly string[]).includes(x);
}

/** A result FlipStart can't stand behind. Each has its own screen. */
export type SoftFail =
  | "cannot_identify"   // no identification at all
  | "low_confidence"    // only partly identified (LOW tier)
  | "multiple_items"    // several items, none stands out
  | "photo_problem"     // blurry, dark, too far, glare or cut off
  | "no_item";          // nothing to identify in the photo

/** What scanSoftFail reads. Every field optional: old results lack most of them. */
export interface SoftFailSource {
  identification?: {
    v1?: {
      confidenceTier?: "high" | "medium" | "low" | null;
      scanIssue?: string | null;
    } | null;
  } | null;
  risk_analysis?: { match_confidence?: number | null } | null;
}

/** App 2.1's low-screen boundaries, used only for results with no tier. */
const LEGACY_VERY_LOW = 35;
const LEGACY_LOW = 55;

/**
 * Null for a normal result. Otherwise which soft fail it is.
 *
 * With a tier (every result from the rebuilt confidence model): the server's
 * own scanIssue decides, and a LOW tier without a photo problem is "low
 * confidence" rather than "couldn't identify". Without one (the legacy AI
 * route, or a result from before the rebuild): the score, at app 2.1's
 * boundaries, with 0 treated as "couldn't identify" — before, a 0 slipped
 * through as a normal result.
 */
export function scanSoftFail(result: SoftFailSource | null | undefined): SoftFail | null {
  if (!result || typeof result !== "object") return null;
  const v1 = result.identification?.v1 ?? null;
  const hasTier = !!v1 && v1.confidenceTier !== undefined;

  if (hasTier) {
    const issue = v1!.scanIssue ?? null;
    const tier = v1!.confidenceTier ?? null;
    if (issue === "no_item") return "no_item";
    if (issue === "multiple_items") return "multiple_items";
    if (issue === "photo_problem") return "photo_problem";
    if (tier === "low") return "low_confidence";
    if (tier === null || issue === "cannot_identify") return "cannot_identify";
    return null;
  }

  const raw = result.risk_analysis?.match_confidence;
  const score = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  if (score < LEGACY_VERY_LOW) return "cannot_identify";
  if (score < LEGACY_LOW) return "low_confidence";
  return null;
}

/**
 * What a hard failure means for the numbers (Phase 6, tracking).
 *
 * failure   — FlipStart let the user down: something broke, ran out of time
 *             or couldn't be checked. These are what the failure rate counts.
 * blocked   — working as designed: the user needs to sign in, buy scans,
 *             upgrade or update. Shown, but never counted as a failure.
 * stopped   — the user cancelled.
 * duplicate — a retry of a scan that is still running or already settled.
 *             The original request records the outcome; this one doesn't.
 */
export type FailureGroup = "failure" | "blocked" | "stopped" | "duplicate";

export function failureGroup(reason: ScanFailReason): FailureGroup {
  switch (reason) {
    case "sign_in": case "out_of_scans": case "pro_third_photo":
    case "pro_ai_context": case "app_outdated":
      return "blocked";
    case "cancelled":
      return "stopped";
    case "scan_in_progress": case "join_timeout":
      return "duplicate";
    default:
      return "failure";
  }
}

/** Soft fails where "Continue anyway" makes sense. No item = nothing to show. */
export function softFailCanContinue(f: SoftFail): boolean {
  return f !== "no_item";
}