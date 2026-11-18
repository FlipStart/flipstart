/**
 * server/leaderboard/view.ts
 *
 * One page of one board, as the app receives it.
 *
 * Postgres does the ranking (leaderboard_page). This turns its rows into the
 * public shape and nothing more:
 *
 *   position · id (a public handle) · name · avatarUrl · rankTitle · metric ·
 *   isMe · foundingHunter
 *
 * ── What never leaves the server ────────────────────────────────────────────
 * Real account ids, emails, the owner's own picture link, Hunt names, items,
 * locations. The database rows DO carry the account id (the server needs it to
 * refresh names and pictures), so every row is rebuilt field by field here
 * rather than passed through. A new column in the SQL cannot leak by accident.
 */
import { getCurrentRank, rankIndexFor } from "../../shared/hunt/ranks";
import { queueIdentityRefresh } from "./identity.js";
import { getLeaderboardStore, type Board, type RawPage, type RawRow } from "./store.js";
import { allowFor } from "../rateLimit.js";

export const PAGE_SIZE = 50;
export const MAX_AFTER = 5_000;           // how deep a board can be browsed
export const CACHE_MS = 30_000;
export const FALLBACK_NAME = "Hunter";

export interface PublicRow {
  position:       number;
  /** A public handle for reports and blocks. Not the account id. */
  id:             string;
  name:           string;
  avatarUrl:      string | null;         // null = show the default picture
  rankTitle:      string;                // Hunt Mode level, from lifetime XP
  rankNumber:     number;                // 1-23
  metric:         number;
  isMe:           boolean;
  foundingHunter: boolean;
}

export interface LeaderboardView {
  board:        Board;
  /** Server time, the week this board is showing, and when the weekly board resets. */
  now:          string;
  weekStart:    string;
  weekEndsAt:   string;
  rankedCount:  number;
  rows:         PublicRow[];
  hasMore:      boolean;
  /** The viewer's own place. null when signed out or not ranked on this board. */
  me:           (PublicRow & { xpToPass: number | null }) | null;
}

const int = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; };

/** Field by field. Nothing from the database row is copied wholesale. */
export function toPublicRow(r: RawRow, viewerId: string | null): PublicRow {
  const totalXp = Math.max(0, int(r.total_xp));
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : FALLBACK_NAME;
  const avatar = typeof r.avatar === "string" && /^https:\/\//.test(r.avatar) ? r.avatar : null;
  return {
    position:       int(r.pos),
    id:             String(r.public_id),
    name,
    avatarUrl:      avatar,
    rankTitle:      getCurrentRank(totalXp).rank,
    rankNumber:     rankIndexFor(totalXp) + 1,
    metric:         Math.max(0, int(r.metric)),
    isMe:           !!viewerId && r.user_id === viewerId,
    foundingHunter: r.founding === true,
  };
}

export function toView(raw: RawPage, viewerId: string | null, after: number): LeaderboardView {
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).map(r => toPublicRow(r, viewerId));
  const rankedCount = int(raw.ranked);
  let me: LeaderboardView["me"] = null;
  if (viewerId && raw.me && raw.me.user_id === viewerId) {
    const mine = toPublicRow(raw.me, viewerId);
    const above = raw.above_metric == null ? null : int(raw.above_metric);
    // Equal XP is not enough to pass: ties go to whoever got there first.
    me = { ...mine, xpToPass: above == null ? null : Math.max(1, above - mine.metric + 1) };
  }
  return {
    board: raw.board,
    now: String(raw.now),
    weekStart: String(raw.week_start).slice(0, 10),
    weekEndsAt: String(raw.week_ends_at),
    rankedCount,
    rows,
    hasMore: after + rows.length < rankedCount && after + rows.length < MAX_AFTER,
    me,
  };
}

// ─── A short cache ────────────────────────────────────────────────────────────
// Per viewer, board and page, for 30 seconds. It absorbs tab flipping and many
// people opening the screen at once.
//
//   - A hunter's own pages are dropped the moment they earn XP, block someone or
//     change their name, so they always see their own change straight away.
//     Everyone else sees it within 30 seconds. (Clearing every viewer's pages on
//     every award would leave nothing cached once Hunts finish every few seconds.)
//   - Identical requests arriving together share one database call.
//   - The size is bounded: the oldest pages go first.
//   - At most a few ranking queries run at once, so a burst of viewers (Monday's
//     reset, a notification) queues briefly instead of flooding the database.
//   - Signed-out viewers all share the same pages. Their page one is always
//     served; their deeper pages share one allowance of database reads.
const cache = new Map<string, { at: number; view: LeaderboardView }>();
const inflight = new Map<string, Promise<LeaderboardView | null>>();
export const MAX_CACHED_PAGES = 4000;
export const MAX_RUNNING_QUERIES = 6;
export const MAX_WAITING_QUERIES = 300;

// Bumped by every invalidation, so an answer that was already on its way when
// something changed is used once but never saved.
let allGen = 0;
const viewerGen = new Map<string, number>();
const keyOf = (viewerId: string | null, board: Board, after: number) => `${viewerId ?? "-"}|${board}|${after}`;
const genOf = (viewerId: string | null) => `${allGen}:${viewerGen.get(viewerId ?? "-") ?? 0}`;

/**
 * Forget saved pages.
 *   invalidateLeaderboardCache()        everyone's (a founder action, a hidden name or picture)
 *   invalidateLeaderboardCache(userId)  only that viewer's (their own XP, block list, name)
 */
