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
  createContext, useContext, useState, useCallback, useRef, useEffect,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/auth-context';

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
  /**
   * Prune in-memory unseen badges to only currently-valid ids/names. Called
   * after a scan/history deletion so badges for progress that no longer exists
   * disappear immediately (no phantom notifications).
   */
  pruneUnseen: (valid: { achievements: string[]; brands: string[]; diamonds: string[] }) => void;
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
  pruneUnseen:        () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AchievementNotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
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

    // Background: mirror seen state to Supabase for signed-in users (fail-safe).
    const uid = user?.id;
    if (uid && toMark.length > 0) {
      import('@/lib/achievementSync').then(({ markAchievementSeenRemote }) => {
        toMark.forEach(a => markAchievementSeenRemote(uid, a.id).catch(() => {}));
      }).catch(() => {});
    }
  }, [unseenAchievements, user?.id]);

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

    const uid = user?.id;
    if (uid && toMark.length > 0) {
      import('@/lib/achievementSync').then(({ markAchievementSeenRemote }) => {
        toMark.forEach(a => markAchievementSeenRemote(uid, a.id).catch(() => {}));
      }).catch(() => {});
    }
  }, [unseenAchievements, user?.id]);

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

  // Prune in-memory unseen badges to only currently-valid items. Used after a
  // scan/history deletion so notifications for removed progress vanish at once.
  const pruneUnseen = useCallback(
    (valid: { achievements: string[]; brands: string[]; diamonds: string[] }) => {
      const aSet = new Set(valid.achievements);
      const bSet = new Set(valid.brands);
      const dSet = new Set(valid.diamonds);
      setUnseenAchievements(prev => prev.filter(a => aSet.has(a.id)));
      setUnseenBrandNames(prev => prev.filter(n => bSet.has(n)));
      setUnseenDiamondIds(prev => prev.filter(id => dSet.has(id)));
    },
    [],
  );

  // ── Clear in-memory notification badges on account change ───────────────────
  // The per-account AsyncStorage keys are cleared in app/_layout.tsx (before the
  // cloud sync runs, to avoid clobbering the new account's downloaded state).
  // Here we only reset the in-memory badge arrays so the UI updates immediately
  // on sign-out/switch. Clear ONLY on sign-out (A→null) or switch (A→B), never
  // on initial login (null→A).
  const prevUidRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const uid  = user?.id ?? null;
    const prev = prevUidRef.current;
    prevUidRef.current = uid;

    if (prev === undefined) return; // first render
    if (prev === uid) return;       // no change
    if (prev === null) return;      // login/launch into an account

    setUnseenAchievements([]);
    setUnseenBrandNames([]);
    setUnseenDiamondIds([]);
  }, [user?.id]);

  // Guests never surface notification badges. Gate the EXPOSED counts/arrays on
  // being signed in — a single chokepoint so no generator (Progress tab, diamond
  // watcher, brand discovery, dev tools, or any future caller) can light the
  // Progress tab badge in guest mode. Internal state is preserved so genuine
  // guest discoveries surface as unseen once the user signs in.
  const signedIn = !!user?.id;

  return (
    <NotifContext.Provider value={{
      unseenCount:        signedIn ? unseenAchievements.length : 0,
      unseenAchievements: signedIn ? unseenAchievements : [],
      notifyNew,
      markAllSeen,
      markAchievementsSeen,
      forceNotify,
      unseenBrandCount:   signedIn ? unseenBrandNames.length : 0,
      unseenBrandNames:   signedIn ? unseenBrandNames : [],
      addUnseenBrands,
      markBrandsSeen,
      markBrandSeen,
      unseenDiamondCount: signedIn ? unseenDiamondIds.length : 0,
      unseenDiamondIds:   signedIn ? unseenDiamondIds : [],
      addUnseenDiamonds,
      markDiamondsSeen,
      markDiamondSeen,
      pruneUnseen,
    }}>
      {children}
    </NotifContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAchievementNotifications() {
  return useContext(NotifContext);
}