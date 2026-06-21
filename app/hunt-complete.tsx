/**
 * app/hunt-complete.tsx
 *
 * Hunt Completion Screen — Pass 3B
 *
 * Shown immediately after saving a hunt bundle.
 * Top ~42% of screen: vintage forest green header with lion laurel art.
 * Bottom: cream card with hunt summary, top finds, XP section, buttons.
 *
 * Data sources:
 *   - bundleId route param → look up HuntBundle from useFlipStore
 *   - consumeLastCompletionResult() → XP result from Pass 3A applyHuntXp
 *     (fallback: reconstruct rank data from bundle.xpEarned + current profile)
 */

import {
  View, Text, ScrollView, Pressable, StyleSheet,
  Animated, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRef, useEffect, useState, useCallback } from 'react';

import { useFlipStore }                              from '@/lib/useFlipStore';
import { isHuntBundle, type HuntBundle, type HuntBundleItem } from '@/types/flip';
import {
  consumeLastCompletionResult, loadXpProfile,
  getCurrentRank, getNextRank, getRankProgress,
  type HuntXpResult,
} from '@/lib/huntXp';
import { FONTS } from '@/constants/typography';
import { MajorAchievementModal } from '@/lib/MajorAchievementModal';
import { BrandRevealModal } from '@/lib/BrandRevealModal';
import {
  getBrandByName,
  computeDiscoveredBrands,
  getRevealedBrandNames,
  markBrandRevealed,
  TOTAL_SUPPORTED_BRANDS,
  type Brand,
} from '@/lib/brandCompendium';
import {
  hasShownMajorAchievement,
  markMajorAchievementShown,
  type MajorAchievementType,
} from '@/lib/majorAchievementStorage';

// ─── Assets ───────────────────────────────────────────────────────────────────

const LION_IMAGE = require('@/assets/images/hunt-lion-completion-greathunt.png');

// ─── Palette ──────────────────────────────────────────────────────────────────

const FOREST   = '#2A4A2A';   // vintage green — top section background
const FOREST_D = '#1C3320';   // deeper green for depth
const CREAM    = '#F4EED8';
const PARCHMENT= '#EDE0C4';
const CARD_B   = '#DDD0B0';
const BROWN    = '#5A3A1A';
const MUTED    = '#8A7050';
const GOLD     = '#BE9C2C';
const GOLD_L   = '#D4A72C';

const { width: SW } = Dimensions.get('window');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatProfit(n: number): string {
  if (n >= 0) return `+$${Math.round(n)}`;
  return `-$${Math.abs(Math.round(n))}`;
}

// ─── Top Finds ────────────────────────────────────────────────────────────────
// Returns up to 3 best kept items by estimated profit, descending

