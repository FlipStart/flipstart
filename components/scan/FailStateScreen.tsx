/**
 * components/scan/FailStateScreen.tsx
 *
 * Reusable fail state for the scan flow.
 * Replaces the loading screen when analysis fails or returns low confidence.
 *
 * Usage:
 *   <FailStateScreen
 *     type="network"
 *     message="Connection lost mid-analysis."
 *     onRetry={handleRetry}
 *     onRetake={handleRetake}
 *   />
 *
 *   <FailStateScreen
 *     type="low_confidence"
 *     confidence={38}
 *     onRetry={handleRetry}
 *     onRetake={handleRetake}
 *     onContinueAnyway={handleContinue}  // optional — only for low_confidence
 *   />
 */

import Animated, {
    FadeIn, FadeInDown, FadeInUp,
  } from "react-native-reanimated";
  import {
    View, Text, Pressable, StyleSheet, Platform,
  } from "react-native";
  import MaterialIcons from "@expo/vector-icons/MaterialIcons";
  
  import { FONTS } from "@/constants/typography";
  import { V } from "@/constants/vintage";
  
  // ─── Types ────────────────────────────────────────────────────────────────────
  
  export type FailType =
    | "network"
    | "timeout"
    | "low_confidence"
    | "bad_input";
  
  export interface FailStateProps {
    type:               FailType;
    message?:           string;       // override default message
    confidence?:        number;       // 0–100, required for low_confidence type
    onRetry:            () => void;
    onRetake:           () => void;
    onContinueAnyway?:  () => void;   // only shown for low_confidence
  }
  
  // ─── Per-type config ──────────────────────────────────────────────────────────
  
  interface FailConfig {
    icon:       keyof typeof MaterialIcons.glyphMap;
    iconColor:  string;
    title:      string;
    body:       string;
    retryLabel: string;
  }
  
  const FAIL_CONFIG: Record<FailType, FailConfig> = {
    network: {
      icon:       "wifi-off",
      iconColor:  "#C0392B",
      title:      "Couldn't reach the server",
      body:       "Check your internet connection and try again. Your photo is still saved.",
      retryLabel: "Try Again",
    },
    timeout: {
      icon:       "hourglass-empty",
      iconColor:  "#BE9C2C",
      title:      "Analysis took too long",
      body:       "The server is taking longer than usual. Try again — it usually resolves quickly.",
      retryLabel: "Retry Scan",
    },
    low_confidence: {
      icon:       "help-outline",
      iconColor:  "#BE9C2C",
      title:      "Couldn't get a confident result",
      body:       "We found a possible match but aren't confident enough to show a reliable resale estimate.",
      retryLabel: "Try with Better Photo",
    },
    bad_input: {
      icon:       "image-not-supported",
      iconColor:  "#8B6914",
      title:      "Having trouble with this image",
      body:       "The photo may be too blurry, too dark, or showing multiple items. A clearer shot usually works.",
      retryLabel: "Retake Photo",
    },
  };
  
  // ─── Palette ──────────────────────────────────────────────────────────────────
  
  const PARCHMENT   = "#EDE0C4";
  const PARCHMENT_D = "#D9C9A3";
  const FOREST      = "#1F3D1F";
  const GOLD        = "#BE9C2C";
  const GOLD_LIGHT  = "rgba(190,156,44,0.12)";
  const WARM_BROWN  = "#5A3A1A";
  const CREAM_TEXT  = "#F4EED8";
  
  // ─── Component ────────────────────────────────────────────────────────────────
  
  export function FailStateScreen({
    type,
    message,
    confidence,
    onRetry,
    onRetake,
    onContinueAnyway,
  }: FailStateProps) {
    const cfg = FAIL_CONFIG[type];
    const isLowConf = type === "low_confidence";
    const confPct   = confidence ?? 0;
  
    return (
      <Animated.View
        entering={FadeIn.duration(350)}
        style={s.root}
      >
        {/* ── Icon with halo ── */}
        <Animated.View entering={FadeInDown.delay(60).duration(350)} style={s.iconWrap}>
          <View style={[s.iconHalo, { backgroundColor: cfg.iconColor + "18" }]}>
            <MaterialIcons name={cfg.icon} size={52} color={cfg.iconColor} />
          </View>
        </Animated.View>
  
        {/* ── Title + body ── */}
        <Animated.View entering={FadeInDown.delay(140).duration(350)} style={s.textBlock}>
          <Text style={s.title}>{cfg.title}</Text>
          <Text style={s.body}>{message ?? cfg.body}</Text>
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
  
        {/* ── Divider ornament ── */}
        <Animated.View entering={FadeIn.delay(220).duration(300)} style={s.ornamentRow}>
          <View style={s.ornamentLine} />
          <Text style={s.ornamentGlyph}>✦</Text>
          <View style={s.ornamentLine} />
        </Animated.View>
  
        {/* ── Action buttons ── */}
        <Animated.View entering={FadeInUp.delay(260).duration(350)} style={s.actions}>
  
          {/* Primary: retry */}
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [
              s.primaryBtn,
              pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
            ]}
          >
            <MaterialIcons name="refresh" size={18} color={CREAM_TEXT} />
            <Text style={s.primaryBtnText}>{cfg.retryLabel}</Text>
          </Pressable>
  
          {/* Secondary: retake photos */}
          <Pressable
            onPress={onRetake}
            style={({ pressed }) => [
              s.secondaryBtn,
              pressed && { opacity: 0.65 },
            ]}
          >
            <MaterialIcons name="add-a-photo" size={16} color={WARM_BROWN} />
            <Text style={s.secondaryBtnText}>Retake Photos</Text>
          </Pressable>
  
          {/* Optional: continue anyway (low confidence only) */}
          {isLowConf && onContinueAnyway && (
            <Pressable
              onPress={onContinueAnyway}
              style={({ pressed }) => [
                s.ghostBtn,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={s.ghostBtnText}>Continue anyway →</Text>
            </Pressable>
          )}
  
        </Animated.View>
  
        {/* ── Footer note ── */}
        <Animated.View entering={FadeIn.delay(380).duration(300)} style={s.footerRow}>
          <MaterialIcons name="lock-outline" size={10} color={PARCHMENT_D} />
          <Text style={s.footerText}>Photos are only used for analysis and never stored.</Text>
        </Animated.View>
  
      </Animated.View>
    );
  }
  
  // ─── Styles ───────────────────────────────────────────────────────────────────
  
  const s = StyleSheet.create({
    root: {
      flex:              1,
      backgroundColor:   PARCHMENT,
      alignItems:        "center",
      justifyContent:    "center",
      paddingHorizontal: 28,
      paddingBottom:     32,
      gap:               0,
    },
  
    iconWrap:  { marginBottom: 20 },
    iconHalo:  {
      width:          96,
      height:         96,
      borderRadius:   48,
      justifyContent: "center",
      alignItems:     "center",
      borderWidth:    1,
      borderColor:    "rgba(190,156,44,0.20)",
    },
  
    textBlock:  { alignItems: "center", marginBottom: 16, gap: 8 },
    title: {
      fontFamily:    FONTS.serif,
      fontSize:      22,
      fontWeight:    "700",
      color:         FOREST,
      textAlign:     "center",
      letterSpacing: 0.1,
    },
    body: {
      fontFamily:  FONTS.serif,
      fontSize:    14,
      color:       WARM_BROWN,
      textAlign:   "center",
      lineHeight:  21,
    },
  
    confBadge: {
      flexDirection:     "row",
      alignItems:        "center",
      gap:               6,
      backgroundColor:   GOLD_LIGHT,
      borderRadius:      10,
      borderWidth:       1,
      borderColor:       GOLD + "40",
      paddingHorizontal: 12,
      paddingVertical:   7,
      marginBottom:      12,
    },
    confBadgeText: {
      fontFamily: FONTS.serif,
      fontSize:   12,
      fontWeight: "600",
      color:      WARM_BROWN,
      flex:       1,
      lineHeight: 17,
    },
  
    ornamentRow: {
      flexDirection:  "row",
      alignItems:     "center",
      gap:            10,
      marginBottom:   20,
      width:          "70%",
    },
    ornamentLine:  { flex: 1, height: 1, backgroundColor: PARCHMENT_D },
    ornamentGlyph: { fontSize: 14, color: GOLD },
  
    actions: { width: "100%", gap: 10, alignItems: "center" },
  
    primaryBtn: {
      flexDirection:   "row",
      alignItems:      "center",
      justifyContent:  "center",
      gap:             8,
      width:           "100%",
      paddingVertical: 16,
      borderRadius:    50,
      backgroundColor: FOREST,
      borderWidth:     1,
      borderColor:     "#1A3D1A",
      shadowColor:     FOREST,
      shadowOffset:    { width: 0, height: 3 },
      shadowOpacity:   0.25,
      shadowRadius:    6,
      elevation:       4,
    },
    primaryBtnText: {
      fontFamily:    FONTS.serif,
      fontSize:      16,
      fontWeight:    "700",
      color:         CREAM_TEXT,
      letterSpacing: 0.2,
    },
  
    secondaryBtn: {
      flexDirection:   "row",
      alignItems:      "center",
      justifyContent:  "center",
      gap:             6,
      width:           "100%",
      paddingVertical: 13,
      borderRadius:    50,
      borderWidth:     1.5,
      borderColor:     PARCHMENT_D,
      backgroundColor: "rgba(217,201,163,0.30)",
    },
    secondaryBtnText: {
      fontFamily: FONTS.serif,
      fontSize:   14,
      fontWeight: "600",
      color:      WARM_BROWN,
    },
  
    ghostBtn: {
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    ghostBtnText: {
      fontFamily:    FONTS.serif,
      fontSize:      13,
      color:         WARM_BROWN,
      opacity:       0.7,
      textDecorationLine: "underline",
    },
  
    footerRow: {
      flexDirection: "row",
      alignItems:    "center",
      gap:           5,
      marginTop:     20,
    },
    footerText: {
      fontSize:  10,
      color:     PARCHMENT_D,
      textAlign: "center",
    },
  });