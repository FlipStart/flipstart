/**
 * components/monetization/paywall/PaywallMasthead.tsx
 *
 * The engraved title-page header every contextual Pro paywall opens with:
 *
 *        ✦  FLIPSTART  ✦
 *    ───── FEATURE NAME ─────
 *               ◆
 *
 * ── Why this is one component ───────────────────────────────────────────────
 * The Deep Analysis hero introduced this treatment and Dylan approved it. The
 * three heroes redesigned after it (Generate Listings, Third Photo, AI Context)
 * adopt the same header so the four read as siblings rather than four
 * designers' opinions. Extracting it means the wordmark weight, the tracking,
 * the rule opacity and the glint cadence are identical by construction — a
 * sibling cannot drift a point away from the others.
 *
 * DeepAnalysisHero still carries its own inline copy of this markup. That is
 * deliberate for this pass: it is approved and pinned by test, and a refactor
 * with no visual change is not worth the regression risk. Fold it in later.
 *
 * ── Gold draws the rule; the wordmark is forest ─────────────────────────────
 * #C4A334 at 19pt bold is readable; the same gold at 11pt is roughly 2:1 on
 * white and is not. So the feature label sits between two gold rules and is
 * set in gold ONLY because it is tracked, bold and short — it is a caption
 * inside an ornament, not running text, and the headline below it carries the
 * meaning in ink.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * Static, except an optional glint that crosses the feature label about every
 * 11s — the same cadence Deep Analysis uses, offset from the CTA sheen (7s) so
 * nothing on the screen ever pulses in step. Heroes that already carry an
 * ambient loop of their own (Third Photo's PremiumGlimmer) pass `glint={false}`
 * so the screen never runs three loops at once. Reduce Motion removes it.
 */
import React, { useEffect, useId, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, withRepeat,
  Easing, interpolate,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { PW } from "./paywallTheme";

/** Long cadence, deliberately offset from the CTA sheen (7s) and store gleam (9s). */
const GLINT_PERIOD_MS = 11000;
const GLINT_PASS_MS = 1200;
const GLINT_FIRST_DELAY_MS = 2500;

export interface PaywallMastheadProps {
  /** Small caps feature name between the rules, e.g. "GENERATE LISTINGS". */
  feature: string;
  /** Spoken header, e.g. "FlipStart, Generate Listings". */
  accessibilityLabel: string;
  /** The slow gold glint across the feature label. Off where another loop already runs. */
  glint?: boolean;
}

export function PaywallMasthead({ feature, accessibilityLabel, glint = true }: PaywallMastheadProps) {
  const uid = useId().replace(/:/g, "");
  const glintId = `mastGlint-${uid}`;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  const pass = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || !glint) { pass.value = 0; return; }
    pass.value = 0;
    pass.value = withDelay(GLINT_FIRST_DELAY_MS, withRepeat(
      withSequence(
        withTiming(1, { duration: GLINT_PASS_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 0 }),
        withDelay(GLINT_PERIOD_MS - GLINT_PASS_MS, withTiming(0, { duration: 0 })),
      ), -1, false,
    ));
  }, [reduceMotion, glint, pass]);

  const glintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pass.value, [0, 0.15, 0.85, 1], [0, 0.9, 0.9, 0]),
    transform: [{ translateX: interpolate(pass.value, [0, 1], [-70, 70]) }],
  }));

  return (
    <View style={s.masthead} accessibilityRole="header" accessibilityLabel={accessibilityLabel}>
      <View style={s.brandRow}>
        <Spark size={13} />
        <Text style={s.brand} allowFontScaling={false}>FLIPSTART</Text>
        <Spark size={13} />
      </View>

      <View style={s.featureRow}>
        <View style={s.featureRule} />
        <View style={s.featureLabelWrap}>
          <Text style={s.featureLabel} allowFontScaling={false}>{feature}</Text>
          {glint && !reduceMotion && (
            <Animated.View pointerEvents="none" style={[s.glint, glintStyle]}>
              <Svg width={40} height="100%">
                <Defs>
                  <LinearGradient id={glintId} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0"   stopColor={PW.gold} stopOpacity="0" />
                    <Stop offset="0.5" stopColor="#FFF4C8" stopOpacity="0.7" />
                    <Stop offset="1"   stopColor={PW.gold} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${glintId})`} />
              </Svg>
            </Animated.View>
          )}
        </View>
        <View style={s.featureRule} />
      </View>

      <Diamond />
    </View>
  );
}

/** A four-point gold spark, the mark that brackets the wordmark. */
export function Spark({ size }: { size: number }) {
  const h = size / 2;
  return (
    <Svg width={size} height={size}>
      <Path
        d={`M${h} 0 L${h * 1.19} ${h * 0.81} L${size} ${h} L${h * 1.19} ${h * 1.19} L${h} ${size} L${h * 0.81} ${h * 1.19} L0 ${h} L${h * 0.81} ${h * 0.81} Z`}
        fill={PW.gold}
      />
    </Svg>
  );
}

function Diamond() {
  return (
    <Svg width={10} height={10} style={s.diamond}>
      <Path d="M5 0 L10 5 L5 10 L0 5 Z" fill={PW.gold} />
    </Svg>
  );
}

const s = StyleSheet.create({
  masthead: { alignItems: "center", gap: 5 },

  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  /** Forest, heavy, wide-tracked: a wordmark, not a label. */
  brand: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: "800", letterSpacing: 5, color: PW.forest },

  featureRow: { flexDirection: "row", alignItems: "center", gap: 10, width: 260 },
  featureRule: { flex: 1, height: 1, backgroundColor: "rgba(196,163,52,0.65)" },
  featureLabelWrap: { overflow: "hidden", paddingHorizontal: 2 },
  featureLabel: { fontFamily: FONTS.serif, fontSize: 11, fontWeight: "800", letterSpacing: 3.2, color: PW.gold },
  glint: { position: "absolute", top: 0, bottom: 0, left: 0, width: 40 },

  diamond: { marginTop: -2 },
});