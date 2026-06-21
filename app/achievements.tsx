/**
 * app/achievements.tsx
 *
 * FILE PATH: app/achievements.tsx
 *
 * Main Achievements screen — shows all 7 categories with live progress.
 * Tapping a category navigates to /achievement-category?id=<categoryId>
 */

import { navGuard } from '@/lib/navGuard';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback, useRef, useEffect } from 'react';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import {
  ACHIEVEMENT_CATEGORIES,
  TOTAL_ACHIEVEMENTS,
  buildUserAchievementData,
  getUnlockedCount,
  getTotalUnlocked,
  type UserAchievementData,
} from '@/lib/achievements';
import {
  useAchievementNotifications,
} from '@/lib/AchievementNotificationContext';

// ─── Palette ─────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const PARCH  = '#ECE7D3';
const CARD   = '#F2EDD8';
const IVORY  = '#FAF6EE';
const BORDER = '#C8B88A';
const TAN    = '#D6C8A3';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';

// ─────────────────────────────────────────────────────────────────────────────

export default function AchievementsScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const { flips } = useFlipStore();
  const [userData, setUserData] = useState<UserAchievementData | null>(null);
  const [devUnlocked, setDevUnlocked] = useState<Set<string>>(new Set());
  const { unseenAchievements, markAllSeen } = useAchievementNotifications();


  // Per-category unseen badge counts — drives notification dots on each category card.
  const unseenByCat = unseenAchievements.reduce<Record<string, number>>((acc, a) => {
    acc[a.categoryId] = (acc[a.categoryId] ?? 0) + 1;
    return acc;
  }, {});

  useFocusEffect(useCallback(() => {
    const uid = user?.id ?? null;
    const load = async () => {
      const profile = uid ? await loadXpProfile(uid).catch(() => null) : null;
      setUserData(buildUserAchievementData(
        flips,
        profile?.completedHunts  ?? 0,
        profile?.huntStreak      ?? 0,
        profile?.discoveredBrands?.length ?? 0,
      ));
      if (__DEV__) {
        const { getDevUnlocked } = await import('@/lib/devAchievementOverrides');
        setDevUnlocked(await getDevUnlocked());
      }
    };
    load();
  }, [user?.id, flips]));

  const totalUnlocked = userData ? getTotalUnlocked(userData) : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/progress' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={FOREST} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>✦ Achievements ✦</Text>
          <Text style={s.headerSub}>Your journey. Your legacy.</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>
      <View style={s.headerDivider} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Total progress pill ─────────────────────────────────────────── */}
        <View style={s.totalPill}>
          <MaterialIcons name="emoji-events" size={16} color={GOLD} />
          <Text style={s.totalText}>
            <Text style={s.totalNum}>{totalUnlocked}</Text>
            <Text style={s.totalOf}> / {TOTAL_ACHIEVEMENTS} </Text>
            <Text style={s.totalLabel}>Achievements Unlocked</Text>
          </Text>
        </View>

        {/* ── "Achievement Categories" decorative divider ─────────────────── */}
        <View style={s.sectionDivider}>
          <View style={s.dividerLine} />
          <Text style={s.sectionTitle}>Achievement Categories</Text>
          <View style={s.dividerLine} />
        </View>

        {/* ── Category cards ──────────────────────────────────────────────── */}
        {ACHIEVEMENT_CATEGORIES.map(cat => {
          const unlocked = userData ? getUnlockedCount(cat, userData) : 0;
          const devExtra = [...devUnlocked].filter(id => cat.achievements.some(a => a.id === id)).length;
          const total    = cat.achievements.length;
          const totalUnlocked = Math.min(unlocked + devExtra, total);
          const pct      = total > 0 ? totalUnlocked / total : 0;

          return (
            <Pressable
              key={cat.id}
              onPress={() => { if (!navGuard()) return; router.push({
                pathname: '/achievement-category' as any,
                params:   { categoryId: cat.id },
              }); }}
              style={({ pressed }) => [s.catCard, pressed && { opacity: 0.82 }]}
            >
              {/* Icon badge */}
              <View style={[s.badge, { backgroundColor: FOREST }]}>
                <MaterialIcons
                  name={cat.icon as any}
                  size={22}
                  color={cat.iconColor}
                />
              </View>

              {/* Content */}
              <View style={s.catBody}>
                <Text style={s.catTitle}>{cat.title}</Text>
                <Text style={s.catDesc}>{cat.description}</Text>

                {/* Progress bar */}
                <View style={s.barTrack}>
                  <View style={[
                    s.barFill,
                    { width: `${Math.round(pct * 100)}%` as any, backgroundColor: cat.barColor },
                  ]} />
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={s.catCount}>
                    <Text style={{ color: FOREST, fontWeight: '700' }}>{totalUnlocked}</Text>
                    {' / '}{total}{' unlocked'}
                  </Text>
                  {(unseenByCat[cat.id] ?? 0) > 0 && (
                    <View style={s.catNotifBadge}>
                      <Text style={s.catNotifText}>{unseenByCat[cat.id]}</Text>
                    </View>
                  )}
                </View>
              </View>

              <MaterialIcons name="chevron-right" size={18} color={MUTED} />
            </Pressable>
          );
        })}

      </ScrollView>

      {/* ── Achievement Unlock Reveal Modal ─────────────────────────────── */}
      
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCH },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
    backgroundColor: PARCH,
  },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 3 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: FOREST },
  headerSub:    { fontSize: 12, color: MUTED, textAlign: 'center' },
  headerDivider:{ height: 1, backgroundColor: BORDER },

  // Scroll
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 14 },

  // Total pill
  totalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: IVORY,
    borderRadius: 12, borderWidth: 1.5, borderColor: GOLD + '55',
    paddingHorizontal: 16, paddingVertical: 12,
    alignSelf: 'stretch',
  },
  totalText:  { fontSize: 13 },
  totalNum:   { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '900', color: FOREST },
  totalOf:    { fontSize: 13, color: MUTED },
  totalLabel: { fontSize: 13, color: MUTED },

  // "Achievement Categories" decorative divider
  sectionDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginVertical: 4,
  },
  dividerLine:  { flex: 1, height: 1, backgroundColor: BORDER },
  sectionTitle: {
    fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700',
    color: BROWN, letterSpacing: 0.3,
  },

  // Category card
  catCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: IVORY,
    borderRadius: 16, borderWidth: 1.5, borderColor: GOLD + '55',
    paddingHorizontal: 16, paddingVertical: 16,
  },
  badge: {
    width: 52, height: 52, borderRadius: 26,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: GOLD + '60',
  },
  catBody:  { flex: 1, gap: 5 },
  catTitle: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: BROWN },
  catDesc:  { fontSize: 11, color: MUTED, lineHeight: 15 },

  barTrack: {
    height: 5, backgroundColor: TAN,
    borderRadius: 3, overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  catCount: { fontSize: 11, color: MUTED },
  catNotifBadge: {
    backgroundColor: '#CC2222', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2, minWidth: 18, alignItems: 'center',
  },
  catNotifText: { fontSize: 9, fontWeight: '900', color: '#fff' },

  // ── Achievement reveal modal ───────────────────────────────────────────────
  revealBackdrop: {
    flex: 1, backgroundColor: 'rgba(10,20,10,0.75)',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  revealCard: {
    backgroundColor: IVORY,
    borderRadius: 24, borderWidth: 2, borderColor: GOLD + '80',
    paddingVertical: 36, paddingHorizontal: 28,
    alignItems: 'center', gap: 12,
    width: '100%', maxWidth: 360,
  },
  revealEyebrow: {
    fontSize: 12, fontWeight: '700', color: GOLD, letterSpacing: 1.2,
  },
  revealBadgeWrap: { marginVertical: 8 },
  revealBadge: {
    width: 120, height: 120, borderRadius: 60,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: GOLD,
  },
  revealName: {
    fontFamily: FONTS.serif, fontSize: 24, fontWeight: '900',
    color: BROWN, textAlign: 'center',
  },
  revealFlavor: { fontSize: 14, color: GOLD, fontWeight: '700' },
  revealCounter: { fontSize: 12, color: MUTED },
  revealBtn: {
    marginTop: 8,
    backgroundColor: FOREST,
    borderRadius: 50, paddingVertical: 14, paddingHorizontal: 48,
  },
  revealBtnText: {
    fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: '#F4EED8',
  },
});