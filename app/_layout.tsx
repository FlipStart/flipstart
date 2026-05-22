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

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

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
  // 1. App renders with opacity 0 immediately (nothing visible to user yet)
  // 2. Once layout is ready (onLayout fires), we have a real frame to fade into
  // 3. We hide the native splash — it fades out via the plugin's fade:true
  // 4. Simultaneously we fade the app in from 0→1 over 350ms
  // Result: one continuous crossfade, no flash, no jump cut
  const appOpacity  = useRef(new Animated.Value(0)).current;
  const [layoutReady, setLayoutReady] = useState(false);

  const onRootLayout = useCallback(() => {
    if (layoutReady) return;
    setLayoutReady(true);
    // Hide native splash (fade is handled by plugin's fade:true on iOS)
    SplashScreen.hideAsync().catch(() => {});
    // Fade app in simultaneously
    Animated.timing(appOpacity, {
      toValue:         1,
      duration:        350,
      useNativeDriver: true,
    }).start();
  }, [layoutReady]);
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
      <FlipStoreProvider>
      <ScanProvider>
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
          </Stack>
          <StatusBar style="light" />
        </QueryClientProvider>
      </trpc.Provider>
      </ScanProvider>
      </FlipStoreProvider>
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