/**
 * app/dev-achievements.tsx
 *
 * FILE PATH: app/dev-achievements.tsx
 *
 * DEV ONLY — Achievement testing tool.
 * Accessible from Settings → "Test Achievements" (dev builds only).
 *
 * Allows:
 *   - Viewing all 39 achievements with real + dev unlock state
 *   - Manually unlocking any achievement (triggers notification flow)
 *   - Manually removing any achievement (resets for re-testing)
 *   - Testing full-screen major achievement modals
 */

import {
  View, Text, StyleSheet, ScrollView, Pressable, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback } from 'react';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import {
  ACHIEVEMENT_CATEGORIES,
  buildUserAchievementData,
  getUnlockedIds,
  getTotalUnlocked,
  TOTAL_ACHIEVEMENTS,
  type Achievement,
  type AchievementCategory,
  type UserAchievementData,
} from '@/lib/achievements';
import {
  useAchievementNotifications,
  type AchievementNotification,
} from '@/lib/AchievementNotificationContext';
import {
  MajorAchievementModal,
} from '@/lib/MajorAchievementModal';
import {
  getDevUnlocked, addDevUnlocked, removeDevUnlocked,
  clearAllDevUnlocked, removeFromSeen, clearAllSeen,
  removeFromMajorShown, clearAllMajorShown,
} from '@/lib/devAchievementOverrides';
import { markMajorAchievementShown, type MajorAchievementType } from '@/lib/majorAchievementStorage';
import { clearRevealedBrands } from '@/lib/brandCompendium';

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
const DEV_BG = '#0A0A14';  // dark dev-tool background accent

// ─── Major achievement ID → MajorAchievementType mapping ─────────────────────
const MAJOR_MAP: Record<string, MajorAchievementType> = {
  profit_10000:    'flipstart_legend',
  scan_5000:       'master_scanner',
  hunt_2500:       'hunt_mode_legend',
  streak_365:      'never_miss',
  rare_100profit:  'jackpot',
  era_bandtee:     'band_tee_bloodhound',
  brand_100:       'brand_encyclopedia',
};

// ─── All achievement details flat list (for notification building) ────────────
function buildAllDetails(): AchievementNotification[] {
  const details: AchievementNotification[] = [];
  for (const cat of ACHIEVEMENT_CATEGORIES) {
    for (const ach of cat.achievements) {
      details.push({
        id:           ach.id,
        name:         ach.name,
        flavor:       ach.flavor,
        categoryId:   cat.id,
        categoryIcon: cat.icon,
        iconColor:    cat.iconColor,
        barColor:     cat.barColor,
      });
    }
  }
  return details;
}

const ALL_DETAILS = buildAllDetails();

// ─────────────────────────────────────────────────────────────────────────────

