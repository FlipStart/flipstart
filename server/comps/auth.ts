/**
 * server/comps/auth.ts
 *
 * Founder gate for the Phase 0 comps endpoint.
 *
 * Separate secret from FOUNDER_DASHBOARD_SECRET and DEV_SCAN_GRANT_SECRET:
 * compromising a read-only dashboard should not also hand over the ability to
 * burn a paid API quota.
 *
 * Timing-safe because a plain === short-circuits at the first differing byte,
 * which leaks the secret one character at a time to anyone who can measure
 * response time.
 */
import crypto from "node:crypto";

export function compsFounderAuthorised(supplied: string): boolean {
  const expected = (process.env.COMPS_FOUNDER_SECRET ?? "").trim();
  // Fail closed. An unset or weak secret means the endpoint does not exist.
  if (expected.length < 16) return false;
  const a = crypto.createHash("sha256").update((supplied ?? "").trim()).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}