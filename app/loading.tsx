/**
 * app/loading.tsx — Scan analysis screen
 *
 * Background image (assets/images/scan-loading-bg.png) contains:
 *   - green ribbon banner at top
 *   - glowing clock face in center
 *   - treasure chest scene below
 *
 * We overlay ONLY:
 *   - "Analyzing..." text inside the ribbon banner
 *   - live countdown number inside the clock face
 *   - status message below the clock
 *   - cancel button in the ground area below the chest
 *
 * The scan pipeline is unchanged — navigation fires the instant the
 * API response arrives. The countdown is perceived progress only.
 */

import {
  useEffect, useState, useRef, useCallback,
} from "react";
import {
  Text, View, StyleSheet, Platform, Pressable,
  ImageBackground, useWindowDimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, Easing, FadeIn, FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useScanContext } from "@/lib/scan-context";
import { trpc } from "@/lib/trpc";
import { consumePendingScan } from "@/lib/pending-scan";
import { ScanResult } from "@/lib/types";
import { V } from "@/constants/vintage";
import { FONTS } from "@/constants/typography";

// ─── Asset ────────────────────────────────────────────────────────────────────
// Save as: assets/images/scan-loading-bg.png
const BG_IMAGE = require("@/assets/images/scan-loading-bg.png");

// ─── Status messages tied to real pipeline stages ────────────────────────────
type StageKey = "preparing" | "identifying" | "market" | "finishing";

const STAGE_MESSAGES: Record<StageKey, string> = {
  preparing:   "Preparing image...",
  identifying: "Scanning item...",
  market:      "Searching market data...",
  finishing:   "Finalizing results...",
};

// Estimated total duration in seconds — conservative upper bound.
// Navigation fires IMMEDIATELY when the real response arrives.
// This value only affects how the countdown counts down, not when we navigate.

// ─── Component ────────────────────────────────────────────────────────────────

