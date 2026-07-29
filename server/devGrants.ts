/**
 * Dev scan grants.
 *
 * Threat model, stated plainly: `analyzeFast` is a publicProcedure and
 * `scannerId` is whatever the client sends. `__DEV__` only controls whether a
 * button is drawn — it is not a security boundary. Anyone can hit the API
 * directly. So the grant is enforced here, on the server, behind a secret that
 * is never compiled into the app.
 *
 * Defences, in order of what they stop:
 *
 *   secret lives in Railway only   -> cannot be extracted from the IPA/APK
 *   timing-safe comparison         -> cannot be discovered byte-by-byte
 *   failed-attempt lockout         -> cannot be brute-forced
 *   grants are time-boxed          -> a leaked grant expires on its own
 *   grants are in-memory           -> cleared by any restart or redeploy
 *   global backstop still applies  -> a stolen grant still cannot run up a bill
 *
 * Deliberately a SEPARATE secret from FOUNDER_DASHBOARD_SECRET. Compromising
 * the read-only dashboard should not also hand over write access to quotas.
 */
import crypto from "node:crypto";

/** Hard ceiling regardless of what the caller asks for. */
const MAX_GRANT = 500;
/** Grants expire. A forgotten override must not become permanent. */
const MAX_TTL_MS = 12 * 60 * 60 * 1000;   // 12 hours
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Lockout after repeated failures. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Grant {
  scannerId: string;
  limit: number;
  expiresAt: number;
  grantedAt: number;
}

const grants = new Map<string, Grant>();

let failedAttempts = 0;
let lockedUntil = 0;

/**
 * Constant-time secret comparison.
 *
 * A plain `===` on strings short-circuits at the first differing byte, which
 * leaks the secret one character at a time to anyone who can measure response
 * time. timingSafeEqual always reads both buffers fully.
 *
 * Lengths are hashed to equal-size digests first, because timingSafeEqual
 * throws on a length mismatch — and that throw would itself leak the length.
 */
function secretMatches(supplied: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export type GrantOutcome =
  | { ok: true; limit: number; expiresAt: number }
  | { ok: false; reason: "not_configured" | "locked_out" | "bad_secret" | "invalid_request" };

export function grantDevScans(params: {
  secret: string;
  scannerId: string;
  limit?: number;
  ttlMs?: number;
}): GrantOutcome {
  const expected = (process.env.DEV_SCAN_GRANT_SECRET ?? "").trim();

  // No secret configured = feature does not exist. Fail closed, and do NOT
  // treat an empty supplied secret as matching an empty expected one.
  if (!expected || expected.length < 16) {
    console.warn("[devGrant] rejected — DEV_SCAN_GRANT_SECRET unset or shorter than 16 chars");
    return { ok: false, reason: "not_configured" };
  }

  const now = Date.now();
  if (now < lockedUntil) {
    console.warn(`[devGrant] rejected — locked out for ${Math.ceil((lockedUntil - now) / 1000)}s`);
    return { ok: false, reason: "locked_out" };
  }

  const supplied = (params.secret ?? "").trim();
  const scannerId = (params.scannerId ?? "").trim();
  if (!supplied || !scannerId) return { ok: false, reason: "invalid_request" };

  if (!secretMatches(supplied, expected)) {
    failedAttempts++;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_MS;
      failedAttempts = 0;
      console.error(`[devGrant] LOCKED OUT — ${MAX_FAILED_ATTEMPTS} failed attempts, ${LOCKOUT_MS / 60000}min`);
    } else {
      console.warn(`[devGrant] bad secret — attempt ${failedAttempts}/${MAX_FAILED_ATTEMPTS}`);
    }
    return { ok: false, reason: "bad_secret" };
  }

  failedAttempts = 0;

  const limit = Math.min(
    Math.max(1, Math.floor(params.limit ?? 200)),
    MAX_GRANT,
  );
  const ttl = Math.min(Math.max(60_000, params.ttlMs ?? DEFAULT_TTL_MS), MAX_TTL_MS);
  const expiresAt = now + ttl;

  grants.set(scannerId, { scannerId, limit, expiresAt, grantedAt: now });
  console.log(
    `[devGrant] GRANTED — ${scannerId.slice(0, 12)}… limit ${limit}, expires in ${Math.round(ttl / 60000)}min`,
  );
  return { ok: true, limit, expiresAt };
}

/** Active grant for this id, or null. Expired entries are cleaned on read. */
export function activeGrantFor(scannerId?: string): Grant | null {
  const id = (scannerId ?? "").trim();
  if (!id) return null;
  const g = grants.get(id);
  if (!g) return null;
  if (Date.now() >= g.expiresAt) {
    grants.delete(id);
    console.log(`[devGrant] expired — ${id.slice(0, 12)}…`);
    return null;
  }
  return g;
}

/** Revoke immediately. Used by the client's "revoke" button. */
export function revokeDevGrant(secret: string, scannerId: string): boolean {
  const expected = (process.env.DEV_SCAN_GRANT_SECRET ?? "").trim();
  if (!expected || expected.length < 16) return false;
  if (!secretMatches((secret ?? "").trim(), expected)) return false;
  const had = grants.delete((scannerId ?? "").trim());
  if (had) console.log(`[devGrant] revoked — ${scannerId.slice(0, 12)}…`);
  return had;
}

/** Status for the dev screen. Returns nothing sensitive. */
export function devGrantStatus(scannerId?: string): {
  active: boolean; limit: number | null; expiresAt: number | null; configured: boolean;
} {
  const configured = ((process.env.DEV_SCAN_GRANT_SECRET ?? "").trim().length >= 16);
  const g = activeGrantFor(scannerId);
  return {
    active: Boolean(g),
    limit: g?.limit ?? null,
    expiresAt: g?.expiresAt ?? null,
    configured,
  };
}