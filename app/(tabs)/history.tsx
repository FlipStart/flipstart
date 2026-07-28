/**
 * history.tsx — Scan History (redesigned)
 *
 * Source of truth: useFlipStore.flips ONLY.
 * scan-context is NOT used here — it only manages the temporary scan pipeline.
 *
 * Stats are derived from useFlipStore.globalStats (computed via flipCalculations.ts).
 * No formulas live in this file except realized-profit (derived from sold items).
 *
 * Tapping a scan opens /scan-detail (the Flip Record screen). Hunt bundles
 * still open /hunt-history. Swipe-to-delete, impact-modal deletion, and cloud
 * reconciliation are preserved verbatim from the previous implementation.
 */

import { navGuard } from '@/lib/navGuard';
import {
  Text, View, FlatList, Pressable, Platform,
  StyleSheet, TextInput, Animated, PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useRef, useMemo, useEffect } from 'react';

import { useFlipStore } from '@/lib/useFlipStore';
import { FlipResult, HistoryEntry, HuntBundle, isHuntBundle } from '@/types/flip';
import { FONTS } from '@/constants/typography';
import { normalizeBuyRating, type CanonicalRating } from '@/utils/recommendation';
import { calculateFees } from '@/utils/flipCalculations';
import { allScanFlips, type SourcedFlip } from '@/utils/huntItemToFlip';
import { useAuth } from '@/lib/auth-context';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import {
  getScanDeletionImpact, computeValidSets, type DeletionImpact, type ImpactContext,
} from '@/lib/scanDeletionImpact';
import { DeleteImpactModal } from '@/components/DeleteImpactModal';
import { trackAnalyticsEvent, useScreenFocus } from '@/lib/analytics';

// ─── Palette (matches results / deep analysis / scan-detail) ─────────────────
const BG     = '#FFFFFF';
const CARD   = '#FFFEFA';
const CARD_B = '#DDD2AC';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';
const MAROON = '#6E211B';

