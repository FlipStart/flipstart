/**
 * app/brand-compendium.tsx
 *
 * FILE PATH: app/brand-compendium.tsx
 *
 * Brand Compendium — Pass 1 (Revised).
 * Main hub screen: overall collection card + 4 tappable rarity cards.
 * Rarity is the primary navigation. Categories are filters inside each rarity.
 */

import { navGuard } from '@/lib/navGuard';
import { View, Text, StyleSheet, ScrollView, Pressable, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import {
  ALL_BRANDS,
  TOTAL_SUPPORTED_BRANDS,
  RARITY_TOTALS,
  RARITY_COLORS,
  RARITY_LABELS,
  computeDiscoveredBrands,
  getDiscoveredByRarity,
  type BrandRarity,
} from '@/lib/brandCompendium';

// ─── Palette ──────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const PARCH  = '#ECE7D3';
const CARD   = '#F2EDD8';
const IVORY  = '#FAF6EE';
const BORDER = '#C8B88A';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';

const RARITIES: BrandRarity[] = ['common', 'uncommon', 'rare', 'legendary'];

const RARITY_ICONS: Record<BrandRarity, string> = {
  common:    'local-offer',
  uncommon:  'grade',
  rare:      'diamond',
  legendary: 'workspace-premium',
};

// ─────────────────────────────────────────────────────────────────────────────

export default function BrandCompendiumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user }  = useAuth();
  const { flips } = useFlipStore();
  const { unseenBrandNames } = useAchievementNotifications();

  const [discovered, setDiscovered] = useState<Set<string> | null>(null);

  useFocusEffect(useCallback(() => {
    const load = async () => {
      const uid     = user?.id ?? null;
      const profile = uid ? await loadXpProfile(uid).catch(() => null) : null;
      let disc      = computeDiscoveredBrands(flips, profile?.discoveredBrands ?? []);

      // DEV — merge in any dev-unlocked brands so the tester reflects accurately.
      if (__DEV__) {
        const { getDevUnlockedBrands } = await import('@/lib/devBrandOverrides');
        const devSet = await getDevUnlockedBrands();
        if (devSet.size > 0) disc = new Set([...disc, ...devSet]);
      }
      setDiscovered(disc);

      // Do NOT clear unseen brand notifications here.
      // Notifications clear progressively: rarity page view → brand tap.
    };
    load();
  }, [user?.id, flips]));

  const byRarity   = useMemo(() => discovered ? getDiscoveredByRarity(discovered) : null, [discovered]);
  const totalDisc  = discovered?.size ?? null;
  const totalPct   = (discovered && TOTAL_SUPPORTED_BRANDS > 0)
    ? Math.round((discovered.size / TOTAL_SUPPORTED_BRANDS) * 1000) / 10
    : null;
  const isComplete = discovered ? discovered.size >= TOTAL_SUPPORTED_BRANDS : false;

  // Per-rarity unseen brand counts — drives notification badges on each rarity card
  const unseenByRarity = useMemo(() => {
    const map: Record<string, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    for (const name of unseenBrandNames) {
      const brand = ALL_BRANDS.find(b => b.name === name);
      if (brand) map[brand.rarity] = (map[brand.rarity] ?? 0) + 1;
    }
    return map;
  }, [unseenBrandNames]);

  // Shining gold aura animation — only runs when collection is 100% complete
  const glowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isComplete) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      glowAnim.setValue(0);
    }
  }, [isComplete]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/progress' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={FOREST} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Brand Compendium</Text>
          <Text style={s.headerSub}>Build your brand archive.</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>
      <View style={s.divider} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Overall Collection Card */}
        <View style={[s.overallCard, isComplete && { borderColor: GOLD }]}>

          {/* Shining aura rings — only visible at 100% */}
          {isComplete && (
            <>
              <Animated.View style={[s.auraRing, s.auraOuter, {
                opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.22] }),
                transform: [{ scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
              }]} />
              <Animated.View style={[s.auraRing, s.auraInner, {
                opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] }),
                transform: [{ scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.02] }) }],
              }]} />
            </>
          )}

          <View style={s.overallTop}>
            <MaterialIcons name="auto-stories" size={24} color={isComplete ? GOLD : FOREST} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.overallCount}>
                <Text style={[s.overallNum, isComplete && { color: GOLD }]}>{totalDisc ?? '—'}</Text>
                <Text style={s.overallOf}> / {TOTAL_SUPPORTED_BRANDS}</Text>
              </Text>
              <Text style={s.overallLabel}>Brands Discovered</Text>
            </View>
            <Animated.Text style={[
              s.overallPct,
              isComplete && { color: GOLD },
              isComplete && {
                transform: [{ scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
              },
            ]}>
              {totalPct !== null ? `${totalPct}%` : '—'}
            </Animated.Text>
          </View>

          <View style={s.overallBarTrack}>
            <View style={[
              s.overallBarFill,
              { width: `${Math.min(((totalDisc ?? 0) / TOTAL_SUPPORTED_BRANDS) * 100, 100)}%` as any },
              isComplete && { backgroundColor: GOLD },
            ]} />
          </View>

          <Text style={[s.overallSub, isComplete && { color: GOLD, fontWeight: '800', letterSpacing: 2 }]}>
            {isComplete ? '✦  COMPLETE  ✦' : 'Complete'}
          </Text>
        </View>

        {/* Rarity Cards */}
        <Text style={s.sectionLabel}>Your Collection</Text>

        <View style={s.rarityGrid}>
          {RARITIES.map(rarity => {
            const found = byRarity?.[rarity] ?? null;
            const total = RARITY_TOTALS[rarity];
            const pct   = (found !== null && total > 0) ? Math.round((found / total) * 1000) / 10 : null;
            const color = RARITY_COLORS[rarity];
            const rarityUnseen = unseenByRarity[rarity] ?? 0;

            return (
              <Pressable
                key={rarity}
                onPress={() => { if (!navGuard()) return; router.push({
                  pathname: '/brand-rarity' as any,
                  params: { rarity },
                }); }}
                style={({ pressed }) => [s.rarityCard, pressed && { opacity: 0.82 }]}
              >

                {/* Colored accent bar at top */}
                <View style={[s.rarityAccent, { backgroundColor: color }]} />

                <View style={s.rarityCardInner}>
                  <MaterialIcons
                    name={RARITY_ICONS[rarity] as any}
                    size={20}
                    color={color}
                    style={{ marginBottom: 6 }}
                  />

                  <Text style={[s.rarityName, { color }]}>
                    {RARITY_LABELS[rarity].toUpperCase()}
                  </Text>

                  <Text style={s.rarityFound}>
                    <Text style={[s.rarityFoundNum, { color }]}>{found ?? "—"}</Text>
                    <Text style={s.rarityFoundOf}> / {total}</Text>
                  </Text>
                  <Text style={s.rarityFoundLabel}>Found</Text>

                  {/* Mini progress bar */}
                  <View style={s.rarityBarTrack}>
                    <View style={[
                      s.rarityBarFill,
                      { width: `${Math.min(pct ?? 0, 100)}%` as any, backgroundColor: color },
                    ]} />
                  </View>

                  <Text style={[s.rarityPct, { color }]}>{pct !== null ? `${pct}%` : "—"}</Text>
                </View>

                {rarityUnseen > 0 && (
                  <View style={s.rarityNotifBadge}>
                    <Text style={s.rarityNotifText}>{rarityUnseen}</Text>
                  </View>
                )}
                <MaterialIcons
                  name="chevron-right"
                  size={16}
                  color={color + '80'}
                  style={s.rarityChevron}
                />
              </Pressable>
            );
          })}
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: PARCH },

  header:       {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
    backgroundColor: PARCH,
  },
  backBtn:      {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: FOREST },
  headerSub:    { fontSize: 12, color: MUTED },
  divider:      { height: 1, backgroundColor: BORDER },

  scroll:       { paddingHorizontal: 16, paddingTop: 20, gap: 20 },

  // Overall card
  overallCard:  {
    backgroundColor: IVORY,
    borderRadius: 18, borderWidth: 1.5, borderColor: GOLD + '55',
    padding: 18, gap: 12, overflow: 'hidden',
  },
  overallTop:   { flexDirection: 'row', alignItems: 'center' },
  overallCount: {},
  overallNum:   { fontFamily: FONTS.serif, fontSize: 32, fontWeight: '900', color: FOREST },
  overallOf:    { fontSize: 18, color: MUTED },
  overallLabel: { fontSize: 12, color: MUTED, marginTop: 2 },
  overallPct:   { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '900', color: GOLD },

  overallBarTrack: {
    height: 8, backgroundColor: BORDER + '60', borderRadius: 4, overflow: 'hidden',
  },
  overallBarFill:  {
    height: '100%', backgroundColor: FOREST, borderRadius: 4,
  },
  overallSub:   { fontSize: 10, color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase' },

  // 100% complete aura rings
  auraRing: {
    position: 'absolute', borderRadius: 18,
    borderWidth: 2, borderColor: GOLD,
    top: 0, left: 0, right: 0, bottom: 0,
  },
  auraOuter: { margin: -6, borderRadius: 22 },
  auraInner: { margin: -2, borderRadius: 19 },

  // Section label
  sectionLabel: {
    fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700',
    color: BROWN, letterSpacing: 0.3, textTransform: 'uppercase',
  },

  // Rarity grid
  rarityGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  rarityCard:   {
    width: '47.5%',
    backgroundColor: IVORY,
    borderRadius: 16, borderWidth: 1.5, borderColor: BORDER,
    overflow: 'hidden', position: 'relative',
  },
  rarityAccent: { height: 4 },
  rarityCardInner: { padding: 14, paddingBottom: 10, gap: 2 },
  rarityName:   { fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  rarityFound:  {},
  rarityFoundNum: { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '900' },
  rarityFoundOf:  { fontSize: 14, color: MUTED },
  rarityFoundLabel: { fontSize: 10, color: MUTED, marginBottom: 8 },
  rarityBarTrack: {
    height: 4, backgroundColor: BORDER + '60', borderRadius: 2,
    overflow: 'hidden', marginBottom: 4,
  },
  rarityBarFill: { height: '100%', borderRadius: 2 },
  rarityPct:    { fontSize: 11, fontWeight: '700' },
  rarityChevron: { position: 'absolute', bottom: 12, right: 10 },
  rarityNotifBadge: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: '#CC2222', borderRadius: 10,
    minWidth: 18, height: 18, paddingHorizontal: 4,
    justifyContent: 'center', alignItems: 'center',
  },
  rarityNotifText: { fontSize: 10, fontWeight: '900', color: '#fff' },
});