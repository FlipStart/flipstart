/**
 * components/monetization/paywall/ScanStoreAlternative.tsx
 *
 * The second answer on the scan-limit paywall: buy scans instead.
 *
 * ── Only ever rendered for scan_limit ───────────────────────────────────────
 * The modal gates this on `config.showScanStoreAlternative`, which is true for
 * exactly one source. Packs buy quantity and cannot unlock a capability, so on
 * the other five paywalls this button would sell something that cannot help.
 * Here the user's problem IS quantity — and a pack genuinely solves it.
 *
 * ── Visual weight ───────────────────────────────────────────────────────────
 * Gold-forward, so a user who specifically wants more scans notices it at once,
 * but outlined rather than filled so it stays clearly second to the solid
 * forest Pro CTA above it. Filled gold would compete; a thin link would hide.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * A faint gleam crosses the button once on appear, then every ~9 seconds —
 * offset from the CTA's 7-second sheen so the two never pulse in step. Reduce
 * Motion removes it.
 */
import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo, Pressable, StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay,
  Easing, interpolate,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS } from "./paywallTheme";

const GLEAM_PERIOD_MS = 9000;
const GLEAM_PASS_MS = 1300;

export function ScanStoreAlternative({ onPress, disabled = false }: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const { width } = useWindowDimensions();
  const btnW = Math.min(width - 40, 420);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  const gleam = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || disabled) { gleam.value = 0; return; }
    gleam.value = withDelay(1800, withRepeat(
      withSequence(
        withTiming(1, { duration: GLEAM_PASS_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 0 }),
        withDelay(GLEAM_PERIOD_MS - GLEAM_PASS_MS, withTiming(0, { duration: 0 })),
      ),
      -1, false,
    ));
  }, [reduceMotion, disabled, gleam]);

  const gleamStyle = useAnimatedStyle(() => ({
    opacity: interpolate(gleam.value, [0, 0.1, 0.9, 1], [0, 0.5, 0.5, 0]),
    transform: [{ translateX: interpolate(gleam.value, [0, 1], [-btnW * 0.5, btnW * 1.05]) }],
  }));

  return (
    <View style={s.block}>
      {/* ── or ── */}
      <View style={s.orRow}>
        <View style={s.orRule} />
        <Text style={s.orText}>or</Text>
        <View style={s.orRule} />
      </View>

      <Text style={s.prompt}>Just need more scans?</Text>

      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Go to Scan Store"
        accessibilityHint="Buy scan packs without subscribing"
        accessibilityState={{ disabled }}
        style={({ pressed }) => [s.btn, disabled && s.btnDisabled, pressed && !disabled && s.btnPressed]}
      >
        {!reduceMotion && !disabled && (
          <Animated.View pointerEvents="none" style={[s.gleam, gleamStyle]}>
            <Svg width={64} height="100%">
              <Defs>
                <LinearGradient id="store-gleam" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0"   stopColor={PW.gold} stopOpacity="0" />
                  <Stop offset="0.5" stopColor="#FFF4C8" stopOpacity="0.7" />
                  <Stop offset="1"   stopColor={PW.gold} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#store-gleam)" />
            </Svg>
          </Animated.View>
        )}
        <View style={s.row}>
          <Spark />
          <Text style={s.label} numberOfLines={1}>Go to Scan Store</Text>
          <Spark />
        </View>
      </Pressable>
    </View>
  );
}

function Spark() {
  return (
    <Svg width={11} height={11}>
      <Path d="M5.5 0 L6.6 4.4 L11 5.5 L6.6 6.6 L5.5 11 L4.4 6.6 L0 5.5 L4.4 4.4 Z" fill={PW.gold} />
    </Svg>
  );
}

const s = StyleSheet.create({
  block: { alignItems: "center", gap: 8, width: "100%" },

  orRow: { flexDirection: "row", alignItems: "center", gap: 12, width: "100%", paddingHorizontal: 6 },
  orRule: { flex: 1, height: 1, backgroundColor: "rgba(196,163,52,0.55)" },
  orText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: "700", color: PW.brown },

  prompt: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: "800", color: PW.ink },

  btn: {
    alignSelf: "stretch",
    minHeight: 50,
    borderRadius: PW_RADIUS.pill,
    borderWidth: 1.6,
    borderColor: PW.forest,
    backgroundColor: PW.goldTint,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: PW.gold,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  gleam: { position: "absolute", top: 0, bottom: 0, left: 0, width: 64 },

  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: "800", color: PW.forest },
});