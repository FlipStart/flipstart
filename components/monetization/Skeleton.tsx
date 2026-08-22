/**
 * components/monetization/Skeleton.tsx
 *
 * Neutral placeholder for state that has not resolved yet.
 *
 * Exists because the alternative — rendering a guess — mislabels people. A
 * skeleton says "we don't know yet", which is both true and harmless; "Free
 * Member" says something specific and, for a paying subscriber, wrong.
 *
 * No new dependency: Reanimated is already in the project.
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, AccessibilityInfo, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, interpolate, Easing, cancelAnimation,
} from 'react-native-reanimated';

const GOLD = '#BE9C2C';

export interface SkeletonProps {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width, height, radius = 6, style }: SkeletonProps) {
  const pulse = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // Same pattern SoldCompsSection and MembershipStatus already use.
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // A static placeholder is a perfectly good neutral state.
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true,
    );
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);

  const anim = useAnimatedStyle(() => ({
    // Gentle. A skeleton should be ignorable, not attention-seeking.
    opacity: interpolate(pulse.value, [0, 1], [0.30, 0.55]),
  }));

  return (
    <Animated.View
      style={[
        s.base,
        { width: width as any, height, borderRadius: radius },
        reduceMotion ? { opacity: 0.4 } : anim,
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const s = StyleSheet.create({
  base: { backgroundColor: GOLD + '55' },
});