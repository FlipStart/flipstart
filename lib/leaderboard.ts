/**
 * lib/leaderboard.ts
 *
 * The Hunt Leaderboard on the phone: fetching a board, keeping the last good
 * copy for when the network is gone, and every line of copy the screen shows.
 *
 * The server does all ranking (server/leaderboard/view.ts). Nothing here sorts
 * people or works out XP. A row carries a public handle, a moderated name and
 * picture, the Hunt level and the number, and nothing else.
 *
 * Everything below the transport section is pure, so the wording and the state
 * rules can be tested without a screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RANK_LADDER, rankIndexFor, getNextRank, getRankProgress } from '@shared/hunt/ranks';
import { QUALIFY_MIN_SCANS, QUALIFY_MIN_KEPT, QUALIFY_MIN_MINUTES } from '@shared/hunt/xpRules';

// ─── Shapes ───────────────────────────────────────────────────────────────────

export type Board = 'weekly' | 'all_time' | 'best_hunt';
export const BOARDS: Board[] = ['weekly', 'all_time', 'best_hunt'];
export const DEFAULT_BOARD: Board = 'weekly';
export const BOARD_TABS: Array<{ board: Board; label: string; a11y: string }> = [
  { board: 'weekly',    label: 'WEEKLY XP', a11y: 'Weekly XP'  },
  { board: 'all_time',  label: 'ALL-TIME',  a11y: 'All-Time'   },
  { board: 'best_hunt', label: 'BEST HUNT', a11y: 'Best Hunt'  },
];

export interface BoardRow {
  position:       number;
  /** Public handle for reports and blocks. Never an account id. */
  id:             string;
  name:           string;
  avatarUrl:      string | null;
  rankTitle:      string;
  rankNumber:     number;
  metric:         number;
  isMe:           boolean;
  foundingHunter: boolean;
}
export type MyRow = BoardRow & { xpToPass: number | null };

export interface BoardView {
  board:       Board;
  signedIn:    boolean;
  now:         string;
  weekStart:   string;
  weekEndsAt:  string;
  rankedCount: number;
  rows:        BoardRow[];
  hasMore:     boolean;
  me:          MyRow | null;
}

export type ReportReason = 'photo' | 'name' | 'cheating';
export const REPORT_REASONS: Array<{ reason: ReportReason; label: string }> = [
  { reason: 'photo',    label: 'Inappropriate photo' },
  { reason: 'name',     label: 'Inappropriate name'  },
  { reason: 'cheating', label: 'Suspected cheating'  },
];

export interface BlockedHunter { id: string; name: string; avatarUrl: string | null }

export const PAGE_SIZE = 50;
/** The board lists the top 100 only (the server enforces it). Your own place is always on the rank card. */
export const TOP_N = 100;
export const TOP_N_LINE = `Showing the top ${TOP_N} hunters.`;
/** Under this many ranked hunters the board says how many there are. */
export const SPARSE_BELOW = 10;
export const FETCH_TIMEOUT_MS = 10_000;

// ─── Reading what the server sent (and what was cached) ───────────────────────

const int = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; };
const isBoard = (v: unknown): v is Board => v === 'weekly' || v === 'all_time' || v === 'best_hunt';

function parseRow(r: any): BoardRow | null {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const position = int(r.position);
  if (position < 1) return null;
  const rankNumber = Math.min(RANK_LADDER.length, Math.max(1, int(r.rankNumber) || 1));
  return {
    position,
    id:             r.id,
    name:           typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Hunter',
    avatarUrl:      typeof r.avatarUrl === 'string' && /^https:\/\//.test(r.avatarUrl) ? r.avatarUrl : null,
    rankTitle:      typeof r.rankTitle === 'string' && r.rankTitle ? r.rankTitle : RANK_LADDER[rankNumber - 1].rank,
    rankNumber,
    metric:         Math.max(0, int(r.metric)),
    isMe:           r.isMe === true,
    foundingHunter: r.foundingHunter === true,
  };
}

/** A board from the server or the cache, or null when it is not one. Never throws. */
export function parseBoardView(res: any): BoardView | null {
  try {
    if (!res || typeof res !== 'object' || !isBoard(res.board) || !Array.isArray(res.rows)) return null;
    if (res.ok === false) return null;
    const rows = (res.rows as any[]).map(parseRow).filter((r): r is BoardRow => r !== null);
    const mine = parseRow(res.me);
    const toPass = res.me?.xpToPass;
    return {
      board:       res.board,
      signedIn:    res.signedIn === true,
      now:         String(res.now ?? ''),
      weekStart:   String(res.weekStart ?? ''),
      weekEndsAt:  String(res.weekEndsAt ?? ''),
      rankedCount: Math.max(int(res.rankedCount), rows.length),
      rows,
      hasMore:     res.hasMore === true,
      me:          mine ? { ...mine, isMe: true, xpToPass: toPass == null ? null : Math.max(1, int(toPass)) } : null,
    };
  } catch { return null; }
}

