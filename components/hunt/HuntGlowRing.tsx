/**
 * components/hunt/HuntGlowRing.tsx
 *
 * A soft gold ring around the Start Hunt button while onboarding is unresolved.
 * Sits behind/around the button (pointerEvents none) and never changes its size
 * or position. 'pulse' breathes on the same ~2.4s beat as the tab dot; 'static'
 * (or Reduce Motion) is a quiet constant hairline.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import type { AttentionMode } from '@/lib/huntOnboarding';
import { useReduceMotion } from './HuntAttentionDot';

const GOLD = '#C4972A';
const PERIOD_MS = 2400;

export function HuntGlowRing({
  mode, radius = 14, inset = 4,
}: { mode: Exclude<AttentionMode, 'off'>; radius?: number; inset?: number }) {
  const reduce = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  const animate = mode === 'pulse' && !reduce;

  useEffect(() => {
    if (!animate) { t.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: PERIOD_MS * 0.5, useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: PERIOD_MS * 0.5, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, t]);

  const opacity = animate ? t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.9] }) : 0.45;
  const scale   = animate ? t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) : 1;

  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID="hunt-glow-ring"
      style={{
        position: 'absolute',
        top: -inset, left: -inset, right: -inset, bottom: -inset,
        borderRadius: radius + inset,
        borderWidth: 2,
        borderColor: GOLD,
        opacity,
        transform: [{ scale }],
        shadowColor: GOLD, shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}

export const huntGlowStyles = StyleSheet.create({ wrap: { position: 'relative' } });