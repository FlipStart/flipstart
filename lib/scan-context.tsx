import React, { createContext, useContext, useEffect, useReducer, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ScanResult } from "./types";

const STORAGE_KEY = "flipstart_scan_history";

interface ScanState {
  history: ScanResult[];
  currentScan: ScanResult | null;
  isLoaded: boolean;
}

type ScanAction =
  | { type: "SET_HISTORY"; payload: ScanResult[] }
  | { type: "ADD_SCAN"; payload: ScanResult }
  | { type: "UPDATE_SCAN"; payload: { id: string; updates: Partial<ScanResult> } }
  | { type: "REMOVE_SCAN"; payload: string }
  | { type: "SET_CURRENT"; payload: ScanResult | null }
  | { type: "CLEAR_HISTORY" };

function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "SET_HISTORY":
      return { ...state, history: action.payload, isLoaded: true };
    case "ADD_SCAN":
      return {
        ...state,
        history: [action.payload, ...state.history],
        currentScan: action.payload,
      };
    case "UPDATE_SCAN": {
      const updatedHistory = state.history.map((scan) =>
        scan.id === action.payload.id ? { ...scan, ...action.payload.updates } : scan
      );
      const updatedCurrent =
        state.currentScan?.id === action.payload.id
          ? { ...state.currentScan, ...action.payload.updates }
          : state.currentScan;
      return { ...state, history: updatedHistory, currentScan: updatedCurrent };
    }
    case "REMOVE_SCAN":
      return {
        ...state,
        history: state.history.filter((scan) => scan.id !== action.payload),
        currentScan:
          state.currentScan?.id === action.payload ? null : state.currentScan,
      };
    case "SET_CURRENT":
      return { ...state, currentScan: action.payload };
    case "CLEAR_HISTORY":
      return { ...state, history: [], currentScan: null };
    default:
      return state;
  }
}

interface ScanContextValue {
  history: ScanResult[];
  currentScan: ScanResult | null;
  isLoaded: boolean;
  addScan: (scan: ScanResult) => void;
  updateScan: (id: string, updates: Partial<ScanResult>) => void;
  removeScan: (id: string) => void;
  setCurrentScan: (scan: ScanResult | null) => void;
  clearHistory: () => void;
}

const ScanContext = createContext<ScanContextValue | undefined>(undefined);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(scanReducer, {
    history: [],
    currentScan: null,
    isLoaded: false,
  });

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    if (state.isLoaded) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state.history));
    }
  }, [state.history, state.isLoaded]);

  const loadHistory = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        dispatch({ type: "SET_HISTORY", payload: JSON.parse(stored) });
      } else {
        dispatch({ type: "SET_HISTORY", payload: [] });
      }
    } catch {
      dispatch({ type: "SET_HISTORY", payload: [] });
    }
  };

  const addScan     = useCallback((scan: ScanResult) => { dispatch({ type: "ADD_SCAN", payload: scan }); }, []);
  const updateScan  = useCallback((id: string, updates: Partial<ScanResult>) => { dispatch({ type: "UPDATE_SCAN", payload: { id, updates } }); }, []);
  const removeScan  = useCallback((id: string) => { dispatch({ type: "REMOVE_SCAN", payload: id }); }, []);
  const setCurrentScan = useCallback((scan: ScanResult | null) => { dispatch({ type: "SET_CURRENT", payload: scan }); }, []);
  const clearHistory = useCallback(() => {
    dispatch({ type: "CLEAR_HISTORY" });
    AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ScanContext.Provider
      value={{
        history: state.history,
        currentScan: state.currentScan,
        isLoaded: state.isLoaded,
        addScan,
        updateScan,
        removeScan,
        setCurrentScan,
        clearHistory,
      }}
    >
      {children}
    </ScanContext.Provider>
  );
}

export function useScanContext() {
  const context = useContext(ScanContext);
  if (!context) throw new Error("useScanContext must be used within a ScanProvider");
  return context;
}