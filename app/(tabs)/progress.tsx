/**
 * app/(tabs)/progress.tsx — Progress Screen
 *
 * Layout:
 *   1. Header (title + subtitle with divider)
 *   2. Explore Progress card (SVG ring + stat columns)
 *   3. "Your Collection" decorative divider
 *   4. Five standalone collection cards with progress badges
 *   5. Bottom illustration space (reserved for future artwork)
 *
 * Data: all from HuntXpProfile via loadXpProfile().
 * Calculations: unchanged from prior implementation.
 * SVG: react-native-svg v15 (pre-installed in Expo SDK 54).
 */

import { navGuard } from '@/lib/navGuard';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Image, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import { useFlipStore } from '@/lib/useFlipStore';

import { FONTS } from '@/constants/typography';
import {
  loadXpProfile, getCurrentRank, getNextRank,
  getRankProgress, RANK_LADDER, type HuntXpProfile,
} from '@/lib/huntXp';
import {
  ACHIEVEMENT_CATEGORIES,
  TOTAL_ACHIEVEMENTS as ACHV_TOTAL,
  buildUserAchievementData,
  getTotalUnlocked,
  getAllUnlockedIds,
  getUnlockedCount,
  type UserAchievementData,
} from '@/lib/achievements';
import {
  useAchievementNotifications,
  type AchievementNotification,
} from '@/lib/AchievementNotificationContext';
import {
  computeDiscoveredBrands,
  getUnseenBrandNames,
  TOTAL_SUPPORTED_BRANDS,
} from '@/lib/brandCompendium';
import {
  getUnlockedDiamondIds,
  getUnseenDiamondIds,
  computeUnlockedDiamonds,
  TOTAL_DIAMONDS,
} from '@/lib/diamonds';
import { isProgressHydrated, markProgressHydrated, seedSeenBaselineOnce } from '@/lib/progressHydration';
import { trackAnalyticsEvent, useScreenFocus } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import FeatureGate from '@/components/FeatureGate';

// ─── Palette ─────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const PARCH  = '#FFFFFF';
const CARD   = '#FFFEFA';
const IVORY  = '#FFFEFA';
const BORDER = '#DDD2AC';
const TAN    = '#F4F1E8';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';

// ─── Screen width ────────────────────────────────────────────────────────────
const SW = Dimensions.get('window').width;

// ─── Illustration asset ───────────────────────────────────────────────────────
const EXPLORER_ILL = require('@/assets/images/progress-illustration.png');

// ─── Collection totals ────────────────────────────────────────────────────────
// TOTAL_ACHIEVEMENTS (39) imported as ACHV_TOTAL from lib/achievements
const TOTAL_BRANDS = TOTAL_SUPPORTED_BRANDS;  // 241 supported brands

// ─── Destinations (order matches reference image) ────────────────────────────
const DESTINATIONS = [
  { key: 'achievements', icon: 'emoji-events',  color: '#BE9C2C', title: 'Achievements',         sub: 'Track your achievements'    },
  { key: 'brands',       icon: 'local-offer',   color: '#1A1A1A', title: 'Brand Compendium',      sub: 'Discover brands'            },
  { key: 'diamonds',     icon: 'auto-awesome',  color: '#3A7EBF', title: 'Diamonds in the Rough', sub: 'Find the rarest treasures' },
] as const;

// Badge text per destination key
function getBadge(key: string, realUnlocked: number, brands: number | null, diamonds: number): string {
  if (key === 'achievements') return `${realUnlocked} / ${ACHV_TOTAL}`;
  if (key === 'brands')       return brands === null ? `— / ${TOTAL_BRANDS}` : `${brands} / ${TOTAL_BRANDS}`;
  if (key === 'diamonds')     return `${diamonds} / ${TOTAL_DIAMONDS}`;
  return '—';
}

const comingSoon = () =>
  Alert.alert('Coming Soon', 'Coming in a future update.');

