/**
 * components/monetization/paywall/HeroReveal.tsx
 *
 * One entrance, shared by every redesigned hero teaser.
 *
 * ── The motion doctrine, in one place ───────────────────────────────────────
 * Entrance choreography ONCE, then still. A hero's teaser is revealed by a
 * single 0 → 1 progress value; each part of the teaser picks a window inside
 * that value and fades up as the window passes. Nothing here repeats, nothing
 * bounces, and nothing runs while the user is deciding — the whole pass is
 * over inside a second.
 *
 * Putting the progress value behind a hook means every hero shares the same
 * delay, duration and easing, so the three siblings arrive with the same
 * rhythm. A hero that wanted a different feel would have to argue for it here
 * rather than drift on its own.
 *
 * ── Reduce Motion ───────────────────────────────────────────────────────────
 * Same pattern as PremiumGlimmer, ProBenefits and the plan card: the OS
 * preference is read once, and when it is on the progress value is set to 1
 * directly so every part renders in its finished state. There is no
 * "shorter" animation for Reduce Motion — there is no animation.
 */
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, interpolate,
  type SharedValue,
} from "react-native-reanimated";

/** Starts after the modal's slide has settled; finishes well inside a second. */
const REVEAL_DELAY_MS = 220;
const REVEAL_DURATION_MS = 640;

export function useHeroReveal(): { progress: SharedValue<number>; reduceMotion: boolean } {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) { progress.value = 1; return; }
    progress.value = withDelay(
      REVEAL_DELAY_MS,
      withTiming(1, { duration: REVEAL_DURATION_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [reduceMotion, progress]);

  return { progress, reduceMotion };
}

export interface RevealProps {
  progress: SharedValue<number>;
  /** Where in the 0–1 pass this part starts appearing. */
  at: number;
  /** How much of the pass it takes to fully appear. */
  span?: number;
  /** Resting offset it travels from, in points. */
  dx?: number;
  dy?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** One part of a teaser, fading and settling into place during its window. */
export function Reveal({ progress, at, span = 0.5, dx = 0, dy = 8, style, children }: RevealProps) {
  const animated = useAnimatedStyle(() => {
    const t = interpolate(progress.value, [at, Math.min(1, at + span)], [0, 1], "clamp");
    return {
      opacity: t,
      transform: [{ translateX: (1 - t) * dx }, { translateY: (1 - t) * dy }],
    };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}