export default function LoadingScreen() {
  const router       = useRouter();
  const { imageUri } = useLocalSearchParams<{ imageUri: string }>();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const colors       = useColors();
  const { addScan }  = useScanContext();

  const [stage,     setStage]     = useState<StageKey>("preparing");
  const [error,     setError]     = useState<string | null>(null);

  const hasNavigated = useRef(false);
  // hasStartedRef prevents double-fire in React Strict Mode (dev builds run
  // every effect twice intentionally). Set synchronously before any await so
  // the second invocation hits this guard before any async work begins.
  const hasStartedRef = useRef(false);
  const startTime    = useRef(Date.now());

  const analyzeFastMutation = trpc.scan.analyzeFast.useMutation();

  // Countdown removed — showing a number that doesn't match real API speed
  // damages trust. Stage messages below the clock convey progress instead.

  // ── Stage helper ──────────────────────────────────────────────────────────
  const advanceStage = useCallback((s: StageKey) => {
    setStage(s);
    console.log(`[loading] stage → ${s}`);
  }, []);

  // ── Pulse animation on countdown number ───────────────────────────────────
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.00, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  // ── Scan pipeline ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Synchronous guard — fires before any async work so Strict Mode
    // double-invocation is blocked before the second doScan() call starts.
    if (hasStartedRef.current || hasNavigated.current) return;
    hasStartedRef.current = true;

    const doScan = async () => {
      console.log("[loading] pipeline start");
      advanceStage("preparing");

      const pending = consumePendingScan();
      if (!pending?.imageBase64) {
        console.error("[loading] no pending scan data — aborting");
        setError("Couldn't find the selected image. Please try again.");
        return;
      }

      const { imageBase64, mimeType } = pending;
      console.log(`[loading] image ready — mimeType: ${mimeType}, base64 length: ${imageBase64.length}`);

      advanceStage("identifying");
      console.log("[loading] analysis request start");

      try {
        const result = await analyzeFastMutation.mutateAsync({
          imageBase64,
          mimeType: mimeType || "image/jpeg",
        });

        console.log("[loading] analysis response received");
        advanceStage("market");

        if (hasNavigated.current) return;

        advanceStage("finishing");

        const scanId = `scan_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        const safeIdentification = {
          item_name:      "Unknown Item",
          brand:          "Unknown",
          category:       "Other",
          estimated_era:  "Unknown",
          style_labels:   [] as string[],
          material_guess: "Unknown",
          ...(result.identification || {}),
        };
        if (!Array.isArray(safeIdentification.style_labels)) {
          safeIdentification.style_labels = [];
        }

        const safeMarketData = {
          estimated_resale_range: { low: 0, high: 0 },
          average_sold_price:     0,
          suggested_buy_price:    0,
          demand:                 "Medium" as const,
          sell_speed:             "Moderate" as const,
          competition_level:      "Unknown",
          base_estimated_value:   0,
          price_adjustments:      [] as { reason: string; impact: number; type: "positive" | "negative" }[],
          adjusted_estimated_value: 0,
          ...(result.market_data || {}),
        };
        if (!safeMarketData.estimated_resale_range) {
          safeMarketData.estimated_resale_range = { low: 0, high: 0 };
        }
        if (!Array.isArray(safeMarketData.price_adjustments)) {
          safeMarketData.price_adjustments = [];
        }

        const safeRiskAnalysis = {
          match_confidence: 0,
          risk_flags:       [] as string[],
          ...(result.risk_analysis || {}),
        };
        if (!Array.isArray(safeRiskAnalysis.risk_flags)) {
          safeRiskAnalysis.risk_flags = [];
        }

        const scanResult: ScanResult = {
          id:             scanId,
          imageUri:       result.imageUrl || imageUri || "",
          timestamp:      Date.now(),
          identification: safeIdentification,
          market_data:    safeMarketData,
          risk_analysis:  safeRiskAnalysis,
        };

        addScan(scanResult);

        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }

        // Navigate immediately — no artificial delay
        hasNavigated.current = true;
        console.log("[loading] navigating to results");
        router.replace("/results" as any);

      } catch (err: any) {
        console.error("[loading] error caught:", err);

        const raw: string = err?.message ?? "";
        let msg: string;

        if (
          raw.toLowerCase().includes("unsupported image") ||
          raw.toLowerCase().includes("image format") ||
          raw.toLowerCase().includes("heic") ||
          (raw.toLowerCase().includes("png") && raw.toLowerCase().includes("jpeg"))
        ) {
          msg = "This image format wasn't supported. Try taking a new photo or choose a JPEG/PNG from your library.";
        } else if (
          raw.toLowerCase().includes("network") ||
          raw.toLowerCase().includes("fetch") ||
          raw.toLowerCase().includes("connect")
        ) {
          msg = "Connection error. Please check your internet and try again.";
        } else if (raw.length > 0 && raw.length < 120 && !raw.startsWith("{")) {
          msg = raw;
        } else {
          msg = "Analysis failed. Please try again.";
        }

        setError(msg);

        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
      }
    };

    doScan();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Layout position constants ──────────────────────────────────────────────
  // Named constants — tune these to adjust overlay positions without
  // hunting through magic numbers elsewhere in the file.
  const HEADER_H                 = 56;    // header height (px)
  const BANNER_TEXT_Y_RATIO      = 0.072; // fraction of imgH → ribbon banner center
  const CLOCK_CENTER_Y_RATIO     = 0.275; // fraction of imgH → clock face center
  const STATUS_TEXT_Y_RATIO      = 0.505; // fraction of imgH → status msg below clock
  const CANCEL_BUTTON_BOTTOM_INSET = 40;  // px from bottom of image area

  const imgH    = screenH - HEADER_H;
  const bannerY = imgH * BANNER_TEXT_Y_RATIO;
  const clockY  = imgH * CLOCK_CENTER_Y_RATIO;
  const statusY = imgH * STATUS_TEXT_Y_RATIO;

  // ── Cancel handler ────────────────────────────────────────────────────────
  const handleCancel = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    hasNavigated.current = true;
    router.back();
  };

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={s.errorContainer}>
          <Animated.View entering={FadeIn.duration(300)}>
            <View style={[s.errorIconWrap, { backgroundColor: colors.error + "20" }]}>
              <MaterialIcons name="error-outline" size={48} color={colors.error} />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(150).duration(300)} style={s.errorTextBlock}>
            <Text style={[s.errorTitle, { color: colors.foreground }]}>Analysis Failed</Text>
            <Text style={[s.errorBody,  { color: colors.muted }]}>{error}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(300).duration(300)}>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                }
                router.back();
              }}
              style={({ pressed }) => [
                s.retryBtn,
                { backgroundColor: colors.primary },
                pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
              ]}
            >
              <MaterialIcons name="refresh" size={20} color={V.white} />
              <Text style={s.retryBtnText}>Try Again</Text>
            </Pressable>
          </Animated.View>
        </View>
      </ScreenContainer>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  return (
    <View style={s.flex}>
      {/* Header — sits above the background image */}
      <View style={[s.header, { backgroundColor: "transparent" }]}>
        <Pressable
          onPress={handleCancel}
          hitSlop={10}
          style={({ pressed }) => [s.headerIcon, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color={V.white} />
        </Pressable>

        <Text style={s.headerTitle}>FlipStart</Text>

        <View style={s.headerIcon} />
      </View>

      {/* Background image fills everything below the header */}
      <ImageBackground
        source={BG_IMAGE}
        style={s.bg}
        resizeMode="cover"
      >
        {/* Subtle dark scrim so text overlays are always readable */}
        <View style={s.scrim} />

        {/* ── "Analyzing..." inside the green ribbon banner ────────────── */}
        <Animated.View
          entering={FadeIn.duration(400)}
          style={[s.bannerOverlay, { top: bannerY }]}
          pointerEvents="none"
        >
          <Text style={s.bannerText}>Analyzing...</Text>
        </Animated.View>

        {/* ── Animated pulse dot in clock center — shows life without fake numbers */}
        <Animated.View
          style={[s.clockOverlay, { top: clockY }, pulseStyle]}
          pointerEvents="none"
        >
          <View style={s.pulseDot} />
        </Animated.View>

        {/* ── Status message below the clock ───────────────────────────── */}
        <Animated.View
          entering={FadeIn.delay(200).duration(400)}
          style={[s.statusOverlay, { top: statusY }]}
          pointerEvents="none"
        >
          <Text style={s.statusText}>{STAGE_MESSAGES[stage]}</Text>
        </Animated.View>

        {/* ── Cancel Search button in the lower ground area ─────────────── */}
        <View style={[s.cancelWrapper, { bottom: CANCEL_BUTTON_BOTTOM_INSET }]}>
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => [
              s.cancelBtn,
              pressed && { transform: [{ scale: 0.96 }], opacity: 0.85 },
            ]}
          >
            <Text style={s.cancelBtnText}>Cancel Search</Text>
          </Pressable>
        </View>

      </ImageBackground>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#1A2A10" },

  // Header
  header: {
    height:         56,
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    // Sits on top of the image, styled to blend
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  headerIcon:  { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  headerTitle: {
    fontFamily:    FONTS.serif,
    fontSize:      20,
    fontWeight:    "700",
    color:         "#ECE7D3",   // Antique Cream — warm, not bright white
    letterSpacing: 0.2,
  },

  // Background
  bg: {
    flex: 1,
  },

  // Very slight dark overlay so text is always legible
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.08)",
  },

  // ── Text overlays — all absolute inside the ImageBackground ──────────────

  // "Analyzing..." sits inside the ribbon banner
  bannerOverlay: {
    position:  "absolute",
    left:      0,
    right:     0,
    alignItems:"center",
    justifyContent: "center",
  },
  bannerText: {
    fontFamily:    FONTS.serif,
    fontSize:      22,
    fontWeight:    "800",
    color:         "#ECE7D3",   // Antique Cream — warm, not bright white
    letterSpacing: 1.2,
    textShadowColor:  "rgba(0,0,0,0.40)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Countdown sits in the center of the clock face
  clockOverlay: {
    position:       "absolute",
    left:           0,
    right:          0,
    alignItems:     "center",
    justifyContent: "center",
  },
  pulseDot: {
    width:           18,
    height:          18,
    borderRadius:    9,
    backgroundColor: "rgba(190,156,44,0.80)",  // warm gold — visible on clock face
    shadowColor:     "#BE9C2C",
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.9,
    shadowRadius:    10,
    elevation:       4,
  },

  // Status message below clock, above chest
  statusOverlay: {
    position:       "absolute",
    left:           0,
    right:          0,
    alignItems:     "center",
    paddingHorizontal: 32,
  },
  statusText: {
    fontFamily:    FONTS.serif,
    fontSize:      15,
    fontWeight:    "600",
    color:         "#F0E8C8",
    textAlign:     "center",
    letterSpacing: 0.3,
    textShadowColor:  "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  // Cancel button in lower earth area
  cancelWrapper: {
    position:       "absolute",
    left:           0,
    right:          0,
    alignItems:     "center",
  },
  cancelBtn: {
    paddingHorizontal: 32,
    paddingVertical:   12,
    borderRadius:      50,
    backgroundColor:   "rgba(160,120,20,0.95)",   // deeper vintage gold, readable on image
    borderWidth:       1.5,
    borderColor:       "#9A7A10",
    shadowColor:       "#3A2000",
    shadowOffset:      { width: 0, height: 3 },
    shadowOpacity:     0.40,
    shadowRadius:      6,
    elevation:         5,
  },
  cancelBtnText: {
    fontFamily:    FONTS.serif,
    fontSize:      15,
    fontWeight:    "700",
    color:         "#1E1409",
    letterSpacing: 0.3,
  },

  // ── Error state ────────────────────────────────────────────────────────────
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems:     "center",
    paddingHorizontal: 32,
    gap: 0,
    backgroundColor: V.pageBg,
  },
  errorIconWrap: {
    width: 80, height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  errorTextBlock: {
    alignItems: "center",
    marginBottom: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    fontFamily: FONTS.serif,
  },
  errorBody: {
    fontSize:   14,
    textAlign:  "center",
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  retryBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius:    50,
  },
  retryBtnText: {
    fontSize:   16,
    fontWeight: "700",
    color:      V.white,
  },
});