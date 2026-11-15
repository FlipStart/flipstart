/**
 * components/onboarding/OnboardingProgress.tsx
 *
 * Segmented progress under the header: one segment per screen that moves the
 * user forward, filled in forest as they go.
 *
 * Driven by a fraction so the shell's existing `progress` prop keeps working;
 * the fraction is rounded to whole segments so a bar never stops halfway
 * through one. Fill slides between screens in 300ms; Reanimated's default
 * ReduceMotion.System drops the slide when the OS asks.
 */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { OB, OB_MOTION } from "./onboardingTheme";

/** Walkthrough ×2, questions ×4, profile ×1. */
export const PROGRESS_SEGMENTS = 7;

export function filledSegments(value: number, segments: number): number {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return Math.round(v * segments);
}

export function OnboardingProgress({ value, segments = PROGRESS_SEGMENTS }: { value: number; segments?: number }) {
  const target = filledSegments(value, segments);
  const filled = useSharedValue(target);
  useEffect(() => {
    filled.value = withTiming(target, { duration: OB_MOTION.progress, easing: Easing.out(Easing.cubic) });
  }, [target, filled]);

  return (
    <View
      style={s.row}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${Math.max(target, 1)} of ${segments}`}
      accessibilityValue={{ min: 0, max: segments, now: target }}
    >
      {Array.from({ length: segments }, (_, i) => <Segment key={i} index={i} filled={filled} />)}
    </View>
  );
}

function Segment({ index, filled }: { index: number; filled: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => {
    const f = Math.max(0, Math.min(1, filled.value - index));
    return { width: `${f * 100}%` };
  });
  return (
    <View style={s.track}>
      <Animated.View style={[s.fill, fill]} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 5 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: OB.track, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2, backgroundColor: OB.forest },
});