/**
 * app/loading.tsx — Scan analysis screen
 *
 * Plain forest-green screen, no artwork: a pulsing magnifying glass, the
 * heading, a rotating status line, an indeterminate bar and Cancel scan.
 * Everything visual lives in the "Loading state" return at the bottom of this
 * file. The scan pipeline above it is untouched by the redesign.
 *
 * When a scan can't end on a normal result it ends on FailStateScreen, chosen
 * by reason (Phase 4/5 of the scan-failure plan): the server's reason code for
 * an error, scanSoftFail() for a result FlipStart can't stand behind. A soft
 * fail is charged only if the user taps "Continue anyway".
 *
 * No fake countdown, no fake percentage, no fake eBay/Depop claims. The
 * server sends nothing until it is done, so the bar is indeterminate.
 * Navigation fires IMMEDIATELY when the API responds.
 */

import {
  useEffect, useState, useRef, useCallback,
} from "react";
import {
  Text, View, StyleSheet, Platform, Pressable,
  Linking, AccessibilityInfo,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming,
  Easing, FadeIn, cancelAnimation,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { FailStateScreen, type FailAction, type ChargeState } from "@/components/scan/FailStateScreen";
import { useProPaywall, ProPaywallHost } from "@/components/monetization/paywall/ProPaywallProvider";
import { scanSoftFail, softFailCanContinue } from "@shared/scanFailure";
import { APP_STORE_PRODUCT_URL } from "@/lib/reviewPrompt";
import { logEvent, incrementSessionCount, saveScanRecord, getScannerId } from "@/lib/analytics";
import { isHuntActive } from "@/lib/hunt-context";
import { rememberScanPhotos } from "@/lib/scanSessionPhotos";
import { useAuth } from "@/lib/auth-context";
import { useEntitlement } from "@/lib/useEntitlement";
import {
  SCAN_BUDGET_MS, MIN_ATTEMPT_MS, MAX_ATTEMPTS, CANCEL_WAIT_MS,
  ATTEMPT_TIMEOUT, SCAN_DEADLINE,
  classifyScanError, attemptTimeoutMs, planRetry, deadlineForServer, checkConnection, legacyErrorType,
  type ClassifiedScanError, type FailScreen, type ServerCause, type FailPaywall,
} from "@/lib/scanAttempt";

/** Everything the fail screen needs. */
interface FailState {
  screen:         FailScreen;
  cause?:         ServerCause;
  paywall?:       FailPaywall;
  charge:         ChargeState;
  /** What the AI could tell, for the result-based screens. */
  seen?:          string | null;
  photoProblems?: string[];
}

/** A soft-fail result kept until the user chooses: shown on Continue, dropped on Back / Retake. */
interface HeldResult {
  scanResult: ScanResult;
  chargePending: boolean;
  /** scan_completed's fields, sent if the user taps Continue anyway. */
  completedMeta: Record<string, unknown>;
}

/** How long Continue anyway waits for the server to confirm the charge before showing the result anyway. */
const CONFIRM_WAIT_MS = 5_000;

// ─── Status messages ──────────────────────────────────────────────────────────
// One vision request does all of this work: identification (item, brand,
// category, era, material, logos), the resale range, demand and competition,
// and the risk flags. These lines name only that. Nothing here claims a live
// marketplace lookup: sold comps run after this screen, not during it.
//
// The first line is always first and the last two are always last, so the
// screen never says "Preparing your results" at the start. The middle ones are
// shuffled, so every scan reads a little differently. The queue stops on the
// last line rather than looping.
const FIRST_MESSAGE = "Identifying your find...";
const MIDDLE_MESSAGES = [
  "Reading item details...",
  "Detecting brand signals...",
  "Checking category and era...",
  "Estimating resale value...",
  "Estimating buyer demand...",
  "Evaluating the item...",
];
const LAST_MESSAGES = [
  "Building your analysis...",
  "Preparing your results...",
];

const MESSAGE_INTERVAL_MS = 3000; // 3 seconds — premium, unhurried feel

// ─── Look ─────────────────────────────────────────────────────────────────────
const FOREST = "#214D2D";
const GOLD   = "#C4A334";
const CREAM  = "#F4EED8";

const PULSE_PEAK        = 1.06;  // magnifier scale: 1.0 → 1.06 → 1.0
const PULSE_HALF_MS     = 1100;
const BAR_SWEEP_MS      = 1500;
const BAR_SEGMENT_RATIO = 0.38;  // width of the moving segment, vs the track

function buildMessageQueue(): string[] {
  return [FIRST_MESSAGE, ...shuffleArray(MIDDLE_MESSAGES), ...LAST_MESSAGES];
}

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
  const colors       = useColors();
  const { addScan }  = useScanContext();

  const insets       = useSafeAreaInsets();

  // Message queue: fixed first and last lines, shuffled middle
  const [messages]     = useState<string[]>(buildMessageQueue);
  const [msgIndex,     setMsgIndex]     = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [scanKey,  setScanKey]   = useState(0);   // increment to re-trigger doScan (manual retry)
  const [retryCount, setRetryCount] = useState(0); // automatic retries made in the last scan
  const [failState, setFailState] = useState<FailState | null>(null);
  const [failBusy, setFailBusy]   = useState<FailAction | null>(null);
  const [autoPaywall, setAutoPaywall] = useState<FailPaywall | null>(null);
  const actionLockRef             = useRef(false);
  const heldResultRef             = useRef<HeldResult | null>(null);
  const { openProPaywall }        = useProPaywall();
  const entitlement               = useEntitlement();
  /** Whose scans ran out, for the out-of-scans screen. Null until the plan is known. */
  const planKind: "free" | "pro" | null = entitlement.status === "ready" ? (entitlement.isPro ? "pro" : "free") : null;
  const planKindRef               = useRef(planKind);
  planKindRef.current             = planKind;

  const { user }        = useAuth();
  const hasNavigated    = useRef(false);
  // Stable id for THIS scan attempt. The server dedupes by it, so internal
  // retries of the same item can never burn more than one scan. A genuinely
  // new scan remounts this screen and gets a fresh id.
  const scanAttemptId   = useRef(
    `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  ).current;
  const hasStartedRef   = useRef(false);
  const scanStartTime   = useRef(Date.now());
  const timeoutIdRef    = useRef<ReturnType<typeof setTimeout> | null>(null);   // the 45 s clock
  const tryAbortRef     = useRef<AbortController | null>(null);  // the request in flight
  const lastPendingScan = useRef<import('@/lib/pending-scan').PendingScan | null>(null);
  const scanRunRef      = useRef(0);       // numbers each run of the pipeline; see below
  const scanActiveRef   = useRef(false);   // a run may have work going on the server

  // ── Audio ─────────────────────────────────────────────────────────────────

  const trpcUtils           = trpc.useUtils();

  /**
   * Abandon the request in flight. If its photos are still uploading, the
   * server never starts it, so an abandoned try can't start a scan (and a
   * charge) after the app has moved on. Work the server already started is
   * stopped with cancel instead.
   */
  const abandonTry = useCallback(() => {
    try { tryAbortRef.current?.abort(); } catch { /* ignore */ }
    tryAbortRef.current = null;
  }, []);

  /**
   * Ask the server to stop this scan. Answers "cancelled" (stopped, nothing
   * charged), "completed" with the result (it had already finished),
   * "stopping" (told to stop, outcome not known yet) or "not_running". Null
   * when there was no answer within CANCEL_WAIT_MS. Never throws.
   */
  // why: "gave_up" when the app stopped waiting (45 s, or errors), "user" for
  // the Cancel button — so the server records a slow scan as a failure, not
  // as the user cancelling. A server without the field ignores it.
  const stopOnServer = useCallback(async (why: "user" | "gave_up"): Promise<{ status: string; result?: unknown } | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        trpcUtils.client.scan.cancelAnalysis.mutate({ scanAttemptId, why }),
        new Promise<null>(res => { timer = setTimeout(() => res(null), CANCEL_WAIT_MS); }),
      ]);
    } catch (e: any) {
      console.warn("[loading] cancel request failed:", String(e?.message ?? e).slice(0, 80));
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [trpcUtils, scanAttemptId]);

  /**
   * Run the scan again from the start with a fresh 45 s clock and the same
   * photos. Used after the paywall unlocks Pro on an out-of-scans or Pro-
   * feature screen. Same scanAttemptId: those refusals happened before
   * anything was reserved, so nothing can be charged twice.
   */
  const restartScan = useCallback(() => {
    console.log("[loading] restarting the scan with a fresh clock");
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    hasStartedRef.current = false;
    hasNavigated.current  = false;
    heldResultRef.current = null;
    actionLockRef.current = false;
    setAutoPaywall(null);
    setRetryCount(0);
    setFailBusy(null);
    setFailState(null);
    setMsgIndex(0);
    setScanKey(k => k + 1);
  }, []);

  /** Out of scans / a Pro feature in this scan: the matching paywall, over the fail screen. */
  const openPaywallForScan = useCallback((source: FailPaywall) => {
    openProPaywall(source, { onUnlocked: restartScan });
  }, [openProPaywall, restartScan]);

  /**
   * Opened from an effect, not in the same tick as the fail state: the
   * screen-level <ProPaywallHost/> claims itself in its own effect, which
   * runs first (children before parents). Opened earlier, the root host would
   * render the modal underneath this fullScreenModal for a frame.
   */
  useEffect(() => {
    if (!autoPaywall || !failState) return;
    openPaywallForScan(autoPaywall);
    setAutoPaywall(null);
  }, [autoPaywall, failState, openPaywallForScan]);

  /**
   * Hand a held soft-fail scan back. Retried when the request doesn't get
   * through, because it usually runs right as the user leaves — often in a
   * thrift-store dead zone — and a release that never lands blocks that scan
   * until the reservation expires (10 min). A release the server received
   * but couldn't complete isn't retried: the hold is gone by then, and the
   * reservation expires back to the user on its own.
   * Fire-and-forget: leaving never waits for it.
   */
  const releaseOnServer = useCallback(() => {
    void (async () => {
      for (const delay of [0, 2_000, 5_000]) {
        if (delay) await new Promise(res => setTimeout(res, delay));
        try {
          const r = await trpcUtils.client.scan.releaseCharge.mutate({ scanAttemptId });
          if (r?.status !== "failed") return;
        } catch { /* try again */ }
      }
    })();
  }, [trpcUtils, scanAttemptId]);

  // ── Rotating messages (every 3s) ─────────────────────────────────────────
  // Stops on the last line instead of looping back to "Identifying".
  useEffect(() => {
    const id = setInterval(() => {
      if (hasNavigated.current) return;
      setMsgIndex(i => Math.min(i + 1, messages.length - 1));
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [messages]);

  // ── Reduce Motion ─────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (alive) setReduceMotion(v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", v => setReduceMotion(v));
    return () => { alive = false; sub.remove(); };
  }, []);

  // ── Magnifier pulse: 1.0 → 1.06 → 1.0, slow and smooth ───────────────────
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(PULSE_PEAK, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(1,          { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [reduceMotion]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  // ── Indeterminate bar: a gold segment sweeping across the track ───────────
  // No percentage and no fill: the server reports no progress, so the bar only
  // shows that work is happening. It never "completes"; success navigates.
  const [trackW, setTrackW] = useState(0);
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (!trackW) return;
    sweep.value = 0;
    sweep.value = withRepeat(
      withTiming(1, { duration: reduceMotion ? BAR_SWEEP_MS * 2 : BAR_SWEEP_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(sweep);
  }, [trackW, reduceMotion]);
  const segW = trackW * BAR_SEGMENT_RATIO;
  const segStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -segW + sweep.value * (trackW + segW) }],
  }));

  // ── Scan pipeline ─────────────────────────────────────────────────────────
  //
  // One 45 s clock for the whole scan, retries included (the rules live in
  // lib/scanAttempt.ts). Every try tells the server how much of the clock is
  // left, so the server stops 5 s before it runs out and refunds the scan.
  // At 45 s the app asks the server to stop (cancelAnalysis): a scan still
  // running is refunded, and one that already finished is handed back and
  // shown, so nobody is charged for a result they never see.
  //
  // scanRunRef numbers each run of the pipeline. Cancel and manual retry move
  // it on, so an answer that belongs to an abandoned run is ignored.
  useEffect(() => {
    if (hasStartedRef.current || hasNavigated.current) return;
    hasStartedRef.current = true;

    const run  = ++scanRunRef.current;
    const live = () => scanRunRef.current === run && !hasNavigated.current;

    const doScan = async () => {
      console.log("[loading] pipeline start");
      scanStartTime.current = Date.now();
      const expiresAt = scanStartTime.current + SCAN_BUDGET_MS;
      const remaining = () => expiresAt - Date.now();

      // The first run takes the photos from the camera; a manual retry reuses
      // them (consumePendingScan() clears the module store).
      const pending = lastPendingScan.current ?? consumePendingScan();
      if (!pending?.front?.base64) {
        console.error("[loading] no pending scan data — aborting");
        try {
          logEvent("scan_failed", {
            errorType: legacyErrorType("photo_load_failed"), reason: "photo_load_failed",
            screen: "photo_load_failed", charge: "not_used", attemptId: scanAttemptId, inHunt: isHuntActive(),
          });
          incrementSessionCount("failedScanCount");
        } catch { /* never block */ }
        setFailState({ screen: "photo_load_failed", charge: "not_used" });
        return;
      }
      lastPendingScan.current = pending;

      const { front, tag, detail, userContext } = pending;
      const imageBase64 = front.base64;
      const mimeType    = front.mimeType;
      console.log(`[loading] images ready — front✓ tag:${!!tag} detail:${!!detail}`);
      console.log("[loading] analysis request start — scan clock", SCAN_BUDGET_MS / 1000, "s");

      // Analytics: scan submitted. Once per scan: automatic retries no longer
      // re-run this, so they no longer count as extra submissions.
      try {
        // Telemetry records PRESENCE and LENGTH only. Users type personal
        // details into this field; the raw text must never reach analytics.
        logEvent("scan_submitted", {
          tagPresent: !!tag,
          detailPresent: !!detail,
          contextPresent: !!userContext,
          contextChars: userContext?.length ?? 0,
        });
        incrementSessionCount("scanCount");
      } catch { /* never block analysis */ }

      // ── A result arrived (from a try, or handed back by cancel) ────────────
      const finishWithResult = (result: any) => {
        scanActiveRef.current = false;
        console.log("[loading] analysis response received");
        if (hasNavigated.current) return;

        /**
         * A scan has genuinely COMPLETED here: the mutation resolved with an
         * analysis, before any save decision. This is the authoritative point
         * for review eligibility — the previous trigger sat in the results
         * SAVE handler, so a user who scanned in a shop and never tapped save
         * was never counted, and one save counted as the whole experience.
         *
         * Fire-and-forget: the counter must never delay or fail navigation.
         * Nothing is shown here; eligibility is consumed later from Home.
         */
        const recordForReview = () => {
          void import("@/lib/reviewPrompt")
            .then(m => m.recordCompletedScan())
            .catch(() => {});
        };

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
          // Still defaulted: the server adapter continues to emit this from
          // its own derived conclusions (obvious damage, no price estimate).
          // Only the MODEL no longer supplies it.
          risky_buy_reasons: [] as string[],
          ...(result.risk_analysis || {}),
        };
        if (!Array.isArray(safeRiskAnalysis.risky_buy_reasons)) {
          safeRiskAnalysis.risky_buy_reasons = [];
        }
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
        // Every photo taken for this scan, for the results screen's viewer
        // (also after "Continue anyway" on a soft fail).
        // Memory only — never saved with the scan.
        rememberScanPhotos(scanId, [
          { uri: scanResult.imageUri, label: "Front" },
          tag?.uri ? { uri: tag.uri, label: "Tag" } : null,
          detail?.uri ? { uri: detail.uri, label: "Detail" } : null,
        ]);

        // ── A result FlipStart can't stand behind ─────────────────────────
        // Decided by the server's own scan issue and confidence tier (the
        // same scanSoftFail() the server uses to hold the charge), not by
        // the 35 / 55 score. Nothing is saved until the user taps Continue
        // anyway; Back or Retake drop it, and the held scan goes back.
        const matchConf = safeRiskAnalysis.match_confidence ?? 0;
        console.log("[loading] match_confidence:", matchConf);
        const soft = scanSoftFail(result);
        if (soft) {
          const v1 = (result?.identification?.v1 ?? {}) as {
            confidenceTierReason?: unknown; photoProblems?: unknown;
          };
          const chargePending = result?.chargePending === true;
          const tier = typeof (v1 as { confidenceTier?: unknown }).confidenceTier === "string"
            ? (v1 as { confidenceTier: string }).confidenceTier : null;
          heldResultRef.current = {
            scanResult, chargePending,
            completedMeta: {
              confidence: matchConf, category: safeIdentification.category, brand: safeIdentification.brand,
              recommendation: result.recommendation ?? "", tier,
              continuedAfterSoftFail: true, softFail: soft, attemptId: scanAttemptId,
            },
          };
          // scanUsed comes from a server that holds charges; a server that
          // doesn't send it charged the scan, as before.
          const softCharge: ChargeState = chargePending && softFailCanContinue(soft) ? "pending"
            : result?.scanUsed === false ? "not_used"
            : result?.scanUsed === true ? "used"
            // A server that predates scanUsed charged every result, except
            // "no item" which there was nothing to charge for.
            : softFailCanContinue(soft) ? "used" : "not_used";
          console.log(`[loading] soft fail: ${soft} — charge ${chargePending ? "held" : "already taken"}`);
          try {
            logEvent("scan_failed", {
              errorType: legacyErrorType(soft), reason: soft, confidence: matchConf,
              chargeHeld: chargePending,
              // Phase 6: which screen, and enough to join it to scan_outcomes.
              screen: soft, kind: "soft", tier, charge: softCharge,
              attemptId: scanAttemptId, inHunt: isHuntActive(),
            });
            incrementSessionCount("failedScanCount");
          } catch { /* never block */ }
          setFailState({
            screen: soft,
            charge: softCharge,
            seen: typeof v1.confidenceTierReason === "string" ? v1.confidenceTierReason : null,
            photoProblems: Array.isArray(v1.photoProblems) ? v1.photoProblems.map(String) : [],
          });
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          }
          return;
        }

        recordForReview();
        addScan(scanResult);

        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }

        // Analytics: scan completed + save structured scan record for future AI memory
        try {
          logEvent("scan_completed", {
            confidence:      matchConf,
            category:        safeIdentification.category,
            brand:           safeIdentification.brand,
            recommendation:  result.recommendation ?? "",
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

        // Straight to the result. No fill-to-100% and no wait: real results are
        // never held back for an animation.
        if (hasNavigated.current) return;
        hasNavigated.current = true;
        if (isHuntActive()) {
          // Replace loading with hunt-item-detail — keeps stack clean so
          // back() from Discovery Analysis returns to hunt-active, not loading
          router.replace("/hunt-item-detail" as any);
        } else {
          router.replace("/results" as any);
        }
      };

      // Scan-limit identity. Prefer the signed-in account id: it is the same
      // value getScannerId() returns for authenticated users (so the Home
      // pill reads the identical bucket), but it can't degrade to a SHARED
      // bucket. The analytics fallback can return the literal "anon_unknown"
      // when AsyncStorage fails, and an undefined id makes the server use
      // "_legacy" — either way every affected device would share one quota.
      let scannerId: string | undefined = user?.id ?? undefined;
      if (!scannerId) {
        const fallback = await getScannerId().catch(() => undefined);
        scannerId = fallback && fallback !== 'anon_unknown' ? fallback : undefined;
      }
      if (!live()) return;

      // ── The 45 s clock ──────────────────────────────────────────────────
      const deadline = new Promise<never>((_, reject) => {
        timeoutIdRef.current = setTimeout(() => {
          console.log("[loading] scan clock ran out after", SCAN_BUDGET_MS / 1000, "s");
          reject(new Error(SCAN_DEADLINE));
        }, Math.max(0, remaining()));
      });
      deadline.catch(() => {});   // raced below; never an unhandled rejection
      scanActiveRef.current = true;

      let attempts = 0;
      let lastTry: AbortController | null = null;
      let lastRaw  = "";
      let last: ClassifiedScanError | null = null;
      let lastServerReason: string | null = null;

      try {
        while (true) {
          const left = remaining();
          if (left < MIN_ATTEMPT_MS && attempts > 0) { lastRaw = SCAN_DEADLINE; break; }
          attempts += 1;
          let patienceTimer: ReturnType<typeof setTimeout> | undefined;
          abandonTry();   // a try that ran out of patience; the server keeps its scan for this one to join
          const tryAbort = new AbortController();
          tryAbortRef.current = tryAbort;
          lastTry = tryAbort;
          try {
            const result = await Promise.race([
              trpcUtils.client.scan.analyzeFast.mutate({
                imageBase64,
                mimeType:           mimeType || "image/jpeg",
                tagImageBase64:     tag?.base64,
                tagMimeType:        tag?.mimeType,
                detailImageBase64:  detail?.base64,
                detailMimeType:     detail?.mimeType,
                scannerId,
                // Same id on every try: the server joins a scan that is still
                // running, hands back one that finished, or runs it once.
                scanAttemptId,
                // Confirmed camera context. Undefined for context-free scans;
                // every try sends the identical value.
                userContext,
                deadlineMs:         deadlineForServer(left),
                // Hold the charge on a soft fail until the user chooses.
                chargeOnContinue:   true,
                // Results will show sold comps: let the server start that
                // search now. Hunt scans go to their own screen, which has none.
                prefetchComps:      !isHuntActive(),
              }, { signal: tryAbort.signal }),
              deadline,
              new Promise<never>((_, reject) => {
                patienceTimer = setTimeout(
                  () => reject(new Error(ATTEMPT_TIMEOUT)),
                  attemptTimeoutMs(attempts - 1, left),
                );
              }),
            ]);
            if (!live()) return;
            finishWithResult(result);
            return;
          } catch (err: any) {
            if (!live()) return;
            lastRaw = String(err?.message ?? "");
            if (lastRaw === SCAN_DEADLINE) break;
            lastServerReason = typeof err?.data?.scanReason === "string" ? err.data.scanReason.slice(0, 40) : null;
            // The server's reason code first; status and wording as fallbacks.
            last = classifyScanError(lastRaw, {
              reason:     err?.data?.scanReason,
              httpStatus: err?.data?.httpStatus ?? err?.meta?.response?.status ?? null,
            });
            if (last.kind === "server_timeout") break;

            // Retry only a request that failed or got no answer, and only
            // while there is time left. Refusals and unusable photos: never.
            const plan = planRetry({ attemptsMade: attempts, remainingMs: remaining(), kind: last.kind });
            if (!plan.retry) break;

            console.log(`[loading] auto-retry ${attempts}/${MAX_ATTEMPTS - 1} in ${plan.delayMs}ms — ${last.screen}${last.cause ? `/${last.cause}` : ""}`);
            try {
              logEvent("scan_auto_retry", {
                attempt:     attempts,
                failType:    legacyErrorType(last.screen),
                reason:      last.cause ?? last.screen,
                delayMs:     plan.delayMs,
                errorRaw:    lastRaw.slice(0, 80),
              });
            } catch { /* never block */ }

            if (plan.delayMs > 0) {
              await Promise.race([
                new Promise(res => setTimeout(res, plan.delayMs)),
                deadline,
              ]).catch(() => {});
            }
            if (!live()) return;
          } finally {
            if (patienceTimer) clearTimeout(patienceTimer);
          }
        }
      } finally {
        if (timeoutIdRef.current !== null) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
        // Giving up (or done): drop this run's request if it is still going.
        if (lastTry && tryAbortRef.current === lastTry) abandonTry();
      }

      // ── Giving up ─────────────────────────────────────────────────────────
      const lastScreen: FailScreen = last?.screen ?? "timeout";
      const outOfTime = lastRaw === SCAN_DEADLINE
        || last?.kind === "server_timeout"
        || (lastScreen === "timeout" && remaining() < MIN_ATTEMPT_MS);

      // Anything but a refusal or an unusable photo may have left work on the
      // server. Ask it to stop: a running scan is refunded; a finished one is
      // handed back and shown instead of an error.
      let noCharge = last?.kind === "server_timeout";
      let cancelStatus = "skipped";
      if (outOfTime || last?.kind === "transient") {
        const reply = await stopOnServer("gave_up");
        if (!live()) return;
        cancelStatus = reply?.status ?? "no_answer";
        if (reply?.status === "completed" && reply.result) {
          console.log("[loading] scan finished as the clock ran out — showing it");
          finishWithResult(reply.result);
          return;
        }
        if (reply?.status === "cancelled") noCharge = true;
      }
      scanActiveRef.current = false;

      let screen: FailScreen = outOfTime ? "timeout" : lastScreen;
      let cause: ServerCause | undefined = outOfTime ? undefined : last?.cause;
      // The request never reached us: is the phone offline, or is our server
      // down? Ask a well-known site — if it answers, the problem is ours.
      if (screen === "offline") {
        const net = await checkConnection();
        if (!live()) return;
        if (net === "online") { screen = "server"; cause = "server_down"; }
      }
      // "No scan used" only when it's certain: a refusal (nothing was ever
      // reserved), the server's own stop, or cancel confirming that nothing
      // ran or that it stopped it. Otherwise the screen makes no claim.
      const charge: ChargeState =
        last?.kind === "refusal" || noCharge || cancelStatus === "not_running" ? "not_used" : "unknown";
      const durationMs = Date.now() - scanStartTime.current;
      console.error(`[loading] giving up after ${attempts} tr${attempts === 1 ? "y" : "ies"} — ${screen}${cause ? `/${cause}` : ""} cancel: ${cancelStatus} raw: ${lastRaw.substring(0, 80)}`);

      // Out of scans is a paywall moment, and an outdated app a build
      // problem; neither was ever counted as a failed scan.
      // Phase 6 fields on both: the exact screen, the server's own code (null
      // when no answer arrived), what the screen said about the charge, and
      // the attempt id that joins it to scan_outcomes.
      const failMeta = {
        screen, cause: cause ?? null, serverReason: lastServerReason, kind: "hard",
        charge, attemptId: scanAttemptId, inHunt: isHuntActive(), cancelStatus,
      };
      if (screen !== "out_of_scans" && screen !== "app_outdated") {
        try {
          logEvent("scan_failed", {
            errorType:     legacyErrorType(screen),
            reason:        cause ?? screen,
            autoRetries:   attempts - 1,
            durationMs,
            errorRaw:      lastRaw.slice(0, 80),
            ...failMeta,
          });
          incrementSessionCount("failedScanCount");
        } catch { /* never block */ }
      } else {
        // Still a screen the user saw, so it gets one event — just not a failure.
        try { logEvent("scan_blocked", { ...failMeta, durationMs }); } catch { /* never block */ }
      }

      setRetryCount(attempts - 1);
      setFailState({ screen, cause, paywall: last?.paywall, charge });
      // Out of scans / a Pro feature: straight to the paywall, over this
      // screen — opened by the effect below once the screen (and its paywall
      // host) has mounted. Closing it leaves the user here, with Back and
      // See plans. Out of scans opens it only for a known Free user: a
      // subscriber gets the Scan Store from the screen, and while the plan
      // is still loading nobody is offered an upgrade they may already have.
      if (last?.paywall && (screen === "pro_feature" || (screen === "out_of_scans" && planKindRef.current === "free"))) {
        setAutoPaywall(last.paywall);
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    };

    doScan();
  // scanKey increments on a manual retry — re-runs this effect so doScan fires again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanKey]);

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    hasNavigated.current = true;
    // Stop the scan on the server too, so a scan the user walked away from
    // is refunded rather than charged. Fire-and-forget: leaving never waits.
    if (scanActiveRef.current) {
      scanActiveRef.current = false;
      scanRunRef.current += 1;
      abandonTry();
      // A soft fail held while the user was leaving is handed back. Sent
      // whatever cancel answered — including no answer in time — because a
      // release with nothing held is a harmless no-op.
      void stopOnServer("user").then(r => {
        if (r?.status !== "cancelled" && r?.status !== "not_running") releaseOnServer();
      });
    }
    router.back();
  };

  // ── Derived display ───────────────────────────────────────────────────────
  const currentMessage = messages[Math.min(msgIndex, messages.length - 1)];

  // ── Fail state ────────────────────────────────────────────────────────────
  if (failState) {
    const inHunt = isHuntActive();

    /** Back / Retake on a soft fail: the held scan goes back to the user. */
    const releaseHeld = () => {
      const held = heldResultRef.current;
      heldResultRef.current = null;
      if (held?.chargePending) releaseOnServer();
    };

    const leave = (to: "home" | "camera" | "result") => {
      hasNavigated.current = true;
      if (to === "camera") router.replace("/camera" as any);
      else if (to === "result") router.replace((inHunt ? "/hunt-item-detail" : "/results") as any);
      // Hunt progress is never lost: Back returns to the live hunt.
      else router.replace((inHunt ? "/hunt-active" : "/(tabs)") as any);
    };

    const onAction = async (action: FailAction) => {
      // One leaving action per screen. A ref, not state: two taps in the same
      // frame would both read a busy flag that hasn't re-rendered yet.
      const leaves = action === "continue" || action === "back" || action === "retake" || action === "sign_in";
      if (leaves) {
        if (actionLockRef.current) return;
        actionLockRef.current = true;
      }
      // What users do on each screen (Phase 6). Once per leaving action, thanks to the lock above.
      try {
        logEvent("scan_fail_action", {
          action, screen: failState.screen, cause: failState.cause ?? null,
          charge: failState.charge, attemptId: scanAttemptId, inHunt,
        });
      } catch { /* never block */ }
      switch (action) {
        case "continue": {
          const held = heldResultRef.current;
          if (!held) { leave("home"); return; }
          // Charge the held scan, then show the result. The result is shown
          // even if the confirm doesn't answer in time: the user chose it,
          // and an unconfirmed hold expires in the user's favour.
          setFailBusy("continue");
          if (held.chargePending) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const outcome = await Promise.race([
              trpcUtils.client.scan.confirmCharge.mutate({ scanAttemptId }).catch(() => null),
              new Promise<null>(res => { timer = setTimeout(() => res(null), CONFIRM_WAIT_MS); }),
            ]);
            if (timer) clearTimeout(timer);
            console.log("[loading] continue anyway — charge:", outcome?.status ?? "no answer");
            held.completedMeta.chargeConfirm = outcome?.status ?? "no_answer";
          }
          heldResultRef.current = null;
          addScan(held.scanResult);
          // The user got a result, so it counts as a completed scan — the
          // dashboard's scan count and first-scan funnel read this event.
          try {
            logEvent("scan_completed", held.completedMeta);
            incrementSessionCount("completedScanCount");
          } catch { /* never block */ }
          void import("@/lib/reviewPrompt").then(m => m.recordCompletedScan()).catch(() => {});
          leave("result");
          return;
        }
        case "back":    releaseHeld(); leave("home"); return;
        case "retake":  releaseHeld(); leave("camera"); return;
        case "sign_in":
          hasNavigated.current = true;
          router.replace({ pathname: "/auth" as any, params: { mode: "login" } });
          return;
        case "update":
          Linking.openURL(APP_STORE_PRODUCT_URL).catch(() => {});
          return;
        case "see_plans":
          openPaywallForScan(failState.paywall ?? "scan_limit");
          return;
        case "scan_store":
          router.push("/scan-store?from=scan_fail" as any);
          return;
      }
    };

    return (
      <View style={s.flex}>
        <FailStateScreen
          screen={failState.screen}
          cause={failState.cause}
          paywall={failState.paywall}
          photoUri={imageUri ?? null}
          seen={failState.seen ?? null}
          photoProblems={failState.photoProblems}
          charge={failState.charge}
          inHunt={inHunt}
          plan={planKind}
          busy={failBusy}
          onAction={(a) => { void onAction(a); }}
        />
        {/* This screen is a fullScreenModal: the paywall must mount its own host to appear above it. */}
        <ProPaywallHost />
      </View>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  // Layout: one block, centred in the safe area, with Cancel scan under the
  // bar so it is next to the thing it stops. Nothing is positioned by
  // screen-height ratios.
  // The status line has a fixed two-line height, so a longer message never
  // moves the bar.
  return (
    <View
      style={[
        s.flex,
        { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 16) + 12 },
      ]}
    >
      <View style={s.center}>
        <Animated.View style={pulseStyle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MaterialIcons name="search" size={88} color={GOLD} />
        </Animated.View>

        <Text style={s.heading} accessibilityRole="header">Analyzing your find</Text>

        <View style={s.statusBox}>
          <Animated.Text
            key={currentMessage}
            entering={FadeIn.duration(260)}
            style={s.statusText}
            numberOfLines={2}
          >
            {currentMessage}
          </Animated.Text>
        </View>

        <View
          style={s.barTrack}
          onLayout={e => setTrackW(e.nativeEvent.layout.width)}
          accessibilityRole="progressbar"
          accessibilityLabel="Analyzing your find"
        >
          {trackW > 0 && (
            <Animated.View style={[s.barSegment, { width: segW }, segStyle]} />
          )}
        </View>

        <Pressable
          onPress={handleCancel}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Cancel scan"
          style={({ pressed }) => [s.cancelBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={s.cancelBtnText}>Cancel scan</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  flex:   { flex: 1, backgroundColor: FOREST },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },

  heading: {
    marginTop: 28,
    fontFamily: FONTS.serif, fontSize: 26, fontWeight: "700",
    color: CREAM, letterSpacing: 0.2, textAlign: "center",
  },

  // Two lines tall whatever the message, so the bar below never jumps.
  statusBox: { marginTop: 10, height: 44, width: "100%", alignItems: "center", justifyContent: "flex-start" },
  statusText: {
    fontFamily: FONTS.serif, fontSize: 16, lineHeight: 22,
    color: "rgba(244,238,216,0.82)", textAlign: "center",
  },

  barTrack: {
    marginTop: 18, width: "100%", maxWidth: 260, height: 4, borderRadius: 2,
    backgroundColor: "rgba(244,238,216,0.18)",
    overflow: "hidden",
  },
  barSegment: { height: "100%", borderRadius: 2, backgroundColor: GOLD },

  cancelBtn: {
    alignSelf: "center", marginTop: 28,
    paddingHorizontal: 26, paddingVertical: 11, borderRadius: 50,
    borderWidth: 1, borderColor: "rgba(244,238,216,0.35)",
  },
  cancelBtnText: {
    fontFamily: FONTS.serif, fontSize: 14, fontWeight: "600",
    color: "rgba(244,238,216,0.85)", letterSpacing: 0.4,
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