// ─── Transport ────────────────────────────────────────────────────────────────

export interface LeaderboardTransport {
  view(board: Board, after: number): Promise<any>;
  report(id: string, reason: ReportReason): Promise<any>;
  block(id: string, blocked: boolean): Promise<any>;
  blocked(): Promise<any>;
}
let transportOverride: LeaderboardTransport | null = null;
/** Tests only. */
export function __setLeaderboardTransportForTests(t: LeaderboardTransport | null): void { transportOverride = t; }

async function client() {
  const { createTRPCClient } = await import('@/lib/trpc');
  return createTRPCClient();
}
const defaultTransport: LeaderboardTransport = {
  view:    async (board, after) => (await client()).leaderboard.view.query({ board, after, limit: PAGE_SIZE }),
  report:  async (id, reason)   => (await client()).leaderboard.report.mutate({ id, reason }),
  block:   async (id, blocked)  => (await client()).leaderboard.block.mutate({ id, blocked }),
  blocked: async ()             => (await client()).leaderboard.blocked.query(),
};

async function withTimeout<T>(run: () => Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
    ]);
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}
const transport = () => transportOverride ?? defaultTransport;

/** One page of one board. null when it could not be fetched. Never throws. */
export async function fetchBoard(board: Board, after = 0, timeoutMs = FETCH_TIMEOUT_MS): Promise<BoardView | null> {
  const res = await withTimeout(() => transport().view(board, Math.max(0, after)), timeoutMs);
  const view = parseBoardView(res);
  return view && view.board === board ? view : null;
}

export type ActionOutcome = 'ok' | 'signed_out' | 'rate_limited' | 'failed';
function outcomeOf(res: any): ActionOutcome {
  if (res?.ok === true) return 'ok';
  if (res?.reason === 'NOT_AUTHENTICATED') return 'signed_out';
  if (res?.reason === 'RATE_LIMITED') return 'rate_limited';
  return 'failed';
}
export async function reportHunter(id: string, reason: ReportReason): Promise<ActionOutcome> {
  return outcomeOf(await withTimeout(() => transport().report(id, reason)));
}
export async function setHunterBlocked(id: string, blocked: boolean): Promise<ActionOutcome> {
  return outcomeOf(await withTimeout(() => transport().block(id, blocked)));
}
/** The accounts this user has blocked. null when it could not be fetched. */
export async function fetchBlockedHunters(): Promise<BlockedHunter[] | null> {
  const res: any = await withTimeout(() => transport().blocked());
  if (res?.ok !== true || !Array.isArray(res.users)) return null;
  return res.users
    .filter((u: any) => u && typeof u.id === 'string' && u.id)
    .map((u: any) => ({
      id: u.id,
      name: typeof u.name === 'string' && u.name.trim() ? u.name.trim() : 'Hunter',
      avatarUrl: typeof u.avatarUrl === 'string' && /^https:\/\//.test(u.avatarUrl) ? u.avatarUrl : null,
    }));
}

// ─── The last good copy ───────────────────────────────────────────────────────
// First page of each board, per account. Shown at once when the screen opens and
// kept on screen (with its time) when the network is gone. It holds only what
// the server already sent: public names, pictures and numbers.

const cacheKey = (uid: string | null | undefined, board: Board) =>
  `@flipstart/leaderboard:v1:${uid || 'guest'}:${board}`;

export interface CachedBoard { view: BoardView; savedAt: number }

/** A weekly board from a week that has ended is not worth showing. */
export function cacheStillUseful(c: CachedBoard, nowMs: number): boolean {
  if (c.view.board !== 'weekly') return true;
  const ends = Date.parse(c.view.weekEndsAt);
  return !Number.isFinite(ends) || ends > nowMs;
}

export async function readBoardCache(uid: string | null | undefined, board: Board, nowMs = Date.now()): Promise<CachedBoard | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(uid, board));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const view = parseBoardView(parsed?.view);
    const savedAt = Number(parsed?.savedAt);
    if (!view || view.board !== board || !Number.isFinite(savedAt)) return null;
    // Who is signed in decides what "me" means. A copy saved signed-out is never
    // shown as a signed-in board, or the other way round.
    if (view.signedIn !== Boolean(uid)) return null;
    const cached = { view, savedAt };
    return cacheStillUseful(cached, nowMs) ? cached : null;
  } catch { return null; }
}

