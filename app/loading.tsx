/**
 * app/loading.tsx — Scan analysis screen
 *
 * Background image: green ribbon banner, clock face, treasure chest.
 * Overlays: banner text, pulsing gold dot, rotating status message,
 *           estimated confidence bar, cancel button.
 *
 * No fake countdown. No fake eBay/Depop claims.
 * Navigation fires IMMEDIATELY when the API responds.
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
  withRepeat, withSequence, withTiming, withSpring,
  Easing, FadeIn, FadeInDown,
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
import { useAudioPlayer } from "expo-audio";
import { FailStateScreen, type FailType } from "@/components/scan/FailStateScreen";
import { logEvent, incrementSessionCount, saveScanRecord } from "@/lib/analytics";
import { isHuntActive } from "@/lib/hunt-context";

// ─── Assets ───────────────────────────────────────────────────────────────────
const BG_IMAGE   = require("@/assets/images/scan-loading-bg.png");
const COIN_SOUND = require("@/assets/images/sounds/coin-pour.mp3");

// ─── Message pool ─────────────────────────────────────────────────────────────
// Honest messages only — no fake data-source claims.
// Shuffled on mount so every scan feels different.
const MESSAGE_POOL = [
  "Reading item details...",
  "Detecting brand signals...",
  "Analyzing category...",
  "Checking condition clues...",
  "Comparing resale patterns...",
  "Estimating buyer demand...",
  "Reviewing style and era...",
  "Examining material and finish...",
  "Building resale report...",
  "Calculating profit potential...",
  "Assessing market competition...",
  "Reviewing similar sold items...",
];

const MESSAGE_INTERVAL_MS = 3000; // 3 seconds — premium, unhurried feel

// ─── Confidence config ────────────────────────────────────────────────────────
// Estimated progress, NOT actual AI result confidence.
// Rises to ~95% while loading, pauses there until backend responds,
// then jumps to 100% right before navigation.
const CONFIDENCE_TICK_MS   = 250;   // how often confidence updates
const CONFIDENCE_CRUISE_MS = 6000;  // time to reach 95%
const CONFIDENCE_HOLD      = 95;    // max before backend responds
const HARD_TIMEOUT_MS      = 30000; // 30s — generous but not infinite
const CONFIDENCE_HAPTIC_AT = [25, 50, 75]; // subtle haptics at these milestones

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LoadingScreen() {
  const router       = useRouter();
  const { imageUri } = useLocalSearchParams<{ imageUri: string }>();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const colors       = useColors();
  const { addScan }  = useScanContext();

  // Shuffled message queue — different every scan
  const [messages]     = useState<string[]>(() => shuffleArray(MESSAGE_POOL));
  const [msgIndex,     setMsgIndex]     = useState(0);
  const [confidence,   setConfidence]   = useState(0);
  const [finalizing,   setFinalizing]   = useState(false);
  const [scanKey,  setScanKey]   = useState(0);   // increment to re-trigger doScan
  const [retryCount, setRetryCount] = useState(0); // auto-retry attempts made
  const [failState, setFailState] = useState<{
    type:        FailType;
    message:     string;
    confidence?: number;
  } | null>(null);

  const hasNavigated    = useRef(false);
  const hasStartedRef   = useRef(false);
  const scanStartTime   = useRef(Date.now());
  const lastHapticAt    = useRef(0);
  const timeoutIdRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPendingScan = useRef<import('@/lib/pending-scan').PendingScan | null>(null);
  const retryAttemptRef = useRef(0);   // tracks auto-retry attempts for exponential backoff

  // ── Audio ─────────────────────────────────────────────────────────────────
  const player       = useAudioPlayer(COIN_SOUND);
  const soundStarted = useRef(false);

  const analyzeFastMutation = trpc.scan.analyzeFast.useMutation();

  // ── Rotating messages (every 3s) ─────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (hasNavigated.current) return;
      setMsgIndex(i => (i + 1) % messages.length);
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [messages]);

  // ── Estimated confidence bar ──────────────────────────────────────────────
  const confidenceWidth = useSharedValue(0);

  useEffect(() => {
    const id = setInterval(() => {
      if (hasNavigated.current) return;
      setConfidence(prev => {
        if (prev >= CONFIDENCE_HOLD) {
          if (!finalizing) setFinalizing(true);
          return prev;
        }
        const elapsed    = Date.now() - scanStartTime.current;
        const target     = Math.min(CONFIDENCE_HOLD, (elapsed / CONFIDENCE_CRUISE_MS) * CONFIDENCE_HOLD);
        const next       = Math.min(CONFIDENCE_HOLD, prev + (target - prev) * 0.12 + 0.4);

        for (const milestone of CONFIDENCE_HAPTIC_AT) {
          if (prev < milestone && next >= milestone && lastHapticAt.current !== milestone) {
            lastHapticAt.current = milestone;
            if (Platform.OS !== "web") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
          }
        }

        return next;
      });
    }, CONFIDENCE_TICK_MS);
    return () => clearInterval(id);
  }, [finalizing]);

  // Sync confidence value to Reanimated width
  useEffect(() => {
    confidenceWidth.value = withTiming(confidence / 100, {
      duration: CONFIDENCE_TICK_MS * 1.2,
      easing:   Easing.out(Easing.ease),
    });
  }, [confidence]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${(confidenceWidth.value * 100).toFixed(1)}%` as any,
  }));

  // ── Pulse animations ──────────────────────────────────────────────────────
  const dotScale    = useSharedValue(1);
  const ringScale   = useSharedValue(0.6);
  const ringOpacity = useSharedValue(0.7);

  useEffect(() => {
    dotScale.value = withRepeat(
      withSequence(
        withTiming(1.40, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.00, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    ringScale.value = withRepeat(
      withSequence(
        withTiming(2.4, { duration: 1400, easing: Easing.out(Easing.ease) }),
        withTiming(0.6, { duration: 0 }),
      ),
      -1,
      false,
    );
    ringOpacity.value = withRepeat(
      withSequence(
        withTiming(0,   { duration: 1400, easing: Easing.out(Easing.ease) }),
        withTiming(0.65, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, []);

  const dotStyle  = useAnimatedStyle(() => ({ transform: [{ scale: dotScale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity:   ringOpacity.value,
  }));

  // ── Scan pipeline ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasStartedRef.current || hasNavigated.current) return;
    hasStartedRef.current = true;

    const doScan = async () => {
      console.log("[loading] pipeline start");
      scanStartTime.current = Date.now();

      // Start coin sound
      if (!soundStarted.current) {
        soundStarted.current = true;
        try {
          player.volume = 0.45;
          player.loop   = false;
          player.play();
        } catch { /* never block analysis */ }
      }

      const pending = consumePendingScan();
      if (!pending?.front?.base64) {
        console.error("[loading] no pending scan data — aborting");
        setFailState({ type: "bad_input", message: "We couldn't load the selected image. Please go back and try again." });
        return;
      }

      // Cache for retry — consumePendingScan() clears the module store
      lastPendingScan.current = pending;

      const { front, tag, detail } = pending;
      const imageBase64 = front.base64;
      const mimeType    = front.mimeType;
      console.log(`[loading] images ready — front✓ tag:${!!tag} detail:${!!detail}`);
      console.log("[loading] analysis request start — timeout in", HARD_TIMEOUT_MS / 1000, "s");

      // Analytics: scan submitted
      try {
        logEvent("scan_submitted", {
          tagPresent:        !!tag,
          detailPresent:     !!detail,
          scan_type:         "normal",
          image_count:       1 + (!!tag ? 1 : 0) + (!!detail ? 1 : 0),
          has_tag_photo:     !!tag,
          has_detail_photo:  !!detail,
          model_name:        "gpt-4o",
          api_provider:      "openai",
        });
        incrementSessionCount("scanCount");
      } catch { /* never block analysis */ }

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutIdRef.current = setTimeout(() => {
            console.log("[loading] hard timeout triggered after", HARD_TIMEOUT_MS / 1000, "s");
            reject(new Error("__TIMEOUT__"));
          }, HARD_TIMEOUT_MS);
        });

        const result = await Promise.race([
          analyzeFastMutation.mutateAsync({
            imageBase64,
            mimeType:           mimeType || "image/jpeg",
            tagImageBase64:     tag?.base64,
            tagMimeType:        tag?.mimeType,
            detailImageBase64:  detail?.base64,
            detailMimeType:     detail?.mimeType,
          }),
          timeoutPromise,
        ]);

        // Backend responded — cancel timeout immediately
        if (timeoutIdRef.current !== null) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }

        console.log("[loading] analysis response received");
        if (hasNavigated.current) return;

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
          allImageUris:   [
            result.imageUrl || imageUri || "",
          ].filter(Boolean) as string[],
          timestamp:      Date.now(),
          identification: safeIdentification,
          market_data:    safeMarketData,
          risk_analysis:  safeRiskAnalysis,
          // listings intentionally omitted — undefined until user generates them
        };

        // Low-confidence detection
        const matchConf = safeRiskAnalysis.match_confidence ?? 0;
        console.log("[loading] match_confidence:", matchConf);

        if (matchConf > 0 && matchConf < 35) {
          console.log("[loading] bad_input: confidence too low to use:", matchConf);
          addScan(scanResult);
          try { player.pause(); } catch { /* ignore */ }
          try {
            logEvent("scan_failed", { errorType: "bad_input", confidence: matchConf, scan_type: "normal", image_count: 1 + (!!tag ? 1 : 0) + (!!detail ? 1 : 0), model_name: "gpt-4o" });
            incrementSessionCount("failedScanCount");
          } catch { /* never block */ }
          setFailState({ type: "bad_input", message: "", confidence: matchConf });
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          }
          return;
        }

        if (matchConf > 0 && matchConf < 55) {
          console.log("[loading] low_confidence: showing warning screen:", matchConf);
          addScan(scanResult);
          try { player.pause(); } catch { /* ignore */ }
          try {
            logEvent("scan_failed", { errorType: "low_confidence", confidence: matchConf, scan_type: "normal", image_count: 1 + (!!tag ? 1 : 0) + (!!detail ? 1 : 0), model_name: "gpt-4o" });
            incrementSessionCount("failedScanCount");
          } catch { /* never block */ }
          setFailState({ type: "low_confidence", message: "", confidence: matchConf });
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          }
          return;
        }

        addScan(scanResult);

        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }

        // Analytics: scan completed + save structured scan record for future AI memory
        try {
          logEvent("scan_completed", {
            confidence:        matchConf,
            category:          safeIdentification.category,
            brand:             safeIdentification.brand,
            recommendation:    result.recommendation ?? "",
            // Cost/budget metadata (client-side knowables; token data is server-only)
            scan_type:         "normal",
            image_count:       1 + (!!tag ? 1 : 0) + (!!detail ? 1 : 0),
            has_tag_photo:     !!tag,
            has_detail_photo:  !!detail,
            model_name:        "gpt-4o",
            api_provider:      "openai",
            // prompt_tokens / completion_tokens / estimated_cost_usd: server-only, left null
          });
          incrementSessionCount("completedScanCount");
          saveScanRecord({
            scanId:             scanResult.id,
            imageUri:           scanResult.imageUri,
            tagImagePresent:    !!tag,
            detailImagePresent: !!detail,
            aiTitle:            safeIdentification.item_name,
            aiCategory:         safeIdentification.category,
            aiBrand:            safeIdentification.brand,
            aiEra:              safeIdentification.estimated_era,
            aiMaterial:         safeIdentification.material_guess,
            aiRecommendation:   result.recommendation ?? "",
            aiResaleLow:        safeMarketData.estimated_resale_range.low,
            aiResaleHigh:       safeMarketData.estimated_resale_range.high,
            aiEstimatedValue:   safeMarketData.adjusted_estimated_value,
            aiPlatform:         result.best_platform ?? "",
            aiSellSpeed:        safeMarketData.sell_speed,
            aiDemand:           safeMarketData.demand,
            aiConfidence:       matchConf,
            styleLabels:        safeIdentification.style_labels,
            riskFlags:          safeRiskAnalysis.risk_flags,
          });
        } catch { /* never block navigation */ }

        setConfidence(100);
        try { player.pause(); } catch { /* ignore */ }

        setTimeout(() => {
          if (hasNavigated.current) return;
          hasNavigated.current = true;
          if (isHuntActive()) {
            // Replace loading with hunt-item-detail — keeps stack clean so
            // back() from Discovery Analysis returns to hunt-active, not loading
            router.replace("/hunt-item-detail" as any);
          } else {
            router.replace("/results" as any);
          }
        }, 600);

      } catch (err: any) {
        if (timeoutIdRef.current !== null) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
        try { player.pause(); } catch { /* ignore */ }

        const raw: string = err?.message ?? "";
        const durationMs  = Date.now() - scanStartTime.current;

        // ── Classify error type ────────────────────────────────────────────
        let failType: FailType;

        if (raw === "__TIMEOUT__" || raw.toLowerCase().includes("timed out")) {
          failType = "timeout";
        } else if (
          raw.includes("GLOBAL_SCAN_LIMIT_REACHED") ||
          raw.toLowerCase().includes("scan limit")
        ) {
          // Scan limit — show immediately, do not auto-retry
          try { player.pause(); } catch {}
          setFailState({ type: "timeout", message: "Daily scan limit reached. Try again tomorrow." });
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          }
          return;
        } else if (
          raw.toLowerCase().includes("network request failed") ||
          raw.toLowerCase().includes("network error") ||
          raw.toLowerCase().includes("failed to fetch") ||
          raw.toLowerCase().includes("connection refused") ||
          raw.toLowerCase().includes("no internet") ||
          raw.toLowerCase().includes("offline")
        ) {
          failType = "offline";
        } else if (
          raw.toLowerCase().includes("unsupported image") ||
          raw.toLowerCase().includes("image format") ||
          raw.toLowerCase().includes("heic")
        ) {
          failType = "bad_input";
        } else if (
          raw.toLowerCase().includes("transform") ||
          raw.toLowerCase().includes("trpc") ||
          raw.toLowerCase().includes("internal server error") ||
          raw.toLowerCase().includes("500") ||
          raw.toLowerCase().includes("502") ||
          raw.toLowerCase().includes("503") ||
          raw.toLowerCase().includes("504") ||
          raw.toLowerCase().includes("service unavailable") ||
          raw.toLowerCase().includes("bad gateway") ||
          raw.toLowerCase().includes("railway")
        ) {
          failType = "server";
        } else {
          failType = "server"; // default unknown → server, most recoverable
        }

        // ── Exponential auto-retry (server/offline/timeout only) ───────────
        // Attempt 1 → immediate, Attempt 2 → +2s, Attempt 3 → +5s
        // Bad input / low confidence → never auto-retry (user action needed)
        const shouldAutoRetry = (failType === "server" || failType === "timeout" || failType === "offline")
          && retryAttemptRef.current < 3;

        if (shouldAutoRetry) {
          const attempt = retryAttemptRef.current;
          retryAttemptRef.current += 1;
          const delayMs = attempt === 0 ? 0 : attempt === 1 ? 2000 : 5000;

          console.log(`[loading] auto-retry ${attempt + 1}/3 in ${delayMs}ms — type: ${failType}`);
          try {
            logEvent("scan_auto_retry", {
              attempt:     attempt + 1,
              failType,
              delayMs,
              errorRaw:    raw.slice(0, 80),
            });
          } catch { /* never block */ }

          await new Promise(res => setTimeout(res, delayMs));

          // Restore pending scan for retry and re-run doScan
          if (lastPendingScan.current) {
            const { setPendingScan } = require("@/lib/pending-scan");
            setPendingScan(lastPendingScan.current);
          }
          hasStartedRef.current = false;
          setScanKey(k => k + 1);
          return;
        }

        // ── All retries exhausted — show fail screen ────────────────────────
        const totalAttempts = retryAttemptRef.current;
        console.error(`[loading] all retries exhausted (${totalAttempts} auto + manual) — showing fail screen. type: ${failType} raw: ${raw.substring(0, 80)}`);

        try {
          logEvent("scan_failed", {
            errorType:     failType,
            autoRetries:   totalAttempts,
            durationMs,
            errorRaw:      raw.slice(0, 80),
          });
          incrementSessionCount("failedScanCount");
        } catch { /* never block */ }

        const safeMsg = (raw.length > 0 && raw.length < 120 && !raw.startsWith("{") && raw !== "__TIMEOUT__")
          ? raw : "";
        setRetryCount(totalAttempts);
        setFailState({ type: failType, message: safeMsg });

        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
      }
    };

    doScan();
  // scanKey increments on retry — re-runs this effect so doScan fires again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanKey]);

  // ── Layout constants ──────────────────────────────────────────────────────
  const HEADER_H                   = 56;
  const BANNER_TEXT_Y_RATIO        = 0.072;
  const CLOCK_CENTER_Y_RATIO       = 0.275;
  const STATUS_TEXT_Y_RATIO        = 0.505;
  const CANCEL_BUTTON_Y_RATIO      = 0.84;

  const imgH    = screenH - HEADER_H;
  const bannerY = imgH * BANNER_TEXT_Y_RATIO;
  const clockY  = imgH * CLOCK_CENTER_Y_RATIO;
  const statusY = imgH * STATUS_TEXT_Y_RATIO;
  const cancelY = imgH * CANCEL_BUTTON_Y_RATIO;

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    try { player.pause(); } catch { /* ignore */ }
    hasNavigated.current = true;
    router.back();
  };

  // ── Derived display ───────────────────────────────────────────────────────
  const currentMessage = finalizing
    ? "Finalizing analysis..."
    : messages[msgIndex % messages.length];

  const confidencePct = Math.round(confidence);

  // ── Error state ───────────────────────────────────────────────────────────
  if (failState) {
    const handleRetry = () => {
      console.log("[loading] manual retry pressed — resetting state machine");
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (lastPendingScan.current) {
        const { setPendingScan } = require("@/lib/pending-scan");
        setPendingScan(lastPendingScan.current);
      }
      // Reset all state for a clean retry
      retryAttemptRef.current = 0;
      hasStartedRef.current = false;
      hasNavigated.current  = false;
      soundStarted.current  = false;
      lastHapticAt.current  = 0;
      setRetryCount(0);
      setFailState(null);
      setConfidence(0);
      setFinalizing(false);
      setScanKey(k => k + 1);
    };
    const handleRetake = () => {
      console.log("[loading] retake pressed — navigating to camera screen");
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      try { player.pause(); } catch { /* ignore */ }
      hasNavigated.current = true;
      router.replace("/camera" as any);
    };
    const handleContinueAnyway =
      (failState.type === "low_confidence" || failState.type === "bad_input")
        ? () => {
            hasNavigated.current = true;
            if (isHuntActive()) {
              router.replace("/hunt-item-detail" as any);
            } else {
              router.replace("/results" as any);
            }
          }
        : undefined;

    // Return to Hunt — preserve all hunt progress, just go back to live hunt
    const handleReturnToHunt = isHuntActive()
      ? () => {
          console.log("[loading] returning to hunt — preserving all hunt progress");
          try { player.pause(); } catch { /* ignore */ }
          hasNavigated.current = true;
          router.replace("/hunt-active" as any);
        }
      : undefined;

    return (
      <FailStateScreen
        type={failState.type}
        message={failState.message}
        confidence={failState.confidence}
        retryCount={retryCount}
        onRetry={handleRetry}
        onRetake={handleRetake}
        onReturnToHunt={handleReturnToHunt}
        onContinueAnyway={handleContinueAnyway}
      />
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  return (
    <View style={s.flex}>
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

      <ImageBackground source={BG_IMAGE} style={s.bg} resizeMode="cover">
        <View style={s.scrim} />

        {/* ── Banner text ── */}
        <Animated.View
          entering={FadeIn.duration(400)}
          style={[s.bannerOverlay, { top: bannerY }]}
          pointerEvents="none"
        >
          <Text style={s.bannerText}>Analyzing...</Text>
        </Animated.View>

        {/* ── Clock center: pulsing gold dot + glow ring ── */}
        <View style={[s.clockOverlay, { top: clockY }]} pointerEvents="none">
          <Animated.View style={[s.glowRing, ringStyle]} />
          <Animated.View style={[s.dotWrap, dotStyle]}>
            <View style={s.pulseDot} />
          </Animated.View>
        </View>

        {/* ── Status + confidence bar ── */}
        <View style={[s.statusOverlay, { top: statusY }]} pointerEvents="none">
          <Text style={s.statusText}>{currentMessage}</Text>

          {/* Confidence bar */}
          <View style={s.barTrack}>
            <Animated.View style={[s.barFill, barStyle]} />
          </View>
          <View style={s.confidencePill}>
            <Text style={s.confidenceLabel}>
              {confidencePct < 100
                ? `Estimated confidence: ${confidencePct}%`
                : "Complete"}
            </Text>
          </View>
        </View>

        {/* ── Cancel button ── */}
        <View style={[s.cancelWrapper, { top: cancelY }]}>
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => [s.cancelBtn, pressed && { transform: [{ scale: 0.96 }], opacity: 0.85 }]}
          >
            <Text style={s.cancelBtnText}>✕  Cancel scan</Text>
          </Pressable>
        </View>

      </ImageBackground>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  flex:  { flex: 1, backgroundColor: "#1A2A10" },
  bg:    { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.08)" },

  header: {
    height: 56, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 16,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  headerIcon:  { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: "700", color: "#ECE7D3", letterSpacing: 0.2 },

  bannerOverlay: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  bannerText: {
    fontFamily: FONTS.serif, fontSize: 22, fontWeight: "800",
    color: "#ECE7D3", letterSpacing: 1.2,
    textShadowColor: "rgba(0,0,0,0.40)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },

  // Clock
  clockOverlay: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  glowRing: {
    position: "absolute", width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(190,156,44,0.35)",
  },
  dotWrap: { alignItems: "center", justifyContent: "center" },
  pulseDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(190,156,44,0.88)",
    shadowColor: "#BE9C2C", shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 14, elevation: 6,
  },

  // Status + bar
  statusOverlay: {
    position: "absolute", left: 0, right: 0,
    alignItems: "center", paddingHorizontal: 32,
    gap: 10,
  },
  statusText: {
    fontFamily: FONTS.serif, fontSize: 15, fontWeight: "600",
    color: "#F0E8C8", textAlign: "center", letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  barTrack: {
    width: "80%", height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  barFill: {
    height: "100%", borderRadius: 2,
    backgroundColor: "rgba(190,156,44,0.85)",
  },
  confidencePill: {
    backgroundColor: "rgba(0,0,0,0.38)",
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderRadius:      20,
    borderWidth:       0.5,
    borderColor:       "rgba(190,156,44,0.30)",
  },
  confidenceLabel: {
    fontFamily:    FONTS.serif,
    fontSize:      11,
    fontWeight:    "600",
    color:         "rgba(240,230,190,0.95)",
    letterSpacing: 0.4,
    textShadowColor:  "rgba(0,0,0,0.60)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Cancel
  cancelWrapper: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  cancelBtn: {
    paddingHorizontal: 22,
    paddingVertical:    9,
    borderRadius:      50,
    backgroundColor:   "rgba(10,15,8,0.52)",
    borderWidth:       1,
    borderColor:       "rgba(190,156,44,0.45)",
    shadowColor:       "#000",
    shadowOffset:      { width: 0, height: 2 },
    shadowOpacity:     0.30,
    shadowRadius:      6,
    elevation:         4,
  },
  cancelBtnText: {
    fontFamily:    FONTS.serif,
    fontSize:      13,
    fontWeight:    "600",
    color:         "rgba(236,231,211,0.88)",
    letterSpacing: 0.5,
  },

  // Error state (legacy — kept for safety, FailStateScreen handles errors now)
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, backgroundColor: V.pageBg },
  errorIconWrap:  { width: 80, height: 80, borderRadius: 40, justifyContent: "center", alignItems: "center", marginBottom: 20 },
  errorTextBlock: { alignItems: "center", marginBottom: 32 },
  errorTitle:     { fontSize: 20, fontWeight: "700", marginBottom: 8, fontFamily: FONTS.serif },
  errorBody:      { fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 16 },
  retryBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 50 },
  retryBtnText:   { fontSize: 16, fontWeight: "700", color: V.white },
});