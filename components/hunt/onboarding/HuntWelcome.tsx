/**
 * components/hunt/onboarding/HuntWelcome.tsx
 *
 * The first-visit welcome to Hunt Mode, shown over the Hunt start screen.
 *
 *   Welcome to Hunt Mode
 *   Turn every thrift trip into a Hunt. Scan finds, track your haul, estimate
 *   profit, and earn XP as you thrift.
 *   [ example find: Pelle Pelle jacket · Legendary Loot · numbers from the real engine ]
 *   ☐ Do not show this again
 *   [ Start Demo ]            Skip
 *
 * The example find stands in for a hero photo: it shows the payoff (a real find
 * and what it's worth) in one glance and stays small enough that Start Demo is
 * above the fold on the smallest iPhone.
 *
 * Skip never dismisses on its own: with the box unchecked it is only "not right
 * now". The same card serves the manual replay ("How Hunt Mode Works"): there the
 * checkbox is hidden (a decision was already made) and Skip becomes Close.
 *
 * Accessibility: modal for VoiceOver with focus moved to the title, checkbox
 * semantics, 44pt targets, Reduce Motion skips the fade, scrolls if Dynamic Type
 * makes it taller than the screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Animated, AccessibilityInfo,
  findNodeHandle, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { FONTS } from '@/constants/typography';
import { HUNT_BADGE } from '@/components/hunt/discovery/theme';
import { DEMO_JACKET, demoEconomics, demoHuntSummary } from '@/lib/huntDemoData';
import { DEMO_JACKET_PHOTO } from './demoAssets';
import { useReduceMotion } from '@/components/hunt/HuntAttentionDot';

const FOREST      = '#1E3A1E';
const GOLD        = '#C4972A';
const CREAM       = '#F2E8D0';
const CARD_BG     = 'rgba(242, 232, 208, 0.98)';
const TEXT_DARK   = '#2A1A0A';
const TEXT_MUTED  = '#5C4426';   // ≥ 6:1 on the cream card

export const WELCOME_TITLE = 'Welcome to Hunt Mode';
export const WELCOME_BODY =
  "Use Hunt Mode when you're at thrift stores. Scan finds to track your haul, estimate total profit and total cost, and earn XP at the end.";

export interface HuntWelcomeProps {
  /** Manual replay from the info button: no checkbox, Skip reads Close. */
  replay?: boolean;
  onStartDemo: () => void;
  /** Skip (or Close on a replay). `doNotShowAgain` is the checkbox, always false on a replay. */
  onSkip: (doNotShowAgain: boolean) => void;
}

