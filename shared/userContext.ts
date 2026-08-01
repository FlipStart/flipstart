/**
 * shared/userContext.ts
 *
 * Normalization, validation and hashing for camera-confirmed user context.
 *
 * Lives in shared/ because the client and server MUST agree byte-for-byte. If
 * they normalize differently, the client's cache key and the server's diverge
 * and the same photos plus the same note can reuse a stale analysis.
 *
 * The server never trusts the client's normalization — it re-runs this on
 * arrival. A modified client cannot bypass the length cap or smuggle control
 * characters through.
 */

/** Hard ceiling. The client also sets maxLength, but this is the real limit. */
export const USER_CONTEXT_MAX_LEN = 200;

export type UserContextSource = "camera_confirmed";

export interface UserContextInput {
  user_context: string | null;
  source: UserContextSource;
  confirmed: boolean;
  /** SHA-256 of the normalized text. Used for cache keys and telemetry so raw
   *  text never has to be logged to distinguish two scans. */
  hash: string | null;
  char_count: number;
}

/**
 * Trim, collapse runs of whitespace, strip control characters, cap length.
 *
 * Deliberately preserves ordinary punctuation and capitalization — "Made in
 * USA" and "RN 56323" are meaningful as typed, and lowercasing or stripping
 * punctuation would damage exactly the details this feature exists to capture.
 */
export function normalizeUserContext(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    // Control characters and zero-width joiners. Newlines become spaces rather
    // than being dropped, so "size XL\nnavy" does not become "size XLnavy".
    .replace(/[\r\n\t]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, USER_CONTEXT_MAX_LEN);
}

/** Whitespace-only, empty, or non-string all resolve to "no context". */
export function hasUsableContext(raw: unknown): boolean {
  return normalizeUserContext(raw).length > 0;
}

/**
 * Build the immutable metadata block stored on the analysis.
 *
 * `confirmed` is not taken on trust from the client: context only reaches the
 * server when the user pressed Confirm, so anything that arrives here and
 * normalizes to non-empty is treated as confirmed. An unconfirmed draft is
 * simply never sent.
 */
export function buildUserContextInput(
  raw: unknown,
  /** Injected by the server, which owns hashing. Null on the client. */
  hash: string | null = null,
): UserContextInput {
  const text = normalizeUserContext(raw);
  if (!text) {
    return {
      user_context: null,
      source: "camera_confirmed",
      confirmed: false,
      hash: null,
      char_count: 0,
    };
  }
  return {
    user_context: text,
    source: "camera_confirmed",
    confirmed: true,
    hash,
    char_count: text.length,
  };
}

/**
 * The runtime block appended AFTER the static prompt.
 *
 * JSON rather than prose for two reasons: it escapes the value so a note
 * containing quotes or braces cannot break out of its slot, and it visually
 * marks the text as DATA rather than instruction, which is the first line of
 * defence against prompt injection. The second line is the prompt itself,
 * which tells the model to ignore commands found in here.
 *
 * Returns "" when there is no context, so the runtime block stays byte-
 * identical for context-free scans and those scans keep their cache hit.
 */
export function renderUserContextBlock(ctx: UserContextInput): string {
  if (!ctx.user_context) return "";
  return (
    "\nUSER_PROVIDED_CONTEXT:\n" +
    JSON.stringify(
      { present: true, source: ctx.source, text: ctx.user_context },
      null,
      2,
    ) +
    "\n"
  );
}

/** Telemetry-safe summary. Never contains the text itself. */
export function contextTelemetry(ctx: UserContextInput): Record<string, unknown> {
  return {
    context_present: ctx.confirmed,
    context_chars: ctx.char_count,
    context_hash: ctx.hash,
  };
}