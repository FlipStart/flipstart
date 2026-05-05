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
import { FlipResult } from '@/types/flip';
import { deriveGlobalStats, calcGlobalRank } from '@/utils/flipCalculations';
import type { GlobalStats, GlobalRank } from '@/types/flip';

// ─── Storage key ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'flipstart_confirmed_flips';

// ─── State ────────────────────────────────────────────────────────────────────

interface FlipStoreState {
  flips:    FlipResult[];
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
  | { type: 'LOAD';              payload: FlipResult[] }
  | { type: 'ADD_FLIP';          payload: FlipResult }
  | { type: 'REMOVE_FLIP';       payload: string }       // by id
  | { type: 'UPDATE_FLIP';       payload: { id: string; updates: Partial<FlipResult> } }
  | { type: 'SET_THRIFT_PRICE';  payload: { id: string; price: string } }
  | { type: 'CLEAR_THRIFT_PRICE'; payload: string }      // by id
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
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([])).catch(() => {});
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
  flips:    FlipResult[];
  isLoaded: boolean;
  pendingThriftPrices: Record<string, string>;

  // Actions
  addFlip:            (flip: FlipResult) => void;
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

export function FlipStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    flips:    [],
    isLoaded: false,
    pendingThriftPrices: {},
  });

  // ── Load from AsyncStorage on mount ────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (raw) {
          const parsed = JSON.parse(raw) as FlipResult[];
          dispatch({ type: 'LOAD', payload: parsed });
        } else {
          dispatch({ type: 'LOAD', payload: [] });
        }
      })
      .catch(() => dispatch({ type: 'LOAD', payload: [] }));
  }, []);

  // ── Persist to AsyncStorage whenever flips change ──────────────────────────
  useEffect(() => {
    if (!state.isLoaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state.flips)).catch(() => {});
  }, [state.flips, state.isLoaded]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const addFlip = useCallback((flip: FlipResult) => {
    dispatch({ type: 'ADD_FLIP', payload: flip });
  }, []);

  const removeFlip = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_FLIP', payload: id });
  }, []);

  const clearAllFlips = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, []);

  const updateFlip = useCallback((id: string, updates: Partial<FlipResult>) => {
    dispatch({ type: 'UPDATE_FLIP', payload: { id, updates } });
  }, []);

  const setPendingThriftPrice = useCallback((id: string, price: string) => {
    dispatch({ type: 'SET_THRIFT_PRICE', payload: { id, price } });
  }, []);

  const clearPendingThriftPrice = useCallback((id: string) => {
    dispatch({ type: 'CLEAR_THRIFT_PRICE', payload: id });
  }, []);

  // ── Derived values (computed via flipCalculations — zero inline formulas) ──
  const globalStats = useMemo(() => deriveGlobalStats(state.flips), [state.flips]);
  const globalRank  = useMemo(() => calcGlobalRank(globalStats), [globalStats]);

  const getFlipById = useCallback(
    (id: string) => state.flips.find(f => f.id === id),
    [state.flips],
  );

  return (
    <FlipStoreContext.Provider
      value={{
        flips:    state.flips,
        isLoaded: state.isLoaded,
        pendingThriftPrices: state.pendingThriftPrices,
        addFlip,
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