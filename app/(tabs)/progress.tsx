/**
 * app/(tabs)/progress.tsx
 *
 * Progress screen — shows XP rank, hunt streak, and XP bar.
 * Reads live data from huntXp AsyncStorage profile.
 */

import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FONTS } from '@/constants/typography';
import { V } from '@/constants/vintage';
import {
  loadXpProfile, getCurrentRank, getNextRank,
  getRankProgress, RANK_LADDER, type HuntXpProfile,
} from '@/lib/huntXp';
import { useAuth } from '@/lib/auth-context';

// ─── Palette ──────────────────────────────────────────────────────────────────
const FOREST  = '#2A4A2A';
const GOLD    = '#BE9C2C';
const CREAM   = '#F4EED8';
const PARCHMENT = '#EDE0C4';
const CARD_B  = '#DDD0B0';
const BROWN   = '#5A3A1A';
const MUTED   = '#8A7050';

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<HuntXpProfile | null>(null);

  useFocusEffect(useCallback(() => {
    if (user) loadXpProfile().then(setProfile).catch(() => {});
  }, [user]));

  // Login gate — show before full render
  if (!authLoading && !user) {
    return (
      <View style={{ flex: 1, backgroundColor: PARCHMENT, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <MaterialIcons name="bar-chart" size={48} color={MUTED} style={{ marginBottom: 16 }} />
        <Text style={{ fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 10 }}>
          Track Your Progress
        </Text>
        <Text style={{ fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 21, marginBottom: 28 }}>
          Create an account to track your XP, rank, and hunt streaks across sessions.
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: '/auth', params: { mode: 'signup' } } as any)}
          style={{ backgroundColor: FOREST, borderRadius: 50, paddingVertical: 14, paddingHorizontal: 36, marginBottom: 12 }}
        >
          <Text style={{ color: CREAM, fontSize: 15, fontWeight: '700', fontFamily: FONTS.serif }}>Create Account</Text>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } } as any)}>
          <Text style={{ color: MUTED, fontSize: 14, textDecorationLine: 'underline' }}>Log In</Text>
        </Pressable>
      </View>
    );
  }

  const totalXp     = profile?.totalXp      ?? 0;
  const streak      = profile?.huntStreak   ?? 0;
  const completed   = profile?.completedHunts ?? 0;
  const currentRank = getCurrentRank(totalXp);
  const nextRank    = getNextRank(totalXp);
  const progress    = getRankProgress(totalXp);
  const levelNum    = RANK_LADDER.findIndex(r => r.rank === currentRank.rank) + 1;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ width: 36 }} />
        <Text style={s.headerTitle}>Progress</Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={s.divider} />

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>

        {/* Rank card */}
        <Animated.View entering={FadeInDown.delay(60).duration(350)} style={s.rankCard}>
          <View style={s.rankTop}>
            <View style={s.rankIconWrap}>
              <MaterialIcons name="emoji-events" size={32} color={GOLD} />
            </View>
            <View style={s.rankTextBlock}>
              <Text style={s.rankName}>{currentRank.rank}</Text>
              <Text style={s.rankLevel}>Level {levelNum}</Text>
            </View>
            {streak > 0 && (
              <View style={s.streakBadge}>
                <Text style={s.streakFire}>🔥</Text>
                <Text style={s.streakNum}>{streak}</Text>
                <Text style={s.streakLabel}>day streak</Text>
              </View>
            )}
          </View>

          {/* Progress bar */}
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${progress}%` }]} />
          </View>
          <View style={s.barLabels}>
            <Text style={s.barCurrent}>{totalXp.toLocaleString()} XP</Text>
            {nextRank && <Text style={s.barNext}>{nextRank.xp.toLocaleString()} XP</Text>}
          </View>
        </Animated.View>

        {/* Stats row */}
        <Animated.View entering={FadeInDown.delay(120).duration(350)} style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statNum}>{completed}</Text>
            <Text style={s.statLabel}>Hunts{'\n'}Completed</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statCard}>
            <Text style={s.statNum}>{streak}</Text>
            <Text style={s.statLabel}>Day{'\n'}Streak</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statCard}>
            <Text style={s.statNum}>{levelNum}</Text>
            <Text style={s.statLabel}>Current{'\n'}Level</Text>
          </View>
        </Animated.View>

        {/* Rank ladder */}
        <Animated.View entering={FadeInDown.delay(180).duration(350)}>
          <Text style={s.sectionLabel}>RANK LADDER</Text>
          {RANK_LADDER.map((tier, idx) => {
            const isEarned  = totalXp >= tier.xp;
            const isCurrent = tier.rank === currentRank.rank;
            return (
              <View key={tier.rank} style={[s.tierRow, isCurrent && s.tierRowActive]}>
                <Text style={[s.tierNum, !isEarned && s.tierDimmed]}>{idx + 1}</Text>
                <Text style={[s.tierName, !isEarned && s.tierDimmed, isCurrent && s.tierNameActive]}>
                  {tier.rank}
                </Text>
                <Text style={[s.tierXp, !isEarned && s.tierDimmed]}>
                  {tier.xp.toLocaleString()} XP
                </Text>
                {isCurrent && <MaterialIcons name="chevron-left" size={14} color={GOLD} />}
              </View>
            );
          })}
        </Animated.View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: V.pageBg },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: FOREST },
  divider:     { height: 1, backgroundColor: CARD_B },
  content:     { paddingHorizontal: 16, paddingTop: 18, gap: 14 },

  rankCard:   { backgroundColor: FOREST, borderRadius: 16, padding: 18, gap: 12 },
  rankTop:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rankIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: GOLD + '22', borderWidth: 1, borderColor: GOLD + '55', justifyContent: 'center', alignItems: 'center' },
  rankTextBlock: { flex: 1 },
  rankName:   { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: CREAM },
  rankLevel:  { fontSize: 13, color: GOLD, fontWeight: '600', marginTop: 2 },
  streakBadge:{ alignItems: 'center', gap: 2 },
  streakFire: { fontSize: 18 },
  streakNum:  { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '900', color: GOLD },
  streakLabel:{ fontSize: 9, color: CREAM, opacity: 0.7 },
  barTrack:   { height: 7, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4, overflow: 'hidden' },
  barFill:    { height: '100%', backgroundColor: GOLD, borderRadius: 4 },
  barLabels:  { flexDirection: 'row', justifyContent: 'space-between' },
  barCurrent: { fontSize: 11, color: CREAM, fontWeight: '600' },
  barNext:    { fontSize: 11, color: CREAM, opacity: 0.55 },

  statsRow:  { flexDirection: 'row', backgroundColor: V.cardBg, borderRadius: 14, borderWidth: 1, borderColor: CARD_B, overflow: 'hidden' },
  statCard:  { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 4 },
  statSep:   { width: 1, backgroundColor: CARD_B },
  statNum:   { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '900', color: FOREST },
  statLabel: { fontSize: 10, color: MUTED, textAlign: 'center', fontWeight: '600' },

  sectionLabel: { fontSize: 10, fontWeight: '800', color: MUTED, letterSpacing: 2.5, marginBottom: 8, marginTop: 6 },
  tierRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: CARD_B + '60' },
  tierRowActive:{ backgroundColor: GOLD + '14', marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 8, borderBottomWidth: 0 },
  tierNum:      { fontSize: 11, color: MUTED, fontWeight: '700', width: 20, textAlign: 'right' },
  tierName:     { flex: 1, fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700', color: BROWN },
  tierNameActive: { color: FOREST },
  tierXp:       { fontSize: 11, color: MUTED },
  tierDimmed:   { opacity: 0.38 },
});