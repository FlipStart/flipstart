/**
 * app/achievement-category.tsx
 *
 * FILE PATH: app/achievement-category.tsx
 *
 * Category detail screen. Shows every achievement in the category
 * with locked / unlocked states clearly visible.
 * Receives categoryId via route params.
 */

import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Modal, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback, useEffect, useRef } from 'react';

import { FONTS } from '@/constants/typography';
import {
  useAchievementNotifications,
  type AchievementNotification,
} from '@/lib/AchievementNotificationContext';
import { useAuth } from '@/lib/auth-context';
import { trackAnalyticsEvent, useScreenFocus } from '@/lib/analytics';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import {
  ACHIEVEMENT_CATEGORIES,
  buildUserAchievementData,
  getUnlockedIds,
  getUnlockedCount,
  type UserAchievementData,
  type Achievement,
  type AchievementCategory,
} from '@/lib/achievements';

// ─── Palette ─────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const PARCH  = '#FFFFFF';
const CARD   = '#F8F7F0';
const IVORY  = '#FFFEFA';
const BORDER = '#DDD2AC';
const TAN    = '#F4F1E8';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';

// ─────────────────────────────────────────────────────────────────────────────

export default function AchievementCategoryScreen() {
  const insets     = useSafeAreaInsets();
  const router     = useRouter();
  const { user }   = useAuth();
  const { flips }  = useFlipStore();
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();

  // Analytics: a specific achievement category was opened. cooldownKey is
  // category-specific so Scanning and Hunt categories both track independently.
  useScreenFocus(
    'achievement_category_opened',
    { achievement_category: categoryId ?? null },
    { cooldownKey: `achievement_category_opened:${categoryId ?? 'unknown'}` },
  );

  const [userData, setUserData] = useState<UserAchievementData | null>(null);
  const [devUnlocked, setDevUnlocked] = useState<Set<string>>(new Set());

  // ── Achievement reveal popup (fires when this category has unseen achievements) ──
  const { unseenAchievements, markAchievementsSeen } = useAchievementNotifications();
  const catUnseen = unseenAchievements.filter(a => a.categoryId === categoryId);
  const [revealIndex,   setRevealIndex]   = useState(0);
  const [showReveal,    setShowReveal]    = useState(false);
  const scaleAnim   = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Trigger popup when this category has unseen achievements
  useEffect(() => {
    if (catUnseen.length > 0 && !showReveal) {
      setRevealIndex(0);
      setShowReveal(true);
    }
  }, [catUnseen.length, showReveal]);

  // Animate each badge in
  useEffect(() => {
    if (!showReveal) return;
    scaleAnim.setValue(0);
    opacityAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim,   { toValue: 1, useNativeDriver: true, damping: 11, stiffness: 120 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [showReveal, revealIndex]);

  const handleRevealContinue = () => {
    if (revealIndex < catUnseen.length - 1) {
      setRevealIndex(i => i + 1);
    } else {
      setShowReveal(false);
      markAchievementsSeen(catUnseen.map(a => a.id));
    }
  };

  // Find the category — handle graceful fallback
  const category: AchievementCategory | undefined =
    ACHIEVEMENT_CATEGORIES.find(c => c.id === categoryId);

  useFocusEffect(useCallback(() => {
    const uid = user?.id ?? null;
    const load = async () => {
      const profile = uid ? await loadXpProfile(uid).catch(() => null) : null;
      setUserData(buildUserAchievementData(
        flips,
        profile?.completedHunts       ?? 0,
        profile?.huntStreak           ?? 0,
        profile?.discoveredBrands?.length ?? 0,
      ));
      if (__DEV__) {
        const { getDevUnlocked } = await import('@/lib/devAchievementOverrides');
        setDevUnlocked(await getDevUnlocked());
      }
    };
    load();
  }, [user?.id, flips]));

  if (!category) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Text style={{ color: MUTED, margin: 24 }}>Category not found.</Text>
      </View>
    );
  }

  const realUnlockedIds = userData ? getUnlockedIds(category, userData) : new Set<string>();
  const unlockedIds = __DEV__
    ? new Set([...realUnlockedIds, ...[...devUnlocked].filter(id => category.achievements.some(a => a.id === id))])
    : realUnlockedIds;
  const unlocked    = unlockedIds.size;
  const total       = category.achievements.length;
  const pct         = total > 0 ? unlocked / total : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/achievements' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={FOREST} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{category.title}</Text>
          <Text style={s.headerSub}>{category.description}</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>
      <View style={s.headerDivider} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Category progress summary ───────────────────────────────────── */}
        <View style={s.summaryCard}>
          <View style={[s.catBadge, { backgroundColor: FOREST }]}>
            <MaterialIcons name={category.icon as any} size={26} color={category.iconColor} />
          </View>
          <View style={s.summaryBody}>
            <Text style={s.summaryCount}>
              <Text style={{ color: FOREST, fontWeight: '900' }}>{unlocked}</Text>
              {' / '}{total}{' unlocked'}
            </Text>
            <View style={s.barTrack}>
              <View style={[
                s.barFill,
                { width: `${Math.round(pct * 100)}%` as any, backgroundColor: category.barColor },
              ]} />
            </View>
          </View>
        </View>

        {/* ── Achievement rows ────────────────────────────────────────────── */}
        {category.achievements.map(ach => {
          const isUnlocked = unlockedIds.has(ach.id);
          return (
            <AchievementRow
              key={ach.id}
              achievement={ach}
              isUnlocked={isUnlocked}
              category={category}
            />
          );
        })}

      </ScrollView>

      {/* ── Achievement unlock popup — fires for THIS category's unseen achievements ── */}
      {showReveal && catUnseen.length > 0 && (() => {
        const ach    = catUnseen[revealIndex];
        const isLast = revealIndex === catUnseen.length - 1;
        return (
          <Modal
            transparent
            animationType="fade"
            visible={showReveal}
            onRequestClose={handleRevealContinue}
          >
            <Pressable style={s.revealBackdrop} onPress={handleRevealContinue}>
              <Pressable style={s.revealCard} onPress={e => e.stopPropagation()}>
                <Text style={s.revealEyebrow}>✦ Achievement Unlocked ✦</Text>
                <Animated.View style={[
                  s.revealBadgeWrap,
                  { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
                ]}>
                  <View style={[s.revealBadge, { backgroundColor: FOREST }]}>
                    <MaterialIcons name={ach.categoryIcon as any} size={48} color={ach.iconColor} />
                  </View>
                </Animated.View>
                <Text style={s.revealName}>{ach.name}</Text>
                <Text style={s.revealFlavor}>{ach.flavor}</Text>
                {catUnseen.length > 1 && (
                  <Text style={s.revealCounter}>{revealIndex + 1} of {catUnseen.length}</Text>
                )}
                <Pressable
                  onPress={handleRevealContinue}
                  style={({ pressed }) => [s.revealBtn, pressed && { opacity: 0.85 }]}
                >
                  <Text style={s.revealBtnText}>{isLast ? 'Nice!' : 'Continue'}</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
        );
      })()}

    </View>
  );
}

