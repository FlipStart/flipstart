/**
 * components/monetization/PremiumGlimmer.tsx
 *
 * A gold sheen that sweeps across a surface — the premium cue on the third
 * photo slot.
 *
 * ── Why SVG and not a plain View ────────────────────────────────────────────
 * A translucent <View> is a hard-edged bar. It reads as a loading shimmer, not
 * as light moving across a surface. A real linear gradient — transparent to
 * gold to transparent — has soft edges and a bright core, which is what makes
 * the difference between "shimmer effect" and "premium".
 *
 * react-native-svg is already a project dependency, so this costs nothing.
 *
 * ── The surface stays normal ────────────────────────────────────────────────
 * No border, no tint, no background change. The slot looks exactly like every
 * other slot; it just catches the light.
 */
import React, { useEffect, useId, useState } from 'react';
import { View, StyleSheet, AccessibilityInfo, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay,
  withSequence, interpolate, Easing, cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

const GOLD = '#C4A334';
/** Pale gold at the core — a highlight reads brighter than the base colour. */
const GOLD_HOT = '#F0DC96';

/** One pass across the tile. */
const SWEEP_MS = 900;
/** Rest between passes. Long enough to feel occasional, short enough to catch. */
const REST_MS = 1500;

export interface PremiumGlimmerProps {
  children: React.ReactNode;
  size: number;
  active?: boolean;
  radius?: number;
  style?: ViewStyle;
}

export function PremiumGlimmer({
  children, size, active = true, radius = 10, style,
}: PremiumGlimmerProps) {
  const progress = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  /**
   * SVG ids are global within a document. A hardcoded "sheen" would collide if
   * two glimmers ever mounted together, and the failure is silent — one band
   * simply renders blank. Only one mounts today, but the component is reusable.
   */
  const gradientId = `sheen-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = 0;
    /**
     * FIRST PASS IS IMMEDIATE.
     *
     * The previous version wrapped every pass in withDelay, including the
     * first — so the slot sat dead for 1.6s after the second photo, which is
     * exactly the window where the user is looking at it and deciding what to
     * do. Most never saw it.
     *
     * withSequence runs one pass straight away, then hands over to the
     * rest-and-repeat loop.
     */
    progress.value = withSequence(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.out(Easing.quad) }),
      withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }),
          withDelay(REST_MS, withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) })),
        ),
        -1, false,
      ),
    );
    return () => cancelAnimation(progress);
  }, [active, reduceMotion, progress]);

  // Band travels well clear of both edges so nothing is parked on the tile at
  // rest.
  const bandH = size * 0.62;
  const sweep = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-bandH * 1.4, size + bandH * 0.6]) },
      { rotate: '-24deg' },
    ],
    // Eases in and out rather than snapping on, which is most of what separates
    // a premium sheen from a blinking overlay.
    opacity: interpolate(progress.value, [0, 0.12, 0.55, 0.88, 1], [0, 0.85, 1, 0.85, 0]),
  }));

  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      {children}

      {/* Reduce Motion renders nothing: the slot is meant to look normal, and a
          frozen streak would just be a stray mark. */}
      {active && !reduceMotion && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
        >
          <Animated.View
            style={[
              {
                position: 'absolute',
                // Wider than the tile so the rotated band still spans it fully.
                width: size * 2.2,
                height: bandH,
                left: -size * 0.6,
                top: 0,
              },
              sweep,
            ]}
          >
            <Svg width="100%" height="100%">
              <Defs>
                {/* Feathered across the band's SHORT axis, so the leading and
                    trailing edges fade instead of cutting hard. */}
                <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0"    stopColor={GOLD}     stopOpacity="0" />
                  <Stop offset="0.35" stopColor={GOLD}     stopOpacity="0.30" />
                  <Stop offset="0.5"  stopColor={GOLD_HOT} stopOpacity="0.62" />
                  <Stop offset="0.65" stopColor={GOLD}     stopOpacity="0.30" />
                  <Stop offset="1"    stopColor={GOLD}     stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
            </Svg>
          </Animated.View>
        </View>
      )}
    </View>
  );
}