export async function writeBoardCache(uid: string | null | undefined, view: BoardView, nowMs = Date.now()): Promise<void> {
  try {
    const firstPage: BoardView = { ...view, rows: view.rows.slice(0, PAGE_SIZE) };
    await AsyncStorage.setItem(cacheKey(uid, view.board), JSON.stringify({ view: firstPage, savedAt: nowMs }));
  } catch { /* the cache is a convenience */ }
}

/** After a block or unblock: the saved boards no longer match what this account should see. */
export async function clearBoardCaches(uid: string | null | undefined): Promise<void> {
  try { await AsyncStorage.multiRemove(BOARDS.map(b => cacheKey(uid, b))); } catch { /* ok */ }
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/** Add a later page. One row per hunter (the newest copy wins), in position order. */
export function mergeRows(existing: BoardRow[], incoming: BoardRow[]): BoardRow[] {
  const byId = new Map<string, BoardRow>();
  for (const r of existing) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r);
  return Array.from(byId.values()).sort((a, b) => a.position - b.position);
}

/**
 * A fresh first page arrived while a longer list is on screen (the viewer had
 * scrolled past #50, then the app refreshed). Keep the rows they already loaded
 * below the first page so the list does not collapse under them. A new week, or
 * a first load, simply takes the fresh page.
 */
export function refreshedView(current: BoardView | null, firstPage: BoardView): BoardView {
  if (!current || current.board !== firstPage.board || current.weekStart !== firstPage.weekStart) return firstPage;
  const n = firstPage.rows.length;
  if (current.rows.length <= n || !firstPage.hasMore) return firstPage;
  const fresh = new Set(firstPage.rows.map(r => r.id));
  const tail = current.rows.filter(r => r.position > n && r.position <= firstPage.rankedCount && !fresh.has(r.id));
  if (tail.length === 0) return firstPage;
  const rows = mergeRows(tail, firstPage.rows);
  return { ...firstPage, rows, hasMore: rows.length < firstPage.rankedCount };
}

/** #2, #1, #3, left to right. null is an open spot. */
export function podiumSlots(rows: BoardRow[]): [BoardRow | null, BoardRow | null, BoardRow | null] {
  const at = (p: number) => rows.find(r => r.position === p) ?? null;
  return [at(2), at(1), at(3)];
}
export const listRows = (rows: BoardRow[]): BoardRow[] => rows.filter(r => r.position > 3);

/**
 * Take a hunter off the board straight away (they were just blocked). Everyone
 * below moves up one, the same way the server will answer on the next fetch.
 */
export function withoutHunter(view: BoardView, id: string): BoardView {
  const gone = view.rows.find(r => r.id === id);
  if (!gone || gone.isMe) return view;
  const shift = <T extends BoardRow>(r: T): T => r.position > gone.position ? { ...r, position: r.position - 1 } : r;
  return {
    ...view,
    rankedCount: Math.max(0, view.rankedCount - 1),
    rows: view.rows.filter(r => r.id !== id).map(shift),
    me: view.me ? shift(view.me) : null,
  };
}

// ─── Words ────────────────────────────────────────────────────────────────────

export const formatXp = (n: number): string => `${Math.max(0, Math.round(n)).toLocaleString('en-US')} XP`;

export function ordinal(n: number): string {
  const v = Math.abs(Math.round(n)) % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][v % 10] ?? 'th');
  return `${Math.round(n)}${suffix}`;
}

/** Milliseconds until the weekly board resets, on the SERVER's clock. */
export function msUntilReset(view: Pick<BoardView, 'now' | 'weekEndsAt'>, fetchedAtMs: number, nowMs: number): number | null {
  const ends = Date.parse(view.weekEndsAt);
  const serverNow = Date.parse(view.now);
  if (!Number.isFinite(ends) || !Number.isFinite(serverNow)) return null;
  // Time passed is measured on the phone; the starting point is the server's.
  return ends - (serverNow + Math.max(0, nowMs - fetchedAtMs));
}

// ── The moment a week ends, with the screen open ─────────────────────────────
// The screen asks for the new week as soon as the countdown reaches zero. The
// answer can still be the old week (the phone's idea of the server clock is a
// touch fast, or the request crossed the boundary), so it asks again, a few
// times, spaced out, and then stops: it never loops.
export const ROLLOVER_RETRY_MS = 8_000;
export const ROLLOVER_MAX_TRIES = 5;

