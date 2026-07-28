/**
 * app/hunt-history.tsx
 *
 * Hunt History Detail screen.
 * Opens when user taps a hunt bundle card in Scan History.
 *
 * Shows:
 *   - Hunt title + date
 *   - Stats summary (profit, ROI, cost, kept count, duration)
 *   - Kept Items section
 *   - Removed Items section
 *
 * Tapping an item navigates to analysis-details with source='hunt_history'
 * which shows Generate Listings — not Save to Hunt / Remove.
 */

import {
  View, Text, Pressable, StyleSheet, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { useFlipStore }                from '@/lib/useFlipStore';
import { isHuntBundle, HuntBundleItem } from '@/types/flip';
import { calculateFees } from '@/utils/flipCalculations';
import { FONTS }                        from '@/constants/typography';
import { logEvent }                     from '@/lib/analytics';
import { useEffect }                    from 'react';

// ─── Palette ──────────────────────────────────────────────────────────────────

const BG     = '#F0E8D4';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';
const RED    = '#8A2A1A';

// ─── Rating config (matches hunt-active RATING_CFG) ──────────────────────────

const RATING_COLORS: Record<string, { color: string; bg: string; border: string; emoji: string; label: string }> = {
  legendary: { color: '#D4A72C', bg: '#2A1E04', border: '#D4A72C', emoji: '👑', label: 'Legendary Loot' },
  treasure:  { color: '#BE9C2C', bg: '#221904', border: '#BE9C2CAA', emoji: '💰', label: 'Treasure' },
  risky:     { color: '#C89020', bg: '#221604', border: '#C8902088', emoji: '⚠️', label: 'Risky' },
  trash:     { color: '#FFDADA', bg: '#6B1414', border: '#E05555',   emoji: '✕',  label: 'Skip' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HuntHistoryScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { bundleId } = useLocalSearchParams<{ bundleId: string }>();
  const { flips }    = useFlipStore();

  const bundle = flips.find(f => isHuntBundle(f) && f.id === bundleId);

  useEffect(() => {
    if (bundle && isHuntBundle(bundle)) {
      logEvent('hunt_bundle_opened', {
        keptItemCount:    bundle.keptItemCount,
        removedItemCount: bundle.removedItemCount,
        durationMs:       bundle.durationMs,
        totalCost:        bundle.totalCost,
        totalEstimatedProfit: bundle.totalEstimatedProfit,
      });
    }
  }, [bundleId]);

  if (!bundle || !isHuntBundle(bundle)) {
    return (
      <View style={[s.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <MaterialIcons name="search-off" size={40} color={MUTED} />
        <Text style={s.notFoundText}>Hunt not found</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const profitColor = bundle.totalEstimatedProfit >= 0 ? '#2A6A2A' : '#8A2A2A';

  // Realized profit across kept items marked sold. Same fee model as a normal
  // flip so the number is comparable to everything else in the app. Recomputes
  // on every render, so marking an item sold updates this immediately on return.
  const soldKept = bundle.keptItems.filter(i => i.status === 'sold' && (i.soldPrice ?? 0) > 0);
  const realizedTotal = soldKept.reduce((sum, i) => {
    const sp = i.soldPrice ?? 0;
    return sum + Math.round(sp - calculateFees(sp) - (i.thriftPrice ?? 0));
  }, 0);

  /**
   * KEPT items open the full Flip Record — same screen a normal scan gets, with
   * working sold tracking. They stay nested in the bundle, so scan-detail is
   * given bundleId + huntItemId to resolve and write back through.
   *
   * REMOVED items keep going to Deep Analysis: they were passed on, so there is
   * no flip to record.
   */
  const handleKeptPress = (item: HuntBundleItem) => {
    logEvent('hunt_history_item_opened', {
      category:   item.category,
      huntRating: item.huntRating,
      destination: 'flip_record',
    });
    router.push({
      pathname: '/scan-detail' as any,
      params: {
        scanId:     item.scanId,
        bundleId:   bundle.id,
        huntItemId: item.huntItemId,
      },
    });
  };

  const handleItemPress = (item: HuntBundleItem) => {
    logEvent('hunt_history_item_opened', {
      category:   item.category,
      huntRating: item.huntRating,
    });
    // Convert ScanResult scanSnapshot into a FlipResult-compatible shape
    // so analysis-details can render market data, identification, etc.
    const snap = item.scanSnapshot;
    const flipLike = {
      id:              item.scanId,
      imageUri:        item.imageUri,
      timestamp:       bundle.endedAt,
      itemName:        snap.identification?.item_name  ?? item.itemName,
      brand:           snap.identification?.brand       ?? item.brand,
      category:        snap.identification?.category    ?? item.category,
      era:             snap.identification?.estimated_era ?? '',
      styleLabels:     snap.identification?.style_labels  ?? [],
      material:        snap.identification?.material_guess ?? '',
      resaleValue:     snap.market_data?.adjusted_estimated_value ?? 0,
      resaleRangeLow:  snap.market_data?.estimated_resale_range?.low  ?? 0,
      resaleRangeHigh: snap.market_data?.estimated_resale_range?.high ?? 0,
      avgSoldPrice:    snap.market_data?.average_sold_price ?? 0,
      demand:          snap.market_data?.demand        ?? 'Medium',
      sellSpeed:       snap.market_data?.sell_speed    ?? 'Moderate',
      competitionLevel:snap.market_data?.competition_level ?? '',
      matchConfidence: snap.risk_analysis?.match_confidence ?? 0,
      riskFlags:       snap.risk_analysis?.risk_flags   ?? [],
      thriftPrice:     item.thriftPrice,
      fees:            0,
      profit:          item.profit,
      roi:             item.thriftPrice > 0 ? Math.round((item.profit / item.thriftPrice) * 100) : 0,
      buyScore:        0,
      buyLabel:        '✅ BUY' as const,
      stars:           3,
      bestPlatform:    'eBay' as const,
      listingsGenerated: false,
      generatedAt:     null,
      listingData:     null,
    };
    router.push({
      pathname: '/analysis-details' as any,
      params: {
        scanId:   item.scanId,
        snapshot: JSON.stringify(flipLike),
        source:   'hunt_history',
      },
    });
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn}>
          <MaterialIcons name="arrow-back" size={22} color={BROWN} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerMode}>♦  HUNT HISTORY  ♦</Text>
          <Text style={s.headerTitle} numberOfLines={1}>{bundle.huntTitle}</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Date + duration subtitle ── */}
        <Text style={s.dateText}>{formatDate(bundle.endedAt)}</Text>

        {/* ── Stats summary card ── */}
        <View style={s.statsCard}>
          <View style={s.statsRow}>
            <StatCell label="Est. Profit"    value={`${bundle.totalEstimatedProfit >= 0 ? '+' : ''}$${Math.round(bundle.totalEstimatedProfit)}`} valueColor={profitColor} />
            <View style={s.statDivider} />
            <StatCell label="Est. ROI"       value={`${bundle.estimatedROI}%`} />
            <View style={s.statDivider} />
            <StatCell label="Total Cost"     value={`$${bundle.totalCost.toFixed(2)}`} />
          </View>
          <View style={[s.statsRow, { borderTopWidth: 1, borderTopColor: CARD_B }]}>
            <StatCell label="Items Kept"     value={String(bundle.keptItemCount)} />
            <View style={s.statDivider} />
            <StatCell label="Items Removed"  value={String(bundle.removedItemCount)} />
            <View style={s.statDivider} />
            <StatCell label="Duration"       value={formatDuration(bundle.durationMs)} />
          </View>
        </View>

        {/* ── Realized profit ── full width, only once something has sold.
            Hidden until then: "$0 realized" on an unsold hunt reads as a loss. */}
        {soldKept.length > 0 && (
          <View style={s.realizedBar}>
            <View style={s.realizedRow}>
              <Text style={s.realizedLabel}>REALIZED PROFIT</Text>
              <Text style={[s.realizedValue, { color: realizedTotal >= 0 ? '#2A6A2A' : '#8A2A2A' }]}>
                {realizedTotal >= 0 ? '+' : '-'}${Math.abs(realizedTotal)}
              </Text>
            </View>
            <Text style={s.realizedSub}>
              {soldKept.length} of {bundle.keptItems.length} kept item{bundle.keptItems.length !== 1 ? 's' : ''} sold
            </Text>
          </View>
        )}

        {/* ── Kept items ── */}
        {bundle.keptItems.length > 0 && (
          <>
            <Text style={s.sectionLabel}>KEPT ITEMS · {bundle.keptItems.length}</Text>
            {bundle.keptItems.map(item => (
              <HuntItemRow key={item.huntItemId} item={item} onPress={() => handleKeptPress(item)} />
            ))}
          </>
        )}

        {/* ── Removed items ── */}
        {bundle.removedItems.length > 0 && (
          <>
            <Text style={s.sectionLabel}>REMOVED ITEMS · {bundle.removedItems.length}</Text>
            {bundle.removedItems.map(item => (
              <HuntItemRow key={item.huntItemId} item={item} onPress={() => handleItemPress(item)} />
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function StatCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.statCell}>
      <Text style={[s.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Hunt item row ────────────────────────────────────────────────────────────

function HuntItemRow({ item, onPress }: { item: HuntBundleItem; onPress: () => void }) {
  const cfg         = RATING_COLORS[item.huntRating] ?? RATING_COLORS.trash;
  const profitColor = item.profit > 0 ? '#2A6A2A' : '#8A2A2A';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [r.card, pressed && { opacity: 0.80 }]}
    >
      <View style={r.imgWrap}>
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={r.img} contentFit="cover" />
        ) : (
          <View style={[r.img, r.imgFallback]}>
            <MaterialIcons name="checkroom" size={18} color={MUTED} />
          </View>
        )}
      </View>

      <View style={r.info}>
        <Text style={r.name} numberOfLines={1}>{item.itemName}</Text>
        <Text style={r.meta} numberOfLines={1}>{[item.brand, item.category].filter(Boolean).join(' · ')}</Text>
        <View style={[r.ratingPill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
          <Text style={r.ratingEmoji}>{cfg.emoji}</Text>
          <Text style={[r.ratingLabel, { color: cfg.color }]}>{cfg.label.toUpperCase()}</Text>
        </View>
      </View>

      <View style={r.right}>
        {item.thriftPrice > 0 && (
          <Text style={r.cost}>-${item.thriftPrice.toFixed(2)}</Text>
        )}
        <Text style={[r.profit, { color: profitColor }]}>
          {item.profit >= 0 ? '+' : ''}${item.profit}
        </Text>
        <MaterialIcons name="chevron-right" size={16} color={MUTED} />
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CARD_B },
  headerBtn:    { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: CARD_B + '50' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 1 },
  headerMode:   { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: BROWN },
  scroll:       { padding: 16, gap: 12 },
  dateText:     { fontSize: 12, color: MUTED, textAlign: 'center', marginBottom: 4 },

  statsCard:    { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: CARD_B, overflow: 'hidden', marginBottom: 4 },
  statsRow:     { flexDirection: 'row' },
  statDivider:  { width: 1, backgroundColor: CARD_B },
  statCell:     { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },
  statValue:    { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: BROWN },
  statLabel:    { fontSize: 9, fontWeight: '700', color: MUTED, letterSpacing: 0.5 },

  realizedBar:   { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: CARD_B, paddingHorizontal: 14, paddingVertical: 12, marginTop: 10, gap: 3 },
  realizedRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  realizedLabel: { fontSize: 10, fontWeight: '800', color: BROWN, letterSpacing: 1.1 },
  realizedValue: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800' },
  realizedSub:   { fontSize: 10.5, color: MUTED },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: MUTED, letterSpacing: 1.4, marginTop: 8, marginBottom: 6 },

  notFoundText: { fontFamily: FONTS.serif, fontSize: 17, color: BROWN, marginTop: 12, marginBottom: 20 },
  backBtn:      { backgroundColor: BROWN, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  backBtnText:  { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: CREAM },
});

const r = StyleSheet.create({
  card:       { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: CARD_B, padding: 12, gap: 10, marginBottom: 8 },
  imgWrap:    { borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B },
  img:        { width: 52, height: 52 },
  imgFallback:{ backgroundColor: CARD_B, justifyContent: 'center', alignItems: 'center' },
  info:       { flex: 1, gap: 3 },
  name:       { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700', color: BROWN },
  meta:       { fontSize: 11, color: MUTED },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  ratingEmoji:{ fontSize: 9 },
  ratingLabel:{ fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  right:      { alignItems: 'flex-end', gap: 2 },
  cost:       { fontSize: 11, color: MUTED },
  profit:     { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800' },
});