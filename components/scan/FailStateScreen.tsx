/**
 * components/scan/FailStateScreen.tsx
 *
 * Branded safari/hunt themed failure screen.
 * Replaces the loading screen when analysis fails.
 *
 * Error types:
 *   server       — backend 5xx / Railway outage / tRPC failure
 *   offline      — device has no internet
 *   timeout      — scan took > 30s
 *   low_confidence — AI found something but isn't confident
 *   bad_input    — photo too blurry / multi-item / format issue
 *
 * Hunt Mode safety:
 *   All failures preserve active hunt progress.
 *   "Return to Hunt" button is shown when hunt is active.
 */

import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import { View, Text, Pressable, StyleSheet } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FONTS } from "@/constants/typography";
import { V } from "@/constants/vintage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FailType =
  | "server"          // backend/Railway down, 5xx, tRPC parse failure
  | "offline"         // device has no internet
  | "network"         // generic network error (legacy compat)
  | "timeout"         // scan took > 30s
  | "low_confidence"  // AI uncertain
  | "bad_input"       // photo quality issue
  | "scan_limit";     // daily free-scan limit reached

export interface FailStateProps {
  type:               FailType;
  message?:           string;
  confidence?:        number;
  retryCount?:        number;   // auto-retry attempts already made
  onRetry:            () => void;
  onRetake:           () => void;
  onReturnToHunt?:    () => void;   // shown when hunt is active
  onReturnHome?:      () => void;   // shown on scan_limit when not in a hunt
  onContinueAnyway?:  () => void;   // low_confidence only
}

// ─── Per-type config ──────────────────────────────────────────────────────────

interface FailConfig {
  icon:       keyof typeof MaterialIcons.glyphMap;
  iconColor:  string;
  title:      string;
  body:       string;
  retryLabel: string;
  hint?:      string;   // small reassurance note below icon
}

const FAIL_CONFIG: Record<FailType, FailConfig> = {
  server: {
    icon:       "radar",
    iconColor:  "#BE9C2C",
    title:      "Our trackers lost the trail",
    body:       "FlipStart's analysis systems are temporarily overloaded. Your photos are safe — try again in a moment.",
    retryLabel: "Retry Analysis",
    hint:       "Railway servers usually recover within seconds",
  },
  offline: {
    icon:       "signal-wifi-off",
    iconColor:  "#8A5A2A",
    title:      "No signal in the wild",
    body:       "Check your connection and try scanning again. Your photos are safe.",
    retryLabel: "Retry Analysis",
    hint:       "Move to a stronger signal and retry",
  },
  network: {
    icon:       "signal-wifi-off",
    iconColor:  "#8A5A2A",
    title:      "No signal in the wild",
    body:       "Check your connection and try scanning again. Your photos are safe.",
    retryLabel: "Retry Analysis",
    hint:       "Move to a stronger signal and retry",
  },
  timeout: {
    icon:       "compass-calibration",
    iconColor:  "#BE9C2C",
    title:      "This hunt is taking longer than expected",
    body:       "Analysis may be delayed due to heavy traffic. Tap retry — it usually resolves quickly.",
    retryLabel: "Retry Analysis",
    hint:       "Heavy demand causes occasional delays",
  },
  low_confidence: {
    icon:       "remove-red-eye",
    iconColor:  "#BE9C2C",
    title:      "Hard to identify from here",
    body:       "We found a possible match but can't be confident enough for a reliable estimate.",
    retryLabel: "Try with Better Photo",
  },
  bad_input: {
    icon:       "photo-camera",
    iconColor:  "#8A5A2A",
    title:      "Something interrupted the hunt",
    body:       "The photo may be too blurry, too dark, or showing multiple items. A clearer shot usually works.",
    retryLabel: "Retake Photo",
  },
  scan_limit: {
    icon:       "hourglass-bottom",
    iconColor:  "#A04020",
    title:      "You've used all 7 free scans",
    body:       "You've hit your 7 free scans for today. FlipStart is in beta, so daily scans are limited to keep AI costs sustainable. Your scans reset tomorrow.",
    retryLabel: "",
    hint:       "Scans reset at midnight",
  },
};

// ─── Palette ──────────────────────────────────────────────────────────────────

const PARCHMENT   = "#FFFEFA";
const PARCHMENT_D = "#DDD2AC";
const FOREST      = "#1F3D1F";
const GOLD        = "#BE9C2C";
const GOLD_LIGHT  = "rgba(190,156,44,0.12)";
const WARM_BROWN  = "#5A3A1A";
const CREAM_TEXT  = "#F4EED8";
const MUTED       = "#8A7050";