export interface RolloverState { weekEndsAt: string; tries: number; lastAt: number }

/**
 * Should the screen fetch the new week now? `state` is what was tried so far
 * (null = nothing yet). Returns the state to remember when the answer is yes.
 */
export function nextRolloverTry(
  state: RolloverState | null, weekEndsAt: string, msLeft: number | null, nowMs: number,
): RolloverState | null {
  if (msLeft == null || msLeft > 0 || !weekEndsAt) return null;
  if (!state || state.weekEndsAt !== weekEndsAt) return { weekEndsAt, tries: 1, lastAt: nowMs };
  if (state.tries >= ROLLOVER_MAX_TRIES) return null;
  if (nowMs - state.lastAt < ROLLOVER_RETRY_MS) return null;
  return { weekEndsAt, tries: state.tries + 1, lastAt: nowMs };
}

/**
 * When the countdown should next be looked at: every 30 seconds normally, and
 * exactly at the reset (plus a beat) when that comes sooner. After the reset,
 * while the old week is still on screen, at the retry pace.
 */
export function nextCountdownTickMs(msLeft: number | null): number {
  if (msLeft == null) return 30_000;
  if (msLeft <= 0) return ROLLOVER_RETRY_MS;
  return Math.min(30_000, msLeft + 1_000);
}

/** "Resets in 2d 14h". */
export function resetsInLabel(msLeft: number | null): string {
  if (msLeft == null) return 'Resets every Monday';
  if (msLeft <= 0) return 'New week starting';
  const mins = Math.floor(msLeft / 60_000);
  if (mins < 1) return 'Resets in under a minute';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return `Resets in ${d}d ${h}h`;
  if (h > 0) return `Resets in ${h}h ${m}m`;
  return `Resets in ${m}m`;
}

/** The line under the tabs. Only Weekly has a countdown. */
export function boardCaption(board: Board, msLeft: number | null): string {
  if (board === 'weekly') return resetsInLabel(msLeft);
  if (board === 'all_time') return 'Lifetime Hunt XP';
  return 'Most XP from a single Hunt';
}

/**
 * The line under the podium on a small board. null on a board of 10 or more.
 * `viewerRanked`: someone already on the board is not asked to join it.
 */
export function sparseLine(board: Board, rankedCount: number, viewerRanked: boolean): string | null {
  const n = Math.max(0, Math.floor(rankedCount));
  if (n >= SPARSE_BELOW) return null;
  const week = board === 'weekly' ? ' this week' : '';
  if (n === 0) {
    return board === 'best_hunt'
      ? 'Be the first hunter to set a Best Hunt.'
      : `Be the first hunter on the board${week}.`;
  }
  const who = n === 1 ? '1 hunter' : `${n} hunters`;
  const where = board === 'weekly' ? ' this week' : board === 'all_time' ? ' on the board' : ' with a Best Hunt';
  return viewerRanked ? `${who}${where}.` : `${who}${where}. Be the ${ordinal(n + 1)}.`;
}

/** Under the user's own number on their rank card. */
export function passLine(me: Pick<MyRow, 'position' | 'xpToPass'>): string {
  if (me.position <= 1) return "You're on top";
  const above = me.position - 1;
  if (me.xpToPass == null) return `You're #${me.position}`;
  const xp = formatXp(me.xpToPass);
  return me.position <= 3
    ? `You're #${me.position} · ${xp} to take #${above}`
    : `${xp} to pass #${above}`;
}

export interface UnrankedCopy { title: string; body: string; cta: string }
export function unrankedCopy(board: Board): UnrankedCopy {
  if (board === 'weekly') {
    return { title: 'NOT RANKED THIS WEEK', body: 'Earn Hunt XP this week to enter the leaderboard.', cta: 'Start Hunt' };
  }
  if (board === 'all_time') {
    return { title: 'UNRANKED', body: 'Complete your first real Hunt to enter the leaderboard.', cta: 'Start Hunt' };
  }
  return { title: 'NO QUALIFYING HUNT YET', body: BEST_HUNT_RULE, cta: 'Start Hunt' };
}
/**
 * What makes a Hunt count for Best Hunt (and the weekly streak). Built from the server's own
 * numbers so it can never drift from the rule. Before this the card said "Finish a Hunt to set
 * your personal best", which reads wrong to someone who just finished a short one.
 */
