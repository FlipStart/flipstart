/**
 * server/rateLimit.ts
 *
 * Small in-memory limits for the Hunt and leaderboard endpoints.
 *
 * They exist to stop one account (or one script) turning a cheap request into
 * a stream of database, storage or moderation calls. They are deliberately far
 * above anything the app itself does, so a real user never meets one.
 *
 * In memory, per server process: enough for one Railway instance, and with
 * several instances each simply allows its own share. Nothing here is a
 * security boundary. Who may do what is decided by the database.
 */

interface Window { start: number; count: number }
const windows = new Map<string, Window>();
const MAX_KEYS = 20_000;

/**
 * True when `key` may go ahead: at most `max` times per `windowMs`.
 * Fixed windows: simple, and the worst case (twice the limit across a window
 * edge) is harmless for what this protects.
 */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (!key || max <= 0) return false;
  let w = windows.get(key);
  if (!w || now - w.start >= windowMs || now < w.start) {
    if (windows.size >= MAX_KEYS) prune(now);
    w = { start: now, count: 0 };
    windows.set(key, w);
  }
  if (w.count >= max) return false;
  w.count += 1;
  return true;
}

/** Drop the oldest half when the table is full. Old windows have expired anyway. */
function prune(now: number): void {
  const cutoff = [...windows.values()].map(w => w.start).sort((a, b) => a - b)[Math.floor(windows.size / 2)] ?? now;
  for (const [k, w] of windows) if (w.start <= cutoff) windows.delete(k);
}

/** The limits in one place. `max` per `windowMs`, per account unless it says otherwise. */
export const LIMITS = {
  /** Board pages for a signed-in viewer. The app asks a handful of times per visit. */
  leaderboardView:      { max: 120, windowMs: 60_000 },
  /** Pages past the first that the database has to work out for signed-out viewers, all of them together. */
  leaderboardViewGuest: { max: 600, windowMs: 60_000 },
  /** Name-and-picture checks: each can cost a moderation call, an image re-encode and an upload. */
  identitySync:         { max: 6,   windowMs: 5 * 60_000 },
  report:               { max: 30,  windowMs: 60_000 },
  block:                { max: 60,  windowMs: 60_000 },
  /** The unblock list and the app's own XP profile: plain reads the app makes a few times a visit. */
  blockedList:          { max: 60,  windowMs: 60_000 },
  huntProfile:          { max: 120, windowMs: 60_000 },
  /** Finishing Hunts. The offline queue can send up to 20 in one go. */
  huntComplete:         { max: 60,  windowMs: 60_000 },
} as const;

export function allowFor(what: keyof typeof LIMITS, who: string, now = Date.now()): boolean {
  const l = LIMITS[what];
  return allow(`${what}:${who}`, l.max, l.windowMs, now);
}

/** Tests only. */
export function __resetRateLimitsForTests(): void { windows.clear(); }
export function __rateLimitKeysForTests(): number { return windows.size; }