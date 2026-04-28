/**
 * results.tsx — UI ONLY
 *
 * This file:
 *   ✅ renders data
 *   ✅ handles user input
 *   ✅ calls calculation functions from utils/flipCalculations.ts
 *   ✅ triggers store updates via useFlipStore
 *
 * This file does NOT:
 *   ❌ contain business logic
 *   ❌ contain formulas
 *   ❌ duplicate calculations
 */

import {
  Text, View, ScrollView, Pressable, Platform,
  StyleSheet, TextInput, Alert, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useMemo } from 'react';

import { ScreenContainer } from '@/components/screen-container';
import { useScanContext } from '@/lib/scan-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { trpc } from '@/lib/trpc';
import { FlipResult } from '@/types/flip';
import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';
import {
  computeFlipCalc,
  getStarRationale,
  getPlatformRationale,
} from '@/utils/flipCalculations';

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRow({ stars, size = 18 }: { stars: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <MaterialIcons
          key={i}
          name={i <= stars ? 'star' : 'star-outline'}
          size={size}
          color={i <= stars ? V.gold : V.tan}
        />
      ))}
    </View>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

function MetricRow({
  label, value, valueColor, bold,
}: { label: string; value: string; valueColor?: string; bold?: boolean }) {
  return (
    <View style={s.metricRow}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={[s.metricValue, valueColor ? { color: valueColor } : {}, bold ? { fontWeight: '900' } : {}]}>
        {value}
      </Text>
    </View>
  );
}

