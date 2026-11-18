/**
 * lib/leaderboardAnalytics.ts
 *
 * The Hunt Leaderboard's analytics events. They exist to answer one question on
 * the founder dashboard: do people who see the leaderboard go on to Hunt more?
 *
 *   leaderboard_opened              source, board, return_visit
 *   leaderboard_tab_selected        board
 *   leaderboard_viewed              board, ranked, position, ranked_count
 *   leaderboard_start_hunt_clicked  board, unranked
 *   leaderboard_level_track_viewed  rank_number
 *   leaderboard_report_submitted    reason
 *   leaderboard_user_blocked        (nothing)
 *
 * Nothing here ever names another hunter: no id, handle, name or picture of the
 * person reported or blocked, and no row of the board. Every value is one of a
 * fixed set of words, a yes/no, or a number about the viewer's own place.
 *
 * Like every event, these are dropped while the guided Hunt demo runs
 * (lib/analytics), are fire-and-forget, and never throw.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logEvent } from '@/lib/analytics';

export type LbBoard = 'weekly' | 'all_time' | 'best_hunt';
export type LbSource = 'hunt' | 'home' | 'hunt_complete' | 'other';
export type LbReportReason = 'photo' | 'name' | 'cheating';

const BOARDS: readonly string[] = ['weekly', 'all_time', 'best_hunt'];
const SOURCES: readonly string[] = ['hunt', 'home', 'hunt_complete'];
const REASONS: readonly string[] = ['photo', 'name', 'cheating'];

/** Where the screen was opened from. Anything unrecognised is "other": free text never leaves. */
export function sourceOf(raw: unknown): LbSource {
  return typeof raw === 'string' && SOURCES.includes(raw) ? (raw as LbSource) : 'other';
}
const boardOf = (raw: unknown): LbBoard => (typeof raw === 'string' && BOARDS.includes(raw) ? (raw as LbBoard) : 'weekly');
const wholeOrNull = (v: unknown): number | null => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Set the first time this phone opens the leaderboard. Not per account: it only says "seen it before". */
export const LB_OPENED_KEY = '@flipstart/leaderboard:openedBefore';

/** The screen was opened. `return_visit` is false only the first time on this phone. */
export async function logLeaderboardOpened(source: unknown, board: unknown): Promise<void> {
  let returnVisit: boolean | null = null;
  try {
    returnVisit = (await AsyncStorage.getItem(LB_OPENED_KEY)) === '1';
    if (!returnVisit) await AsyncStorage.setItem(LB_OPENED_KEY, '1');
  } catch { /* unknown stays null: never guessed */ }
  try {
    logEvent('leaderboard_opened', { source: sourceOf(source), board: boardOf(board), return_visit: returnVisit });
  } catch { /* never throws into the screen */ }
}

/** The user tapped a different board tab. */
export function logLeaderboardTabSelected(board: unknown): void {
  try { logEvent('leaderboard_tab_selected', { board: boardOf(board) }); } catch { /* never */ }
}

/**
 * A board's fresh data is on screen. `position` is the viewer's own place, or
 * null when they are not ranked on this board (or signed out).
 */
export function logLeaderboardViewed(v: { board: unknown; position: unknown; rankedCount: unknown; signedIn: boolean }): void {
  try {
    const position = wholeOrNull(v.position);
    logEvent('leaderboard_viewed', {
      board: boardOf(v.board),
      ranked: position != null,
      position,
      ranked_count: Math.max(0, Math.floor(Number(v.rankedCount)) || 0),
      signed_in: v.signedIn === true,
    });
  } catch { /* never */ }
}

/** "Start Hunt" on the Your Rank card. */
export function logLeaderboardStartHuntClicked(v: { board: unknown; unranked: boolean }): void {
  try { logEvent('leaderboard_start_hunt_clicked', { board: boardOf(v.board), unranked: v.unranked === true }); } catch { /* never */ }
}

/** My Hunt Level was shown. `rank_number` is the viewer's own rank, 1 to 23 (null when signed out). */
export function logLeaderboardLevelTrackViewed(rankNumber: unknown, signedIn: boolean): void {
  try { logEvent('leaderboard_level_track_viewed', { rank_number: signedIn ? wholeOrNull(rankNumber) : null, signed_in: signedIn === true }); } catch { /* never */ }
}

/** A report was accepted by the server. The reason only: nothing about who. */
export function logLeaderboardReportSubmitted(reason: unknown): void {
  try {
    if (typeof reason !== 'string' || !REASONS.includes(reason)) return;
    logEvent('leaderboard_report_submitted', { reason });
  } catch { /* never */ }
}

/** A block was accepted by the server. Nothing about who. */
export function logLeaderboardUserBlocked(): void {
  try { logEvent('leaderboard_user_blocked', {}); } catch { /* never */ }
}

/**
 * "Once per board, per time the screen is open." Returns a function that says
 * yes the first time it is asked about a key and no after that.
 */
export function createOncePer(): (key: string) => boolean {
  const seen = new Set<string>();
  return (key: string) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}