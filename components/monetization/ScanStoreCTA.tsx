/**
 * components/monetization/ScanStoreCTA.tsx
 *
 * The shopfront button: the voluntary way into the Scan Store.
 *
 * ── Where it appears ────────────────────────────────────────────────────────
 * The scan-balance popup on Home. A user who taps their remaining-scans pill
 * is, more often than not, wondering whether to buy more — so the way into the
 * store is the hero of that popup, not a quiet outline beneath "Got it".
 *
 * ── The same brass as the paywall's Scan Store button ───────────────────────
 * Fill is PW.goldStore with forestDeep text and detail, a forest border, and a
 * warm gold shadow — the treatment ScanStoreAlternative uses on the scan-limit
 * paywall, so "Go to Scan Store" looks like one object wherever it appears. It
 * is richer than the paywall's CTA on purpose here: in THIS popup there is no
 * Pro purchase to stay subordinate to.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * Three things, all restrained:
 *   • Entrance — after the popup's own fade, the button settles in (scale
 *     0.96 → 1, 6pt rise, ~420ms). Once per open.
 *   • Idle gleam — a soft highlight crosses the brass every ~6s. The popup has
 *     no other loop, so one is the budget. Stops when hidden.
 *   • Press — a 3% give under the finger, so it feels like a thing.
 * Reduce Motion renders the finished button with no entrance and no gleam.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 * It navigates. It never starts a purchase, never reads a balance, and never
 * decides anything. The caller owns dismiss → clear intent → push.
 */
import React, { useEffect, useId, useState } from "react";
import {
  AccessibilityInfo, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, withRepeat,
  Easing, interpolate,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS } from "@/components/monetization/paywall/paywallTheme";

/** The popup's own fade is ~300ms; the button arrives just after it. */
const ENTER_DELAY_MS = 240;
const ENTER_MS = 420;
/** Long cadence, offset from every other loop in the app (7s CTA, 9s store, 11s masthead). */
const GLEAM_PERIOD_MS = 6000;
const GLEAM_PASS_MS = 1200;
const GLEAM_FIRST_DELAY_MS = 1400;

export interface ScanStoreCTAProps {
  onPress: () => void;
  /** Drives the entrance and the gleam. Pass the popup's visibility. */
  visible?: boolean;
  disabled?: boolean;
  title?: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
}

export function ScanStoreCTA({
  onPress,
  visible = true,
  disabled = false,
  title = "Go to Scan Store",
  subtitle = "Stock up on extra scans",
  style,
}: ScanStoreCTAProps) {
  const uid = useId().replace(/:/g, "");
  const gleamId = `storeCta-${uid}`;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // ── Entrance: once per open ─────────────────────────────────────────────
  const enter = useSharedValue(0);
  useEffect(() => {
    if (!visible) { enter.value = 0; return; }
    if (reduceMotion) { enter.value = 1; return; }
    enter.value = 0;
    enter.value = withDelay(ENTER_DELAY_MS, withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }));
  }, [visible, reduceMotion, enter]);

  // ── Idle gleam ──────────────────────────────────────────────────────────
  const gleam = useSharedValue(0);
  useEffect(() => {
    if (!visible || reduceMotion || disabled) { gleam.value = 0; return; }
    gleam.value = 0;
    gleam.value = withDelay(GLEAM_FIRST_DELAY_MS, withRepeat(
      withSequence(
        withTiming(1, { duration: GLEAM_PASS_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 0 }),
        withDelay(GLEAM_PERIOD_MS - GLEAM_PASS_MS, withTiming(0, { duration: 0 })),
      ), -1, false,
    ));
  }, [visible, reduceMotion, disabled, gleam]);

  // ── Press give ──────────────────────────────────────────────────────────
  const pressed = useSharedValue(0);

  const shell = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 6 },
      { scale: interpolate(enter.value, [0, 1], [0.96, 1]) * (1 - pressed.value * 0.03) },
    ],
  }));
  const gleamStyle = useAnimatedStyle(() => ({
    opacity: interpolate(gleam.value, [0, 0.12, 0.88, 1], [0, 0.6, 0.6, 0]),
    transform: [{ translateX: interpolate(gleam.value, [0, 1], [-120, 380]) }],
  }));

  return (
    <Animated.View style={[style, shell]}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        onPressIn={() => { pressed.value = withTiming(1, { duration: 90 }); }}
        onPressOut={() => { pressed.value = withTiming(0, { duration: 160 }); }}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        accessibilityState={{ disabled }}
        style={[s.btn, disabled && s.btnDisabled]}
      >
        {/* Hairline inside the edge — the "expensive" detail, in ink on brass. */}
        <View pointerEvents="none" style={s.innerRule} />

        {/* Idle gleam. */}
        {!reduceMotion && !disabled && (
          <Animated.View pointerEvents="none" style={[s.gleam, gleamStyle]}>
            <Svg width={90} height="100%">
              <Defs>
                <LinearGradient id={gleamId} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0"   stopColor="#FFF4C8" stopOpacity="0" />
                  <Stop offset="0.5" stopColor="#FFF9E3" stopOpacity="0.85" />
                  <Stop offset="1"   stopColor="#FFF4C8" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill={`url(#${gleamId})`} />
            </Svg>
          </Animated.View>
        )}

        <View style={s.row}>
          {/* The pack seal: stacked cards, the same glyph the store's balance card uses. */}
          <View style={s.seal}>
            <MaterialIcons name="style" size={19} color={PW.forestDeep} />
          </View>

          <View style={s.textCol}>
            <View style={s.titleRow}>
              <InkSpark />
              <Text style={s.title} numberOfLines={1} allowFontScaling={false}>{title}</Text>
              <InkSpark />
            </View>
            <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>

          <MaterialIcons name="chevron-right" size={22} color={PW.forestDeep} style={s.chevron} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** A four-point spark in ink: gold-on-brass would be ~1.2:1 and vanish. */
function InkSpark() {
  return (
    <Svg width={9} height={9}>
      <Path d="M4.5 0 L5.4 3.6 L9 4.5 L5.4 5.4 L4.5 9 L3.6 5.4 L0 4.5 L3.6 3.6 Z" fill={PW.forestDeep} opacity={0.75} />
    </Svg>
  );
}

const s = StyleSheet.create({
  btn: {
    alignSelf: "stretch",
    backgroundColor: PW.goldStore,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.6,
    borderColor: PW.forest,
    paddingVertical: 11,
    paddingLeft: 12,
    paddingRight: 8,
    overflow: "hidden",
    shadowColor: PW.gold,
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  btnDisabled: { opacity: 0.5, shadowOpacity: 0, elevation: 0 },
  innerRule: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 3,
    borderWidth: 1, borderColor: "rgba(18,46,27,0.28)",
  },
  gleam: { position: "absolute", top: 0, bottom: 0, left: 0, width: 90 },

  row: { flexDirection: "row", alignItems: "center", gap: 11 },
  seal: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(18,46,27,0.10)", borderWidth: 1, borderColor: "rgba(18,46,27,0.35)",
  },
  textCol: { flex: 1, minWidth: 0, gap: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  /** forestDeep on goldStore: ~7:1. */
  title: { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: "800", color: PW.forestDeep, letterSpacing: 0.2, flexShrink: 1 },
  /** forest on goldStore: ~4.6:1 — clears AA at this size. */
  subtitle: { fontSize: 11.5, fontWeight: "600", color: PW.forest, opacity: 0.95 },
  chevron: { marginLeft: 2 },
});