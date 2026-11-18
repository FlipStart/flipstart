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
// Per board, viewer and page. Absorbs tab flipping and many people opening the
// screen at once. Cleared whenever something changes a board (an award, a
// report, a block), so a hunter always sees their own new XP straight away.
const cache = new Map<string, { at: number; view: LeaderboardView }>();
export function invalidateLeaderboardCache(): void { cache.clear(); }

export async function getLeaderboard(input: {
  board: Board; viewerId: string | null; after?: number; limit?: number; now?: number;
}): Promise<LeaderboardView | null> {
  const store = getLeaderboardStore();
  if (!store) return null;
  const after = Math.min(Math.max(0, int(input.after)), MAX_AFTER);
  const limit = Math.min(Math.max(1, int(input.limit) || PAGE_SIZE), 100);
  const viewerId = input.viewerId || null;
  const now = input.now ?? Date.now();

  const key = `${input.board}|${viewerId ?? "-"}|${after}|${limit}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.view;

  const raw = await store.page(input.board, viewerId, after, limit);
  if (!raw) return null;

  // Names or pictures that changed since they were last checked: look again,
  // in the background. The response never waits for moderation.
  const stale = [...(raw.rows ?? []), ...(raw.me ? [raw.me] : [])].filter(r => r?.stale).map(r => r.user_id);
  if (stale.length > 0) queueIdentityRefresh(Array.from(new Set(stale)));

  const view = toView(raw, viewerId, after);
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: now, view });
  return view;
}