function getTopFinds(keptItems: HuntBundleItem[]): HuntBundleItem[] {
  return [...keptItems]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 3);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HuntCompleteScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const params  = useLocalSearchParams<{ bundleId?: string }>();
  const { flips } = useFlipStore();

  // Find the bundle
  const bundle = flips.find(
    f => isHuntBundle(f) && f.id === params.bundleId
  ) as HuntBundle | undefined;

  // Consume XP result (set by hunt-active before navigating here)
  const [xpResult, setXpResult] = useState<HuntXpResult | null>(null);
  const [majorAchievement, setMajorAchievement] = useState<MajorAchievementType | null>(null);

  // Reward queue — same pattern as results.tsx so rewards never overlap
  const [rewardQueue, setRewardQueue] = useState<Array<
    | { kind: 'achievement'; achievementType: MajorAchievementType }
    | { kind: 'brand'; brand: Brand; totalDiscovered: number }
  >>([]);
  const currentReward = rewardQueue[0] ?? null;
  const advanceQueue = useCallback(() => setRewardQueue(q => q.slice(1)), []);

  const enqueueAchievement = useCallback((type: MajorAchievementType) => {
    setRewardQueue(q => [...q, { kind: 'achievement', achievementType: type }]);
  }, []);
  const enqueueBrand = useCallback((brand: Brand, totalDisc: number) => {
    setRewardQueue(q => brand.rarity === 'legendary'
      ? [{ kind: 'brand', brand, totalDiscovered: totalDisc }, ...q]
      : [...q, { kind: 'brand', brand, totalDiscovered: totalDisc }]);
  }, []);

  useEffect(() => {
    const result = consumeLastCompletionResult();
    if (result) {
      setXpResult(result);
      return;
    }
    // Fallback: reconstruct from bundle + current profile if result not present
    if (!bundle) return;
    loadXpProfile().then(async profile => {
      const xpEarned       = bundle.xpEarned ?? 0;
      const newTotalXp     = profile.totalXp;
      const prevTotalXp    = Math.max(0, newTotalXp - xpEarned);
      const prevRank       = getCurrentRank(prevTotalXp);
      const newRank        = getCurrentRank(newTotalXp);
      setXpResult({
        totalXpEarned:   xpEarned,
        breakdown:       bundle.xpBreakdown ?? [],
        previousTotalXp: prevTotalXp,
        newTotalXp,
        previousRank:    prevRank,
        newRank,
        didRankUp:       prevRank.rank !== newRank.rank,
        progressBefore:  getRankProgress(prevTotalXp),
        progressAfter:   getRankProgress(newTotalXp),
      });

      // ── Major achievement detection (hunt-based) ─────────────────────────
      // completedHunts and huntStreak come from the live XP profile.
      // We show the modal here — user is on hunt-complete and can press Continue.
      try {
        const hunts  = profile.completedHunts ?? 0;
        const streak = profile.huntStreak ?? 0;

        // Hunt Mode Legend — 2,500 hunts
        if (hunts >= 2500 && !await hasShownMajorAchievement('hunt_mode_legend')) {
          await markMajorAchievementShown('hunt_mode_legend');
          enqueueAchievement('hunt_mode_legend');
        }
        // Never Miss — 365-day streak
        else if (streak >= 365 && !await hasShownMajorAchievement('never_miss')) {
          await markMajorAchievementShown('never_miss');
          enqueueAchievement('never_miss');
        }

        // ── Brand reveals for brands newly discovered via this hunt ─────────
        // Items saved during the hunt already fired brand reveals via results.tsx.
        // This catches any brands tracked ONLY in profile.discoveredBrands
        // (edge cases where the XP profile has brands not in flips[]).
        if (bundle) {
          const keptBrands = bundle.keptItems.map(i => i.brand).filter(Boolean);
          // Discover set before this hunt (using flips only, no hunt brands)
          const preHuntDiscovered = computeDiscoveredBrands(flips, []);
          const revealed = await getRevealedBrandNames();

          for (const rawBrand of keptBrands) {
            const brandObj = getBrandByName(rawBrand);
            if (!brandObj) continue;
            if (preHuntDiscovered.has(brandObj.name)) continue; // already known
            if (revealed.has(brandObj.name)) continue;          // reveal already shown
            await markBrandRevealed(brandObj.name);
            enqueueBrand(brandObj, preHuntDiscovered.size + 1);
          }
        }
      } catch { /* never crash on achievement logic */ }
    });
  }, []);

  // Progress bar animation — fills once when xpResult is ready
  const barAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!xpResult) return;
    barAnim.setValue(xpResult.progressBefore / 100);
    Animated.timing(barAnim, {
      toValue:  xpResult.progressAfter / 100,
      duration: 900,
      delay:    350,
      useNativeDriver: false,
    }).start();
  }, [xpResult]);

  // ── Error state ─────────────────────────────────────────────────────────────
  if (!bundle) {
    return (
      <View style={[s.errorWrap, { paddingTop: insets.top }]}>
        <MaterialIcons name="search-off" size={36} color={MUTED} />
        <Text style={s.errorText}>Hunt data not found</Text>
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={s.errorBtn}>
          <Text style={s.errorBtnText}>Return Home</Text>
        </Pressable>
      </View>
    );
  }

  const topFinds      = getTopFinds(bundle.keptItems);
  const totalScanned  = bundle.keptItemCount + bundle.removedItemCount;
  const currentRank   = xpResult?.newRank ?? getCurrentRank(0);
  const nextRank      = getNextRank(xpResult?.newTotalXp ?? 0);
  const xpEarned      = xpResult?.totalXpEarned ?? bundle.xpEarned ?? 0;
  const newTotalXp    = xpResult?.newTotalXp ?? 0;
  const didRankUp     = xpResult?.didRankUp ?? false;

  const barWidth = barAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={s.root}>

      {/* ── Green top section ─────────────────────────────────────────────── */}
      <View style={[s.greenTop, { paddingTop: insets.top + 4 }]}>
        {/* Small label */}
        <Text style={s.huntCompleteLabel}>♦  HUNT COMPLETE  ♦</Text>

        {/* Main title */}
        <Text style={s.greatHuntTitle}>Great Hunt!</Text>

        {/* Lion laurel image */}
        <Image
          source={LION_IMAGE}
          style={s.lionImage}
          contentFit="contain"
        />
      </View>

      {/* ── Cream card — scrollable ─────────────────────────────────────────── */}
      <ScrollView
        style={s.scrollArea}
        contentContainerStyle={[s.cardInner, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >

        {/* Hunt title + date/time row */}
        <View style={s.huntMeta}>
          <Text style={s.huntTitle} numberOfLines={1}>{bundle.huntTitle}</Text>
          <View style={s.metaRow}>
            <Text style={s.metaDate}>{formatDate(bundle.endedAt)}</Text>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTime}>{formatDuration(bundle.durationMs)}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={s.divider} />

        {/* 3 Stat cards */}
        <View style={s.statsRow}>
          <StatCard value={String(totalScanned)}       label="Items Scanned" />
          <View style={s.statSep} />
          <StatCard value={String(bundle.keptItemCount)} label="Items Kept" />
          <View style={s.statSep} />
          <StatCard
            value={formatProfit(bundle.totalEstimatedProfit)}
            label="Est. Profit"
            valueColor={bundle.totalEstimatedProfit >= 0 ? '#2A6A2A' : '#8A2A1A'}
          />
        </View>

        {/* ── Top Finds ───────────────────────────────────────────────────── */}
        {topFinds.length > 0 && (
          <>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>TOP FINDS</Text>
            </View>

            {topFinds.map((item, idx) => (
              <TopFindRow
                key={item.huntItemId}
                rank={idx + 1}
                item={item}
              />
            ))}
          </>
        )}

        {/* ── XP Section ──────────────────────────────────────────────────── */}
        <View style={s.xpOrnamentRow}>
          <View style={s.ornamentLine} />
          <Text style={s.ornamentGlyph}>✦</Text>
          <View style={s.ornamentLine} />
        </View>

        <View style={s.xpSection}>
          {/* Header row: YOU EARNED + XP amount */}
          <View style={s.xpHeaderRow}>
            <Text style={s.xpLabel}>YOU EARNED</Text>
            <Text style={s.xpAmount}>+{xpEarned} XP</Text>
          </View>

          {/* Rank row: icon + rank name + level up badge */}
          <View style={s.rankRow}>
            <View style={s.rankIconWrap}>
              <MaterialIcons name="emoji-events" size={20} color={GOLD} />
            </View>
            <Text style={s.rankName}>{currentRank.rank}</Text>
            {didRankUp && (
              <View style={s.levelUpBadge}>
                <Text style={s.levelUpText}>LEVEL UP</Text>
              </View>
            )}
          </View>

          {/* Progress bar */}
          <View style={s.progressTrack}>
            <Animated.View style={[s.progressFill, { width: barWidth }]} />
          </View>

          {/* XP numbers */}
          <View style={s.progressLabels}>
            <Text style={s.progressCurrent}>{newTotalXp.toLocaleString()} XP</Text>
            {nextRank && (
              <Text style={s.progressNext}>{nextRank.xp.toLocaleString()} XP</Text>
            )}
          </View>
        </View>

        {/* ── Buttons ─────────────────────────────────────────────────────── */}
        <View style={s.buttons}>
          <Pressable
            onPress={() => router.replace('/(tabs)' as any)}
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.88 }]}
          >
            <Text style={s.primaryBtnText}>RETURN HOME</Text>
          </Pressable>

          <Pressable
            onPress={() =>
              router.push({
                pathname: '/hunt-history' as any,
                params:   { bundleId: bundle.id },
              })
            }
            style={({ pressed }) => [s.ghostBtn, pressed && { opacity: 0.65 }]}
          >
            <Text style={s.ghostBtnText}>View Hunt History</Text>
          </Pressable>
        </View>

      </ScrollView>

      {/* ── Reward queue ─────────────────────────────────────────────────── */}
      {currentReward?.kind === 'achievement' && (
        <MajorAchievementModal
          type={currentReward.achievementType}
          visible={true}
          onContinue={advanceQueue}
        />
      )}
      {currentReward?.kind === 'brand' && (
        <BrandRevealModal
          brand={currentReward.brand}
          totalDiscovered={currentReward.totalDiscovered}
          totalBrands={TOTAL_SUPPORTED_BRANDS}
          visible={true}
          onContinue={advanceQueue}
        />
      )}

    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────