// ─── Component ────────────────────────────────────────────────────────────────

export function FailStateScreen({
  type,
  message,
  confidence,
  retryCount = 0,
  onRetry,
  onRetake,
  onReturnToHunt,
  onReturnHome,
  onContinueAnyway,
}: FailStateProps) {
  const cfg       = FAIL_CONFIG[type] ?? FAIL_CONFIG.server;
  const isLowConf = type === "low_confidence";
  const isScanLimit = type === "scan_limit";
  const confPct   = confidence ?? 0;
  const isServer  = type === "server" || type === "network" || type === "timeout" || type === "offline";

  return (
    <Animated.View entering={FadeIn.duration(350)} style={s.root}>

      {/* ── Compass ornament ── */}
      <Animated.View entering={FadeIn.delay(20).duration(400)} style={s.topOrnament}>
        <Text style={s.topOrnamentText}>— EXPEDITION LOG —</Text>
      </Animated.View>

      {/* ── Icon with halo ── */}
      <Animated.View entering={FadeInDown.delay(60).duration(350)} style={s.iconWrap}>
        <View style={[s.iconHalo, { backgroundColor: cfg.iconColor + "18", borderColor: cfg.iconColor + "30" }]}>
          <MaterialIcons name={cfg.icon} size={48} color={cfg.iconColor} />
        </View>
        {/* Auto-retry badge */}
        {retryCount > 0 && (
          <View style={s.retryBadge}>
            <Text style={s.retryBadgeText}>Auto-retried {retryCount}×</Text>
          </View>
        )}
      </Animated.View>

      {/* ── Title + body ── */}
      <Animated.View entering={FadeInDown.delay(140).duration(350)} style={s.textBlock}>
        <Text style={s.title}>{cfg.title}</Text>
        <Text style={s.body}>{message ?? cfg.body}</Text>
        {cfg.hint && (
          <View style={s.hintRow}>
            <MaterialIcons name="info-outline" size={11} color={MUTED} />
            <Text style={s.hintText}>{cfg.hint}</Text>
          </View>
        )}
      </Animated.View>

      {/* ── Low confidence badge ── */}
      {isLowConf && confidence !== undefined && (
        <Animated.View entering={FadeInDown.delay(200).duration(300)} style={s.confBadge}>
          <MaterialIcons name="warning-amber" size={14} color={GOLD} />
          <Text style={s.confBadgeText}>
            Low confidence match ({confPct}%) — double-check before buying
          </Text>
        </Animated.View>
      )}

      {/* ── Ornament divider ── */}
      <Animated.View entering={FadeIn.delay(220).duration(300)} style={s.ornamentRow}>
        <View style={s.ornamentLine} />
        <Text style={s.ornamentGlyph}>✦</Text>
        <View style={s.ornamentLine} />
      </Animated.View>

      {/* ── Action buttons ── */}
      <Animated.View entering={FadeInUp.delay(260).duration(350)} style={s.actions}>

        {isScanLimit ? (
          /* Scan limit: no retry/retake — a single clear exit button */
          <Pressable
            onPress={onReturnToHunt ?? onReturnHome ?? onRetake}
            style={({ pressed }) => [s.primaryBtn, pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
          >
            <MaterialIcons name={onReturnToHunt ? 'arrow-back' : 'home'} size={18} color={CREAM_TEXT} />
            <Text style={s.primaryBtnText}>{onReturnToHunt ? 'Return to Hunt' : 'Back to Home'}</Text>
          </Pressable>
        ) : (
          <>
        {/* Primary: retry analysis */}
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [s.primaryBtn, pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
        >
          <MaterialIcons name="refresh" size={18} color={CREAM_TEXT} />
          <Text style={s.primaryBtnText}>{cfg.retryLabel}</Text>
        </Pressable>

        {/* Secondary: retake photos */}
        <Pressable
          onPress={onRetake}
          style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.65 }]}
        >
          <MaterialIcons name="add-a-photo" size={16} color={WARM_BROWN} />
          <Text style={s.secondaryBtnText}>Retake Photos</Text>
        </Pressable>

        {/* Tertiary: return to hunt — only when hunt active */}
        {onReturnToHunt && (
          <Pressable
            onPress={onReturnToHunt}
            style={({ pressed }) => [s.huntBtn, pressed && { opacity: 0.65 }]}
          >
            <MaterialIcons name="arrow-back" size={14} color={GOLD} />
            <Text style={s.huntBtnText}>Return to Hunt</Text>
          </Pressable>
        )}

        {/* Ghost: continue anyway (low confidence) */}
        {isLowConf && onContinueAnyway && (
          <Pressable
            onPress={onContinueAnyway}
            style={({ pressed }) => [s.ghostBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.ghostBtnText}>Continue anyway →</Text>
          </Pressable>
        )}
          </>
        )}

      </Animated.View>

      {/* ── Footer note ── */}
      <Animated.View entering={FadeIn.delay(380).duration(300)} style={s.footerRow}>
        <MaterialIcons name="lock-outline" size={10} color={PARCHMENT_D} />
        <Text style={s.footerText}>
          {isServer
            ? "Hunt progress is preserved. Your photos are safe."
            : "Photos are only used for analysis and never stored."}
        </Text>
      </Animated.View>

    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex:              1,
    backgroundColor:   "#FFFFFF",
    alignItems:        "center",
    justifyContent:    "center",
    paddingHorizontal: 28,
    paddingBottom:     32,
  },

  topOrnament:     { marginBottom: 20 },
  topOrnamentText: { fontSize: 9, fontWeight: "700", color: MUTED, letterSpacing: 2.5, opacity: 0.7 },

  iconWrap: { marginBottom: 20, alignItems: "center" },
  iconHalo: {
    width: 96, height: 96, borderRadius: 48,
    justifyContent: "center", alignItems: "center",
    borderWidth: 1,
  },
  retryBadge: {
    position: "absolute", bottom: -6,
    backgroundColor: PARCHMENT_D, borderRadius: 10,
    paddingHorizontal: 9, paddingVertical: 2,
    borderWidth: 1, borderColor: GOLD + "55",
  },
  retryBadgeText: { fontSize: 9, fontWeight: "700", color: WARM_BROWN },

  textBlock:  { alignItems: "center", marginBottom: 14, gap: 8 },
  title: {
    fontFamily: FONTS.serif, fontSize: 21, fontWeight: "700",
    color: FOREST, textAlign: "center", letterSpacing: 0.1,
  },
  body: {
    fontFamily: FONTS.serif, fontSize: 14,
    color: WARM_BROWN, textAlign: "center", lineHeight: 21,
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2, opacity: 0.75 },
  hintText: { fontSize: 11, color: MUTED, fontStyle: "italic" },

  confBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: GOLD_LIGHT, borderRadius: 10,
    borderWidth: 1, borderColor: GOLD + "40",
    paddingHorizontal: 12, paddingVertical: 7, marginBottom: 12,
  },
  confBadgeText: {
    fontFamily: FONTS.serif, fontSize: 12, fontWeight: "600",
    color: WARM_BROWN, flex: 1, lineHeight: 17,
  },

  ornamentRow:  { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20, width: "70%" },
  ornamentLine: { flex: 1, height: 1, backgroundColor: PARCHMENT_D },
  ornamentGlyph:{ fontSize: 14, color: GOLD },

  actions: { width: "100%", gap: 10, alignItems: "center" },

  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, width: "100%", paddingVertical: 16, borderRadius: 50,
    backgroundColor: FOREST, borderWidth: 1, borderColor: "#1A3D1A",
    shadowColor: FOREST, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  primaryBtnText: {
    fontFamily: FONTS.serif, fontSize: 16, fontWeight: "700",
    color: CREAM_TEXT, letterSpacing: 0.2,
  },

  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, width: "100%", paddingVertical: 13, borderRadius: 50,
    borderWidth: 1.5, borderColor: PARCHMENT_D,
    backgroundColor: "rgba(217,201,163,0.30)",
  },
  secondaryBtnText: {
    fontFamily: FONTS.serif, fontSize: 14, fontWeight: "600", color: WARM_BROWN,
  },

  huntBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 9, paddingHorizontal: 20,
    borderRadius: 50, borderWidth: 1, borderColor: GOLD + "60",
    backgroundColor: GOLD_LIGHT,
  },
  huntBtnText: {
    fontFamily: FONTS.serif, fontSize: 13, fontWeight: "600", color: WARM_BROWN,
  },

  ghostBtn:     { paddingVertical: 6, paddingHorizontal: 12 },
  ghostBtnText: {
    fontFamily: FONTS.serif, fontSize: 13, color: WARM_BROWN,
    opacity: 0.7, textDecorationLine: "underline",
  },

  footerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 20 },
  footerText:{ fontSize: 10, color: PARCHMENT_D, textAlign: "center" },
});