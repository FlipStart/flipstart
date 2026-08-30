/**
 * server/monetization/identity.ts
 *
 * Resolves the CANONICAL, server-verified Supabase user id for a request.
 *
 * ── Why this file had to exist ──────────────────────────────────────────────
 * Monetization V1 cannot key on `input.scannerId`. That value is supplied by the
 * client: `lib/analytics.ts getScannerId()` returns the Supabase uid when signed
 * in, but falls back to an AsyncStorage `anon_...` string, and either way the
 * server never checks it. A modified client could post any string and spend — or
 * inspect — another account's ledger.
 *
 * `ctx.user` is not the answer either. It comes from `sdk.authenticateRequest`,
 * the Manus OAuth SDK, and yields a Drizzle row keyed on `openId`. That is a
 * different identity system from Supabase Auth entirely.
 *
 * So the request carries the Supabase access token in its OWN header and the
 * server verifies it against Supabase. Verification is what makes the resulting
 * uid trustworthy — a JWT the client hands us is only a claim until Supabase
 * confirms it.
 *
 * ── Why a separate header ───────────────────────────────────────────────────
 * `Authorization` already carries the Manus session token and existing
 * protectedProcedure/adminProcedure paths depend on it. Adding a second header
 * leaves all of that untouched, so this change cannot break current auth.
 */
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../supabaseAdmin.js";

/** Header the client uses for the Supabase access token. */
export const SUPABASE_AUTH_HEADER = "x-supabase-auth";

/**
 * Short verification cache.
 *
 * getUser() is a network call to Supabase, and a scan already takes ~18s of AI
 * time — but a duplicate verification per request would add latency for no
 * benefit. 60s is well inside an access token's lifetime, so a revoked session
 * cannot linger meaningfully, and the cache is keyed on the token itself so a
 * different user can never read another's entry.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { uid: string; at: number }>();

function bearer(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  return v.toLowerCase().startsWith("bearer ") ? v.slice(7).trim() : v;
}

/**
 * The authenticated Supabase user id, or null.
 *
 * Null means "not verified" and callers MUST treat it as unauthenticated. It
 * never falls back to a client-supplied value — that fallback is precisely the
 * hole this function closes.
 */
/**
 * ── DIAGNOSTIC INSTRUMENTATION (temporary, QA only) ─────────────────────────
 *
 * Added to find why muid is intermittently null in TestFlight. Every identity
 * resolution emits ONE line with a reason code and the route, so a Railway log
 * can be correlated against a reproduction step.
 *
 * NOTHING here changes auth semantics: the same inputs produce the same uid or
 * null as before. It only observes.
 *
 * The token is NEVER logged — not truncated, not hashed, not its length beyond
 * a coarse bucket. A JWT in a log aggregator is a credential in a log
 * aggregator. Only presence and a short bucket are recorded, which is enough to
 * distinguish "no header at all" from "header present but rejected" — the one
 * distinction the investigation actually needs.
 *
 * Remove this block once the cause is found.
 */
export type IdentityReason =
  | "IDENTITY_OK"
  | "IDENTITY_OK_CACHED"
  | "NO_X_SUPABASE_AUTH_HEADER"
  | "SUPABASE_ADMIN_UNCONFIGURED"
  | "TOKEN_GETUSER_FAILED"
  | "TOKEN_USER_MISSING"
  | "TOKEN_VERIFY_THREW";

/** Coarse size bucket. Distinguishes "empty/garbage" from "plausible JWT". */
function tokenShape(token: string | null): string {
  if (!token) return "none";
  const n = token.length;
  if (n < 40) return "short";
  if (n < 800) return "jwt-ish";
  return "long";
}

function logIdentity(route: string, reason: IdentityReason, token: string | null, extra = "") {
  console.log(
    `[identity] route=${route} reason=${reason} header=${token ? "present" : "absent"} ` +
    `shape=${tokenShape(token)}${extra ? ` ${extra}` : ""}`,
  );
}

export async function resolveSupabaseUserId(
  req: { headers?: Record<string, unknown> } | undefined | null,
  /** Route label, for log correlation only. Never affects the result. */
  route = "unknown",
): Promise<string | null> {
  const token = bearer(req?.headers?.[SUPABASE_AUTH_HEADER]);
  if (!token) {
    logIdentity(route, "NO_X_SUPABASE_AUTH_HEADER", null);
    return null;
  }
  if (!isSupabaseAdminConfigured()) {
    logIdentity(route, "SUPABASE_ADMIN_UNCONFIGURED", token);
    console.warn("[monetization] cannot verify identity — Supabase admin not configured");
    return null;
  }

  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    logIdentity(route, "IDENTITY_OK_CACHED", token);
    return hit.uid;
  }

  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      logIdentity(route, "SUPABASE_ADMIN_UNCONFIGURED", token);
      return null;
    }
    // Supabase validates the signature and expiry. An expired or forged token
    // returns an error, so nothing unverified can reach the ledger.
    const { data, error } = await sb.auth.getUser(token);
    const uid = data?.user?.id ?? null;

    if (error) {
      /**
       * Sanitized only. Supabase reports expiry as a distinct message, which is
       * exactly what separates "token expired" from "token rejected" — the two
       * hypotheses still open.
       */
      const code = (error as { status?: number; code?: string }).status
        ?? (error as { code?: string }).code ?? "?";
      const msg = String((error as Error).message ?? "").slice(0, 120);
      logIdentity(route, "TOKEN_GETUSER_FAILED", token, `status=${code} msg="${msg}"`);
      return null;
    }
    if (!uid) {
      logIdentity(route, "TOKEN_USER_MISSING", token);
      return null;
    }

    if (cache.size > 500) cache.clear();
    cache.set(token, { uid, at: Date.now() });
    // uid is a Supabase uuid, not a secret, and the first 8 chars are enough to
    // confirm it is the SAME account across requests.
    logIdentity(route, "IDENTITY_OK", token, `uid=${uid.slice(0, 8)}…`);
    return uid;
  } catch (e) {
    const msg = String((e as Error).message ?? "").slice(0, 120);
    logIdentity(route, "TOKEN_VERIFY_THREW", token, `msg="${msg}"`);
    console.warn("[monetization] identity verification failed:", msg);
    return null;
  }
}

/** Test seam. */
export function __resetIdentityCache(): void { cache.clear(); }