// ─── Achievement row ──────────────────────────────────────────────────────────

function AchievementRow({
  achievement: ach,
  isUnlocked,
  category,
}: {
  achievement: Achievement;
  isUnlocked: boolean;
  category:   AchievementCategory;
}) {
  return (
    <View style={[s.achCard, !isUnlocked && s.achCardLocked]}>
      {/* Badge */}
      <View style={[
        s.achBadge,
        isUnlocked
          ? { backgroundColor: category.barColor + '22', borderColor: category.barColor + '55' }
          : { backgroundColor: TAN,                      borderColor: BORDER },
      ]}>
        <MaterialIcons
          name={category.icon as any}
          size={20}
          color={isUnlocked ? category.iconColor : MUTED}
        />
        {!isUnlocked && (
          <View style={s.lockOverlay}>
            <MaterialIcons name="lock" size={10} color={MUTED} />
          </View>
        )}
      </View>

      {/* Text */}
      <View style={s.achBody}>
        <Text style={[s.achName, !isUnlocked && { color: MUTED }]}>{ach.name}</Text>
        <Text style={s.achFlavor}>{ach.flavor}</Text>
        <Text style={s.achReq}>{ach.requirement}</Text>
      </View>

      {/* Status badge */}
      <View style={[
        s.statusPill,
        isUnlocked ? s.statusPillUnlocked : s.statusPillLocked,
      ]}>
        <MaterialIcons
          name={isUnlocked ? 'check-circle' : 'lock'}
          size={11}
          color={isUnlocked ? FOREST : MUTED}
        />
        <Text style={[
          s.statusText,
          { color: isUnlocked ? FOREST : MUTED },
        ]}>
          {isUnlocked ? 'Earned' : 'Locked'}
        </Text>
      </View>
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
  headerCenter: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 8 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: FOREST },
  headerSub:    { fontSize: 11, color: MUTED, textAlign: 'center' },
  headerDivider: { height: 1, backgroundColor: BORDER },

  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 12 },

  // Summary card
  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: IVORY,
    borderRadius: 16, borderWidth: 1.5, borderColor: GOLD + '55',
    paddingHorizontal: 16, paddingVertical: 16,
    marginBottom: 4,
  },
  catBadge: {
    width: 54, height: 54, borderRadius: 27,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: GOLD + '50',
  },
  summaryBody:  { flex: 1, gap: 8 },
  summaryCount: { fontFamily: FONTS.serif, fontSize: 15, color: BROWN },

  barTrack: { height: 6, backgroundColor: TAN, borderRadius: 3, overflow: 'hidden' },
  barFill:  { height: '100%', borderRadius: 3 },

  // Achievement row card
  achCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: IVORY,
    borderRadius: 14, borderWidth: 1.5, borderColor: GOLD + '50',
    paddingHorizontal: 14, paddingVertical: 14,
  },
  achCardLocked: {
    backgroundColor: CARD,
    borderColor: BORDER,
  },

  achBadge: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
    position: 'relative',
  },
  lockOverlay: {
    position: 'absolute', bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },

  achBody:   { flex: 1, gap: 2 },
  achName:   { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: BROWN },
  achFlavor: { fontSize: 11, color: GOLD, fontWeight: '700' },
  achReq:    { fontSize: 10, color: MUTED, lineHeight: 14 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1,
  },
  statusPillUnlocked: {
    backgroundColor: FOREST + '12', borderColor: FOREST + '40',
  },
  statusPillLocked: {
    backgroundColor: TAN, borderColor: BORDER,
  },
  statusText: { fontSize: 10, fontWeight: '700' },

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
  revealEyebrow: { fontSize: 12, fontWeight: '700', color: GOLD, letterSpacing: 1.2 },
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
    marginTop: 8, backgroundColor: FOREST,
    borderRadius: 50, paddingVertical: 14, paddingHorizontal: 48,
  },
  revealBtnText: {
    fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: '#F4EED8',
  },
});