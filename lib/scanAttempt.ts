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
 * Error text is matched because the server sends no reason codes yet; Phase 4
 * replaces this with codes. The phrases are the server's own messages.
 */
import type { FailType } from "@/components/scan/FailStateScreen";

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

export interface ClassifiedScanError {
  kind: ScanErrorKind;
  failType: FailType;
  /** Text for the fail screen, or "" to use the screen's own copy. */
  message: string;
}

/** The server's text when it isn't JSON, an internal marker or too long; otherwise "". */
export function safeMessage(raw: string): string {
  return raw.length > 0 && raw.length < 120 && !raw.startsWith("{") && !raw.startsWith("__") ? raw : "";
}

const has = (s: string, ...needles: string[]) => needles.some(n => s.includes(n));

export function classifyScanError(raw: string): ClassifiedScanError {
  const text = String(raw ?? "");
  const s = text.toLowerCase();

  if (text === ATTEMPT_TIMEOUT) return { kind: "transient", failType: "timeout", message: "" };

  // The server's deadline (server/scanRuntime.ts): stopped and refunded.
  if (s.includes("you weren't charged") && has(s, "timed out", "cancelled")) {
    return { kind: "server_timeout", failType: "timeout", message: "" };
  }

  // ── Refusals ──────────────────────────────────────────────────────────────
  if (s.includes("scanner_id_missing")) {
    return {
      kind: "refusal", failType: "server",
      message: "FlipStart couldn't verify your scan balance. Please make sure you're signed in and running the latest version, then try again.",
    };
  }
  if (has(s, "global_scan_limit_reached", "scan limit")) {
    return { kind: "refusal", failType: "scan_limit", message: "" };
  }
  if (has(s, "please sign in", "out of scans", "available with flipstart pro", "please update flipstart")) {
    return { kind: "refusal", failType: "server", message: safeMessage(text) };
  }
  if (has(s, "unsupported image", "image format", "heic", "image data is required")) {
    return { kind: "bad_input", failType: "bad_input", message: safeMessage(text) };
  }

  // ── Transient ─────────────────────────────────────────────────────────────
  if (has(s, "network request failed", "network error", "failed to fetch",
               "connection refused", "no internet", "offline")) {
    return { kind: "transient", failType: "offline", message: safeMessage(text) };
  }
  if (has(s, "timed out", "timeout")) {
    return { kind: "transient", failType: "timeout", message: "" };
  }
  // Server errors, "already being processed", "restarting", and anything
  // unknown: worth another try while time is left.
  return { kind: "transient", failType: "server", message: safeMessage(text) };
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

/** Copy for the "took too long" screen. Says "you weren't charged" only when the server confirmed it. */
export function tookTooLongMessage(cancelConfirmed: boolean): string {
  return cancelConfirmed
    ? "This scan took longer than 45 seconds, so FlipStart stopped it. You weren't charged."
    : "This scan took longer than 45 seconds, so FlipStart stopped it.";
}