export function invalidateLeaderboardCache(viewerId?: string): void {
  if (viewerId === undefined) {
    allGen += 1;
    viewerGen.clear();
    cache.clear();
    return;
  }
  if (!viewerId) return;
  if (viewerGen.size > 10_000) { allGen += 1; viewerGen.clear(); }
  viewerGen.set(viewerId, (viewerGen.get(viewerId) ?? 0) + 1);
  const prefix = `${viewerId}|`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

function remember(key: string, at: number, view: LeaderboardView): void {
  cache.delete(key);                                   // re-insert: newest last
  cache.set(key, { at, view });
  if (cache.size > MAX_CACHED_PAGES) {
    let drop = Math.ceil(MAX_CACHED_PAGES / 10);
    for (const k of cache.keys()) { if (drop-- <= 0) break; cache.delete(k); }
  }
}

// A small gate in front of the ranking query. A query that finishes hands its
// place straight to the next one waiting, so no more than the limit ever run.
//
// Every request has 8 seconds from arriving here to an answer (the app itself
// gives up at 10). Two things follow:
//   - A query that has not answered by then gives its place up (the app keeps
//     its last board and offers Retry), so a stuck database cannot jam the gate.
//   - Nobody waits in line for more than 5 of those seconds. When more people
//     arrive than the database can serve, the ones who have waited longest are
//     let go instead of being served after their app has stopped listening,
//     which would leave the server busy answering nobody.
export const QUERY_TIMEOUT_MS = 8_000;
export const MAX_WAIT_MS = 5_000;
interface Waiter { go: (granted: boolean) => void; timer: ReturnType<typeof setTimeout> | undefined }
let running = 0;
const waiting: Waiter[] = [];
async function throughGate<T>(fn: () => Promise<T>): Promise<T | null> {
  const arrived = Date.now();
  if (running >= MAX_RUNNING_QUERIES) {
    if (waiting.length >= MAX_WAITING_QUERIES) return null;      // overloaded
    const granted = await new Promise<boolean>(resolve => {
      const w: Waiter = { go: resolve, timer: undefined };
      // Step out of the line, so a place that frees up later goes to someone still waiting.
      w.timer = setTimeout(() => {
        const i = waiting.indexOf(w);
        if (i !== -1) waiting.splice(i, 1);
        resolve(false);
      }, MAX_WAIT_MS);
      waiting.push(w);
    });
    if (!granted) return null;                                   // waited too long; never held a place
    // Granted: resumes already holding the place of the query that just finished.
  } else {
    running += 1;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const left = QUERY_TIMEOUT_MS - (Date.now() - arrived);      // at least 3 seconds: nobody waits longer than 5
    return await Promise.race([
      fn(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), left); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.go(true); } else running -= 1;
  }
}

/** True once the week this view was built for is over. */
export function weekHasEnded(view: Pick<LeaderboardView, "weekEndsAt">, now: number): boolean {
  const ends = Date.parse(view.weekEndsAt);
  return Number.isFinite(ends) && ends <= now;
}

export async function getLeaderboard(input: {
  board: Board; viewerId: string | null; after?: number; limit?: number; now?: number;
}): Promise<LeaderboardView | null> {
  const store = getLeaderboardStore();
  if (!store) return null;
  const after = Math.min(Math.max(0, int(input.after)), MAX_AFTER);
  // One page size, whatever is asked for: it keeps the number of different
  // requests (and so of cached pages and database calls) small.
  const limit = PAGE_SIZE;
  const viewerId = input.viewerId || null;
  const now = input.now ?? Date.now();

  const key = keyOf(viewerId, input.board, after);
  const hit = cache.get(key);
  // A copy from a week that has since ended is never served: the first request
  // after Monday 00:00 Pacific must see the new week, not the last 30 seconds
  // of the old one.
  if (hit && now - hit.at < CACHE_MS && !weekHasEnded(hit.view, now)) return hit.view;

  const already = inflight.get(key);
  if (already) return already;

  const gen = genOf(viewerId);
  const job = (async (): Promise<LeaderboardView | null> => {
    // Signed-out viewers. Page one of each board is what everyone opens: it is
    // saved for 30 seconds and shared, so it costs the database a read or two a
    // minute however many people are looking, and it is always served. Deeper
    // pages share one allowance, so a script walking the boards signed out can
    // neither crowd the database nor use up the allowance and blank page one.
    if (!viewerId && after > 0 && !allowFor("leaderboardViewGuest", "all", now)) return null;
    const raw = await throughGate(() => store.page(input.board, viewerId, after, limit));
    if (!raw) return null;

    // Names or pictures that changed since they were last checked: look again,
    // in the background. The response never waits for moderation.
    const stale = [...(raw.rows ?? []), ...(raw.me ? [raw.me] : [])].filter(r => r?.stale).map(r => r.user_id);
    if (stale.length > 0) queueIdentityRefresh(Array.from(new Set(stale)));

    const view = toView(raw, viewerId, after);
    if (genOf(viewerId) === gen) remember(key, now, view);
    return view;
  })();
  inflight.set(key, job);
  try { return await job; }
  finally { if (inflight.get(key) === job) inflight.delete(key); }
}

/** Tests only. */
export function __leaderboardCacheStatsForTests() {
  return { cached: cache.size, inflight: inflight.size, running, waiting: waiting.length };
}
/** Tests only: forget everything, including queries a test left hanging. */
export function __resetLeaderboardCacheForTests(): void {
  cache.clear(); inflight.clear(); viewerGen.clear(); allGen += 1;
  for (const w of waiting) clearTimeout(w.timer);
  running = 0; waiting.length = 0;
}