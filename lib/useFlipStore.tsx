/**
 * FlipStart — useFlipStore
 *
 * Global persistent store for confirmed flips.
 *
 * Architecture:
 *   - useReducer for predictable state transitions
 *   - AsyncStorage for persistence across app restarts
 *   - React Context to expose state + dispatch
 *
 * This is the SINGLE SOURCE OF TRUTH for:
 *   - confirmed flip history
 *   - global stats
 *   - ROI / rankings
 *
 * scan-context is SEPARATE — it only manages the temporary scan flow.
 */

import React, {
  createContext, useContext, useEffect, useReducer,
  useCallback, useMemo,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlipResult, HuntBundle, HistoryEntry, isHuntBundle } from '@/types/flip';
import { deriveGlobalStats, calcGlobalRank } from '@/utils/flipCalculations';
import type { GlobalStats, GlobalRank } from '@/types/flip';
import { upsertScan, deleteScan, deleteAllScans, fetchScans, mergeScans } from '@/lib/scanSync';
import { upsertHuntBundle, deleteHuntBundle, deleteAllHuntBundles, fetchHuntBundles, mergeHuntBundles } from '@/lib/huntBundleSync';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const GUEST_KEY  = 'flipstart_confirmed_flips';           // legacy / guest
const userKey    = (uid: string) => `flipstart_flips:${uid}`; // per-user

// ─── State ────────────────────────────────────────────────────────────────────

interface FlipStoreState {
  flips:    HistoryEntry[];
  isLoaded: boolean;

