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
export async function resolveSupabaseUserId(
  req: { headers?: Record<string, unknown> } | undefined | null,
): Promise<string | null> {
  const token = bearer(req?.headers?.[SUPABASE_AUTH_HEADER]);
  if (!token) return null;
  if (!isSupabaseAdminConfigured()) {
    console.warn("[monetization] cannot verify identity — Supabase admin not configured");
    return null;
  }

  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.uid;

  try {
    const sb = getSupabaseAdmin();
    if (!sb) return null;
    // Supabase validates the signature and expiry. An expired or forged token
    // returns an error, so nothing unverified can reach the ledger.
    const { data, error } = await sb.auth.getUser(token);
    const uid = data?.user?.id ?? null;
    if (error || !uid) return null;

    if (cache.size > 500) cache.clear();
    cache.set(token, { uid, at: Date.now() });
    return uid;
  } catch (e) {
    console.warn("[monetization] identity verification failed:", (e as Error).message);
    return null;
  }
}

/** Test seam. */
export function __resetIdentityCache(): void { cache.clear(); }