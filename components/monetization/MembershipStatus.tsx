/**
 * components/monetization/MembershipStatus.tsx
 *
 * Membership identity, shared by Settings and Profile so the two can never
 * drift. Both previously hardcoded the string "FlipStart Free Member".
 *
 * ── Plan comes from the server, never from pack ownership ───────────────────
 * A Free user holding 2,310 pack scans is still a Free member. Packs buy
 * quantity, never capability — and this component is where that distinction is
 * most visible to the user, so it must not blur it.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay,
  interpolate, Easing, cancelAnimation,
} from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEntitlement } from '@/lib/useEntitlement';
import { Skeleton } from '@/components/monetization/Skeleton';

const GOLD  = '#BE9C2C';
const CREAM = '#F4EED8';
const MUTED = '#8A7050';

export interface MembershipStatusProps {
  style?: TextStyle;
  /** Settings uses 11pt, Profile 13pt — matches each host's type scale. */
  fontSize?: number;
}

/**
 * Premium glimmer.
 *
 * ── Direction ───────────────────────────────────────────────────────────────
 * Sweeps RIGHT → LEFT, deliberately. The translate runs +width → -width.
 *
 * ── Why it pauses ───────────────────────────────────────────────────────────
 * A continuous sweep reads as a loading state, and on a settings row as
 * something demanding attention. The sheen passes, then rests ~2.6s. Premium is
 * occasional, not insistent.
 *
 * ── Why no gradient library ─────────────────────────────────────────────────
 * expo-linear-gradient is not installed, and a native dependency for a
 * decorative sheen is a poor trade. A narrow translucent band moving over
 * opaque text achieves the same read using Reanimated, already present. The
 * base text stays fully readable throughout.
 */
function GlimmerText({ text, fontSize }: { text: string; fontSize: number }) {
  const progress = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Approximate width so the band starts off-screen; exactness is unnecessary
  // for a sheen and avoids an onLayout round trip.
  const width = text.length * fontSize * 0.62;

  useEffect(() => {
    // Same pattern components/comps/SoldCompsSection.tsx already uses.
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Typography and colour stay premium; only movement stops.
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withDelay(2600, withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) })),
      -1, false,
    );
    return () => cancelAnimation(progress);
  }, [reduceMotion, progress]);

  const sheen = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [width, -width]) }],
    opacity: interpolate(progress.value, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
  }));

  return (
    <View style={s.glimmerWrap}>
      <Text style={[s.pro, { fontSize }]}>{text}</Text>
      {!reduceMotion && (
        <Animated.View pointerEvents="none" style={[s.sheenLayer, sheen]}>
          <View style={s.sheenBand} />
        </Animated.View>
      )}
    </View>
  );
}

export function MembershipStatus({ style, fontSize = 12 }: MembershipStatusProps) {
  const ent = useEntitlement();

  /**
   * While loading, show Free rather than a spinner or a blank.
   *
   * Under-promising is the safe direction: briefly showing Free to a Pro user
   * self-corrects in a moment, whereas flashing "Pro Member" at a Free user and
   * snatching it away is the kind of thing people screenshot.
   */
  /**
   * UNRESOLVED — infer nothing.
   *
   * An earlier version rendered "FlipStart Free Member" here and called it
   * conservative. It is not: a paying subscriber saw themselves labelled Free on
   * every cold start, which is wrong information rather than a cautious guess.
   * A skeleton says "not known yet", which is accurate.
   *
   * No badge and no glimmer while unresolved — never animate a placeholder.
   */
  if (ent.status === 'unresolved') {
    // Sized to the final text so the row does not jump when it resolves.
    return <Skeleton width={fontSize * 10.5} height={fontSize + 3} radius={5} />;
  }

  /**
   * ERROR — also not Free.
   *
   * A failed fetch tells us nothing about the plan. "Free Member" would be a
   * guess that happens to be wrong for exactly the people who paid.
   */
  if (ent.status === 'error') {
    return <Text style={[s.unavailable, { fontSize }, style]}>Membership unavailable</Text>;
  }

  if (!ent.isPro) {
    return <Text style={[s.free, { fontSize }, style]}>FlipStart Free Member</Text>;
  }

  /**
   * Monthly and Annual share ONE identity. Never "Monthly Member" or "Annual
   * Member" — the plan is a billing detail, not who the user is.
   */
  return (
    <View style={s.proRow}>
      <GlimmerText text="FlipStart Pro Member" fontSize={fontSize} />
      <MaterialIcons name="verified" size={fontSize + 3} color={GOLD} style={s.badge} />
    </View>
  );
}

const s = StyleSheet.create({
  // Unchanged from the italic muted treatment both screens already used.
  free: { fontStyle: 'italic', color: MUTED },
  unavailable: { fontStyle: 'italic', color: MUTED, opacity: 0.75 },
  proRow: { flexDirection: 'row', alignItems: 'center' },
  pro: { fontStyle: 'italic', fontWeight: '700', color: GOLD },
  badge: { marginLeft: 5 },
  glimmerWrap: { position: 'relative', overflow: 'hidden' },
  sheenLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-start', justifyContent: 'center' },
  // Narrow and translucent: a sheen, not a highlight.
  sheenBand: { width: 26, height: '200%', backgroundColor: CREAM, opacity: 0.38,
               transform: [{ rotate: '18deg' }] },
});