function StatCard({
  value, label, valueColor = BROWN,
}: { value: string; label: string; valueColor?: string }) {
  return (
    <View style={sc.card}>
      <Text style={[sc.value, { color: valueColor }]}>{value}</Text>
      <Text style={sc.label}>{label}</Text>
    </View>
  );
}

const RANK_MEDALS: Record<number, string> = { 1: '#D4A72C', 2: '#A0A0A0', 3: '#A0724A' };

function TopFindRow({ rank, item }: { rank: number; item: HuntBundleItem }) {
  const medalColor = RANK_MEDALS[rank] ?? MUTED;
  return (
    <View style={tf.row}>
      {/* Rank badge */}
      <View style={[tf.rankBadge, { borderColor: medalColor + 'AA' }]}>
        <Text style={[tf.rankNum, { color: medalColor }]}>{rank}</Text>
      </View>

      {/* Thumbnail */}
      <View style={tf.imgWrap}>
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={tf.img} contentFit="cover" />
        ) : (
          <View style={[tf.img, tf.imgFallback]}>
            <MaterialIcons name="checkroom" size={14} color={MUTED} />
          </View>
        )}
      </View>

      {/* Name */}
      <Text style={tf.name} numberOfLines={1}>{item.itemName}</Text>

      {/* Profit */}
      <Text style={[tf.profit, { color: item.profit >= 0 ? '#2A6A2A' : '#8A2A1A' }]}>
        {formatProfit(item.profit)}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: FOREST },

  // ── Green header ───────────────────────────────────────────────────────────
  greenTop: {
    backgroundColor: FOREST,
    alignItems:      'center',
    paddingBottom:   0,
  },
  huntCompleteLabel: {
    fontSize:      9,
    fontWeight:    '800',
    color:         GOLD,
    letterSpacing: 3,
    marginBottom:  8,
  },
  greatHuntTitle: {
    fontFamily:    FONTS.serif,
    fontSize:      38,
    fontWeight:    '900',
    color:         CREAM,
    letterSpacing: 0.5,
    marginBottom:  2,
  },
  lionImage: {
    width:        SW * 0.62,
    height:       SW * 0.38,
    marginTop:    -16,
    marginBottom: -24,
  },

  // ── Scrollable cream card ──────────────────────────────────────────────────
  scrollArea: {
    flex:                 1,
    backgroundColor:      PARCHMENT,
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
  },
  cardInner: {
    paddingHorizontal: 20,
    paddingTop:        12,
  },

  // ── Hunt meta ─────────────────────────────────────────────────────────────
  huntMeta:  { alignItems: 'center', marginBottom: 8 },
  huntTitle: {
    fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800',
    color: BROWN, textAlign: 'center',
  },
  metaRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  metaDate:  { fontSize: 13, color: MUTED },
  metaDot:   { fontSize: 13, color: CARD_B },
  metaTime:  { fontSize: 13, color: MUTED },

  divider: { height: 1, backgroundColor: CARD_B, marginVertical: 8 },

  // ── Stats ─────────────────────────────────────────────────────────────────
  statsRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 10 },
  statSep:  { width: 1, backgroundColor: CARD_B, marginVertical: 4 },

  // ── Section header ────────────────────────────────────────────────────────
  sectionHeader: { marginBottom: 10, marginTop: 4 },
  sectionTitle:  {
    fontSize: 10, fontWeight: '800', color: MUTED, letterSpacing: 2.5,
  },

  // ── XP ornament ──────────────────────────────────────────────────────────
  xpOrnamentRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  ornamentLine:   { flex: 1, height: 1, backgroundColor: CARD_B },
  ornamentGlyph:  { fontSize: 13, color: GOLD },

  // ── XP section ────────────────────────────────────────────────────────────
  xpSection: { marginBottom: 14 },
  xpHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: 12,
  },
  xpLabel: {
    fontSize: 10, fontWeight: '800', color: MUTED, letterSpacing: 2.5,
  },
  xpAmount: {
    fontFamily: FONTS.serif, fontSize: 26, fontWeight: '900', color: GOLD_L,
  },
  rankRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
  },
  rankIconWrap: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: GOLD + '22',
    borderWidth: 1, borderColor: GOLD + '44',
    justifyContent: 'center', alignItems: 'center',
  },
  rankName: {
    fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: BROWN, flex: 1,
  },
  levelUpBadge: {
    backgroundColor: GOLD, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  levelUpText: { fontSize: 9, fontWeight: '900', color: FOREST, letterSpacing: 1.5 },

  progressTrack: {
    height: 8, backgroundColor: CARD_B, borderRadius: 4, overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%', backgroundColor: GOLD, borderRadius: 4,
  },
  progressLabels: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  progressCurrent: { fontSize: 10, color: BROWN, fontWeight: '600' },
  progressNext:    { fontSize: 10, color: MUTED },

  // ── Buttons ───────────────────────────────────────────────────────────────
  buttons:    { gap: 10, marginTop: 4 },
  primaryBtn: {
    backgroundColor: FOREST, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center',
    shadowColor: FOREST, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28, shadowRadius: 6, elevation: 4,
  },
  primaryBtnText: {
    fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800',
    color: CREAM, letterSpacing: 1.5,
  },
  ghostBtn: { alignItems: 'center', paddingVertical: 10 },
  ghostBtnText: {
    fontFamily: FONTS.serif, fontSize: 14, color: MUTED,
    textDecorationLine: 'underline',
  },

  // ── Error state ───────────────────────────────────────────────────────────
  errorWrap: {
    flex: 1, backgroundColor: PARCHMENT,
    justifyContent: 'center', alignItems: 'center', gap: 14,
  },
  errorText: { fontFamily: FONTS.serif, fontSize: 17, color: BROWN },
  errorBtn:  { backgroundColor: FOREST, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  errorBtnText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: CREAM },
});

const sc = StyleSheet.create({
  card:  { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 4 },
  value: { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '900', color: BROWN },
  label: { fontSize: 11, color: MUTED, textAlign: 'center', fontWeight: '600' },
});

const tf = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: CARD_B + '88',
  },
  rankBadge: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: PARCHMENT,
  },
  rankNum:    { fontSize: 11, fontWeight: '800' },
  imgWrap:    { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B },
  img:        { width: 40, height: 40 },
  imgFallback:{ backgroundColor: CARD_B, justifyContent: 'center', alignItems: 'center' },
  name:       { flex: 1, fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700', color: BROWN },
  profit:     { fontSize: 14, fontWeight: '800', fontFamily: FONTS.serif },
});