/**
 * components/monetization/paywall/PaywallPurchaseButton.tsx
 *
 * The one control on this screen that can charge someone.
 *
 * ── Appearance and behaviour come from the same predicate ───────────────────
 * `disabled` is computed by `canPurchase()` in lib/paywallMachine.ts, and the
 * press handler is short-circuited by the same flag. A button that looks
 * disabled but still fires on a fast double tap is how duplicate charges
 * happen; deriving both from one boolean makes that shape impossible.
 *
 * ── Loading does not blank the screen ───────────────────────────────────────
 * The button keeps its size and its place and swaps its label for a spinner.
 *
 * ── The redesign ────────────────────────────────────────────────────────────
 * Deep forest, a hairline gold trim inside the edge, and two small gold sparks
 * bracketing the label. A gold sheen crosses the button once when it appears
 * and then about every seven seconds — slow, faint, and never while busy or
 * disabled, so it cannot suggest a charge is pending. Reduce Motion removes the
 * sheen entirely and leaves the static button.
 */
import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay,
  Easing, interpolate,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS } from "./paywallTheme";

export interface PaywallPurchaseButtonProps {
  label: string;
  onPress: () => void;
  /** Spinner instead of the label. Implies disabled. */
  busy?: boolean;
  /** Blocked for any other reason — unresolved identity, products missing. */
  disabled?: boolean;
  /** Replaces the label while blocked, e.g. "Checking your account…". */
  blockedLabel?: string | null;
}

/** How often the sheen passes. Long enough to be noticed, not watched. */
const SHEEN_PERIOD_MS = 7000;
const SHEEN_PASS_MS = 1400;

export function PaywallPurchaseButton({
  label, onPress, busy = false, disabled = false, blockedLabel = null,
}: PaywallPurchaseButtonProps) {
  const inert = busy || disabled;
  const { width } = useWindowDimensions();
  const btnW = Math.min(width - 40, 420);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  /**
   * The sheen: 0 → 1 is one left-to-right pass. It runs only while the button
   * is genuinely pressable; a shimmer on a disabled or busy button would read
   * as activity that is not happening.
   */
  const sheen = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || inert) { sheen.value = 0; return; }
    sheen.value = 0;
    sheen.value = withDelay(600, withRepeat(
      withSequence(
        withTiming(1, { duration: SHEEN_PASS_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 0 }),
        withDelay(SHEEN_PERIOD_MS - SHEEN_PASS_MS, withTiming(0, { duration: 0 })),
      ),
      -1, false,
    ));
  }, [reduceMotion, inert, sheen]);

  const sheenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheen.value, [0, 0.1, 0.9, 1], [0, 0.55, 0.55, 0]),
    transform: [{ translateX: interpolate(sheen.value, [0, 1], [-btnW * 0.5, btnW * 1.05]) }],
  }));

  const shown = busy ? "" : (inert && blockedLabel) ? blockedLabel : label;

  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={busy ? "Purchasing" : shown}
      accessibilityState={{ disabled: inert, busy }}
      style={({ pressed }) => [s.btn, inert && s.btnInert, pressed && !inert && s.btnPressed]}
    >
      {/* Gold trim just inside the edge. */}
      <View pointerEvents="none" style={s.trim} />

      {/* Sheen pass. */}
      {!reduceMotion && !inert && (
        <Animated.View pointerEvents="none" style={[s.sheen, sheenStyle]}>
          <Svg width={72} height="100%">
            <Defs>
              <LinearGradient id="cta-sheen" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0"   stopColor={PW.gold} stopOpacity="0" />
                <Stop offset="0.5" stopColor="#FFF4C8" stopOpacity="0.45" />
                <Stop offset="1"   stopColor={PW.gold} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#cta-sheen)" />
          </Svg>
        </Animated.View>
      )}

      <View style={s.row}>
        {busy ? (
          <ActivityIndicator size="small" color={PW.cream} />
        ) : (
          <>
            {!inert && <Spark />}
            <Text style={[s.label, inert && s.labelInert]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {shown}
            </Text>
            {!inert && <Spark />}
          </>
        )}
      </View>
    </Pressable>
  );
}

/** A four-point gold spark. Decorative; hidden from assistive tech by the parent label. */
function Spark() {
  return (
    <Svg width={14} height={14} style={s.spark}>
      <Path d="M7 0 L8.4 5.6 L14 7 L8.4 8.4 L7 14 L5.6 8.4 L0 7 L5.6 5.6 Z" fill={PW.gold} opacity={0.9} />
    </Svg>
  );
}

const s = StyleSheet.create({
  btn: {
    backgroundColor: PW.forestDeep,
    borderRadius: PW_RADIUS.pill,
    minHeight: 56,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: PW.forestDeep,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  btnInert: { backgroundColor: "#4E6A56", shadowOpacity: 0, elevation: 0 },
  btnPressed: { opacity: 0.9 },

  trim: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.pill - 3,
    borderWidth: 1,
    borderColor: "rgba(212,180,84,0.55)",
  },
  sheen: { position: "absolute", top: 0, bottom: 0, left: 0, width: 72 },

  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  spark: { opacity: 0.9 },
  label: {
    fontFamily: FONTS.serif, fontSize: 18, fontWeight: "800",
    color: PW.cream, letterSpacing: 0.2, textAlign: "center",
  },
  labelInert: { opacity: 0.85 },
});