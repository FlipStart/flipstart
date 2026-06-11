import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform, AppState, AppStateStatus, Animated } from "react-native";
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
// Deep link auth handler remains disabled until AuthProvider boot is confirmed stable.
// import * as Linking from "expo-linking";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

// AuthBridge: reads userId from AuthProvider (safe — no supabase import here)
// and passes it to FlipStoreProvider so scan/bundle sync knows the current user.
function AppProviders({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  // Keep XP module in sync with auth state.
  // setXpUserId must fire before any screen loads XP so all reads/writes
  // target the correct account-scoped key (or guest key when null).
  useEffect(() => {
    const uid = user?.id ?? null;
    import('@/lib/huntXp').then(({ setXpUserId }) => {
      setXpUserId(uid);
    }).catch(() => {});
  }, [user?.id]);

  return (
    <FlipStoreProvider userId={user?.id ?? null}>
      <ScanProvider>
        {children}
      </ScanProvider>
    </FlipStoreProvider>
  );
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
      <AppProviders>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ animation: "fade", headerShown: false }} />
            <Stack.Screen name="loading" options={{ presentation: "fullScreenModal", animation: "fade" }} />
            <Stack.Screen name="results" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="analysis-details" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="camera" options={{ animation: "slide_from_bottom", headerShown: false, presentation: "fullScreenModal" }} />
            <Stack.Screen name="oauth/callback" />
            <Stack.Screen name="auth" options={{ headerShown: false, presentation: "modal" }} />
            <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
            <Stack.Screen name="username-setup" options={{ headerShown: false, presentation: "fullScreenModal" }} />
          </Stack>
          <StatusBar style="light" />
        </QueryClientProvider>
      </trpc.Provider>
      </AppProviders>
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