/**
 * lib/useLeaderboard.ts
 *
 * Screen state for the Hunt Leaderboard: one entry per board, so flipping tabs
 * shows what was already loaded while the new copy comes in.
 *
 *   open / focus / tab change   last good copy at once, then a fresh first page
 *   scroll to the end           the next 50
 *   fetch failed                keep what is on screen, mark it stale (with its time)
 *
 * The rules themselves live in lib/leaderboard.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BOARDS, DEFAULT_BOARD, type Board, type BoardView,
  fetchBoard, readBoardCache, writeBoardCache, clearBoardCaches, mergeRows, refreshedView, withoutHunter,
} from '@/lib/leaderboard';

export interface BoardEntry {
  view:        BoardView | null;
  /** When the data on screen was fetched (phone clock). */
  at:          number | null;
  /** The latest fetch failed; `view` is an older copy. */
  stale:       boolean;
  loading:     boolean;
  loadingMore: boolean;
}
const EMPTY: BoardEntry = { view: null, at: null, stale: false, loading: false, loadingMore: false };
const emptyAll = (): Record<Board, BoardEntry> => ({ weekly: EMPTY, all_time: EMPTY, best_hunt: EMPTY });

export interface LeaderboardState {
  board:      Board;
  entry:      BoardEntry;
  select:     (b: Board) => void;
  /** Fetch the first page of the current board again. */
  refresh:    () => Promise<void>;
  loadMore:   () => void;
  /** A hunter was blocked: take them off every board now, then ask the server. */
  dropHunter: (id: string) => void;
  /** Throw away everything and load again (after an unblock, or a failed block). */
  reset:      () => void;
}

export function useLeaderboard(uid: string | null, authReady: boolean, initial: Board = DEFAULT_BOARD): LeaderboardState {
  const [board, setBoard] = useState<Board>(initial);
  const [entries, setEntries] = useState<Record<Board, BoardEntry>>(emptyAll);

  // Every answer is checked against these before it is applied, so a slow
  // response for an old account or an old request can never land on screen.
  const epoch = useRef(0);
  const seq = useRef<Record<Board, number>>({ weekly: 0, all_time: 0, best_hunt: 0 });
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const patch = useCallback((b: Board, p: Partial<BoardEntry> | ((e: BoardEntry) => Partial<BoardEntry>)) => {
    setEntries(prev => ({ ...prev, [b]: { ...prev[b], ...(typeof p === 'function' ? p(prev[b]) : p) } }));
  }, []);

  const load = useCallback(async (b: Board) => {
    if (!authReady) return;
    const myEpoch = epoch.current;
    const mySeq = ++seq.current[b];
    const current = () => epoch.current === myEpoch && seq.current[b] === mySeq;

    patch(b, { loading: true });
    if (!entriesRef.current[b].view) {
      const cached = await readBoardCache(uid, b);
      if (!current()) return;
      // Only fills an empty board: a fresh answer that arrived first is never replaced.
      if (cached) patch(b, e => (e.view ? {} : { view: cached.view, at: cached.savedAt }));
    }

    const view = await fetchBoard(b, 0);
    if (!current()) return;
    if (view) {
      const at = Date.now();
      patch(b, cur => ({ view: refreshedView(cur.view, view), at, stale: false, loading: false, loadingMore: false }));
      void writeBoardCache(uid, view, at);
    } else {
      patch(b, { stale: true, loading: false, loadingMore: false });
    }
  }, [uid, authReady, patch]);

  // A different account (or signing out) starts from nothing.
  useEffect(() => {
    epoch.current += 1;
    setEntries(emptyAll());
    entriesRef.current = emptyAll();
    if (authReady) void load(board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authReady]);

  const select = useCallback((b: Board) => {
    if (!BOARDS.includes(b)) return;
    setBoard(b);
    void load(b);
  }, [load]);

  const refresh = useCallback(() => load(board), [load, board]);

  const loadMore = useCallback(() => {
    const b = board;
    const e = entriesRef.current[b];
    if (!e.view || !e.view.hasMore || e.loading || e.loadingMore || e.stale) return;
    const myEpoch = epoch.current;
    const mySeq = seq.current[b];
    const after = e.view.rows.length;
    patch(b, { loadingMore: true });
    void fetchBoard(b, after).then(page => {
      if (epoch.current !== myEpoch || seq.current[b] !== mySeq) return;
      patch(b, cur => {
        if (!cur.view || !page) return { loadingMore: false };
        const rows = mergeRows(cur.view.rows, page.rows);
        return {
          loadingMore: false,
          view: {
            ...cur.view,
            rows,
            rankedCount: page.rankedCount,
            // A page that added nobody means there is nothing more to ask for.
            hasMore: page.hasMore && rows.length > cur.view.rows.length,
          },
        };
      });
    });
  }, [board, patch]);

  const dropHunter = useCallback((id: string) => {
    setEntries(prev => {
      const next = { ...prev };
      for (const b of BOARDS) {
        const v = prev[b].view;
        if (v) next[b] = { ...prev[b], view: withoutHunter(v, id) };
      }
      return next;
    });
    void clearBoardCaches(uid);
  }, [uid]);

  const reset = useCallback(() => {
    epoch.current += 1;
    setEntries(emptyAll());
    entriesRef.current = emptyAll();
    void clearBoardCaches(uid).then(() => load(board));
  }, [uid, load, board]);

  return { board, entry: entries[board], select, refresh, loadMore, dropHunter, reset };
}