// ─── Circular Progress Ring ───────────────────────────────────────────────────
function RingProgress({ percent, size = 112, strokeWidth = 9 }: {
  percent: number; size?: number; strokeWidth?: number;
}) {
  const r     = (size - strokeWidth) / 2;
  const circ  = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Track */}
        <Circle cx={cx} cy={cy} r={r} stroke={TAN} strokeWidth={strokeWidth} fill="none" />
        {/* Arc */}
        <Circle
          cx={cx} cy={cy} r={r}
          stroke={FOREST}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90, ${cx}, ${cy})`}
        />
      </Svg>
      <Text style={s.ringPct}>{percent}%</Text>
      <Text style={s.ringLbl}>Complete</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { flips } = useFlipStore();
  const { notifyNew, unseenCount, unseenBrandCount, addUnseenBrands, unseenBrandNames,
          unseenDiamondCount, addUnseenDiamonds } = useAchievementNotifications();
  const [profile, setProfile] = useState<HuntXpProfile | null>(null);
  const [achvData, setAchvData] = useState<UserAchievementData | null>(null);
  const [devAchvCount, setDevAchvCount] = useState<number>(0);
  const [brandCount, setBrandCount] = useState<number | null>(null);
  const [diamondCount, setDiamondCount] = useState<number | null>(null);
  const [cachedAchv, setCachedAchv] = useState<number | null>(null); // last-known achievements, shown until achvData loads

  // ── Instant hydrate from last-known values ──────────────────────────────────
  // Show the last numbers we saw immediately on mount so the stat cards never
  // flash "—"; the real values refresh in the background via the load effect.
  const progressCacheKey = `@flipstart/progress_stats_cache:${user?.id ?? 'guest'}`;
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(progressCacheKey)
      .then(raw => {
        if (!alive || !raw) return;
        try {
          const c = JSON.parse(raw) as { brands?: number; diamonds?: number; achv?: number };
          // Only fill values that haven't already loaded fresh, to avoid clobbering.
          setBrandCount(prev => (prev === null && typeof c.brands === 'number' ? c.brands : prev));
          setDiamondCount(prev => (prev === null && typeof c.diamonds === 'number' ? c.diamonds : prev));
          if (typeof c.achv === 'number') setCachedAchv(c.achv);
        } catch { /* ignore corrupt cache */ }
      })
      .catch(() => { /* no cache yet — falls back to '—' then real data */ });
    return () => { alive = false; };
  }, [progressCacheKey]);

  // Analytics: Progress tab opened — refires on focus return after 30s cooldown.
  useScreenFocus('progress_tab_opened');

  useFocusEffect(useCallback(() => {
    const uid = user?.id ?? null;

    // Guests never generate notifications. When signed out the screen shows the
    // FeatureGate (below), but this effect's hooks still run — so without this
    // guard, guest flips/dev overrides would recompute unseen diamonds/brands/
    // achievements and light up the Progress tab badge in guest mode.
    if (!uid) return;

    const load = async () => {
      const xp = uid ? await loadXpProfile(uid).catch(() => null) : null;
      setProfile(xp);

      const data = buildUserAchievementData(
        flips,
        xp?.completedHunts       ?? 0,
        xp?.huntStreak           ?? 0,
        xp?.discoveredBrands?.length ?? 0,
      );
      setAchvData(data);

      // Detect newly unlocked achievements and push to notification context
      const unlockedIds = getAllUnlockedIds(data);

      // If the global watcher hasn't yet downloaded this account's seen-state
      // from Supabase (e.g. Progress opened immediately after login), await that
      // download here BEFORE notifying — otherwise already-seen achievements/
      // brands/diamonds would replay as new. Normally the watcher wins this race
      // and the flag is already set, so this block is skipped.
      if (uid && !isProgressHydrated(uid)) {
        try {
          const disc  = computeDiscoveredBrands(flips, xp?.discoveredBrands ?? []);
          const dRecs = Object.values(computeUnlockedDiamonds(flips));
          await Promise.all([
            import('@/lib/achievementSync').then(m => m.syncAchievementsWithSupabase(uid, unlockedIds)).catch(() => {}),
            import('@/lib/brandSync').then(m => m.syncBrandCompendiumWithSupabase(uid, [...disc])).catch(() => {}),
            import('@/lib/diamondSync').then(m => m.syncDiamondsWithSupabase(uid, dRecs)).catch(() => {}),
          ]);
          // First time this account is opened on this device: treat everything
          // already unlocked as "seen" so a returning user gets no notification
          // spam. Only items unlocked AFTER this baseline will notify.
          await seedSeenBaselineOnce(uid, {
            achievements: unlockedIds,
            brands:       [...disc],
            diamonds:     getUnlockedDiamondIds(flips),
          });
        } catch { /* fail-safe: proceed with local SEEN */ }
        markProgressHydrated(uid);
      }

      // DEV — count dev-unlocked achievements NOT already unlocked by stats, so
      // the Progress card total matches the category screen (which merges dev
      // unlocks in __DEV__). Mirrors the brands/diamonds dev-merge below.
      let devExtra = 0;
      if (__DEV__) {
        try {
          const { getDevUnlocked } = await import('@/lib/devAchievementOverrides');
          const devSet  = await getDevUnlocked();
          const statSet = new Set(unlockedIds);
          devSet.forEach(id => { if (!statSet.has(id)) devExtra++; });
          setDevAchvCount(devExtra);
        } catch { setDevAchvCount(0); }
      }

      if (unlockedIds.length > 0) {
        // Build full notification detail objects for each unlocked achievement
        const allDetails: AchievementNotification[] = [];
        for (const cat of ACHIEVEMENT_CATEGORIES) {
          for (const ach of cat.achievements) {
            allDetails.push({
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
        await notifyNew(unlockedIds, allDetails);

        // Background cloud sync for signed-in users — records unlocks in Supabase.
        // Fire-and-forget; never blocks the local notification flow above.
        if (uid) {
          import('@/lib/achievementSync')
            .then(({ syncAchievementsWithSupabase }) => syncAchievementsWithSupabase(uid, unlockedIds))
            .catch(() => {});
        }
      }

      // ── Brand discovery notifications ──────────────────────────────────
      let discoveredBrands = computeDiscoveredBrands(
        flips,
        xp?.discoveredBrands ?? [],
      );

      // DEV — merge dev-unlocked brands so the count matches the compendium.
      if (__DEV__) {
        const { getDevUnlockedBrands } = await import('@/lib/devBrandOverrides');
        const devSet = await getDevUnlockedBrands();
        if (devSet.size > 0) discoveredBrands = new Set([...discoveredBrands, ...devSet]);
      }

      // Store the accurate, deduped, normalized brand count for display.
      setBrandCount(discoveredBrands.size);
      const unseenBrands = await getUnseenBrandNames(discoveredBrands);
      if (unseenBrands.length > 0) {
        addUnseenBrands(unseenBrands);
      }

      // Background cloud sync for signed-in users — uploads new brand discoveries
      // + downloads remote seen state. Fire-and-forget; never blocks local flow.
      if (uid) {
        import('@/lib/brandSync')
          .then(({ syncBrandCompendiumWithSupabase }) =>
            syncBrandCompendiumWithSupabase(uid, [...discoveredBrands]))
          .catch(() => {});
      }

      // ── Diamond discovery (derived from the saved flip history) ─────────
      let unlockedDiamondIds = getUnlockedDiamondIds(flips);

      // DEV — merge dev force-unlocked Diamonds so the count matches the collection.
      if (__DEV__) {
        const { getDevDiamondIds } = await import('@/lib/devDiamondOverrides');
        const devIds = await getDevDiamondIds();
        if (devIds.length > 0) unlockedDiamondIds = Array.from(new Set([...unlockedDiamondIds, ...devIds]));
      }

      setDiamondCount(unlockedDiamondIds.length);
      const unseenDiamonds = await getUnseenDiamondIds(unlockedDiamondIds);
      if (unseenDiamonds.length > 0) {
        addUnseenDiamonds(unseenDiamonds);
      }

      // ── Cache the fresh values so the next mount hydrates instantly ─────────
      try {
        const freshAchv = Math.min(
          getTotalUnlocked(data) + (__DEV__ ? devExtra : 0),
          ACHV_TOTAL,
        );
        await AsyncStorage.setItem(progressCacheKey, JSON.stringify({
          brands:   discoveredBrands.size,
          diamonds: unlockedDiamondIds.length,
          achv:     freshAchv,
        }));
      } catch { /* non-fatal */ }
    };
    load();
  }, [user?.id, flips]));

  // ── Guest gate ────────────────────────────────────────────────────────────
  if (!authLoading && !user) {
    return (
      <FeatureGate
        icon="emoji-events"
        title="Track Your Progress"
        subtitle="Build your FlipStart legacy."
        body="Create a free FlipStart account to save achievements, discovered brands, Diamonds in the Rough, and progress across devices."
        benefits={[
          'Save achievements',
          'Build your Brand Compendium',
          'Preserve Diamonds in the Rough',
          'Sync progress automatically',
        ]}
        returnTo="progress"
      />
    );
  }

  // ── Derived values (all preserved from prior implementation) ──────────────
  const totalXp    = profile?.totalXp             ?? 0;
  const completed  = profile?.completedHunts      ?? 0;
  const brands     = brandCount ?? 0;
  const diamonds   = diamondCount ?? 0;

  // Loading-aware display: show cached last-known value until fresh data arrives,
  // then the real value. Only shows '—' if there's no cache and nothing loaded yet.
  const brandsDisplay      = brandCount === null ? '—' : String(brands);
  const diamondsDisplay    = diamondCount === null ? '—' : String(diamonds);
  const achvLoaded         = achvData !== null;

  // Real achievement count — replaces the old completedHunts proxy.
  const statUnlocked   = achvData ? getTotalUnlocked(achvData) : 0;
  const realUnlocked   = Math.min(statUnlocked + (__DEV__ ? devAchvCount : 0), ACHV_TOTAL);
  const achvDisplay    = achvLoaded ? String(realUnlocked) : (cachedAchv !== null ? String(cachedAchv) : '—');

  // Explore percentage: achievements + brands + diamonds (all three tracked systems).
  // While achievements are still loading, fall back to the cached count so the
  // ring matches the displayed stat instead of dipping to zero.
  const achvForRing    = achvLoaded ? realUnlocked : (cachedAchv ?? 0);
  const exploreRaw     = (achvForRing / ACHV_TOTAL + brands / TOTAL_BRANDS + diamonds / TOTAL_DIAMONDS) / 3;
  const explorePercent = Math.min(Math.round(exploreRaw * 100), 100);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header — centered title + subtitle, airy ─────────────────────── */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Progress</Text>
        <Text style={s.headerSub}>Track your journey. Build your legacy.</Text>
      </View>
      <View style={s.headerDivider} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 8) + 12 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ═══════ EXPLORE PROGRESS ══════════════════════════════════════ */}
        <View style={s.exploreCard}>

          {/* Decorative title */}
          <Text style={s.exploreTitle}>{'\u2726'} Explore Progress {'\u2726'}</Text>

          {/* Ring + stats row */}
          <View style={s.exploreBody}>

            {/* Circular ring */}
            <RingProgress percent={explorePercent} />

            {/* Thin vertical separator */}
            <View style={s.vertSep} />

            {/* Right column: progress bar + 3 stat items */}
            <View style={s.statsCol}>
              {/* Horizontal bar synced to ring */}
              <View style={s.exploreBarTrack}>
                <View style={[s.exploreBarFill, { width: `${explorePercent}%` }]} />
              </View>

              {/* 3 stat items */}
              <View style={s.statRow}>

                <View style={s.statItem}>
                  <View style={s.statIconBox}>
                    <MaterialIcons name="emoji-events" size={16} color={GOLD} />
                  </View>
                  <Text style={s.statCount}>
                    <Text style={s.statCurrent}>{achvDisplay}</Text>
                    <Text style={s.statTotal}> / {ACHV_TOTAL}</Text>
                  </Text>
                  <Text style={s.statLabel}>Achievements{'\n'}Unlocked</Text>
                </View>

                <View style={s.statDivider} />

                <View style={s.statItem}>
                  <View style={s.statIconBox}>
                    <MaterialIcons name="local-offer" size={16} color={GOLD} />
                  </View>
                  <Text style={s.statCount}>
                    <Text style={s.statCurrent}>{brandsDisplay}</Text>
                    <Text style={s.statTotal}> / {TOTAL_BRANDS}</Text>
                  </Text>
                  <Text style={s.statLabel}>Brands{'\n'}Discovered</Text>
                </View>

                <View style={s.statDivider} />

                <View style={s.statItem}>
                  <View style={s.statIconBox}>
                    <MaterialIcons name="auto-awesome" size={16} color={GOLD} />
                  </View>
                  <Text style={s.statCount}>
                    <Text style={s.statCurrent}>{diamondsDisplay}</Text>
                    <Text style={s.statTotal}> / {TOTAL_DIAMONDS}</Text>
                  </Text>
                  <Text style={s.statLabel}>Diamonds{'\n'}Unlocked</Text>
                </View>

              </View>
            </View>
          </View>
        </View>

        {/* ═══════ "YOUR COLLECTION" DIVIDER ═════════════════════════════ */}
        <View style={s.collectionDivider}>
          <View style={s.dividerLine} />
          <Text style={s.collectionTitle}>Your Collection</Text>
          <View style={s.dividerLine} />
        </View>

        {/* ═══════ COLLECTION CARDS ══════════════════════════════════════ */}
        {DESTINATIONS.map(dest => (
          <Pressable
            key={dest.key}
            onPress={dest.key === 'achievements'
              ? () => { if (!navGuard()) return; router.push('/achievements' as any); }
              : dest.key === 'brands'
              ? () => { if (!navGuard()) return; router.push('/brand-compendium' as any); }
              : dest.key === 'diamonds'
              ? () => { if (!navGuard()) return; router.push('/diamonds-in-the-rough' as any); }
              : comingSoon}
            style={({ pressed }) => [s.destCard, pressed && { opacity: 0.78 }]}
          >
            <View style={s.destIconBox}>
              <MaterialIcons name={dest.icon as any} size={22} color={dest.color} />
            </View>
            <View style={s.destBody}>
              <Text style={s.destTitle}>{dest.title}</Text>
              <Text style={s.destSub}>{dest.sub}</Text>
            </View>
            <View style={s.badge}>
              <Text style={s.badgeText}>
                {getBadge(dest.key, realUnlocked, brands, diamonds)}
              </Text>
            </View>
            {dest.key === 'achievements' && unseenCount > 0 && (
              <View style={s.notifBadge}>
                <Text style={s.notifBadgeText}>
                  {unseenCount > 99 ? '99+' : String(unseenCount)}
                </Text>
              </View>
            )}
            {dest.key === 'brands' && unseenBrandCount > 0 && (
              <View style={s.notifBadge}>
                <Text style={s.notifBadgeText}>
                  {unseenBrandCount > 99 ? '99+' : String(unseenBrandCount)}
                </Text>
              </View>
            )}
            {dest.key === 'diamonds' && unseenDiamondCount > 0 && (
              <View style={s.notifBadge}>
                <Text style={s.notifBadgeText}>
                  {unseenDiamondCount > 99 ? '99+' : String(unseenDiamondCount)}
                </Text>
              </View>
            )}
            <MaterialIcons name="chevron-right" size={18} color={MUTED} style={{ marginLeft: 4 }} />
          </Pressable>
        ))}

        {/* ═══════ EXPLORER ILLUSTRATION — scroll reward ════════════════ */}
        {/* Decorative only. Visible only after scrolling to bottom.      */}
        <View style={s.illWrap}>
          <Image
            source={EXPLORER_ILL}
            style={s.illImage}
            resizeMode="contain"
          />
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCH },

  // ── Guest gate ─────────────────────────────────────────────────────────────
  guestRoot: { flex: 1, backgroundColor: PARCH, justifyContent: 'center', alignItems: 'center', padding: 32 },
  guestTitle: { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 10 },
  guestBody:  { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  guestBtn:   { backgroundColor: FOREST, borderRadius: 50, paddingVertical: 16, paddingHorizontal: 40, marginBottom: 12 },
  guestBtnText: { color: '#F4EED8', fontSize: 16, fontWeight: '800', fontFamily: FONTS.serif },
  guestLink:  { color: MUTED, fontSize: 14, textDecorationLine: 'underline' },

  // ── Header — centered, airy, no icons ─────────────────────────────────────
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: PARCH,
  },
  headerTitle: {
    fontFamily: FONTS.serif, fontSize: 28, fontWeight: '800', color: FOREST,
    marginBottom: 4,
  },
  headerSub: {
    fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19,
  },
  headerDivider: { height: 1, backgroundColor: BORDER },

  // ── Scroll ─────────────────────────────────────────────────────────────────
  scroll: { paddingHorizontal: 16, paddingTop: 24, gap: 16 },

  // ── Explore Progress card ──────────────────────────────────────────────────
  exploreCard: {
    backgroundColor: IVORY,
    borderRadius: 18, borderWidth: 1.5, borderColor: GOLD + '60',
    paddingHorizontal: 18, paddingTop: 20, paddingBottom: 18,
    gap: 16,
  },
  exploreTitle: {
    fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: BROWN,
    textAlign: 'center', letterSpacing: 0.5,
  },
  exploreBody: { flexDirection: 'row', alignItems: 'center', gap: 14 },

  vertSep:    { width: 1, height: 90, backgroundColor: BORDER },

  // Right stats column
  statsCol:   { flex: 1, gap: 10 },
  exploreBarTrack: {
    height: 6, backgroundColor: TAN, borderRadius: 3, overflow: 'hidden',
  },
  exploreBarFill: { height: '100%', backgroundColor: FOREST, borderRadius: 3 },

  statRow:    { flexDirection: 'row', alignItems: 'flex-start' },
  statItem:   { flex: 1, alignItems: 'center', gap: 5 },
  statDivider:{ width: 1, height: 60, backgroundColor: BORDER, alignSelf: 'center' },
  statIconBox:{
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: GOLD + '1E', borderWidth: 1, borderColor: GOLD + '50',
    justifyContent: 'center', alignItems: 'center',
  },
  statCount:  { fontSize: 13, textAlign: 'center' },
  statCurrent:{ fontFamily: FONTS.serif, fontSize: 15, fontWeight: '900', color: FOREST },
  statTotal:  { fontSize: 11, color: MUTED, fontWeight: '600' },
  statLabel:  { fontSize: 8, color: MUTED, fontWeight: '600', textAlign: 'center', lineHeight: 12 },

  // Ring labels
  ringPct: { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '900', color: FOREST, lineHeight: 28 },
  ringLbl: { fontSize: 10, color: MUTED, fontWeight: '600', letterSpacing: 0.3 },

  // ── "Your Collection" divider ──────────────────────────────────────────────
  collectionDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 4, marginBottom: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  collectionTitle: {
    fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700',
    color: BROWN, letterSpacing: 0.3,
  },

  // ── Collection destination cards ───────────────────────────────────────────
  destCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: IVORY,
    borderRadius: 16, borderWidth: 1.5, borderColor: GOLD + '55',
    paddingHorizontal: 16, paddingVertical: 16,
  },
  destIconBox: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: TAN, borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  destBody:  { flex: 1, gap: 3 },
  destTitle: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: BROWN },
  destSub:   { fontSize: 11, color: MUTED, lineHeight: 15 },

  // Progress badge pill
  badge: {
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: CARD,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: BROWN },

  // Red notification badge on Achievements card
  notifBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: '#CC2222',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 4,
    marginLeft: -4,
  },
  notifBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },

  // ── Explorer illustration — scroll reward ─────────────────────────────────
  // Image is 987×433 (ratio 2.28:1 landscape). Bleeds to full screen width
  // via negative marginHorizontal to counteract the scroll container padding.
  illWrap: {
    alignItems:       'center',
    marginHorizontal: -16,   // escape the 16px scroll padding → full screen width
    paddingTop:       20,
    paddingBottom:    8,
  },
  illImage: {
    width:  SW,               // full screen width
    height: SW / 2.28,        // exact aspect ratio — ~171px on a 390pt iPhone
  },
});