const RATING_THEME: Record<CanonicalRating, { fg: string; border: string; bg: string }> = {
  'STRONG BUY': { fg: FOREST,    border: GOLD,      bg: '#F5EFDB' },
  'BUY':        { fg: '#2A5A2A', border: '#7CA87C', bg: '#EFF6EC' },
  'RISKY BUY':  { fg: '#7A5C1E', border: '#C9A94E', bg: '#F7EFD9' },
  'SKIP':       { fg: MAROON,    border: '#C08A80', bg: '#F5E9E7' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const d = new Date(ts);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7)    return `${diffD}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Actual realized profit for a sold flip (same fee model as predictions). */
function realizedProfit(f: FlipResult): number {
  const sp = f.soldPrice ?? 0;
  return Math.round(sp - calculateFees(sp) - f.thriftPrice);
}

/**
 * Realized profit across a hunt bundle's kept items, using the same fee model
 * as a normal flip so the two are directly comparable.
 *
 * Returns count as well as total: the UI must not show "$0 realized" for a
 * bundle where nothing has sold yet — that reads as a loss rather than as
 * "no data". Callers gate on count > 0.
 */
function bundleRealized(bundle: HuntBundle): { count: number; total: number } {
  const sold = bundle.keptItems.filter(i => i.status === 'sold' && (i.soldPrice ?? 0) > 0);
  const total = sold.reduce((sum, i) => {
    const sp = i.soldPrice ?? 0;
    return sum + Math.round(sp - calculateFees(sp) - (i.thriftPrice ?? 0));
  }, 0);
  return { count: sold.length, total };
}

// ─── Rank badge ───────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const cfg: Record<number, { bg: string; text: string; label: string }> = {
    1: { bg: '#D4AF37', text: '#3A2A00', label: '🥇' },
    2: { bg: '#A8A9AD', text: '#1A1A1A', label: '🥈' },
    3: { bg: '#CD7F32', text: '#2A1000', label: '🥉' },
  };
  const c = cfg[rank] ?? { bg: '#F4F1E8', text: MUTED, label: `#${rank}` };
  return (
    <View style={[rb.badge, { backgroundColor: c.bg }]}>
      <Text style={[rb.text, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}
const rb = StyleSheet.create({
  badge: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(90,58,26,0.12)' },
  text:  { fontSize: 13, fontWeight: '800' },
});

// ─── Scan card ────────────────────────────────────────────────────────────────

const DELETE_WIDTH = 80;

function FlipCard({
  item, onPress, onDelete,
}: { item: FlipResult; onPress: () => void; onDelete: () => void }) {

  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOpen  = useRef(false);

  const snapOpen = () =>
    Animated.spring(translateX, { toValue: -DELETE_WIDTH, useNativeDriver: true, bounciness: 4 })
      .start(() => { swipeOpen.current = true; });

  const snapClosed = () =>
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 })
      .start(() => { swipeOpen.current = false; });

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = swipeOpen.current ? -DELETE_WIDTH : 0;
        translateX.setValue(Math.min(0, Math.max(-DELETE_WIDTH, base + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const base  = swipeOpen.current ? -DELETE_WIDTH : 0;
        const total = base + g.dx;
        total < -DELETE_WIDTH / 2 ? snapOpen() : snapClosed();
      },
      onPanResponderTerminate: () => snapClosed(),
    })
  ).current;

  const rating  = normalizeBuyRating((item as any).recommendation?.label ?? (item as any).buyLabel ?? (item as any).recommendation);
  const rTheme  = RATING_THEME[rating];
  const isSold  = item.status === 'sold' && (item.soldPrice ?? 0) > 0;
  const isPassed = item.status === 'passed';
  const hasBought = item.status === 'bought' || item.status === 'listed' || item.status === 'sold';
  const shownProfit = isSold ? realizedProfit(item) : item.profit;
  const profitColor = shownProfit >= 15 ? '#2A5A2A' : shownProfit >= 0 ? '#7A5C1E' : '#8A3A2A';

  return (
    <View style={fc.wrapper}>
      {/* Delete zone behind card */}
      <View style={fc.deleteZone}>
        <Pressable
          style={fc.deleteBtn}
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            snapClosed();
            setTimeout(onDelete, 180);
          }}
        >
          <MaterialIcons name="delete-outline" size={22} color={CREAM} />
          <Text style={fc.deleteText}>Delete</Text>
        </Pressable>
      </View>

      <Animated.View
        style={[fc.surface, { transform: [{ translateX }] }]}
        {...pan.panHandlers}
      >
        <Pressable
          onPress={() => swipeOpen.current ? snapClosed() : onPress()}
          style={({ pressed }) => [fc.card, pressed && !swipeOpen.current && { opacity: 0.88 }]}
        >
          {/* Thumbnail */}
          <View style={fc.thumbWrap}>
            {item.imageUri ? (
              <Image source={{ uri: item.imageUri }} style={fc.thumb} contentFit="cover" />
            ) : (
              <View style={[fc.thumb, fc.thumbFallback]}>
                <MaterialIcons name="checkroom" size={24} color={MUTED} />
              </View>
            )}
            {isSold && (
              <View style={fc.soldRibbon}>
                <Text style={fc.soldRibbonText}>SOLD</Text>
              </View>
            )}
          </View>

          {/* Content */}
          <View style={fc.content}>
            <Text style={fc.name} numberOfLines={1}>{item.itemName}</Text>
            <Text style={fc.brand} numberOfLines={1}>
              {item.brand}{item.brand && item.category ? ' · ' : ''}{item.category}
            </Text>
            <View style={fc.metaRow}>
              <View style={[fc.ratingPill, { borderColor: rTheme.border, backgroundColor: rTheme.bg }]}>
                <Text style={[fc.ratingPillText, { color: rTheme.fg }]} numberOfLines={1}>{rating}</Text>
              </View>
              {isPassed && (
                <View style={fc.passedPill}><Text style={fc.passedPillText}>PASSED</Text></View>
              )}
            </View>
            <Text style={fc.date}>
              {formatDate(item.timestamp)}{hasBought && item.thriftPrice > 0 ? ` · paid $${item.thriftPrice}` : ''}
            </Text>
          </View>

          {/* Right */}
          <View style={fc.right}>
            <Text style={[fc.profit, { color: profitColor }]} numberOfLines={1}>
              {shownProfit >= 0 ? `+$${shownProfit}` : `-$${Math.abs(shownProfit)}`}
            </Text>
            <Text style={fc.profitSub}>{isSold ? 'realized' : 'est. profit'}</Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const fc = StyleSheet.create({
  wrapper:    { marginBottom: 10, borderRadius: 16, overflow: 'hidden' },
  deleteZone: { position: 'absolute', top: 0, bottom: 0, right: 0, width: DELETE_WIDTH, backgroundColor: MAROON, justifyContent: 'center', alignItems: 'center' },
  deleteBtn:  { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', gap: 4 },
  deleteText: { fontSize: 10, fontWeight: '700', color: CREAM },
  surface:    { backgroundColor: BG, borderRadius: 16 },
  card:       { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: CARD_B, padding: 12, gap: 12, shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
  thumbWrap:  { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B, position: 'relative' },
  thumb:      { width: 62, height: 62, backgroundColor: '#FFFEFA' },
  thumbFallback: { justifyContent: 'center', alignItems: 'center' },
  soldRibbon: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(42,74,42,0.92)', paddingVertical: 2, alignItems: 'center' },
  soldRibbonText: { fontSize: 8, fontWeight: '800', color: CREAM, letterSpacing: 1.2 },
  content:    { flex: 1, gap: 3, minWidth: 0 },
  name:       { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: FOREST },
  brand:      { fontSize: 11, color: MUTED, fontWeight: '600' },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingPill: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, maxWidth: 110 },
  ratingPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  passedPill:     { backgroundColor: '#F5E9E7', borderWidth: 1, borderColor: '#C08A80', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  passedPillText: { fontSize: 9, fontWeight: '800', color: MAROON, letterSpacing: 0.3 },
  date:       { fontSize: 10.5, color: MUTED },
  right:      { alignItems: 'flex-end', gap: 1, minWidth: 66 },
  profit:     { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800' },
  profitSub:  { fontSize: 9, color: MUTED, fontWeight: '600' },
});

// ─── Top flip card ────────────────────────────────────────────────────────────

function TopFlipCard({ item, rank, onPress }: { item: FlipResult; rank: number; onPress: () => void }) {
  const isSold = item.status === 'sold' && (item.soldPrice ?? 0) > 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [tf.card, rank === 1 && tf.cardFirst, pressed && { opacity: 0.88 }]}
    >
      <RankBadge rank={rank} />

      <View style={tf.thumbWrap}>
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={tf.thumb} contentFit="cover" />
        ) : (
          <View style={[tf.thumb, tf.thumbFallback]}>
            <MaterialIcons name="checkroom" size={20} color={MUTED} />
          </View>
        )}
      </View>

      <View style={tf.info}>
        <Text style={tf.name} numberOfLines={1}>{item.itemName}</Text>
        <Text style={tf.brand} numberOfLines={1}>{item.brand}</Text>
        <View style={tf.badgeRow}>
          <View style={tf.roiWrap}><Text style={tf.roi}>{item.roi}% ROI</Text></View>
          {isSold && <View style={tf.soldChip}><Text style={tf.soldChipText}>SOLD</Text></View>}
        </View>
      </View>

      <View style={tf.profitBlock}>
        <Text style={tf.profit}>+${item.profit}</Text>
        <Text style={tf.profitSub}>est. profit</Text>
      </View>
    </Pressable>
  );
}