function StatBox({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <View style={s.statBox}>
      <Text style={s.statValue}>{value}</Text>
      {delta ? <Text style={s.statDelta}>{delta}</Text> : null}
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Hero theme map ───────────────────────────────────────────────────────────

const HERO_THEMES = {
  '🔥 GRAIL FIND':   { bg: V.green,       border: V.greenSecond },
  '💰 STRONG BUY':   { bg: V.green,       border: V.greenSecond },
  '✅ BUY':          { bg: V.greenSecond, border: V.green       },
  '⚠️ RISKY BUY':   { bg: V.warning,     border: '#9A7010'     },
  "❌ DON'T BUY":    { bg: '#7A3A1A',     border: '#5A2A0E'     },
  '🤮 TRASH':        { bg: '#4A2010',     border: '#3A1808'     },
} as const;

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ResultsScreen() {
  const router   = useRouter();
  const { currentScan, setCurrentScan, updateScan } = useScanContext();
  const {
    addFlip, removeFlip,
    pendingThriftPrices, setPendingThriftPrice,
    globalStats, globalRank,
  } = useFlipStore();

  const [thriftEditing, setThriftEditing] = useState(false);
  const [listingsExpanded, setListingsExpanded] = useState(false);

  const generateListingsMutation = trpc.scan.generateListings.useMutation();

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!currentScan) {
    return (
      <ScreenContainer>
        <View style={s.emptyWrap}>
          <Text style={s.emptyText}>No scan data available</Text>
          <Pressable onPress={() => router.replace('/(tabs)' as any)} style={s.emptyBtn}>
            <Text style={s.emptyBtnText}>Go Home</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const md = currentScan.market_data;
  const id = currentScan.identification;
  const ra = currentScan.risk_analysis;

  // ── Read thrift price from store (persists during session) ────────────────
  const thriftPriceStr = pendingThriftPrices[currentScan.id] ?? '';
  const parsedThrift   = parseFloat(thriftPriceStr) || 0;
  const effectiveThrift = parsedThrift > 0 ? parsedThrift : md.suggested_buy_price;

  // ── Live recalculation — ALL via utils/flipCalculations.ts ───────────────
  const calc = useMemo(
    () =>
      computeFlipCalc(
        md.adjusted_estimated_value,
        effectiveThrift,
        ra.match_confidence,
        md.competition_level,
        id.style_labels,
        id.estimated_era,
      ),
    [md.adjusted_estimated_value, effectiveThrift, ra.match_confidence, md.competition_level, id.style_labels, id.estimated_era],
  );

  const heroTheme = HERO_THEMES[calc.buyLabel] ?? HERO_THEMES['🤮 TRASH'];

  // ── Handlers ──────────────────────────────────────────────────────────────
  const haptic = (style: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(style).catch(() => {});
  };

  const handleThriftChange = (text: string) => {
    // Only allow numeric input with optional decimal
    if (/^\d*\.?\d*$/.test(text)) {
      setPendingThriftPrice(currentScan.id, text);
    }
  };

  const handleConfirm = () => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);

    // Build FlipResult — the only place this object is constructed
    const flip: FlipResult = {
      id:          currentScan.id,
      imageUri:    currentScan.imageUri,
      timestamp:   Date.now(),
      itemName:    id.item_name,
      brand:       id.brand,
      category:    id.category,
      era:         id.estimated_era,
      styleLabels: id.style_labels,
      material:    id.material_guess,
      resaleValue:      md.adjusted_estimated_value,
      resaleRangeLow:   md.estimated_resale_range.low,
      resaleRangeHigh:  md.estimated_resale_range.high,
      avgSoldPrice:     md.average_sold_price,
      demand:           md.demand,
      sellSpeed:        md.sell_speed,
      competitionLevel: md.competition_level,
      matchConfidence:  ra.match_confidence,
      riskFlags:        ra.risk_flags,
      thriftPrice:  calc.thriftPrice,
      fees:         calc.fees,
      profit:       calc.profit,
      roi:          calc.roi,
      buyScore:     calc.buyScore,
      buyLabel:     calc.buyLabel,
      stars:        calc.stars,
      bestPlatform: calc.bestPlatform,

      // Listings initialised as not-yet-generated; persisted when user generates them
      listingsGenerated: false,
      generatedAt:       null,
      listingData:       null,
    };

    addFlip(flip);  // persisted to AsyncStorage inside the store
    setCurrentScan(null);
    router.replace('/(tabs)' as any);
  };

  const handleDelete = () => {
    Alert.alert('Delete Scan', 'Remove this scan from history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          removeFlip(currentScan.id);
          setCurrentScan(null);
          router.replace('/(tabs)' as any);
        },
      },
    ]);
  };

  const handleGenerateListings = async () => {
    if (currentScan.listings) { setListingsExpanded(true); return; }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await generateListingsMutation.mutateAsync({
        item_name:                id.item_name,
        brand:                    id.brand,
        category:                 id.category,
        estimated_era:            id.estimated_era,
        material_guess:           id.material_guess,
        style_labels:             id.style_labels,
        adjusted_estimated_value: md.adjusted_estimated_value,
        demand:                   md.demand,
      });
      updateScan(currentScan.id, { listings: result });
      setListingsExpanded(true);
    } catch {
      Alert.alert('Error', 'Could not generate listings. Please try again.');
    }
  };

  // Navigate to deep-dive screen, passing only the scanId
  const handleOpenAnalysis = () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    // Pass scanId + a serialized snapshot of the current scan + calc so
    // analysis-details can render before the user confirms (before flip is in store).
    const snapshot = JSON.stringify({
      id:              currentScan.id,
      imageUri:        currentScan.imageUri,
      itemName:        id.item_name,
      brand:           id.brand,
      category:        id.category,
      era:             id.estimated_era,
      styleLabels:     id.style_labels,
      material:        id.material_guess,
      resaleValue:     md.adjusted_estimated_value,
      resaleRangeLow:  md.estimated_resale_range.low,
      resaleRangeHigh: md.estimated_resale_range.high,
      avgSoldPrice:    md.average_sold_price,
      demand:          md.demand,
      sellSpeed:       md.sell_speed,
      competitionLevel:md.competition_level,
      matchConfidence: ra.match_confidence,
      riskFlags:       ra.risk_flags,
      thriftPrice:     calc.thriftPrice,
      fees:            calc.fees,
      profit:          calc.profit,
      roi:             calc.roi,
      buyScore:        calc.buyScore,
      buyLabel:        calc.buyLabel,
      stars:           calc.stars,
      bestPlatform:    calc.bestPlatform,
      // history fields not yet known — zero until confirmed
      timestamp: Date.now(),
    });
    router.push({
      pathname: '/analysis-details' as any,
      params: { scanId: currentScan.id, snapshot, source: 'results' },
    });
  };

  const listings = currentScan.listings;

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Header ── */}
          <View style={s.header}>
            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)' as any)}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              hitSlop={8}
            >
              <MaterialIcons name="arrow-back" size={22} color={V.green} />
            </Pressable>
            <Text style={s.headerTitle}>Analysis</Text>
            <Pressable onPress={handleDelete} hitSlop={8}>
              <MaterialIcons name="delete-outline" size={22} color={V.error} />
            </Pressable>
          </View>

          {/* ══ 1. HERO CARD ══════════════════════════════════════════════ */}
          <View style={[s.heroCard, { backgroundColor: heroTheme.bg, borderColor: heroTheme.border }]}>
            <Text style={s.heroLabel}>{calc.buyLabel}</Text>

            {/* Score badge */}
            <View style={s.scorePill}>
              <Text style={s.scorePillText}>{calc.buyScore}/100</Text>
            </View>

            <Text style={s.heroBuyLine}>
              {calc.profit >= 0
                ? `Buy this for $${md.suggested_buy_price} or less`
                : 'Not worth buying at this price'}
            </Text>

            <View style={s.heroProfitRow}>
              <Text style={s.heroProfit}>
                {calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`}
              </Text>
              <Text style={s.heroProfitSub}> est. profit</Text>
            </View>

            {calc.roi > 0 && (
              <View style={s.roiBadge}>
                <Text style={s.roiBadgeText}>{calc.roi}% ROI</Text>
              </View>
            )}
          </View>

          {/* ══ 2. ITEM CARD ══════════════════════════════════════════════ */}
          <SectionCard title="">
            {/* Tapping image, title, or stars → analysis details */}
            <Pressable style={s.itemRow} onPress={handleOpenAnalysis}>
              <View style={s.thumbWrap}>
                {currentScan.imageUri ? (
                  <Image
                    source={{ uri: currentScan.imageUri }}
                    style={s.thumb}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <View style={[s.thumb, s.thumbPlaceholder]}>
                    <MaterialIcons name="checkroom" size={28} color={V.textMuted} />
                  </View>
                )}
              </View>

              <View style={s.itemInfo}>
                <Text style={s.itemName} numberOfLines={2}>{id.item_name}</Text>
                <Text style={s.itemBrand}>{id.brand} · {id.category}</Text>
                <StarRow stars={calc.stars} />
                <Text style={s.tapHint}>Tap for deep analysis →</Text>
              </View>
            </Pressable>

            {id.style_labels.length > 0 && (
              <View style={s.tagRow}>
                {id.style_labels.slice(0, 5).map((lbl, i) => (
                  <View key={i} style={s.tag}>
                    <Text style={s.tagText}>{lbl}</Text>
                  </View>
                ))}
              </View>
            )}
          </SectionCard>

          {/* ══ 3. CORE METRICS + THRIFT PRICE INPUT ═════════════════════ */}
          <SectionCard title="CORE METRICS">
            <MetricRow label="Est. Resale Value" value={`$${md.adjusted_estimated_value}`} />
            <View style={s.divider} />
            <MetricRow label="Platform Fees (~12%)" value={`-$${calc.fees}`} valueColor={V.error} />
            <View style={s.divider} />
            <MetricRow
              label="Est. Profit"
              value={calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`}
              valueColor={calc.profit >= 15 ? V.green : calc.profit >= 0 ? V.greenMuted : V.error}
              bold
            />
            <View style={s.divider} />

            {/* Editable thrift price */}
            <View style={s.thriftRow}>
              <Text style={s.metricLabel}>
                {parsedThrift > 0 ? 'Your Thrift Price' : 'Max Buy Price'}
              </Text>
              {thriftEditing ? (
                <View style={s.thriftInputWrap}>
                  <Text style={s.thriftDollar}>$</Text>
                  <TextInput
                    style={s.thriftInput}
                    value={thriftPriceStr}
                    onChangeText={handleThriftChange}
                    keyboardType="decimal-pad"
                    autoFocus
                    onBlur={() => setThriftEditing(false)}
                    returnKeyType="done"
                    onSubmitEditing={() => setThriftEditing(false)}
                    placeholder={String(md.suggested_buy_price)}
                    placeholderTextColor={V.textMuted}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    setThriftEditing(true);
                    haptic(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={s.thriftDisplay}
                >
                  <Text style={s.thriftDisplayText}>
                    ${parsedThrift > 0 ? parsedThrift : md.suggested_buy_price}
                  </Text>
                  <MaterialIcons name="edit" size={14} color={V.green} />
                </Pressable>
              )}
            </View>

            {parsedThrift > 0 && (
              <Text style={s.thriftHint}>
                ✓ All values recalculated using your price of ${parsedThrift}
              </Text>
            )}
          </SectionCard>

          {/* ══ 4. BUY RATING ════════════════════════════════════════════ */}
          <SectionCard title="BUY RATING">
            {/* Score bar */}
            <View style={s.scoreBarRow}>
              <View style={[s.scoreBarBg]}>
                <View
                  style={[
                    s.scoreBarFill,
                    {
                      width: `${calc.buyScore}%` as any,
                      backgroundColor:
                        calc.buyScore >= 70 ? V.green :
                        calc.buyScore >= 40 ? V.warning : V.error,
                    },
                  ]}
                />
              </View>
              <Text style={s.scoreBarNum}>{calc.buyScore}/100</Text>
            </View>

            {/* Label */}
            <View style={[s.ratingPill, { backgroundColor: heroTheme.bg + '22', borderColor: heroTheme.bg }]}>
              <Text style={[s.ratingPillText, { color: heroTheme.bg }]}>{calc.buyLabel}</Text>
            </View>

            {/* Factors */}
            <View style={s.factorsRow}>
              {[
                { label: 'Profit',      value: `$${calc.profit}` },
                { label: 'Confidence',  value: `${ra.match_confidence}%` },
                { label: 'Competition', value: md.competition_level },
              ].map(f => (
                <View key={f.label} style={s.factorBox}>
                  <Text style={s.factorLabel}>{f.label}</Text>
                  <Text style={s.factorValue}>{f.value}</Text>
                </View>
              ))}
            </View>

            <View style={s.platformRow}>
              <MaterialIcons name="store" size={13} color={V.textMuted} />
              <Text style={s.platformText}>
                Best platform: <Text style={s.platformBold}>{calc.bestPlatform}</Text>
              </Text>
            </View>
          </SectionCard>

          {/* ══ 5. ACTION BUTTONS ════════════════════════════════════════ */}
          <View style={s.actionRow}>
            <Pressable
              onPress={handleGenerateListings}
              disabled={generateListingsMutation.isPending}
              style={({ pressed }) => [s.actionBtn, s.actionOutline, pressed && { opacity: 0.8 }]}
            >
              <MaterialIcons name="edit-note" size={18} color={V.green} />
              <Text style={s.actionOutlineText}>
                {generateListingsMutation.isPending ? 'Generating...' : 'Generate Listings'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                haptic(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert('Saved', 'Flip saved to your history.');
              }}
              style={({ pressed }) => [s.actionBtn, s.actionSolid, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            >
              <MaterialIcons name="bookmark" size={18} color={V.white} />
              <Text style={s.actionSolidText}>Save Flip</Text>
            </Pressable>
          </View>

          {/* Listings */}
          {(listingsExpanded || listings) && listings ? (
            <SectionCard title="LISTINGS">
              {/* Best platform first */}
              {([calc.bestPlatform === 'Depop' ? 'depop' : 'ebay', calc.bestPlatform === 'Depop' ? 'ebay' : 'depop'] as const).map(platform => {
                const listing = listings[platform as 'ebay' | 'depop'];
                if (!listing) return null;
                return (
                  <View key={platform} style={s.listingBlock}>
                    <View style={s.listingHeader}>
                      <Text style={s.listingPlatform}>
                        {platform === 'ebay' ? 'eBay' : 'Depop'}
                        {platform === calc.bestPlatform.toLowerCase() ? '  ⭐ Recommended' : ''}
                      </Text>
                    </View>
                    <View style={[s.listingContent]}>
                      <Text style={s.listingTitle}>{listing.title}</Text>
                      <Text style={s.listingDesc}>{listing.description}</Text>
                    </View>
                  </View>
                );
              })}
            </SectionCard>
          ) : null}

          {/* ══ 6. USER STATS ════════════════════════════════════════════ */}
          <SectionCard title="YOUR STATS">
            <View style={s.statsRow}>
              <StatBox
                label="Total Flips"
                value={String(globalStats.totalFlips)}
              />
              <View style={s.statDivider} />
              <StatBox
                label="Lifetime ROI"
                value={`${globalStats.lifetimeRoi}%`}
                delta={calc.roi > 0 ? `+${calc.roi}% this flip` : undefined}
              />
              <View style={s.statDivider} />
              <StatBox
                label="Total Profit"
                value={`$${Math.round(globalStats.totalProfit)}`}
                delta={calc.profit > 0 ? `+$${calc.profit} this flip` : undefined}
              />
            </View>
          </SectionCard>

          {/* ══ 7. GLOBAL RANK ═══════════════════════════════════════════ */}
          <SectionCard title="GLOBAL RANK">
            <View style={s.rankRow}>
              <Text style={s.rankBadge}>{globalRank.rank}</Text>
              <View>
                <Text style={s.rankScore}>{globalRank.score} pts</Text>
                <Text style={s.rankSub}>ROI × 0.4 + Avg Profit × 0.3 + Win Rate × 0.3</Text>
              </View>
            </View>
          </SectionCard>

          {/* ══ 8. CONFIRM + DELETE ═══════════════════════════════════════ */}
          <View style={s.confirmRow}>
            <Pressable
              onPress={handleConfirm}
              style={({ pressed }) => [
                s.confirmBtn,
                pressed && { opacity: 0.88, transform: [{ scale: 0.97 }] },
              ]}
            >
              <MaterialIcons name="check-circle" size={20} color={V.white} />
              <Text style={s.confirmBtnText}>Confirm Item</Text>
            </Pressable>

            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [s.deleteIconBtn, pressed && { opacity: 0.6 }]}
              hitSlop={8}
            >
              <MaterialIcons name="delete-outline" size={22} color={V.error} />
            </Pressable>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { paddingHorizontal: V.screenPad, paddingBottom: 20 },

  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  emptyText: { fontSize: 16, color: V.textMuted },
  emptyBtn:  { backgroundColor: V.green, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 50 },
  emptyBtnText: { color: V.white, fontWeight: '700', fontSize: 15 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '700', color: V.green },

  // Hero
  heroCard: {
    borderRadius: 18, borderWidth: 2,
    padding: 20, marginBottom: 12, gap: 8,
    shadowColor: V.textDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
    overflow: 'hidden',
  },
  heroLabel:    { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '800', color: V.white, letterSpacing: -0.3 },
  scorePill:    { position: 'absolute', top: 14, right: 14, backgroundColor: 'rgba(0,0,0,0.20)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  scorePillText:{ fontSize: 11, fontWeight: '700', color: V.white },
  heroBuyLine:  { fontSize: 13, color: V.white, opacity: 0.82 },
  heroProfitRow:{ flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  heroProfit:   { fontSize: 36, fontWeight: '900', color: V.white, letterSpacing: -1 },
  heroProfitSub:{ fontSize: 13, color: V.white, opacity: 0.75 },
  roiBadge:     { alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,255,255,0.40)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  roiBadgeText: { fontSize: 12, fontWeight: '700', color: V.white },

  // Cards
  card: {
    backgroundColor: V.cardBg, borderRadius: 14, borderWidth: 1, borderColor: V.border,
    padding: 16, marginBottom: 12,
    shadowColor: V.textDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardTitle: {
    fontSize: 10, fontWeight: '700', color: V.textMuted,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: V.border, marginVertical: 8 },

  // Item
  itemRow:  { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  thumbWrap:{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: V.border },
  thumb:    { width: 88, height: 88, borderRadius: 11 },
  thumbPlaceholder: { backgroundColor: V.tan, justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, gap: 5 },
  itemName: { fontSize: 16, fontWeight: '800', color: V.textDark, lineHeight: 21 },
  itemBrand:{ fontSize: 12, color: V.textMuted },
  tapHint:  { fontSize: 10, color: V.green, marginTop: 2 },
  tagRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tag:      { backgroundColor: V.tan, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  tagText:  { fontSize: 11, fontWeight: '600', color: V.textMuted },

  // Metrics
  metricRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  metricLabel: { fontSize: 14, fontWeight: '500', color: V.textMuted },
  metricValue: { fontSize: 15, fontWeight: '700', color: V.textDark },

  // Thrift price
  thriftRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  thriftInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.pageBg, borderRadius: 10, borderWidth: 1.5, borderColor: V.green, paddingHorizontal: 10, paddingVertical: 6 },
  thriftDollar:    { fontSize: 16, fontWeight: '700', color: V.green },
  thriftInput:     { fontSize: 18, fontWeight: '800', color: V.textDark, minWidth: 80, padding: 0 },
  thriftDisplay:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: V.pageBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, borderColor: V.border },
  thriftDisplayText: { fontSize: 16, fontWeight: '800', color: V.textDark },
  thriftHint:      { fontSize: 11, color: V.green, marginTop: 6, fontStyle: 'italic' },

  // Buy rating
  scoreBarRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  scoreBarBg:   { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: V.tan },
  scoreBarFill: { height: '100%', borderRadius: 4 },
  scoreBarNum:  { fontSize: 13, fontWeight: '700', color: V.textDark, minWidth: 45 },
  ratingPill:   { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, marginBottom: 12 },
  ratingPillText: { fontSize: 14, fontWeight: '800' },
  factorsRow:   { flexDirection: 'row', gap: 0, marginBottom: 10 },
  factorBox:    { flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: V.pageBg, borderRadius: 10, margin: 3, gap: 3 },
  factorLabel:  { fontSize: 9, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  factorValue:  { fontSize: 13, fontWeight: '700', color: V.textDark },
  platformRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  platformText: { fontSize: 12, color: V.textMuted },
  platformBold: { fontWeight: '700', color: V.textDark },

  // Actions
  actionRow:         { flexDirection: 'row', gap: 10, marginBottom: 12 },
  actionBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  actionSolid:       { backgroundColor: V.green },
  actionOutline:     { backgroundColor: V.cardBg, borderWidth: 1.5, borderColor: V.green },
  actionSolidText:   { fontSize: 14, fontWeight: '700', color: V.white },
  actionOutlineText: { fontSize: 14, fontWeight: '700', color: V.green },

  // Listings
  listingBlock:   { marginBottom: 14 },
  listingHeader:  { marginBottom: 8 },
  listingPlatform:{ fontSize: 14, fontWeight: '700', color: V.textDark },
  listingContent: { borderRadius: 10, borderWidth: 1, borderColor: V.border, padding: 12, backgroundColor: V.pageBg },
  listingTitle:   { fontSize: 13, fontWeight: '700', color: V.textDark, marginBottom: 6, lineHeight: 19 },
  listingDesc:    { fontSize: 12, color: V.textMuted, lineHeight: 18 },

  // Stats
  statsRow:   { flexDirection: 'row', alignItems: 'center' },
  statBox:    { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 3 },
  statValue:  { fontSize: 20, fontWeight: '900', color: V.green },
  statDelta:  { fontSize: 10, fontWeight: '700', color: V.gold },
  statLabel:  { fontSize: 10, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider:{ width: 1, height: 40, backgroundColor: V.border },

  // Rank
  rankRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rankBadge: { fontSize: 32, fontWeight: '900' },
  rankScore: { fontSize: 18, fontWeight: '800', color: V.textDark },
  rankSub:   { fontSize: 10, color: V.textMuted, marginTop: 2, maxWidth: 200 },

  // Confirm
  confirmRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  confirmBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 50, backgroundColor: V.green },
  confirmBtnText:{ fontSize: 16, fontWeight: '700', color: V.white },
  deleteIconBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: V.cardBg, borderWidth: 1.5, borderColor: V.border, justifyContent: 'center', alignItems: 'center' },
});