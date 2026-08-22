/**
 * components/home/ScanPillAffordance.tsx
 *
 * Makes the scan circle read as a CONTROL rather than a badge.
 *
 * ── Why not just add a chevron ──────────────────────────────────────────────
 * The circle is 46pt and already holds an arced label, a bolt and a number.
 * A fourth element would crowd it, and hanging a glyph underneath would break
 * the header's left/right symmetry for one side only.
 *
 * Instead this does what physical buttons do: catch light on the rim, and give
 * way when pressed. No new elements, no layout change.
 *
 * ── The one-time hint ───────────────────────────────────────────────────────
 * A rim alone is quiet. On the first few app opens the circle gives two slow
 * pulses, which is enough to draw the eye once. It stops permanently the moment
 * the user taps it — a hint that keeps hinting after it has been understood is
 * just noise.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming,
  withDelay, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { AccessibilityInfo } from 'react-native';

/** Pulses shown before the hint gives up on its own. */
const MAX_HINTS = 3;

const key = (uid: string | null) => `@flipstart/scanpill_hint:${uid ?? 'guest'}`;

/**
 * NOTE ON TYPING
 *
 * The return type is deliberately INFERRED rather than declared.
 *
 * A hand-written interface tried `animatedStyle: ReturnType<typeof
 * useAnimatedStyle>`, but that hook is generic — ReturnType resolves it to a
 * base instantiation that is not assignable to Animated.View's `style`, so the
 * error appeared at the call site on a line that looked perfectly fine.
 *
 * Inference gives the exact type useAnimatedStyle actually produces, which is
 * correct by construction and immune to Reanimated renaming its exports.
 */

export function useScanPillAffordance(uid: string | null) {
  const scale = useSharedValue(1);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hintsLeft, setHintsLeft] = useState<number | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  // How many hints this account has already seen.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key(uid))
      .then(raw => {
        if (!alive) return;
        const seen = raw === 'used' ? MAX_HINTS : Number(raw ?? 0);
        setHintsLeft(Math.max(0, MAX_HINTS - (Number.isFinite(seen) ? seen : 0)));
      })
      .catch(() => { if (alive) setHintsLeft(0); });  // unreadable -> stay quiet
    return () => { alive = false; };
  }, [uid]);

  useEffect(() => {
    // Wait for the count; never pulse speculatively.
    if (hintsLeft === null || hintsLeft <= 0 || reduceMotion) {
      cancelAnimation(scale);
      scale.value = 1;
      return;
    }
    /**
     * Three pulses, starting almost immediately.
     *
     * The first version waited 900ms and moved 7%. By the time it fired you had
     * usually looked away, and 7% of 46pt is a 3pt change — too small to
     * register in peripheral vision.
     *
     * 350ms in, 16%, three passes. Still not a loop — a control that never
     * stops moving reads as an alert — but now it is genuinely noticeable.
     */
    scale.value = withDelay(350, withRepeat(
      withSequence(
        withTiming(1.16, { duration: 420, easing: Easing.out(Easing.back(2)) }),
        withTiming(1.00, { duration: 420, easing: Easing.in(Easing.quad) }),
      ),
      3, false,
    ));

    // Record that a hint was spent, so it fades out over a few launches even if
    // the user never taps.
    AsyncStorage.setItem(key(uid), String(MAX_HINTS - hintsLeft + 1)).catch(() => {});
    return () => cancelAnimation(scale);
  }, [hintsLeft, reduceMotion, scale, uid]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Tactile give. Opacity alone reads as "disabled"; a small scale reads as
  // "pressed".
  const onPressIn  = useCallback(() => {
    scale.value = withTiming(0.93, { duration: 90, easing: Easing.out(Easing.quad) });
  }, [scale]);
  const onPressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
  }, [scale]);

  /** Once they have tapped it, they know. Never hint again. */
  const markUsed = useCallback(() => {
    setHintsLeft(0);
    AsyncStorage.setItem(key(uid), 'used').catch(() => {});
  }, [uid]);

  return { animatedStyle, onPressIn, onPressOut, markUsed };
}