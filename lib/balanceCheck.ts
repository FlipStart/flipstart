/**
 * lib/balanceCheck.ts
 *
 * What to tell the user when tapping Scan can't check their scan balance
 * (Phase 7 of the scan-failure plan). Before, the button did nothing at all:
 * no camera, no message. Now it says exactly why, and what to do.
 *
 * Pure: the caller passes what the entitlement refresh returned (or threw),
 * and — only for a network failure — whether the internet itself is up.
 */

export type BalanceProblem =
  | "offline"            // the phone has no internet
  | "server_down"        // internet works, FlipStart's server doesn't answer
  | "server_error"       // the server answered with an error
  | "signed_out"         // the server doesn't recognise the sign-in
  | "balance_unreadable" // the server is up, but couldn't read the account's scans
  | "incomplete";        // an answer without a plan or a scan count

export interface BalanceMessage {
  problem: BalanceProblem;
  title: string;
  message: string;
  /** The main button: try the scan again, or sign in. */
  action: "retry" | "sign_in";
}

const NETWORK_WORDS = /network request failed|failed to fetch|load failed|network error|timed? ?out|aborted|offline|internet connection/i;

/** A failure that never got an HTTP answer: no connection, or nothing listening. */
export function isNetworkFailure(err: unknown): boolean {
  if (!err) return false;
  const e = err as { message?: unknown; data?: { httpStatus?: unknown } };
  const status = typeof e?.data?.httpStatus === "number" ? e.data.httpStatus : null;
  if (status !== null && status > 0) return false;
  return NETWORK_WORDS.test(String(e?.message ?? err));
}

function httpStatusOf(err: unknown): number | null {
  const s = (err as { data?: { httpStatus?: unknown } } | null)?.data?.httpStatus;
  return typeof s === "number" ? s : null;
}

/**
 * Null when nothing is wrong (a usable answer came back).
 * `online` matters only for a network failure: "offline" vs our server down.
 */
export function explainBalanceFailure(i: {
  result?: { data?: any; error?: unknown } | null;
  thrown?: unknown;
  online?: "online" | "offline" | null;
}): BalanceMessage | null {
  const err = i.thrown ?? i.result?.error ?? null;

  if (err) {
    if (isNetworkFailure(err)) {
      if (i.online === "online") return SERVER_DOWN;
      return OFFLINE;
    }
    const status = httpStatusOf(err);
    if (status === 401) return SIGNED_OUT;
    const text = String((err as any)?.message ?? err);
    if ((status !== null && status >= 500) || /<html|<!doctype|bad gateway|service unavailable/i.test(text)) return SERVER_DOWN;
    return {
      ...SERVER_ERROR,
      message: `${SERVER_ERROR.message} (${text.replace(/\s+/g, " ").slice(0, 80)})`,
    };
  }

  const data = i.result?.data;
  if (data?.ok === false) {
    if (data.reason === "NOT_AUTHENTICATED") return SIGNED_OUT;
    if (data.reason === "USAGE_UNAVAILABLE") return BALANCE_UNREADABLE;
    return BALANCE_UNREADABLE;
  }
  const e = data?.entitlement;
  const planOk = e?.plan === "free" || e?.plan === "monthly" || e?.plan === "annual";
  const total = e?.balances?.totalUsableScans ?? e?.totalUsableScans;
  if (!planOk || typeof total !== "number" || !Number.isFinite(total)) return INCOMPLETE;
  return null;
}

const OFFLINE: BalanceMessage = {
  problem: "offline", action: "retry",
  title: "You're offline",
  message: "FlipStart needs the internet to check your scans before opening the camera. Thrift stores are often dead zones — try near the entrance or a window, then tap Try again.",
};
const SERVER_DOWN: BalanceMessage = {
  problem: "server_down", action: "retry",
  title: "FlipStart's servers aren't responding",
  message: "Your internet is working, but our server (hosted on Railway) didn't answer, so we couldn't check your scans. It's on our end. Nothing was used — try again in a minute.",
};
const SERVER_ERROR: BalanceMessage = {
  problem: "server_error", action: "retry",
  title: "We couldn't check your scans",
  message: "FlipStart's server answered with an error when we asked for your scan balance. Nothing was used — try again in a minute.",
};
const SIGNED_OUT: BalanceMessage = {
  problem: "signed_out", action: "sign_in",
  title: "Please sign in again",
  message: "Your sign-in has expired, so FlipStart can't see your scans. Sign in again to keep scanning — your scans and history are kept.",
};
const BALANCE_UNREADABLE: BalanceMessage = {
  problem: "balance_unreadable", action: "retry",
  title: "Your scan balance couldn't be read",
  message: "Our server is up, but it couldn't read your account's scans just now. Nothing was used — try again in a minute.",
};
const INCOMPLETE: BalanceMessage = {
  problem: "incomplete", action: "retry",
  title: "Your scan balance came back incomplete",
  message: "Our server answered without your plan or scan count, so we can't tell whether you have scans left. Nothing was used — try again in a minute.",
};