  /**
   * Session-only thrift price cache.
   * Key: scanId, Value: thrift price string entered by user.
   * Survives navigation within a session but NOT across app restarts.
   * Cleared when the user confirms the flip.
   */
  pendingThriftPrices: Record<string, string>;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

type FlipAction =
  | { type: 'LOAD';              payload: HistoryEntry[] }
  | { type: 'ADD_FLIP';          payload: FlipResult }
  | { type: 'REMOVE_FLIP';       payload: string }       // by id
  | { type: 'UPDATE_FLIP';       payload: { id: string; updates: Partial<FlipResult> } }
  | { type: 'SET_THRIFT_PRICE';  payload: { id: string; price: string } }
  | { type: 'CLEAR_THRIFT_PRICE'; payload: string }      // by id
  | { type: 'ADD_HUNT_BUNDLE'; payload: HuntBundle }
  | { type: 'CLEAR_ALL' };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: FlipStoreState, action: FlipAction): FlipStoreState {
  switch (action.type) {
    case 'LOAD':
      return { ...state, flips: action.payload, isLoaded: true };

    case 'ADD_FLIP': {
      // Replace if already exists (e.g. re-confirm), otherwise prepend
      const exists = state.flips.some(f => f.id === action.payload.id);
      const flips  = exists
        ? state.flips.map(f => f.id === action.payload.id ? action.payload : f)
        : [action.payload, ...state.flips];
      // Clear pending thrift price on confirm — use delete to avoid unused variable
      const pendingThriftPrices = { ...state.pendingThriftPrices };
      delete pendingThriftPrices[action.payload.id];
      return { ...state, flips, pendingThriftPrices };
    }

    case 'ADD_HUNT_BUNDLE': {
      const exists = state.flips.some(f => f.id === action.payload.id);
      const flips  = exists
        ? state.flips.map(f => f.id === action.payload.id ? action.payload : f)
        : [action.payload, ...state.flips];
      return { ...state, flips };
    }

    case 'REMOVE_FLIP':
      return {
        ...state,
        flips: state.flips.filter(f => f.id !== action.payload),
      };

    case 'UPDATE_FLIP':
      return {
        ...state,
        flips: state.flips.map(f =>
          f.id === action.payload.id ? { ...f, ...action.payload.updates } : f
        ),
      };

    case 'SET_THRIFT_PRICE':
      return {
        ...state,
        pendingThriftPrices: {
          ...state.pendingThriftPrices,
          [action.payload.id]: action.payload.price,
        },
      };

    case 'CLEAR_ALL':
      AsyncStorage.setItem(GUEST_KEY, JSON.stringify([])).catch(() => {});
      return { ...state, flips: [], pendingThriftPrices: {} };

    case 'CLEAR_THRIFT_PRICE': {
      const pendingThriftPrices = { ...state.pendingThriftPrices };
      delete pendingThriftPrices[action.payload];
      return { ...state, pendingThriftPrices };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface FlipStoreValue {
  // State
  flips:    HistoryEntry[];
  isLoaded: boolean;
  pendingThriftPrices: Record<string, string>;

  // Actions
  addFlip:            (flip: FlipResult) => void;
  addHuntBundle:      (bundle: HuntBundle) => void;
  removeFlip:         (id: string) => void;
  clearAllFlips:      () => void;
  updateFlip:         (id: string, updates: Partial<FlipResult>) => void;
  setPendingThriftPrice: (id: string, price: string) => void;
  clearPendingThriftPrice: (id: string) => void;

  // Derived (computed from flips via flipCalculations.ts)
  globalStats: GlobalStats;
  globalRank:  GlobalRank;

  // Convenience
  getFlipById: (id: string) => FlipResult | undefined;
}

const FlipStoreContext = createContext<FlipStoreValue | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function FlipStoreProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId?: string | null;
}) {
  const [state, dispatch] = useReducer(reducer, {
    flips:    [],
    isLoaded: false,
    pendingThriftPrices: {},
  });

  // ── Load from AsyncStorage on mount / when userId changes ──────────────────
  useEffect(() => {
    const key = userId ? userKey(userId) : GUEST_KEY;
    AsyncStorage.getItem(key)
      .then(raw => {
        const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
        dispatch({ type: 'LOAD', payload: parsed });
      })
      .catch(() => dispatch({ type: 'LOAD', payload: [] }));
  }, [userId]);

  // ── Persist to AsyncStorage whenever flips change ──────────────────────────
  useEffect(() => {
    if (!state.isLoaded) return;
    const key = userId ? userKey(userId) : GUEST_KEY;
    AsyncStorage.setItem(key, JSON.stringify(state.flips)).catch(() => {});
  }, [state.flips, state.isLoaded, userId]);

  // ── Cloud sync on login: migrate guest → user, pull cloud, merge ─────────
  useEffect(() => {
    if (!userId || !state.isLoaded) return;
    (async () => {
      try {
        const key      = userKey(userId);
        const guestRaw = await AsyncStorage.getItem(GUEST_KEY).catch(() => null);
        const guestEntries: HistoryEntry[] = guestRaw ? JSON.parse(guestRaw) : [];

        // Push guest scans to cloud (migration)
        const guestScans   = guestEntries.filter((e): e is FlipResult => !isHuntBundle(e));
        const guestBundles = guestEntries.filter(isHuntBundle);
        for (const s of guestScans)   upsertScan(s, userId).catch(() => {});
        for (const b of guestBundles) upsertHuntBundle(b, userId).catch(() => {});

        // Fetch cloud data and merge
        const [cloudScans, cloudBundles] = await Promise.all([
          fetchScans(userId),
          fetchHuntBundles(userId),
        ]);

        const localRaw     = await AsyncStorage.getItem(key).catch(() => null);
        const localEntries: HistoryEntry[] = localRaw ? JSON.parse(localRaw) : guestEntries;
        const localScans   = localEntries.filter((e): e is FlipResult => !isHuntBundle(e));
        const localBundles = localEntries.filter(isHuntBundle);

        const mergedScans   = mergeScans(localScans, cloudScans);
        const mergedBundles = mergeHuntBundles(localBundles, cloudBundles);
        const merged        = [...mergedScans, ...mergedBundles];

        dispatch({ type: 'LOAD', payload: merged });
        AsyncStorage.setItem(key, JSON.stringify(merged)).catch(() => {});

        // Clear guest key after migration
        if (guestEntries.length > 0) {
          AsyncStorage.removeItem(GUEST_KEY).catch(() => {});
        }
      } catch (err) {
        if (__DEV__) console.warn('[useFlipStore] sync effect threw:', err);
      }
    })();
  }, [userId, state.isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────
  const addFlip = useCallback((flip: FlipResult) => {
    dispatch({ type: 'ADD_FLIP', payload: flip });
    if (userId) upsertScan(flip, userId).catch(() => {});
  }, [userId]);

  const addHuntBundle = useCallback((bundle: HuntBundle) => {
    dispatch({ type: 'ADD_HUNT_BUNDLE', payload: bundle });
    if (userId) upsertHuntBundle(bundle, userId).catch(() => {});
  }, [userId]);

  const removeFlip = useCallback((id: string) => {
    // Determine type before dispatch removes it
    const entry = state.flips.find(f => f.id === id);
    dispatch({ type: 'REMOVE_FLIP', payload: id });
    if (userId && entry) {
      if (isHuntBundle(entry)) deleteHuntBundle(id, userId).catch(() => {});
      else                     deleteScan(id, userId).catch(() => {});
    }
  }, [userId, state.flips]);

  const clearAllFlips = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
    if (userId) {
      deleteAllScans(userId).catch(() => {});
      deleteAllHuntBundles(userId).catch(() => {});
    }
  }, [userId]);

  const updateFlip = useCallback((id: string, updates: Partial<FlipResult>) => {
    dispatch({ type: 'UPDATE_FLIP', payload: { id, updates } });
    // Re-sync the merged flip to Supabase. Without this, later edits (sold
    // status/price, listings) only ever lived locally — and because
    // mergeScans is cloud-wins per id, the stale cloud row would OVERWRITE
    // the local sold data on the next login. Same fire-and-forget pattern
    // as addFlip/removeFlip; raw_result carries the full updated object.
    if (userId) {
      const entry = state.flips.find(f => f.id === id);
      if (entry && !isHuntBundle(entry)) {
        upsertScan({ ...entry, ...updates }, userId).catch(() => {});
      }
    }
  }, [userId, state.flips]);

  const setPendingThriftPrice = useCallback((id: string, price: string) => {
    dispatch({ type: 'SET_THRIFT_PRICE', payload: { id, price } });
  }, []);

  const clearPendingThriftPrice = useCallback((id: string) => {
    dispatch({ type: 'CLEAR_THRIFT_PRICE', payload: id });
  }, []);

  // ── Derived values (computed via flipCalculations — zero inline formulas) ──
  // ── Derive global stats — includes hunt bundle contributions ─────────────────
  // deriveGlobalStats operates on FlipResult[], so we compute normal-scan stats
  // first then fold in hunt bundle data (kept items only) on top.
  const globalStats = useMemo((): GlobalStats => {
    const normalFlips  = state.flips.filter((f): f is FlipResult => !isHuntBundle(f));
    const base         = deriveGlobalStats(normalFlips);

    // Aggregate kept-item data from all hunt bundles
    const bundles      = state.flips.filter(isHuntBundle);
    let bundleProfit   = 0;
    let bundleCost     = 0;
    let bundleFlips    = 0;   // count of kept items across all bundles
    let bundleWins     = 0;   // kept items with positive profit (analogous to win)

    for (const b of bundles) {
      bundleProfit += Math.max(0, b.totalEstimatedProfit);
      bundleCost   += b.totalCost;
      bundleFlips  += b.keptItemCount;
      // A kept item "wins" if its individual profit > 0
      bundleWins   += b.keptItems.filter(i => i.profit > 0).length;
    }

    const totalFlips  = base.totalFlips + bundleFlips;
    const totalProfit = base.totalProfit + bundleProfit;
    const totalCost   = base.totalCost   + bundleCost;
    const totalWins   = Math.round((base.winRate / 100) * base.totalFlips) + bundleWins;

    const lifetimeRoi = totalCost   > 0 ? Math.round((totalProfit / totalCost)   * 100) : 0;
    const avgProfit   = totalFlips  > 0 ? Math.round(totalProfit / totalFlips)          : 0;
    const winRate     = totalFlips  > 0 ? Math.round((totalWins  / totalFlips)   * 100) : 0;

    return { totalFlips, totalProfit, totalCost, lifetimeRoi, avgProfit, winRate };
  }, [state.flips]);
  const globalRank  = useMemo(() => calcGlobalRank(globalStats), [globalStats]);

  const getFlipById = useCallback(
    (id: string) => state.flips.find((f): f is FlipResult => !isHuntBundle(f) && f.id === id),
    [state.flips],
  );

  return (
    <FlipStoreContext.Provider
      value={{
        flips:    state.flips,
        isLoaded: state.isLoaded,
        pendingThriftPrices: state.pendingThriftPrices,
        addFlip,
        addHuntBundle,
        removeFlip,
        clearAllFlips,
        updateFlip,
        setPendingThriftPrice,
        clearPendingThriftPrice,
        globalStats,
        globalRank,
        getFlipById,
      }}
    >
      {children}
    </FlipStoreContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFlipStore(): FlipStoreValue {
  const ctx = useContext(FlipStoreContext);
  if (!ctx) throw new Error('useFlipStore must be used within a FlipStoreProvider');
  return ctx;
}