const tf = StyleSheet.create({
  card:         { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: CARD_B, padding: 12, gap: 10, marginBottom: 10, shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
  cardFirst:    { borderColor: GOLD + '99', borderWidth: 1.5, shadowColor: GOLD, shadowOpacity: 0.2, shadowRadius: 8 },
  thumbWrap:    { borderRadius: 11, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B },
  thumb:        { width: 50, height: 50, backgroundColor: '#FFFEFA' },
  thumbFallback:{ justifyContent: 'center', alignItems: 'center' },
  info:         { flex: 1, gap: 3, minWidth: 0 },
  name:         { fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: '800', color: FOREST },
  brand:        { fontSize: 11, color: MUTED, fontWeight: '600' },
  badgeRow:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  roiWrap:      { flexDirection: 'row' },
  roi:          { fontSize: 10, fontWeight: '700', color: '#2A5A2A', backgroundColor: '#EFF6EC', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  soldChip:     { backgroundColor: FOREST, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  soldChipText: { fontSize: 8.5, fontWeight: '800', color: CREAM, letterSpacing: 0.8 },
  profitBlock:  { alignItems: 'flex-end', gap: 1 },
  profit:       { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: '#2A5A2A' },
  profitSub:    { fontSize: 9, color: MUTED, fontWeight: '600' },
});


// ─── Hunt Bundle Card ──────────────────────────────────────────────────────────

function HuntBundleCard({
  bundle, onPress, onDelete,
}: { bundle: HuntBundle; onPress: () => void; onDelete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOpen  = useRef(false);

  const snapOpen = () =>
    Animated.spring(translateX, { toValue: -DELETE_WIDTH, useNativeDriver: true, bounciness: 4 })
      .start(() => { swipeOpen.current = true; });
  const snapClosed = () =>
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 })
      .start(() => { swipeOpen.current = false; });

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = swipeOpen.current ? -DELETE_WIDTH : 0;
        translateX.setValue(Math.min(0, Math.max(-DELETE_WIDTH, base + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const base  = swipeOpen.current ? -DELETE_WIDTH : 0;
        const total = base + g.dx;
        total < -DELETE_WIDTH / 2 ? snapOpen() : snapClosed();
      },
      onPanResponderTerminate: () => snapClosed(),
    })
  ).current;

  const profitColor = bundle.totalEstimatedProfit >= 0 ? '#2A5A2A' : '#8A3A2A';
  const durationMin = Math.round(bundle.durationMs / 60000);
  const realized    = bundleRealized(bundle);

  return (
    <View style={hb.wrapper}>
      <View style={fc.deleteZone}>
        <Pressable
          style={fc.deleteBtn}
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            snapClosed();
            setTimeout(onDelete, 180);
          }}
        >
          <MaterialIcons name="delete-outline" size={22} color={CREAM} />
          <Text style={fc.deleteText}>Delete</Text>
        </Pressable>
      </View>
      <Animated.View style={[hb.surface, { transform: [{ translateX }] }]} {...pan.panHandlers}>
        <Pressable
          onPress={() => swipeOpen.current ? snapClosed() : onPress()}
          style={({ pressed }) => [hb.card, pressed && !swipeOpen.current && { opacity: 0.88 }]}
        >
          {/* Trophy icon — distinct from hunt-scan-icon.png */}
          <View style={hb.iconWrap}>
            <MaterialIcons name="emoji-events" size={30} color={GOLD} />
          </View>

          <View style={hb.info}>
            <View style={hb.titleRow}>
              <Text style={hb.bundgeLabel}>HUNT SESSION</Text>
            </View>
            <Text style={hb.title} numberOfLines={1}>{bundle.huntTitle}</Text>
            <View style={hb.metaRow}>
              <Text style={hb.meta}>{bundle.keptItemCount} kept</Text>
              <Text style={hb.metaDot}>·</Text>
              <Text style={hb.meta}>{durationMin}m</Text>
              <Text style={hb.metaDot}>·</Text>
              <Text style={hb.meta}>${bundle.totalCost.toFixed(2)} spent</Text>
            </View>
          </View>

          <View style={hb.profitBlock}>
            <Text style={[hb.profit, { color: profitColor }]}>
              {bundle.totalEstimatedProfit >= 0 ? '+' : ''}${Math.round(bundle.totalEstimatedProfit)}
            </Text>
            <Text style={hb.profitSub}>est. profit</Text>
          </View>

          {/* Realized only appears once a kept item is actually sold — an
              always-on "$0 realized" would read as a loss, not as no-data. */}
          {realized.count > 0 && (
            <>
              <View style={hb.profitDivider} />
              <View style={hb.profitBlock}>
                <Text style={[hb.profit, { color: realized.total >= 0 ? '#2A5A2A' : '#8A3A2A' }]}>
                  {realized.total >= 0 ? '+' : '-'}${Math.abs(realized.total)}
                </Text>
                <Text style={hb.profitSub}>realized</Text>
              </View>
            </>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const hb = StyleSheet.create({
  wrapper:    { marginBottom: 10, borderRadius: 16, overflow: 'hidden' },
  surface:    { backgroundColor: BG, borderRadius: 16 },
  card:       { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, borderWidth: 1.5, borderColor: GOLD + '66', padding: 12, gap: 10 },
  iconWrap:   { width: 52, height: 52, borderRadius: 13, backgroundColor: GOLD + '18', borderWidth: 1, borderColor: GOLD + '44', justifyContent: 'center', alignItems: 'center' },
  info:       { flex: 1, gap: 3, minWidth: 0 },
  titleRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bundgeLabel:{ fontSize: 8, fontWeight: '800', color: GOLD, letterSpacing: 1.2, backgroundColor: GOLD + '18', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  title:      { fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: '800', color: BROWN },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta:       { fontSize: 11, color: MUTED },
  metaDot:    { fontSize: 11, color: MUTED },
  profitBlock:{ alignItems: 'flex-end', gap: 1 },
  profitDivider:{ width: 1, alignSelf: 'stretch', marginVertical: 4, backgroundColor: GOLD + '44' },
  profit:     { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800' },
  profitSub:  { fontSize: 9, color: MUTED },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

type Tab = 'all' | 'top';

export default function HistoryScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  // ONLY source of truth — scan-context is NOT used here
  const { flips, removeFlip, globalStats } = useFlipStore();
  const { user } = useAuth();
  const { pruneUnseen } = useAchievementNotifications();

  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search,    setSearch]    = useState('');
  useScreenFocus('history_opened');

  // Impact context from the xp profile (values not derived from flips).
  const [impactCtx, setImpactCtx] = useState<ImpactContext>({
    completedHunts: 0, huntStreak: 0, huntBrands: [],
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      const uid = user?.id;
      if (!uid) { setImpactCtx({ completedHunts: 0, huntStreak: 0, huntBrands: [] }); return; }
      try {
        const { loadXpProfile } = await import('@/lib/huntXp');
        const xp = await loadXpProfile(uid).catch(() => null);
        if (alive) setImpactCtx({
          completedHunts: xp?.completedHunts ?? 0,
          huntStreak:     xp?.huntStreak ?? 0,
          huntBrands:     xp?.discoveredBrands ?? [],
        });
      } catch { /* defaults */ }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  // Pending impact-warning modal (only shown when a delete would remove progress).
  const [pendingDelete, setPendingDelete] = useState<DeletionImpact | null>(null);

  // All entries — most recent first, filtered by search (scans + hunt bundles)
  const allScans = useMemo(() => {
    const q = search.toLowerCase();
    return [...flips]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter(entry => {
        if (!q) return true;
        if (isHuntBundle(entry)) return entry.huntTitle.toLowerCase().includes(q);
        return entry.itemName.toLowerCase().includes(q) || entry.brand.toLowerCase().includes(q);
      });
  }, [flips, search]);

  // Top flips — highest profit first, only positive-profit items.
  // Kept hunt items rank here as individual finds, never as their bundle: a
  // bundle row in a "top flips" list tells the user nothing about which item
  // actually earned the money.
  const topFlips = useMemo(
    () => allScanFlips(flips).filter(f => f.profit > 0).sort((a, b) => b.profit - a.profit),
    [flips],
  );

  // Realized outcomes — derived from sold items (new outcome tracking).
  const realized = useMemo(() => {
    // Includes sold kept hunt items — the money is just as real, and excluding
    // it would make this figure disagree with the per-bundle realized totals.
    const sold = allScanFlips(flips).filter(
      f => f.status === 'sold' && (f.soldPrice ?? 0) > 0,
    );
    const total = sold.reduce((sum, f) => sum + realizedProfit(f), 0);
    return { count: sold.length, total };
  }, [flips]);

  const handlePress = (item: HistoryEntry) => {
    if (!navGuard()) return; // single-tap: ignore a second tap while the first screen loads
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isHuntBundle(item)) {
      router.push({ pathname: '/hunt-history' as any, params: { bundleId: item.id } });
    } else {
      router.push({ pathname: '/scan-detail' as any, params: { scanId: item.id } });
    }
  };

  /**
   * Top Flips can contain kept hunt items. Those are not top-level flips, so
   * scan-detail cannot find them by id — it needs the bundle coordinates.
   */
  const handleTopFlipPress = (item: SourcedFlip) => {
    if (!navGuard()) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (item.huntSource) {
      router.push({
        pathname: '/scan-detail' as any,
        params: {
          scanId:     item.id,
          bundleId:   item.huntSource.bundleId,
          huntItemId: item.huntSource.huntItemId,
        },
      });
      return;
    }
    router.push({ pathname: '/scan-detail' as any, params: { scanId: item.id } });
  };

  // The actual deletion + post-delete reconcile (prune badges, drop orphaned
  // remote rows). Achievements/brands/diamonds recompute from flips automatically.
  const performDelete = (id: string) => {
    const lost = getScanDeletionImpact(flips, id, impactCtx);
    trackAnalyticsEvent('scan_deleted', {
      scan_id: id,
      lost_achievements: lost.affectedAchievements.length,
      lost_brands:       lost.affectedBrands.length,
      lost_diamonds:     lost.affectedDiamonds.length,
    });
    removeFlip(id);

    // Final local truth after this deletion (achievements/brands/diamonds recompute
    // from flips automatically; this is the authoritative set).
    const after  = flips.filter(f => f.id !== id);
    const valid  = computeValidSets(after, impactCtx);

    // Prune stale unseen badges to what still exists.
    pruneUnseen(valid);

    // Signed-in: reconcile the cloud to local truth — delete remote achievement/
    // brand rows that no longer exist locally AND clean local seen/meta keys so a
    // future sync can't resurrect them. Fail-safe, fire-and-forget.
    // (Diamonds: local-only, no sync table yet.)
    const uid = user?.id;
    if (uid) {
      import('@/lib/achievementSync')
        .then(({ reconcileAchievementsToLocalTruth }) => reconcileAchievementsToLocalTruth(uid, valid.achievements))
        .catch(() => {});
      import('@/lib/brandSync')
        .then(({ reconcileBrandsToLocalTruth }) => reconcileBrandsToLocalTruth(uid, valid.brands))
        .catch(() => {});
      import('@/lib/diamondSync')
        .then(({ reconcileDiamondsToLocalTruth }) => reconcileDiamondsToLocalTruth(uid, valid.diamonds))
        .catch(() => {});
    }
  };

  const handleDelete = (id: string) => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    // Compute impact first. No progress impact → delete immediately (no popup).
    const impact = getScanDeletionImpact(flips, id, impactCtx);
    if (!impact.hasProgressImpact) {
      performDelete(id);
      return;
    }
    // Progress impact → show the serious warning modal.
    setPendingDelete(impact);
  };

  const EmptyState = ({ msg }: { msg: string }) => (
    <View style={s.emptyWrap}>
      <View style={s.emptyIconWrap}>
        <MaterialIcons name="inventory-2" size={34} color={GOLD} />
      </View>
      <Text style={s.emptyTitle}>Nothing here yet</Text>
      <Text style={s.emptySub}>{msg}</Text>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header — flat parchment, matches other tab screens ── */}
      <View style={s.header}>
        <Text style={s.headerBrand}>FlipStart</Text>
        <Text style={s.headerSub}>✦ SCAN HISTORY ✦</Text>
      </View>
      <View style={s.headerDivider} />

      {/* ── Tabs ── */}
      <View style={s.tabRow}>
        {(['all', 'top'] as Tab[]).map(tab => {
          const active = activeTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => {
                setActiveTab(tab);
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }}
              style={[s.tabBtn, active ? s.tabActive : s.tabInactive]}
            >
              <Text style={[s.tabText, active ? s.tabTextActive : s.tabTextInactive]}>
                {tab === 'all' ? 'All Scans' : 'Top Flips'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Content ── */}
      {activeTab === 'all' ? (
        <>
        {/* Pinned above the list, NOT a ListHeaderComponent: the stats and the
            search field stay on screen while only the rows scroll. */}
        <View style={s.pinnedHeader}>
              {/* Scan stats — est. profit + realized profit are the headliners */}
              <View style={s.statsCard}>
                <View style={s.statsAccent} />
                <View style={s.statsInner}>
                  <View style={s.statCol}>
                    <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                      {globalStats.totalProfit >= 0 ? '+' : '-'}${Math.abs(Math.round(globalStats.totalProfit))}
                    </Text>
                    <Text style={s.statLabel}>TOTAL EST. PROFIT</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statCol}>
                    <Text
                      style={[s.statValue, realized.count > 0 ? { color: realized.total >= 0 ? '#2A5A2A' : '#8A3A2A' } : { color: MUTED }]}
                      numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
                    >
                      {realized.count > 0
                        ? `${realized.total >= 0 ? '+' : '-'}$${Math.abs(realized.total)}`
                        : '—'}
                    </Text>
                    <Text style={s.statLabel}>
                      {realized.count > 0 ? `REALIZED · ${realized.count} SOLD` : 'REALIZED PROFIT'}
                    </Text>
                  </View>
                </View>
                <Text style={s.statsFooter}>
                  {globalStats.totalFlips} flip{globalStats.totalFlips !== 1 ? 's' : ''} · {globalStats.lifetimeRoi}% ROI · {globalStats.winRate}% win rate
                </Text>
              </View>

              {/* Search */}
              <View style={s.searchRow}>
                <View style={s.searchBar}>
                  <MaterialIcons name="search" size={18} color={MUTED} />
                  <TextInput
                    style={s.searchInput}
                    placeholder="Search scans..."
                    placeholderTextColor={MUTED}
                    value={search}
                    onChangeText={setSearch}
                    returnKeyType="search"
                  />
                  {search.length > 0 && (
                    <Pressable onPress={() => setSearch('')} hitSlop={8}>
                      <MaterialIcons name="close" size={16} color={MUTED} />
                    </Pressable>
                  )}
                </View>
              </View>

              <Text style={s.countLabel}>
                {allScans.length} entr{allScans.length !== 1 ? 'ies' : 'y'}
              </Text>
        </View>

        <FlatList
          data={allScans}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.listPinned}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            if (isHuntBundle(item)) {
              return <HuntBundleCard bundle={item as HuntBundle} onPress={() => handlePress(item)} onDelete={() => handleDelete(item.id)} />;
            }
            return <FlipCard item={item as FlipResult} onPress={() => handlePress(item)} onDelete={() => handleDelete(item.id)} />;
          }}
          ListEmptyComponent={
            <EmptyState msg={search ? 'No items match your search.' : 'Scan and confirm items to build your history.'} />
          }
        />
        </>
      ) : (
        <FlatList
          data={topFlips}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <Text style={s.countLabel}>
              {topFlips.length} flip{topFlips.length !== 1 ? 's' : ''}
            </Text>
          }
          renderItem={({ item, index }) => (
            <TopFlipCard
              item={item}
              rank={index + 1}
              onPress={() => handleTopFlipPress(item)}
            />
          )}
          ListEmptyComponent={
            <EmptyState msg="Your profitable flips will appear here." />
          }
        />
      )}

      <DeleteImpactModal
        visible={pendingDelete !== null}
        impact={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete?.scanId;
          setPendingDelete(null);
          if (id) performDelete(id);
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header:      { alignItems: 'center', gap: 2, backgroundColor: BG, paddingTop: 12, paddingBottom: 10, paddingHorizontal: 24 },
  headerBrand: { fontFamily: FONTS.serif, fontSize: 28, fontWeight: '800', color: FOREST },
  headerSub:   { fontSize: 10, fontWeight: '800', color: GOLD, letterSpacing: 2.4 },
  headerDivider:{ height: 1, backgroundColor: CARD_B },

  tabRow:        { flexDirection: 'row', marginHorizontal: 14, marginTop: 14, marginBottom: 4, backgroundColor: '#F4F1E8', borderRadius: 12, padding: 3, borderWidth: 1, borderColor: CARD_B },
  tabBtn:        { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive:     { backgroundColor: FOREST },
  tabInactive:   { backgroundColor: 'transparent' },
  tabText:       { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: CREAM },
  tabTextInactive:{ color: FOREST },

  list:          { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 40 },
  pinnedHeader:  { paddingHorizontal: 14, paddingTop: 12 },
  listPinned:    { paddingHorizontal: 14, paddingTop: 0, paddingBottom: 40 },
  countLabel:    { fontSize: 11, color: MUTED, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },

  statsCard:   { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: CARD_B, marginBottom: 14, overflow: 'hidden', shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.10, shadowRadius: 9, elevation: 3 },
  statsAccent: { height: 3, backgroundColor: GOLD },
  statsInner:  { flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 12, paddingHorizontal: 10 },
  statCol:     { flex: 1, alignItems: 'center', gap: 3, minWidth: 0 },
  statValue:   { fontFamily: FONTS.serif, fontSize: 27, fontWeight: '800', color: FOREST, letterSpacing: -0.5 },
  statLabel:   { fontSize: 9, fontWeight: '800', color: MUTED, letterSpacing: 1.1 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: CARD_B, marginVertical: 4 },
  statsFooter: { fontSize: 11.5, color: MUTED, textAlign: 'center', paddingBottom: 13, fontWeight: '600' },

  searchRow:     { flexDirection: 'row', marginBottom: 12 },
  searchBar:     { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: CARD_B, paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  searchInput:   { flex: 1, fontSize: 14, color: BROWN, padding: 0 },

  emptyWrap:     { alignItems: 'center', paddingTop: 56, gap: 8 },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: GOLD + '16', borderWidth: 1, borderColor: GOLD + '44', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle:    { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: FOREST },
  emptySub:      { fontSize: 13.5, color: MUTED, textAlign: 'center', maxWidth: 250 },
});