function Stat({ value, label, good, mid }: { value: string; label: string; good?: boolean; mid?: boolean }) {
  return (
    <View style={[s.stat, mid && s.statMid]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[s.statNum, good && s.statGood]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statLabel} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </View>
  );
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n))}`;

export function HuntWelcome({ replay = false, onStartDemo, onSkip }: HuntWelcomeProps) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [dontShow, setDontShow] = useState(false);
  const fade = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const titleRef = useRef<Text>(null);

  const eco = demoEconomics(DEMO_JACKET);
  const hunt = demoHuntSummary();
  const badge = HUNT_BADGE[eco.rating];

  useEffect(() => {
    if (!reduce) Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    // Put VoiceOver on the title once the card is on screen.
    const t = setTimeout(() => {
      try {
        const h = titleRef.current ? findNodeHandle(titleRef.current) : null;
        if (h) AccessibilityInfo.setAccessibilityFocus(h);
      } catch { /* focus is a nicety; never crash the welcome */ }
    }, 350);
    return () => clearTimeout(t);
  }, [fade, reduce]);

  const toggle = () => {
    Haptics.selectionAsync().catch(() => {});
    setDontShow(v => !v);
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, s.scrim, { opacity: fade }]}
      accessibilityViewIsModal
      testID="hunt-welcome"
    >
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, minHeight: winH }]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.card}>
          {winH >= 740 && (
            <Text style={s.eyebrow} accessibilityElementsHidden importantForAccessibility="no">♦  HUNT MODE  ♦</Text>
          )}

          <Text ref={titleRef} style={s.title} accessibilityRole="header" testID="hunt-welcome-title">
            {WELCOME_TITLE}
          </Text>
          <Text style={s.body}>{WELCOME_BODY}</Text>

          {/* The numbers a Hunt tracks, for one example Hunt (same engine as the real thing) */}
          <Text style={s.sectionLabel}>EXAMPLE HUNT</Text>
          <View
            style={s.stats}
            accessible
            accessibilityLabel={`Example Hunt: ${hunt.found} items found, estimated profit ${money(hunt.profit)}, ${hunt.minutes} minutes hunting, estimated cost ${money(hunt.cost)}.`}
            testID="hunt-welcome-stats"
          >
            <Stat value={String(hunt.found)} label="Items found" />
            <Stat value={`+${money(hunt.profit)}`} label="Est. profit" good mid />
            <Stat value={`${hunt.minutes} min`} label="Time hunting" mid />
            <Stat value={money(hunt.cost)} label="Est. cost" mid />
          </View>

          {/* Example find */}
          <View
            style={s.example}
            accessible
            accessibilityLabel={`Example find: ${DEMO_JACKET.name}. Rated ${badge.label}. Thrift price ${money(eco.thriftPrice)}, estimated resale ${money(eco.resale)}, estimated profit ${money(eco.profit)}.`}
            testID="hunt-welcome-example"
          >
            <Image source={DEMO_JACKET_PHOTO} style={s.exThumb} contentFit="cover" accessibilityIgnoresInvertColors />
            <View style={s.exInfo}>
              <Text style={s.exLabel}>EXAMPLE FIND</Text>
              <Text style={s.exName} numberOfLines={1}>{DEMO_JACKET.name}</Text>
              <Text style={s.exMeta} numberOfLines={1}>
                Paid {money(eco.thriftPrice)} · Resale {money(eco.resale)} · <Text style={s.exProfit}>+{money(eco.profit)}</Text>
              </Text>
              <View style={[s.exBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
                <Text style={[s.exBadgeText, { color: badge.text }]} numberOfLines={1}>{badge.emoji} {badge.label}</Text>
              </View>
            </View>
          </View>

          {!replay && (
            <Pressable
              onPress={toggle}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontShow }}
              accessibilityLabel="Do not show this again"
              style={({ pressed }) => [s.checkRow, pressed && { opacity: 0.7 }]}
              hitSlop={6}
              testID="hunt-welcome-checkbox"
            >
              <MaterialIcons
                name={dontShow ? 'check-box' : 'check-box-outline-blank'}
                size={26}
                color={dontShow ? FOREST : TEXT_MUTED}
              />
              <Text style={s.checkText}>Do not show this again</Text>
            </Pressable>
          )}

          <Pressable
            onPress={onStartDemo}
            accessibilityRole="button"
            accessibilityLabel="Start Demo"
            accessibilityHint="A guided practice Hunt of about a minute. Nothing in it counts toward your real stats."
            style={({ pressed }) => [s.primary, replay && { marginTop: 14 }, pressed && { transform: [{ scale: 0.97 }], opacity: 0.92 }]}
            testID="hunt-welcome-start-demo"
          >
            <MaterialIcons name="pets" size={18} color={GOLD} />
            <Text style={s.primaryText}>Start Demo</Text>
            <MaterialIcons name="pets" size={18} color={GOLD} />
          </Pressable>
          <Text style={s.hint}>About a minute. Won't affect your stats.</Text>

          <Pressable
            onPress={() => onSkip(replay ? false : dontShow)}
            accessibilityRole="button"
            accessibilityLabel={replay ? 'Close' : 'Skip'}
            style={({ pressed }) => [s.secondary, pressed && { opacity: 0.6 }]}
            hitSlop={8}
            testID="hunt-welcome-skip"
          >
            <Text style={s.secondaryText}>{replay ? 'Close' : 'Skip'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // A warm dark brown, not green: the Hunt art is gold, and a green wash over gold reads as mud.
  scrim:  { backgroundColor: 'rgba(24, 14, 4, 0.66)', zIndex: 50, elevation: 50 },
  scroll: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  card: {
    width: '100%', maxWidth: 420, backgroundColor: CARD_BG, borderRadius: 20,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
    borderWidth: 1, borderColor: GOLD + '99',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 18, elevation: 12,
  },
  eyebrow: { textAlign: 'center', fontFamily: FONTS.serif, fontSize: 11, fontWeight: '800', letterSpacing: 2.2, color: GOLD, marginBottom: 8 },
  title:   { textAlign: 'center', fontFamily: FONTS.serif, fontSize: 24, fontWeight: '800', color: FOREST, lineHeight: 30 },
  body:    { textAlign: 'center', fontSize: 14.5, lineHeight: 21, color: TEXT_DARK, marginTop: 8 },

  sectionLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, color: GOLD, marginTop: 14, marginBottom: 5, marginLeft: 2 },
  stats: {
    flexDirection: 'row', backgroundColor: '#FFF9EE', borderRadius: 14, borderWidth: 1, borderColor: '#DDD0B0',
  },
  stat:     { flex: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 3, gap: 2 },
  statMid:  { borderLeftWidth: 1, borderColor: '#E6DABB' },
  statNum:  { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: TEXT_DARK },
  statGood: { color: '#2A6A2A' },
  statLabel:{ fontSize: 9.5, fontWeight: '600', color: TEXT_MUTED, letterSpacing: 0.3 },

  example: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8,
    backgroundColor: '#FFF9EE', borderRadius: 14, borderWidth: 1, borderColor: '#DDD0B0',
    padding: 9,
  },
  exThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#E0D0A8' },
  exInfo:  { flex: 1 },
  exLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, color: GOLD },
  exName:  { fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: '800', color: TEXT_DARK, marginTop: 1 },
  exMeta:  { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  exProfit:{ fontWeight: '800', color: '#2A6A2A' },
  exBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 50, paddingHorizontal: 9, paddingVertical: 3, marginTop: 6 },
  exBadgeText: { fontSize: 11, fontWeight: '800' },

  checkRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 8, alignSelf: 'flex-start' },
  checkText: { fontSize: 14, color: TEXT_DARK },

  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: FOREST, borderRadius: 14, paddingVertical: 15, marginTop: 6,
    borderWidth: 1.5, borderColor: GOLD + '60', minHeight: 50,
  },
  primaryText: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: CREAM, letterSpacing: 0.6 },
  hint:        { textAlign: 'center', fontSize: 11.5, color: TEXT_MUTED, marginTop: 6 },
  secondary:   { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 24, marginTop: 2 },
  secondaryText: { fontSize: 15, fontWeight: '700', color: TEXT_MUTED, textDecorationLine: 'underline' },
});