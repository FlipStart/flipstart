/**
 * lib/appVersion.ts
 *
 * Version parsing and comparison for the force-update gate.
 *
 * Kept separate from the gate itself, and free of any import that touches
 * React Native or the network, so the comparison can be unit-tested directly.
 * That matters more here than usual: this function decides whether to lock a
 * user out of the app.
 *
 * ── Why not a string compare ────────────────────────────────────────────────
 * "2.10" < "2.9" is true for strings and false for versions. Segments are
 * compared as INTEGERS, left to right.
 *
 * ── Why not semver ──────────────────────────────────────────────────────────
 * app.config.ts ships `version: "2.1"` — two segments, not three. A strict
 * semver parser rejects it. Missing segments are treated as zero, so "2.1" and
 * "2.1.0" are equal, and "2.1" is below "2.1.1".
 */

/** A version we were able to make sense of. `null` means "do not decide". */
export type ParsedVersion = number[] | null;

/**
 * Parse a dotted numeric version.
 *
 * Returns null for anything that is not purely digits and dots — a build
 * string like "2.1-beta" or an empty value. Null is not an error to shout
 * about; it is the signal to fail open.
 */
export function parseVersion(raw: string | null | undefined): ParsedVersion {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)*$/.test(trimmed)) return null;
  const parts = trimmed.split(".").map(n => Number.parseInt(n, 10));
  if (parts.some(n => !Number.isFinite(n))) return null;
  return parts;
}

/**
 * -1 if a < b, 0 if equal, 1 if a > b. Shorter versions are zero-padded, so
 * "2.1" === "2.1.0".
 */
export function compareVersions(a: number[], b: number[]): -1 | 0 | 1 {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Is `installed` below `minimum`, and are we sure enough to act on it?
 *
 * FAILS OPEN. Either version being unparseable returns false — "we could not
 * tell, so let them in". Every caller depends on that: the alternative is
 * locking out an entire install base because a version string had a suffix
 * nobody anticipated.
 */
export function isBelowMinimum(installed: string | null | undefined,
                               minimum: string | null | undefined): boolean {
  const a = parseVersion(installed);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  return compareVersions(a, b) < 0;
}