export const BEST_HUNT_RULE =
  `A Hunt counts for Best Hunt with at least ${QUALIFY_MIN_SCANS} scans, ${QUALIFY_MIN_KEPT} kept find` +
  `${QUALIFY_MIN_KEPT === 1 ? '' : 's'} and ${QUALIFY_MIN_MINUTES} minutes.`;
export const SIGNED_OUT_COPY = { title: 'Sign in to join the leaderboard', cta: 'Sign in' };
export const PENDING_XP_COPY = "Your last Hunt's XP is still syncing";

/** What the pinned card shows. */
export type RankCard =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'signed_out' }
  | { kind: 'unranked'; copy: UnrankedCopy }
  | { kind: 'ranked'; me: MyRow; line: string };

export function rankCardFor(input: {
  board: Board; signedIn: boolean; authReady: boolean; view: BoardView | null; loading: boolean;
}): RankCard {
  const { board, signedIn, authReady, view, loading } = input;
  if (!authReady) return { kind: 'loading' };
  if (!signedIn) return { kind: 'signed_out' };
  if (!view) return loading ? { kind: 'loading' } : { kind: 'hidden' };
  // A board fetched before sign-in finished has no "me". Wait for the signed-in one.
  if (!view.signedIn) return loading ? { kind: 'loading' } : { kind: 'hidden' };
  if (!view.me) return { kind: 'unranked', copy: unrankedCopy(board) };
  return { kind: 'ranked', me: view.me, line: passLine(view.me) };
}

/** "Showing results from 2:14 PM" (with the date when it is not from today). */
export function cachedAtLabel(savedAtMs: number, nowMs = Date.now()): string {
  const at = new Date(savedAtMs), now = new Date(nowMs);
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  if (sameDay) return `Showing results from ${time}`;
  const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Showing results from ${day}, ${time}`;
}

// ─── My Hunt Level ────────────────────────────────────────────────────────────

export const RANK_COUNT = RANK_LADDER.length;

export interface LevelSummary {
  title:      string;       // "Hyena Hustler"
  rankNumber: number;       // 4
  headline:   string;       // "Hyena Hustler · Rank 4 of 23"
  line:       string;       // "420 XP to Warthog Wanderer" | "Top rank reached"
  progress:   number;       // 0-100 toward the next rank
  atTop:      boolean;
}
export function levelSummary(totalXp: number): LevelSummary {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  const i = rankIndexFor(xp);
  const next = getNextRank(xp);
  const title = RANK_LADDER[i].rank;
  return {
    title,
    rankNumber: i + 1,
    headline: `${title} · Rank ${i + 1} of ${RANK_COUNT}`,
    line: next ? `${formatXp(next.xp - xp)} to ${next.rank}` : 'Top rank reached',
    progress: getRankProgress(xp),
    atTop: !next,
  };
}

/**
 * Where the gold line ends, in nodes: 3.42 is 42% of the way from the 4th node
 * to the 5th. The last node is the end of the line.
 */
export function trackPosition(totalXp: number): number {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  const i = rankIndexFor(xp);
  if (i >= RANK_COUNT - 1) return RANK_COUNT - 1;
  const span = RANK_LADDER[i + 1].xp - RANK_LADDER[i].xp;
  return i + Math.max(0, Math.min(1, (xp - RANK_LADDER[i].xp) / span));
}

/**
 * How far to scroll the track so the current rank sits near the middle of the
 * screen. Never past either end.
 */
export function trackOffset(currentIndex: number, viewportWidth: number, cell: number, pad: number): number {
  const contentW = pad * 2 + cell * RANK_COUNT;
  const centre = pad + currentIndex * cell + cell / 2;
  return Math.max(0, Math.min(Math.max(0, contentW - viewportWidth), centre - viewportWidth / 2));
}

export type NodeState = 'reached' | 'current' | 'next' | 'future';
export function nodeState(index: number, currentIndex: number): NodeState {
  if (index < currentIndex) return 'reached';
  if (index === currentIndex) return 'current';
  if (index === currentIndex + 1) return 'next';
  return 'future';
}

/** "Rank 5 of 23, Warthog Wanderer, 1,500 XP, next rank". */
export function nodeA11yLabel(index: number, currentIndex: number | null): string {
  const r = RANK_LADDER[index];
  const base = `Rank ${index + 1} of ${RANK_COUNT}, ${r.rank}, ${formatXp(r.xp)}`;
  if (currentIndex == null) return base;
  const state = nodeState(index, currentIndex);
  if (state === 'reached') return `${base}, reached`;
  if (state === 'current') return `${base}, your rank`;
  if (state === 'next') return `${base}, next rank`;
  return base;
}