export default function DevAchievementsScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user }  = useAuth();
  const { flips } = useFlipStore();
  const { forceNotify } = useAchievementNotifications();

  const [userData,    setUserData]    = useState<UserAchievementData | null>(null);
  const [devUnlocked, setDevUnlocked] = useState<Set<string>>(new Set());
  const [majorModal,  setMajorModal]  = useState<MajorAchievementType | null>(null);

  const reload = useCallback(async () => {
    const uid = user?.id ?? null;
    const profile = uid ? await loadXpProfile(uid).catch(() => null) : null;
    const data = buildUserAchievementData(
      flips,
      profile?.completedHunts       ?? 0,
      profile?.huntStreak           ?? 0,
      profile?.discoveredBrands?.length ?? 0,
    );
    setUserData(data);
    setDevUnlocked(await getDevUnlocked());
  }, [user?.id, flips]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  // ── Unlock an achievement manually ────────────────────────────────────────
  const handleUnlock = async (cat: AchievementCategory, ach: Achievement) => {
    await addDevUnlocked(ach.id);
    await removeFromSeen(ach.id);       // so normal notification animation shows

    const majorType = MAJOR_MAP[ach.id];
    const detail = ALL_DETAILS.find(d => d.id === ach.id)!;

    if (majorType) {
      // Major achievement: clear its "shown" flag so full-screen modal can fire
      await removeFromMajorShown(majorType);
      // Show the full-screen modal directly for testing
      setMajorModal(majorType);
    }

    // Always inject into notification queue (drives tab badge + achievements.tsx popup)
    if (detail) forceNotify(detail);

    await reload();
  };

  // ── Remove (reset) an achievement ────────────────────────────────────────
  const handleRemove = async (ach: Achievement) => {
    await removeDevUnlocked(ach.id);
    await removeFromSeen(ach.id);        // allow re-notification
    const majorType = MAJOR_MAP[ach.id];
    if (majorType) await removeFromMajorShown(majorType); // allow re-trigger
    await reload();
  };

  // ── Test "First Achievement Ever" ─────────────────────────────────────────
  const handleFirstAchievement = async () => {
    await removeFromMajorShown('first_achievement');
    setMajorModal('first_achievement');
  };

  // ── Reset everything ─────────────────────────────────────────────────────
  const handleResetAll = () => {
    Alert.alert(
      '⚠️ Reset All Dev Overrides',
      'This will clear all manually unlocked achievements, all seen states, and all major achievement shown flags. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset All', style: 'destructive',
          onPress: async () => {
            await clearAllDevUnlocked();
            await clearAllSeen();
            await clearAllMajorShown();
            await clearRevealedBrands();
            await reload();
            Alert.alert('Done', 'All dev achievement overrides cleared.');
          },
        },
      ]
    );
  };

  // ─── Derived state ────────────────────────────────────────────────────────
  const totalUnlocked = userData ? getTotalUnlocked(userData) + devUnlocked.size : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/settings' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color="#AAF0AA" />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.headerTitle}>🔧 Achievement Tester</Text>
          <Text style={s.headerSub}>DEV BUILD ONLY</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Meta section */}
        <View style={s.metaCard}>
          <Text style={s.metaCount}>
            <Text style={s.metaNum}>{totalUnlocked}</Text>
            <Text style={s.metaDenom}> / {TOTAL_ACHIEVEMENTS}</Text>
            <Text style={s.metaLabel}> total unlocked</Text>
          </Text>

          {/* First achievement special button */}
          <Pressable
            onPress={handleFirstAchievement}
            style={({ pressed }) => [s.metaBtn, s.metaBtnGold, pressed && { opacity: 0.8 }]}
          >
            <MaterialIcons name="emoji-events" size={14} color="#0D0900" />
            <Text style={[s.metaBtnText, { color: '#0D0900' }]}>
              Test "First Achievement Ever" modal
            </Text>
          </Pressable>

          <Pressable
            onPress={handleResetAll}
            style={({ pressed }) => [s.metaBtn, s.metaBtnRed, pressed && { opacity: 0.8 }]}
          >
            <MaterialIcons name="delete-sweep" size={14} color="#fff" />
            <Text style={[s.metaBtnText, { color: '#fff' }]}>Reset all dev overrides</Text>
          </Pressable>
        </View>

        {/* Achievement categories */}
        {ACHIEVEMENT_CATEGORIES.map(cat => {
          const realUnlocked = userData ? getUnlockedIds(cat, userData) : new Set<string>();
          const devCatUnlocked = cat.achievements.filter(a => devUnlocked.has(a.id));
          const totalCatUnlocked = new Set([...realUnlocked, ...devCatUnlocked.map(a => a.id)]);

          return (
            <View key={cat.id} style={s.catSection}>
              {/* Category header */}
              <View style={s.catHeader}>
                <View style={[s.catIcon, { backgroundColor: FOREST }]}>
                  <MaterialIcons name={cat.icon as any} size={14} color={cat.iconColor} />
                </View>
                <Text style={s.catTitle}>{cat.title}</Text>
                <Text style={s.catCount}>
                  {totalCatUnlocked.size} / {cat.achievements.length}
                </Text>
              </View>

              {/* Achievement rows */}
              {cat.achievements.map(ach => {
                const isRealUnlocked = realUnlocked.has(ach.id);
                const isDevUnlocked  = devUnlocked.has(ach.id);
                const isUnlocked     = isRealUnlocked || isDevUnlocked;
                const isMajor        = !!MAJOR_MAP[ach.id];

                return (
                  <View key={ach.id} style={[
                    s.achRow,
                    isRealUnlocked && s.achRowReal,
                    !isRealUnlocked && isDevUnlocked && s.achRowDev,
                  ]}>
                    {/* Status icon */}
                    <MaterialIcons
                      name={isUnlocked ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={isRealUnlocked ? FOREST : isDevUnlocked ? GOLD : MUTED}
                    />

                    {/* Text */}
                    <View style={s.achBody}>
                      <Text style={[s.achName, !isUnlocked && { color: MUTED }]}>
                        {ach.name}
                        {isMajor && <Text style={s.majorBadge}> ★</Text>}
                      </Text>
                      <Text style={s.achFlavor}>{ach.flavor}</Text>
                    </View>

                    {/* Source badge */}
                    {isRealUnlocked && (
                      <View style={[s.srcBadge, { backgroundColor: FOREST + '20', borderColor: FOREST + '60' }]}>
                        <Text style={[s.srcText, { color: FOREST }]}>REAL</Text>
                      </View>
                    )}
                    {!isRealUnlocked && isDevUnlocked && (
                      <View style={[s.srcBadge, { backgroundColor: GOLD + '20', borderColor: GOLD + '60' }]}>
                        <Text style={[s.srcText, { color: GOLD }]}>DEV</Text>
                      </View>
                    )}

                    {/* Action button */}
                    {isRealUnlocked ? (
                      <View style={s.lockedBtn}>
                        <Text style={s.lockedBtnText}>EARNED</Text>
                      </View>
                    ) : isDevUnlocked ? (
                      <Pressable
                        onPress={() => handleRemove(ach)}
                        style={({ pressed }) => [s.removeBtn, pressed && { opacity: 0.7 }]}
                      >
                        <MaterialIcons name="lock-reset" size={14} color="#CC2222" />
                        <Text style={s.removeBtnText}>Reset</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => handleUnlock(cat, ach)}
                        style={({ pressed }) => [
                          s.unlockBtn,
                          isMajor && s.unlockBtnMajor,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <MaterialIcons name="lock-open" size={14} color={isMajor ? '#0D0900' : FOREST} />
                        <Text style={[s.unlockBtnText, isMajor && { color: '#0D0900' }]}>
                          {isMajor ? '★ Unlock' : 'Unlock'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}

      </ScrollView>

      {/* Major achievement modal for testing */}
      <MajorAchievementModal
        type={majorModal}
        visible={!!majorModal}
        onContinue={() => setMajorModal(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C0C18' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    backgroundColor: '#0C0C18', borderBottomWidth: 1, borderBottomColor: '#2A2A40',
  },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: '#2A2A40', backgroundColor: '#14142A',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: '#AAF0AA' },
  headerSub:   { fontSize: 9, color: '#5A5A7A', letterSpacing: 1.4, marginTop: 1 },

  scroll: { paddingHorizontal: 12, paddingTop: 16, gap: 12 },

  // Meta card
  metaCard: {
    backgroundColor: '#14142A', borderRadius: 14,
    borderWidth: 1, borderColor: '#2A2A40',
    padding: 14, gap: 10,
  },
  metaCount: { textAlign: 'center' },
  metaNum:   { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '900', color: '#AAF0AA' },
  metaDenom: { fontSize: 16, color: '#5A5A7A' },
  metaLabel: { fontSize: 12, color: '#5A5A7A' },

  metaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    justifyContent: 'center',
  },
  metaBtnGold:  { backgroundColor: GOLD },
  metaBtnRed:   { backgroundColor: '#8A1010' },
  metaBtnText:  { fontSize: 12, fontWeight: '700' },

  // Category section
  catSection: {
    backgroundColor: '#14142A', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A40',
    overflow: 'hidden',
  },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0C0C18', paddingHorizontal: 12, paddingVertical: 10,
  },
  catIcon: {
    width: 24, height: 24, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  catTitle: { flex: 1, fontSize: 11, fontWeight: '700', color: '#AAF0AA', letterSpacing: 0.5 },
  catCount: { fontSize: 11, color: '#5A5A7A', fontWeight: '600' },

  // Achievement row
  achRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#1E1E34',
  },
  achRowReal: { backgroundColor: FOREST + '0A' },
  achRowDev:  { backgroundColor: GOLD + '0A' },

  achBody:   { flex: 1 },
  achName:   { fontSize: 12, fontWeight: '700', color: '#D8D8E8' },
  achFlavor: { fontSize: 10, color: '#5A5A7A', marginTop: 1 },
  majorBadge: { color: GOLD, fontSize: 11 },

  // Badges
  srcBadge: {
    borderRadius: 6, borderWidth: 1,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  srcText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },

  // Buttons
  unlockBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: FOREST + '20', borderWidth: 1, borderColor: FOREST + '60',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
  },
  unlockBtnMajor: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  unlockBtnText: { fontSize: 10, fontWeight: '700', color: FOREST },

  removeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#CC222220', borderWidth: 1, borderColor: '#CC222260',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
  },
  removeBtnText: { fontSize: 10, fontWeight: '700', color: '#CC2222' },

  lockedBtn: {
    backgroundColor: '#2A2A40', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  lockedBtnText: { fontSize: 10, fontWeight: '700', color: '#3A3A5A' },
});