/**
 * lib/AchievementNotificationContext.tsx
 *
 * Tracks which achievements the user has earned but not yet viewed the
 * unlock animation for. Drives the Progress tab badge and the Achievements
 * card badge on the Progress screen.
 *
 * Usage:
 *   - Wrap the app root with <AchievementNotificationProvider>
 *   - Call notifyNew(ids) when progress screen detects newly unlocked achievements
 *   - Read unseenCount / unseenAchievements in tab bar and progress card
 *   - Call markAllSeen() after the user views the achievement animations
 */

import React, {
  createContext, useContext, useState, useCallback, useRef,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY = '@flipstart/seen_achievement_ids';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AchievementNotification {
  id:           string;
  name:         string;
  flavor:       string;
  categoryId:   string;
  categoryIcon: string;
  iconColor:    string;
  barColor:     string;
}

interface NotifContextValue {
  /** Number of earned-but-not-yet-animated achievements */
  unseenCount:        number;
  /** Full details of unseen achievements (for the animation modal) */
  unseenAchievements: AchievementNotification[];
  /**
   * Called by progress.tsx on focus.
   * Pass all currently-unlocked achievement IDs + full detail objects.
   * Automatically diffs against AsyncStorage seen list.
   */
  notifyNew: (
    unlockedIds: string[],
    allDetails:  AchievementNotification[],
  ) => Promise<void>;
  /** Called by achievements.tsx after showing all animations. */
  markAllSeen: () => Promise<void>;
  /** Called by achievement-category.tsx to clear only the viewed category's achievements. */
  markAchievementsSeen: (ids: string[]) => Promise<void>;
  /**
   * DEV ONLY — directly inject an achievement into the unseen queue
   * without any AsyncStorage diff. Used by the dev achievement tester.
   */
  forceNotify: (achievement: AchievementNotification) => void;

  /** Number of newly discovered brands not yet viewed in Brand Compendium. */
  unseenBrandCount: number;
  /** The actual brand names that are unseen — used for per-rarity counts and NEW markers. */
  unseenBrandNames: string[];
  /**
   * Called by progress.tsx on focus with the names of newly discovered brands.
   * Updates in-memory count (AsyncStorage seen-diff is done in brandCompendium.ts).
   */
  addUnseenBrands: (newNames: string[]) => void;
  /** Called by brand-compendium.tsx after clearing the badge. */
  markBrandsSeen: (names: string[]) => void;
  /** Called by brand-rarity.tsx when user taps a specific brand to clear its NEW marker. */
  markBrandSeen: (name: string) => void;

  /** Number of newly unlocked Diamonds not yet viewed in Diamonds in the Rough. */
  unseenDiamondCount: number;
  /** The actual Diamond ids that are unseen — used for NEW markers + newest-first ordering. */
  unseenDiamondIds: string[];
  /**
   * Called by progress.tsx on focus with the ids of newly unlocked Diamonds.
   * Updates in-memory count (AsyncStorage seen-diff is done in diamonds.ts).
   */
  addUnseenDiamonds: (newIds: string[]) => void;
  /** Called by the Diamonds screen after the user views a batch (clears the badge). */
  markDiamondsSeen: (ids: string[]) => void;
  /** Called by the Diamonds screen when a single Diamond is viewed to clear its NEW marker. */
  markDiamondSeen: (id: string) => void;
}

const NotifContext = createContext<NotifContextValue>({
  unseenCount:        0,
  unseenAchievements: [],
  notifyNew:          async () => {},
  markAllSeen:        async () => {},
  markAchievementsSeen: async () => {},
  forceNotify:        () => {},
  unseenBrandCount:   0,
  unseenBrandNames:   [],
  addUnseenBrands:    () => {},
  markBrandsSeen:     () => {},
  markBrandSeen:      () => {},
  unseenDiamondCount: 0,
  unseenDiamondIds:   [],
  addUnseenDiamonds:  () => {},
  markDiamondsSeen:   () => {},
  markDiamondSeen:    () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AchievementNotificationProvider({ children }: { children: ReactNode }) {
  const [unseenAchievements, setUnseenAchievements] = useState<AchievementNotification[]>([]);
  const [unseenBrandNames,   setUnseenBrandNames]   = useState<string[]>([]);
  const [unseenDiamondIds,   setUnseenDiamondIds]   = useState<string[]>([]);

  const notifyNew = useCallback(async (
    unlockedIds:  string[],
    allDetails:   AchievementNotification[],
  ) => {
    try {
      const raw  = await AsyncStorage.getItem(SEEN_KEY);
      const seen = new Set<string>(raw ? JSON.parse(raw) : []);

      const newOnes = allDetails.filter(
        d => unlockedIds.includes(d.id) && !seen.has(d.id)
      );

      if (newOnes.length > 0) {
        setUnseenAchievements(prev => {
          // If a popup sequence is already active, only append genuinely
          // new items to the END — never reset the list mid-sequence.
          if (prev.length > 0) {
            const existingIds = new Set(prev.map(a => a.id));
            const additions   = newOnes.filter(a => !existingIds.has(a.id));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          }
          // No active popup — start fresh.
          return newOnes;
        });
      }
    } catch {
      // Never crash on notification logic
    }
  }, []);

  const markAllSeen = useCallback(async () => {
    // Capture current list, then clear SYNCHRONOUSLY before any await.
    // This closes the window between setShowReveal(false) and the list
    // clearing — preventing any re-trigger of the popup useEffect.
    const toMark = [...unseenAchievements];
    setUnseenAchievements([]);   // ← sync, batched with setShowReveal(false)

    try {
      const raw  = await AsyncStorage.getItem(SEEN_KEY);
      const seen = new Set<string>(raw ? JSON.parse(raw) : []);
      toMark.forEach(a => seen.add(a.id));
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {
      // Never crash
    }
  }, [unseenAchievements]);

  /**
   * Category-scoped clear — called by achievement-category.tsx when a
   * user finishes viewing the popup for that specific category.
   * Only removes those IDs from the unseen list, leaving other categories intact.
   */
  const markAchievementsSeen = useCallback(async (ids: string[]) => {
    const toMark = unseenAchievements.filter(a => ids.includes(a.id));
    setUnseenAchievements(prev => prev.filter(a => !ids.includes(a.id)));
    try {
      const raw  = await AsyncStorage.getItem(SEEN_KEY);
      const seen = new Set<string>(raw ? JSON.parse(raw) : []);
      toMark.forEach(a => seen.add(a.id));
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {}
  }, [unseenAchievements]);

  // DEV ONLY — bypass AsyncStorage diff and inject directly
  const forceNotify = useCallback((achievement: AchievementNotification) => {
    setUnseenAchievements(prev => {
      if (prev.some(a => a.id === achievement.id)) return prev;
      return [...prev, achievement];
    });
  }, []);

  // ── Brand discovery notifications ──────────────────────────────────────────
  const addUnseenBrands = useCallback((newNames: string[]) => {
    setUnseenBrandNames(prev => {
      const existing = new Set(prev);
      const additions = newNames.filter(n => !existing.has(n));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, []);

  const markBrandsSeen = useCallback((names: string[]) => {
    setUnseenBrandNames(prev => prev.filter(n => !names.includes(n)));
  }, []);

  const markBrandSeen = useCallback((name: string) => {
    setUnseenBrandNames(prev => prev.filter(n => n !== name));
  }, []);

  // ── Diamond discovery notifications (mirrors brand tracking) ────────────────
  const addUnseenDiamonds = useCallback((newIds: string[]) => {
    setUnseenDiamondIds(prev => {
      const existing = new Set(prev);
      const additions = newIds.filter(id => !existing.has(id));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, []);

  const markDiamondsSeen = useCallback((ids: string[]) => {
    setUnseenDiamondIds(prev => prev.filter(id => !ids.includes(id)));
  }, []);

  const markDiamondSeen = useCallback((id: string) => {
    setUnseenDiamondIds(prev => prev.filter(d => d !== id));
  }, []);

  return (
    <NotifContext.Provider value={{
      unseenCount:        unseenAchievements.length,
      unseenAchievements,
      notifyNew,
      markAllSeen,
      markAchievementsSeen,
      forceNotify,
      unseenBrandCount:   unseenBrandNames.length,
      unseenBrandNames,
      addUnseenBrands,
      markBrandsSeen,
      markBrandSeen,
      unseenDiamondCount: unseenDiamondIds.length,
      unseenDiamondIds,
      addUnseenDiamonds,
      markDiamondsSeen,
      markDiamondSeen,
    }}>
      {children}
    </NotifContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAchievementNotifications() {
  return useContext(NotifContext);
}