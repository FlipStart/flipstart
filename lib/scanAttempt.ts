/**
 * lib/scanAttempt.ts
 *
 * The scan clock and retry rules (Phase 2 of the scan-failure plan). Pure: no
 * React, no network, so every rule here is tested directly.
 *
 * ── One clock ───────────────────────────────────────────────────────────────
 * A scan gets 45 s in total, every retry included. At 45 s the app stops,
 * tells the server to stop (no charge), and shows the "took too long" screen.
 * Before, each try had its own 30 s timer and up to three retries, so a scan
 * could run for two minutes.
 *
 * ── Retry only what can succeed ─────────────────────────────────────────────
 * Retried: the request failed or got no answer (network, server error, a
 * scan still running, a server restart). Never retried: a refusal (sign-in,
 * out of scans, a Pro feature, an outdated app) or a photo that can't be used —
 * those fail the same way every time. Before, refusals were retried three
 * times before the user saw anything.
 *
 * Every retry re-sends the same scanAttemptId, so the server either hands back
 * the scan that is already running or finished, or runs it once. A retry can
 * never charge a second scan.
 *
 * ── Which screen (Phase 4) ──────────────────────────────────────────────────
 * The server attaches a reason code to every failure (shared/scanFailure.ts),
 * read here first. The message text is matched only as a fallback, for a
 * server that predates the codes. Server text is never shown on screen: the
 * screen's copy comes from the screen and cause chosen here.
 */
import { isScanFailReason, type ScanFailReason, type SoftFail } from "@shared/scanFailure";

/** The whole scan, retries included. */
export const SCAN_BUDGET_MS = 45_000;
/** If the first try hasn't answered by now, send it again (the server joins the running scan). */
export const ATTEMPT_PATIENCE_MS = 25_000;
/**
 * Don't start a try with less than this left. The server needs at least 3 s
 * to work and keeps 5 s back for the answer to arrive (server/scanRuntime.ts),
 * so with less than 8 s left it would refuse the try straight away.
 */
export const MIN_ATTEMPT_MS = 8_000;
/** Wait before the 2nd, 3rd and 4th tries. */
export const RETRY_DELAYS_MS = [0, 1_500, 3_000] as const;
export const MAX_ATTEMPTS = 4;
/** How long to wait for the server to confirm a cancel at 45 s. */
export const CANCEL_WAIT_MS = 5_000;

/** Internal error markers, never shown to a user. */
export const ATTEMPT_TIMEOUT = "__ATTEMPT_TIMEOUT__";
export const SCAN_DEADLINE = "__SCAN_DEADLINE__";

export type ScanErrorKind =
  /** The server said no on purpose. Retrying gets the same answer. */
  | "refusal"
  /** The photo can't be used. Retrying gets the same answer. */
  | "bad_input"
  /** The request failed or got no answer. Retry while time is left. */
  | "transient"
  /** The server stopped the scan at its deadline and refunded it. No time is left to retry. */
  | "server_timeout";

/**
 * Every fail screen. The five soft fails come from a RESULT (scanSoftFail);
 * the rest from an error. Out of scans and Pro feature open the paywall over
 * their screen.
 */
export type FailScreen =
  | SoftFail
  | "timeout"
  | "offline"
  | "server"            // one screen for every problem on our side; `cause` picks the words
  | "sign_in"
  | "out_of_scans"
  | "pro_feature"
  | "app_outdated"
  | "photo_load_failed";

/** What went wrong on our side, for the merged "server" screen. */
export type ServerCause =
  | "server_down"       // our server can't be reached, or Railway's edge answered for it
  | "restarting"        // a deploy is in progress
  | "ai_busy"           // the AI provider is overloaded or unreachable
  | "ai_failed"         // the AI answered without a usable analysis
  | "account_check"     // the account or scan balance couldn't be read
  | "unknown";

/** The paywall a refusal opens. */
export type FailPaywall = "scan_limit" | "third_photo" | "camera_context";

export interface ClassifiedScanError {
  kind: ScanErrorKind;
  screen: FailScreen;
  cause?: ServerCause;
  paywall?: FailPaywall;
}

/** Extra facts about a failed request, when the client has them. */
export interface ScanErrorMeta {
  /** tRPC `error.data.scanReason`. */
  reason?: unknown;
  /** HTTP status of the response, when one arrived. */
  httpStatus?: number | null;
}

const has = (s: string, ...needles: string[]) => needles.some(n => s.includes(n));

/** A server reason code → screen. Every code the server can send has an entry. */
const BY_REASON: Record<ScanFailReason, ClassifiedScanError> = {
  sign_in:              { kind: "refusal",        screen: "sign_in" },
  out_of_scans:         { kind: "refusal",        screen: "out_of_scans", paywall: "scan_limit" },
  pro_third_photo:      { kind: "refusal",        screen: "pro_feature",  paywall: "third_photo" },
  pro_ai_context:       { kind: "refusal",        screen: "pro_feature",  paywall: "camera_context" },
  app_outdated:         { kind: "refusal",        screen: "app_outdated" },
  account_check_failed: { kind: "transient",      screen: "server", cause: "account_check" },
  server_restarting:    { kind: "transient",      screen: "server", cause: "restarting" },
  scan_in_progress:     { kind: "transient",      screen: "server", cause: "unknown" },
  ai_busy:              { kind: "transient",      screen: "server", cause: "ai_busy" },
  ai_failed:            { kind: "transient",      screen: "server", cause: "ai_failed" },
  server_error:         { kind: "transient",      screen: "server", cause: "unknown" },
  timeout:              { kind: "server_timeout", screen: "timeout" },
  // A retry stopped waiting for a scan still running. Not "server_timeout":
  // nothing was stopped, so cancel must decide what was charged.
  join_timeout:         { kind: "transient",      screen: "timeout" },
  cancelled:            { kind: "server_timeout", screen: "timeout" },
};

