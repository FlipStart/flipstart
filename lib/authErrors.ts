/**
 * lib/authErrors.ts
 *
 * One place that turns an internal auth failure into something a person should
 * read.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A production user saw this inside the login form:
 *
 *   "Sign-In failed: PKCE code verifier not found in storage. This can happen if
 *    the auth flow was initiated in a different browser or device... For SSR
 *    frameworks (Next.js, SvelteKit, etc.), use @supabase/ssr..."
 *
 * That came from `setGoogleError(\`Sign-In failed: ${error.message}\`)`. Any
 * interpolation of a provider message into UI text will eventually print
 * something like that, so the fix is to make raw messages structurally unable to
 * reach a screen: components render `userMessage`, never `error.message`.
 *
 * The technical detail is not discarded — it goes to a dev-only log with tokens
 * stripped.
 */

export type AuthErrorKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "oauth_cancelled"
  | "oauth_failed"
  | "pkce_failed"
  | "session_expired"
  | "network"
  | "rate_limited"
  | "server_unavailable"
  | "account_exists"
  | "weak_password"
  | "unknown";

export interface SanitizedAuthError {
  kind: AuthErrorKind;
  /** Safe to render. Contains no provider names, no internals, no tokens. */
  userMessage: string;
  /** True when a retry is plausibly useful, so callers can offer one. */
  retryable: boolean;
}

/** Copy in FlipStart's voice: plain, specific about what to do, never technical. */
const MESSAGES: Record<AuthErrorKind, { msg: string; retry: boolean }> = {
  invalid_credentials: { msg: "That email or password doesn't look right. Please try again.", retry: true },
  email_not_confirmed: { msg: "Please confirm your email first — check your inbox for the link.", retry: false },
  // Cancellation is not a failure. Callers should usually show nothing at all.
  oauth_cancelled:     { msg: "Sign-in was cancelled.", retry: true },
  oauth_failed:        { msg: "Google sign-in couldn't be completed. Please try again.", retry: true },
  // The user does not need to know what PKCE is. They need to know to retry.
  pkce_failed:         { msg: "Sign-in couldn't be completed. Please try again.", retry: true },
  session_expired:     { msg: "Your session expired. Please sign in again.", retry: false },
  network:             { msg: "We couldn't connect. Check your internet and try again.", retry: true },
  rate_limited:        { msg: "Too many attempts. Please wait a moment and try again.", retry: true },
  server_unavailable:  { msg: "FlipStart is having trouble right now. Please try again shortly.", retry: true },
  account_exists:      { msg: "An account already exists for that email. Try signing in instead.", retry: false },
  weak_password:       { msg: "Please choose a longer password — at least 8 characters.", retry: false },
  unknown:             { msg: "Something went wrong while signing in. Please try again.", retry: true },
};

/**
 * Classify by matching internal signatures. Deliberately conservative: anything
 * unrecognised becomes `unknown` with a generic message, so a new Supabase error
 * string added in a future release cannot leak by default.
 */
function classify(raw: string, status?: number): AuthErrorKind {
  const s = raw.toLowerCase();

  if (/code verifier|pkce/.test(s)) return "pkce_failed";
  if (/invalid login credentials|invalid email or password|invalid credentials/.test(s)) return "invalid_credentials";
  if (/email not confirmed|confirm your email/.test(s)) return "email_not_confirmed";
  if (/cancel|dismiss|user_cancelled|aborted/.test(s)) return "oauth_cancelled";
  if (/refresh token|jwt expired|session.*(expired|not found)|invalid.*token/.test(s)) return "session_expired";
  if (/network|fetch failed|timeout|timed out|offline|econnreset|enotfound|unable to resolve/.test(s)) return "network";
  if (/rate limit|too many requests/.test(s) || status === 429) return "rate_limited";
  if (/already registered|already exists|user_already_exists/.test(s)) return "account_exists";
  if (/password.*(short|weak|least)/.test(s)) return "weak_password";
  if (/oauth|provider|id ?token|identity/.test(s)) return "oauth_failed";
  if (status != null && status >= 500) return "server_unavailable";
  return "unknown";
}

/** Strip anything token-shaped before a message reaches a log. */
function redact(raw: string): string {
  return raw
    // JWTs
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]")
    // long opaque strings: codes, verifiers, refresh tokens
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .slice(0, 300);
}

/**
 * The only function auth UI should call.
 *
 * Accepts anything — a Supabase AuthError, an Error, a string, null — because
 * call sites catch from several layers and should never have to narrow a type
 * before they can show a message.
 */
export function sanitizeAuthError(err: unknown): SanitizedAuthError {
  const raw =
    typeof err === "string" ? err
    : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message)
    : "";
  const status =
    err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;

  const kind = classify(raw, status);
  const { msg, retry } = MESSAGES[kind];

  // Dev-only, redacted. Production keeps the classification but not the text, so
  // a crash reporter never carries a token.
  if (__DEV__) {
    console.warn(`[auth] ${kind}${status ? ` (${status})` : ""}: ${redact(raw)}`);
  } else {
    console.warn(`[auth] ${kind}`);
  }

  return { kind, userMessage: msg, retryable: retry };
}

/** Cancellation is a normal outcome, not an error worth showing. */
export function isCancellation(err: unknown): boolean {
  return sanitizeAuthError(err).kind === "oauth_cancelled";
}