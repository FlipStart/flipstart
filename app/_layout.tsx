import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform, AppState, AppStateStatus, Animated } from "react-native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from "expo-splash-screen";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { ScanProvider } from "@/lib/scan-context";
import { FlipStoreProvider } from "@/lib/useFlipStore";
import { logEvent, resumeOrStartSession, backgroundSession, endSession } from "@/lib/analytics";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AchievementNotificationProvider, useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { useFlipStore } from '@/lib/useFlipStore';
import { getUnlockedDiamondIds, getUnseenDiamondIds, computeUnlockedDiamonds } from '@/lib/diamonds';
import { markProgressHydrated, resetProgressHydration } from '@/lib/progressHydration';
import {
  buildUserAchievementData, getAllUnlockedIds, ACHIEVEMENT_CATEGORIES,
} from '@/lib/achievements';
import { computeDiscoveredBrands, getUnseenBrandNames } from '@/lib/brandCompendium';
import { subscribeToHunt, getActiveHunt } from '@/lib/hunt-context';
import { type HuntBundle } from '@/types/flip';
import UpdateGate from '@/components/UpdateGate';
// Deep link auth handler remains disabled until AuthProvider boot is confirmed stable.
// import * as Linking from "expo-linking";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

// AuthBridge: reads userId from AuthProvider (safe — no supabase import here)
// and passes it to FlipStoreProvider so scan/bundle sync knows the current user.
function AppProviders({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  // Dedup guard: tracks which userId we've already run syncXpOnLogin for
  // this session. Prevents double-sync on profileChecked bounces or re-renders.
  const syncedForUserRef = useRef<string | null>(null);
  // Tracks the previous auth uid so we can detect sign-out (A→null) and account
  // switch (A→B) — distinct from initial login (null→A).
  const prevAuthUidRef = useRef<string | null | undefined>(undefined);

  // Keep XP module in sync with auth state.
  // setXpUserId must fire before any screen loads XP so all reads/writes
  // target the correct account-scoped key (or guest key when null).
  // syncXpOnLogin is consolidated here (previously split into index.tsx) so all
  // XP auth wiring lives in one place and fires regardless of which tab is active.
  useEffect(() => {
    const uid  = user?.id ?? null;
    const prev = prevAuthUidRef.current;
    prevAuthUidRef.current = uid;

    (async () => {
      // On sign-out (A→null) or account switch (A→B) — but NOT initial login
      // (null→A) — clear the per-account notification keys BEFORE any cloud sync
      // runs. These keys are global, so without this a new account inherits the
      // previous account's seen/unread state, dev unlocks, and celebration flags.
      // Awaiting here guarantees the wipe finishes before the sync below
      // re-downloads the new account's state (avoids clobbering it on switch).
      if (prev !== undefined && prev !== null && prev !== uid) {
        try {
          await AsyncStorage.multiRemove([
            '@flipstart/seen_achievement_ids',
            '@flipstart/dev_unlocked_achievements',
            '@flipstart/major_achievement_shown_v1',
            '@flipstart/seen_brand_discoveries',
            '@flipstart/revealed_brand_discoveries',
            '@flipstart/brand_discovery_meta',
            '@flipstart/dev_unlocked_brands',
            // Diamond seen + dev keys ARE now cleared on switch — Diamonds gained
            // cloud sync, so the new account's seen state is restored from Supabase
            // by the gated initial sync (the watcher awaits it before surfacing any
            // notification, preventing old diamonds from re-badging).
            '@flipstart/seen_diamond_ids_v1',
            '@flipstart/dev_unlocked_diamonds_v1',
          ]);
        } catch { /* never crash on cleanup */ }
      }

      const { setXpUserId, syncXpOnLogin } = await import('@/lib/huntXp');
      // Always update the active storage key first
      setXpUserId(uid);
      // Attribute analytics events to the signed-in profile (null for guests).
      try {
        const { setAnalyticsIdentity } = await import('@/lib/analytics');
        setAnalyticsIdentity(uid);
      } catch {}

      if (uid && syncedForUserRef.current !== uid) {
        // First time seeing this userId this session — run cloud merge
        syncedForUserRef.current = uid;
        syncXpOnLogin(uid).catch(() => {});
        // Achievements: merge remote seen/celebration state into local (background,
        // fail-safe). Passing [] for unlockedIds keeps this to the cross-device
        // seen/celebration merge; per-achievement unlock upserts happen in
        // progress.tsx when unlocks are detected.
        import('@/lib/achievementSync')
          .then(({ syncAchievementsWithSupabase }) => syncAchievementsWithSupabase(uid, []))
          .catch(() => {});
        // Brand Compendium: same pattern — download remote discoveries/seen state +
        // upload existing local discovery meta. Discovered-set upload/reconcile
        // happens in progress.tsx where the discovered set is computed.
        import('@/lib/brandSync')
          .then(({ syncBrandCompendiumWithSupabase }) => syncBrandCompendiumWithSupabase(uid, []))
          .catch(() => {});
      }

      if (!uid) {
        // Signed out — reset so next login triggers sync again
        syncedForUserRef.current = null;
      }
    })().catch(() => {});
  }, [user?.id]);

  return (
    <FlipStoreProvider userId={user?.id ?? null}>
      <ScanProvider>
        {children}
      </ScanProvider>
    </FlipStoreProvider>
  );
}

// Watches flips for newly-unlocked diamonds, achievements, and brand discoveries
// and pushes badge notifications immediately — even when the Progress tab is not
// in focus (e.g. after saving an item in Hunt Mode from the Home screen). Without
// this, achievement/brand notifications only appeared after navigating to the
// Progress tab.
function DiamondNotificationWatcher() {
  const { user } = useAuth();
  const { flips } = useFlipStore();
  const { addUnseenDiamonds, notifyNew, addUnseenBrands } = useAchievementNotifications();
  // Tick increments whenever hunt-context fires a change (item saved mid-hunt).
  const [huntTick, setHuntTick] = useState(0);
  // Tracks which account has had its initial cloud seen-state download awaited
  // this session. On the FIRST run for an account we await the download BEFORE
  // computing unseen, so already-seen items (restored from Supabase) don't
  // replay as new notifications after login / account switch. Reset to undefined
  // on sign-out so a re-login re-hydrates.
  const hydratedUidRef = useRef<string | undefined>(undefined);

  // Subscribe to active hunt mutations so we catch diamonds unlocked before
  // the hunt ends and the bundle lands in flips.
  useEffect(() => subscribeToHunt(() => setHuntTick(t => t + 1)), []);

  useEffect(() => {
    // Guests never generate progress badges. Reset hydration so the next login
    // re-downloads seen state before surfacing anything.
    if (!user?.id) { hydratedUidRef.current = undefined; resetProgressHydration(); return; }
    const uid = user.id;
    let alive = true;
    (async () => {
      // Build a synthetic HuntBundle from the active in-progress hunt so the
      // diamond matcher sees kept items immediately, without waiting for hunt end.
      const activeHunt = getActiveHunt();
      const activeEntries: HuntBundle[] = activeHunt?.items?.length
        ? [{
            type:               'hunt_bundle',
            id:                 'active',
            huntTitle:          'Active Hunt',
            timestamp:          Date.now(),
            startedAt:          (activeHunt as any).startedAt ?? Date.now(),
            endedAt:            Date.now(),
            durationMs:         0,
            keptItems:          (activeHunt.items as any[]).filter(i => i.kept),
            removedItems:       [],
            keptItemCount:      (activeHunt.items as any[]).filter(i => i.kept).length,
            removedItemCount:   0,
            totalCost:          0,
            totalEstimatedProfit: 0,
            estimatedROI:       0,
          }]
        : [];

      // ── Authoritative unlocked/discovered sets (local truth) ───────────────
      let diamondUnlockedIds = getUnlockedDiamondIds([...flips, ...activeEntries]);
      if (__DEV__) {
        try {
          const { getDevDiamondIds } = await import('@/lib/devDiamondOverrides');
          const devIds = await getDevDiamondIds();
          if (devIds.length > 0) diamondUnlockedIds = Array.from(new Set([...diamondUnlockedIds, ...devIds]));
        } catch {}
      }
      const diamondRecords = Object.values(computeUnlockedDiamonds(flips));

      const xp = await import('@/lib/huntXp')
        .then(({ loadXpProfile }) => loadXpProfile(uid).catch(() => null))
        .catch(() => null);
      if (!alive) return;

      const achvData = buildUserAchievementData(
        flips,
        xp?.completedHunts           ?? 0,
        xp?.huntStreak               ?? 0,
        xp?.discoveredBrands?.length ?? 0,
      );
      const achvUnlocked = getAllUnlockedIds(achvData);
      const discovered   = computeDiscoveredBrands(flips, xp?.discoveredBrands ?? []);

      // ── Sync. On the FIRST run for this account, AWAIT the download so local
      //    SEEN is hydrated from Supabase BEFORE we compute unseen (prevents the
      //    login/switch replay). Subsequent runs sync in the background. ───────
      const firstRun = hydratedUidRef.current !== uid;
      const runSync = () => Promise.all([
        import('@/lib/achievementSync').then(m => m.syncAchievementsWithSupabase(uid, achvUnlocked)).catch(() => {}),
        import('@/lib/brandSync').then(m => m.syncBrandCompendiumWithSupabase(uid, [...discovered])).catch(() => {}),
        import('@/lib/diamondSync').then(m => m.syncDiamondsWithSupabase(uid, diamondRecords)).catch(() => {}),
      ]);
      if (firstRun) {
        hydratedUidRef.current = uid;   // set before await to avoid duplicate hydration on rapid re-runs
        await runSync();
        // First open of this account on this device: mark all currently-unlocked
        // achievements/brands/diamonds as seen so a returning user gets no
        // notification spam. Only post-baseline unlocks will notify.
        await import('@/lib/progressHydration').then(m => m.seedSeenBaselineOnce(uid, {
          achievements: achvUnlocked,
          brands:       [...discovered],
          diamonds:     diamondUnlockedIds,
        })).catch(() => {});
        markProgressHydrated(uid);      // let the Progress tab skip its own wait
        if (!alive) return;
      } else {
        runSync();                      // background; SEEN already hydrated
      }

      // ── Surface badges from the (now-hydrated) local SEEN keys ─────────────
      const dUnseen = await getUnseenDiamondIds(diamondUnlockedIds);
      if (alive && dUnseen.length > 0) addUnseenDiamonds(dUnseen);

      if (achvUnlocked.length > 0) {
        const details = ACHIEVEMENT_CATEGORIES.flatMap(cat =>
          cat.achievements.map(a => ({
            id: a.id, name: a.name, flavor: a.flavor,
            categoryId: cat.id, categoryIcon: cat.icon,
            iconColor: cat.iconColor, barColor: cat.barColor,
          })),
        );
        if (alive) await notifyNew(achvUnlocked, details);
      }

      const bUnseen = await getUnseenBrandNames(discovered);
      if (alive && bUnseen.length > 0) addUnseenBrands(bUnseen);
    })();
    return () => { alive = false; };
  }, [flips, huntTick, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// Keep the native splash visible until we explicitly hide it.
// Called at module level so it runs before the first render —
// this is the only way to guarantee the splash doesn't flash.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Configure native fade animation on hide — SDK 51 API.
// setOptions must be called at module level, not inside a component.
if (typeof SplashScreen.setOptions === 'function') {
  SplashScreen.setOptions({ fade: true, duration: 400 });
}

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // ── Cinematic splash → app transition ────────────────────────────────────
  // Strategy: hold splash until BOTH conditions are met:
  //   (a) root layout has painted its first frame (onLayout fires)
  //   (b) a minimum of 1800ms has elapsed (feels intentional, not frozen)
  // whichever takes longer wins — usually the 1800ms timer on fast devices.
  // This eliminates the "flash then jump" by ensuring the app is visually
  // ready before the native splash fades out.
  const appOpacity   = useRef(new Animated.Value(0)).current;
  const layoutFired  = useRef(false);
  const timerFired   = useRef(false);
  const hideCalled   = useRef(false);

  const triggerTransition = useCallback(() => {
    if (!layoutFired.current || !timerFired.current) return;
    if (hideCalled.current) return;
    hideCalled.current = true;
    // Hide native splash — setOptions({fade,duration}) configured at module level
    SplashScreen.hideAsync().catch(() => {});
    // Simultaneously fade app in from invisible → visible
    Animated.timing(appOpacity, {
      toValue:         1,
      duration:        400,
      useNativeDriver: true,
    }).start();
  }, []);

  // Arm the minimum-time gate (1800ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      timerFired.current = true;
      triggerTransition();
    }, 1800);
    return () => clearTimeout(timer);
  }, [triggerTransition]);

  const onRootLayout = useCallback(() => {
    if (layoutFired.current) return;
    layoutFired.current = true;
    triggerTransition();
  }, [triggerTransition]);
  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  // ── Analytics: app lifecycle + session tracking ──────────────────────────
  // 30-minute timeout: returning from background within 30 min resumes the
  // same session instead of creating a new one. This prevents session count
  // inflation from quick phone checks.
  useEffect(() => {
    try {
      logEvent("app_opened");
      resumeOrStartSession();   // cold launch — always starts fresh session
    } catch { /* never throw */ }

    const handleAppStateChange = (nextState: AppStateStatus) => {
      try {
        if (nextState === "active") {
          resumeOrStartSession();   // resumes if < 30 min, starts new if > 30 min
        } else if (nextState === "background" || nextState === "inactive") {
          backgroundSession();      // notes backgrounded time, does NOT end session yet
        }
      } catch { /* never throw */ }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      try {
        endSession();   // app unmounting — force-close session
        sub.remove();
      } catch { /* never throw */ }
    };
  }, []);

  // ── Email confirmation deep link handler — DISABLED FOR DIAGNOSTIC ──────────
  // Disabled to isolate startup crash. Re-enable after TestFlight confirms boot.
  // useEffect(() => {
  //   const handleUrl = async (url: string) => {
  //     try {
  //       const parsed     = Linking.parse(url);
  //       const token_hash = parsed.queryParams?.token_hash as string | undefined;
  //       const type       = parsed.queryParams?.type       as string | undefined;
  //       if (token_hash && type) {
  //         await supabase.auth.verifyOtp({ token_hash, type: type as any });
  //       }
  //     } catch { /* never crash */ }
  //   };
  //   const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
  //   Linking.getInitialURL().then(url => { if (url) handleUrl(url); }).catch(() => {});
  //   return () => sub.remove();
  // }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <Animated.View
      style={{ flex: 1, opacity: appOpacity }}
      onLayout={onRootLayout}
    >
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
      <AchievementNotificationProvider>
      <AppProviders>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <DiamondNotificationWatcher />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="achievements" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="achievement-category" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="brand-compendium" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="brand-rarity" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="brand-detail" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="diamonds-in-the-rough" options={{ headerShown: false, animation: 'fade' }} />
            {__DEV__ && <Stack.Screen name="dev-achievements" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />}
            {__DEV__ && <Stack.Screen name="dev-brand-compendium" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />}
            {__DEV__ && <Stack.Screen name="dev-diamonds" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />}
            {/* Sold Comps visual preview.
                Stack.Protected blocks NAVIGATION to the route. The route file
                still exists in the production bundle — Expo Router is
                file-based, and a Stack.Screen declaration configures a route
                rather than creating one. The screen carries its own __DEV__
                denial as defence in depth. Both are client-side controls, which
                is acceptable here only because the payload is fake UI fixtures
                with no secrets and no network. */}
            <Stack.Protected guard={__DEV__}>
              <Stack.Screen name="dev-sold-comps" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
              {/* RevenueCat diagnostics. Same protection rationale: the route
                  file ships regardless, so Stack.Protected blocks navigation,
                  the screen guards itself, and the server secret is the real
                  boundary. */}
              <Stack.Screen name="dev-monetization" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
            </Stack.Protected>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ animation: "fade", headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="loading" options={{ presentation: "fullScreenModal", animation: "fade" }} />
            <Stack.Screen name="results" options={{ animation: "fade", gestureEnabled: false }} />
            <Stack.Screen name="analysis-details" options={{ animation: "fade" }} />
            {/* Flip Record. Was never registered — expo-router still resolved
                it by file, but declaring it keeps the transition consistent
                with every other pushed screen. */}
            <Stack.Screen name="scan-detail" options={{ animation: "fade" }} />
            <Stack.Screen name="hunt-history" options={{ animation: "fade" }} />
            <Stack.Screen name="hunt-item-detail" options={{ animation: "fade" }} />
            <Stack.Screen name="camera" options={{ animation: "slide_from_bottom", headerShown: false, presentation: "fullScreenModal" }} />
            <Stack.Screen name="oauth/callback" />
            <Stack.Screen name="auth" options={{ headerShown: false, animation: "fade" }} />
            <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
            <Stack.Screen name="auth/reset" options={{ headerShown: false }} />
            <Stack.Screen name="username-setup" options={{ headerShown: false, presentation: "fullScreenModal" }} />
            <Stack.Screen name="edit-profile" options={{ headerShown: false, presentation: "modal", animation: "slide_from_bottom" }} />
          </Stack>
          <StatusBar style="light" />
          <UpdateGate />
        </QueryClientProvider>
      </trpc.Provider>
      </AppProviders>
      </AchievementNotificationProvider>
      </AuthProvider>
    </GestureHandlerRootView>
    </Animated.View>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
    </ThemeProvider>
  );
}