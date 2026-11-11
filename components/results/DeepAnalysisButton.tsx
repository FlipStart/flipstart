/**
 * components/results/DeepAnalysisButton.tsx
 *
 * The Deep Analysis entry on the results screen: a gold-outlined card that
 * shivers and bounces like the Progress tab does when it has a notification,
 * then a gold sheen crosses it, like the paywall purchase button.
 *
 * ── One timeline ────────────────────────────────────────────────────────────
 * Shake and shine share a single period so they read as one gesture — the card
 * jolts, then catches the light — instead of two unrelated loops drifting in
 * and out of phase.
 *
 *   0ms      shake + bounce (≈ 0.5s, same beat pattern as the tab icon)
 *   600ms    sheen sweeps left → right (≈ 1.2s)
 *   …        rest until PERIOD_MS, then repeat
 *
 * ── Scaled for a card ───────────────────────────────────────────────────────
 * The tab icon swings ±28° because it is 24px wide. On a full-width card that
 * would be absurd, so the same beats are kept at ±1.8° and a 4% bounce. The
 * rest between passes is longer than the tab's too: the tab is a badge you
 * have to clear, this sits on a screen people are reading.
 *
 * ── Never blocks the tap ────────────────────────────────────────────────────
 * Everything animated is pointerEvents="none" or a transform on the wrapper;
 * the Pressable is a normal full-size target. Reduce Motion renders the card
 * static, with no sheen at all (a frozen streak would just look like a smudge).
 */
import React, { useEffect, useId, useState } from 'react';
import { View, Text, Pressable, StyleSheet, AccessibilityInfo, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay,
  interpolate, Easing, cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';

const FOREST = '#2A4A2A';
const MUTED = '#8A7050';
const GOLD = '#BE9C2C';
const GOLD_HOT = '#F0DC96';
const CARD = '#FFFEFA';

/** Full cycle: shake, shine, rest. */
const PERIOD_MS = 4200;
const SHEEN_DELAY_MS = 600;
const SHEEN_PASS_MS = 1200;
/** Max shake rotation in degrees at wiggle = ±1. */
const SHAKE_DEG = 1.8;

export interface DeepAnalysisButtonProps {
  onPress: () => void;
}

export function DeepAnalysisButton({ onPress }: DeepAnalysisButtonProps) {
  const wiggle = useSharedValue(0);
  const pulse = useSharedValue(1);
  const sheen = useSharedValue(0);
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  // SVG ids are document-global; keep ours unique.
  const gradientId = `da-sheen-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(wiggle); cancelAnimation(pulse); cancelAnimation(sheen);
      wiggle.value = 0; pulse.value = 1; sheen.value = 0;
      return;
    }
    const t = (to: number, duration: number) => withTiming(to, { duration, easing: Easing.linear });
    // Same beat pattern as the Progress tab (app/(tabs)/_layout.tsx).
    const shakeMs = 50 + 90 + 70 + 70 + 55 + 55 + 40;
    const bounceMs = 120 + 100 + 80 + 60;

    wiggle.value = withRepeat(withSequence(
      t(1, 50), t(-1, 90), t(0.85, 70), t(-0.85, 70), t(0.5, 55), t(-0.5, 55), t(0, 40),
      withDelay(PERIOD_MS - shakeMs, t(0, 0)),
    ), -1, false);

    pulse.value = withRepeat(withSequence(
      t(1.04, 120), t(0.985, 100), t(1.02, 80), t(1, 60),
      withDelay(PERIOD_MS - bounceMs, t(1, 0)),
    ), -1, false);

    sheen.value = 0;
    sheen.value = withRepeat(withSequence(
      withDelay(SHEEN_DELAY_MS, withTiming(1, { duration: SHEEN_PASS_MS, easing: Easing.inOut(Easing.sin) })),
      withDelay(PERIOD_MS - SHEEN_DELAY_MS - SHEEN_PASS_MS, withTiming(0, { duration: 0 })),
    ), -1, false);

    return () => { cancelAnimation(wiggle); cancelAnimation(pulse); cancelAnimation(sheen); };
  }, [reduceMotion, wiggle, pulse, sheen]);

  const shake = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${wiggle.value * SHAKE_DEG}deg` },
      { scale: pulse.value },
    ],
  }));

  const bandW = Math.max(width * 0.42, 90);
  const sweep = useAnimatedStyle(() => ({
    opacity: interpolate(sheen.value, [0, 0.12, 0.88, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(sheen.value, [0, 1], [-bandW * 1.2, width + bandW * 0.4]) },
      { rotate: '-18deg' },
    ],
  }));

  return (
    <Animated.View style={[s.wrap, shake]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Open Deep Analysis"
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
      >
        <View style={s.inner}>
          <View style={s.iconCircle}>
            <MaterialIcons name="insights" size={20} color={GOLD} />
          </View>
          <View style={s.textCol}>
            <Text style={s.title}>DEEP ANALYSIS</Text>
            <Text style={s.sub} numberOfLines={2}>
              Full price reasoning, risks and where to sell it
            </Text>
          </View>
          <View style={s.arrow}>
            <Text style={s.link}>Open</Text>
            <MaterialIcons name="chevron-right" size={20} color={FOREST} />
          </View>
        </View>

        {!reduceMotion && width > 0 && (
          <View pointerEvents="none" style={s.clip}>
            <Animated.View style={[{ position: 'absolute', top: -20, bottom: -20, width: bandW }, sweep]}>
              <Svg width="100%" height="100%">
                <Defs>
                  <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0"    stopColor={GOLD}     stopOpacity="0" />
                    <Stop offset="0.35" stopColor={GOLD}     stopOpacity="0.28" />
                    <Stop offset="0.5"  stopColor={GOLD_HOT} stopOpacity="0.7" />
                    <Stop offset="0.65" stopColor={GOLD}     stopOpacity="0.28" />
                    <Stop offset="1"    stopColor={GOLD}     stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
              </Svg>
            </Animated.View>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 14, marginTop: 12 },
  card: {
    backgroundColor: CARD, borderRadius: 14,
    borderWidth: 1.5, borderColor: GOLD + '99',
    shadowColor: GOLD, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 3,
  },
  clip: { ...StyleSheet.absoluteFillObject, borderRadius: 13, overflow: 'hidden' },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: GOLD + '1F' },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: 12, fontWeight: '800', color: FOREST, letterSpacing: 1.2 },
  sub: { fontSize: 12, lineHeight: 16, color: MUTED },
  arrow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  link: { fontSize: 13, fontWeight: '700', color: FOREST, fontFamily: FONTS.serif },
});