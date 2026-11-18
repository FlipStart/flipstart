/**
 * components/hunt/HuntAttentionDot.tsx
 *
 * The "start here" marker on Hunt Mode entry points while onboarding is unresolved: a plain
 * gold dot (no glyph in it). In 'pulse' mode a soft halo breathes out of it every ~2.4s.
 * Deliberately gold, not red: red already means "unseen achievements" on the Progress tab,
 * and this should invite, not alarm.
 *
 * It is a badge, so callers place it OUTSIDE the thing it labels (beside the paw, off the
 * corner of the button), never on top of an icon.
 *
 * Also exports useShutter: the quick shake the Hunt tab does while the badge is pulsing.
 *
 * Decorative: the entry point it sits on carries the accessibility label.
 * Reduce Motion renders everything static. Never intercepts touches.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, AccessibilityInfo, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { AttentionMode } from '@/lib/huntOnboarding';

/** Fill of the dot. */
export const ATTENTION_GOLD = '#C4972A';
/** Gold for the Hunt tab's paw and label on the white bar: 3.2:1 (the badge is the main signal). */
export const ATTENTION_GOLD_TAB = '#B8860B';
const PERIOD_MS = 2400;
export const DEFAULT_DOT_SIZE = 16;

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

/**
 * A quick shake-and-pop, then a rest, repeating while `active`. Returns transforms to put on
 * whatever should shake (the paw, its label and the badge together). Reduce Motion: stays still.
 */
export function useShutter(active: boolean) {
  const reduce = useReduceMotion();
  const shake = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const go = active && !reduce;

  useEffect(() => {
    if (!go) {
      shake.setValue(0); pop.setValue(1);
      return;
    }
    const t = (v: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(v, { toValue, duration, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.sequence([
          t(shake, 1, 50), t(shake, -1, 90), t(shake, 0.85, 70), t(shake, -0.85, 70),
          t(shake, 0.5, 55), t(shake, -0.5, 55), t(shake, 0, 40),
        ]),
        Animated.sequence([t(pop, 1.18, 120), t(pop, 0.94, 100), t(pop, 1.06, 80), t(pop, 1, 60)]),
      ]),
      Animated.delay(1800),
    ]));
    loop.start();
    return () => { loop.stop(); shake.setValue(0); pop.setValue(1); };
  }, [go, shake, pop]);

  const rotate = shake.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-16deg', '0deg', '16deg'] });
  return { transform: [{ rotate }, { scale: pop }] };
}

export function HuntAttentionDot({
  mode, size = DEFAULT_DOT_SIZE, style,
}: { mode: Exclude<AttentionMode, 'off'>; size?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  const animate = mode === 'pulse' && !reduce;

  useEffect(() => {
    if (!animate) { t.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: PERIOD_MS * 0.6, useNativeDriver: true }),
      Animated.delay(PERIOD_MS * 0.4),
      Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, t]);

  const haloScale   = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const haloOpacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View
      pointerEvents="none"
      style={[{ width: size, height: size }, style]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID="hunt-attention-dot"
    >
      {animate && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: size / 2, backgroundColor: ATTENTION_GOLD, opacity: haloOpacity, transform: [{ scale: haloScale }] },
          ]}
        />
      )}
      <View style={[s.badge, { width: size, height: size, borderRadius: size / 2 }]} />
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    backgroundColor: ATTENTION_GOLD, borderWidth: 1.5, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.25, shadowRadius: 1.5, elevation: 2,
  },
});