/**
 * Which screen a failed request ends on, and whether it is worth another try.
 * The reason code wins; the HTTP status and the message are fallbacks.
 */
export function classifyScanError(raw: string, meta: ScanErrorMeta = {}): ClassifiedScanError {
  if (isScanFailReason(meta.reason)) return { ...BY_REASON[meta.reason] };

  const text = String(raw ?? "");
  const s = text.toLowerCase();

  if (text === ATTEMPT_TIMEOUT) return { kind: "transient", screen: "timeout" };

  // Railway's edge answering for a server that is down or crashed: a 502 /
  // 503 / 504, or an HTML page where JSON was expected.
  const status = typeof meta.httpStatus === "number" ? meta.httpStatus : 0;
  if (status === 502 || status === 503 || status === 504
      || has(s, "unexpected token '<'", "unexpected token <", "json parse error", "<html", "<!doctype",
             "application failed to respond", "bad gateway", "service unavailable", "gateway time")) {
    return { kind: "transient", screen: "server", cause: "server_down" };
  }

  // ── A server without reason codes: its exact messages ─────────────────────
  if (s.includes("you weren't charged") && has(s, "timed out", "cancelled")) {
    return { kind: "server_timeout", screen: "timeout" };
  }
  if (s.includes("scanner_id_missing") || s.includes("please update flipstart")) {
    return { kind: "refusal", screen: "app_outdated" };
  }
  if (has(s, "global_scan_limit_reached", "scan limit", "out of scans")) {
    return { kind: "refusal", screen: "out_of_scans", paywall: "scan_limit" };
  }
  if (s.includes("please sign in")) return { kind: "refusal", screen: "sign_in" };
  if (s.includes("available with flipstart pro")) {
    return s.includes("ai context")
      ? { kind: "refusal", screen: "pro_feature", paywall: "camera_context" }
      : { kind: "refusal", screen: "pro_feature", paywall: "third_photo" };
  }
  if (has(s, "unsupported image", "image format", "heic", "image data is required")) {
    return { kind: "bad_input", screen: "photo_load_failed" };
  }

  // ── Transient ─────────────────────────────────────────────────────────────
  if (has(s, "network request failed", "network error", "failed to fetch",
               "connection refused", "no internet", "offline", "internet connection appears to be offline")) {
    // Offline, or our server unreachable: checkConnection() tells which when
    // the scan gives up.
    return { kind: "transient", screen: "offline" };
  }
  if (has(s, "timed out", "timeout")) return { kind: "transient", screen: "timeout" };
  if (s.includes("restarting")) return { kind: "transient", screen: "server", cause: "restarting" };
  if (s.includes("couldn't check your")) return { kind: "transient", screen: "server", cause: "account_check" };
  return { kind: "transient", screen: "server", cause: "unknown" };
}

/**
 * The scan_failed `errorType` the dashboard already groups by. New screens map
 * onto the old names so October's numbers stay comparable; the precise screen
 * travels alongside as `reason`.
 */
export function legacyErrorType(screen: FailScreen): "server" | "offline" | "timeout" | "low_confidence" | "bad_input" | "scan_limit" {
  switch (screen) {
    case "low_confidence": return "low_confidence";
    case "cannot_identify": case "multiple_items": case "photo_problem": case "no_item": case "photo_load_failed":
      return "bad_input";
    case "timeout": return "timeout";
    case "offline": return "offline";
    case "out_of_scans": return "scan_limit";
    default: return "server";
  }
}

/** Where to ask "is the internet up?" when a request never reached us. */
export const CONNECTIVITY_PROBE_URL = "https://captive.apple.com/hotspot-detect.html";
export const CONNECTIVITY_PROBE_MS = 3_000;

/**
 * A request that never reached the server means either the phone is offline
 * or our server is down. Ask a well-known site: if it answers, the internet
 * is fine and the problem is ours. If the check itself can't tell (it timed
 * out or threw), say offline — the honest, more likely answer in a thrift
 * store.
 */
export async function checkConnection(
  fetcher: (url: string, init: { signal: AbortSignal; method: string; cache?: string }) => Promise<{ ok: boolean; status: number }> =
    (url, init) => fetch(url, init as RequestInit),
  timeoutMs = CONNECTIVITY_PROBE_MS,
): Promise<"online" | "offline"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(CONNECTIVITY_PROBE_URL, { signal: ctrl.signal, method: "GET", cache: "no-store" });
    return res.status > 0 && res.status < 500 ? "online" : "offline";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timer);
  }
}

/** How long to wait for one try. The first gets ATTEMPT_PATIENCE_MS; later ones get whatever is left. */
export function attemptTimeoutMs(attemptIndex: number, remainingMs: number): number {
  const left = Math.max(0, remainingMs);
  return attemptIndex === 0 ? Math.min(ATTEMPT_PATIENCE_MS, left) : left;
}

/** Whether to try again after a failure, and after how long. */
export function planRetry(opts: { attemptsMade: number; remainingMs: number; kind: ScanErrorKind }): {
  retry: boolean; delayMs: number;
} {
  const delayMs = RETRY_DELAYS_MS[Math.min(Math.max(opts.attemptsMade - 1, 0), RETRY_DELAYS_MS.length - 1)];
  const retry = opts.kind === "transient"
    && opts.attemptsMade < MAX_ATTEMPTS
    && opts.remainingMs - delayMs >= MIN_ATTEMPT_MS;
  return { retry, delayMs };
}

/** The deadline sent to the server with each try: what's left of the 45 s, in whole ms. */
export function deadlineForServer(remainingMs: number): number {
  return Math.max(1, Math.round(remainingMs));
}