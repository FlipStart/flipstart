/**
 * analysis-details.tsx — Deep Analysis Screen
 *
 * Opens from two contexts, detected via `source` route param:
 *
 *   source = 'results'  → opened from fresh results flow.
 *                          Read-only analysis. Thrift price editing happens
 *                          on the results screen itself.
 *
 *   source = 'history'  → opened from scan history.
 *                          Full action mode:
 *                            • editable thrift price (recalculates live)
 *                            • generate / view listings
 *                            • updates persisted flip in useFlipStore
 *
 * Data resolution order:
 *   1. useFlipStore.getFlipById(scanId)   ← confirmed flip (always preferred)
 *   2. JSON.parse(snapshot param)         ← pre-confirm fallback (results flow)
 *
 * NO calculations happen here — all derived values come from
 * utils/flipCalculations.ts via computeFlipCalc().
 */

import {
  Text, View, ScrollView, Pressable, Platform,
  StyleSheet, TextInput, Alert, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useMemo } from 'react';

import { ScreenContainer } from '@/components/screen-container';
import { useFlipStore } from '@/lib/useFlipStore';
import { trpc } from '@/lib/trpc';
import { FlipResult, ListingData } from '@/types/flip';
import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';
import {
  computeFlipCalc,
  getStarRationale,
  getPlatformRationale,
} from '@/utils/flipCalculations';

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={d.section}>
      <Text style={d.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DataRow({
  label, value, valueColor,
}: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={d.dataRow}>
      <Text style={d.dataLabel}>{label}</Text>
      <Text style={[d.dataValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={d.bullet}>
      <Text style={d.bulletDot}>·</Text>
      <Text style={d.bulletText}>{text}</Text>
    </View>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 75 ? V.green : value >= 50 ? V.warning : V.error;
  return (
    <View style={d.barRow}>
      <View style={d.barBg}>
        <View style={[d.barFill, { width: `${value}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[d.barLabel, { color }]}>{value}%</Text>
    </View>
  );
}

function StarRow({ stars }: { stars: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1,2,3,4,5].map(i => (
        <MaterialIcons
          key={i}
          name={i <= stars ? 'star' : 'star-outline'}
          size={20}
          color={i <= stars ? V.gold : V.tan}
        />
      ))}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AnalysisDetailsScreen() {
  const router = useRouter();
  const { scanId, snapshot, source } = useLocalSearchParams<{
    scanId:    string;
    snapshot?: string;
    source?:   'results' | 'history';
  }>();

  const { getFlipById, updateFlip } = useFlipStore();
  const generateListingsMutation = trpc.scan.generateListings.useMutation();

  // ── Data resolution ────────────────────────────────────────────────────────
  const storedFlip = scanId ? getFlipById(scanId) : undefined;
  const baseFlip: FlipResult | undefined = storedFlip ?? (snapshot ? (() => {
    try { return JSON.parse(snapshot) as FlipResult; } catch { return undefined; }
  })() : undefined);

  // Determine context
  const isHistory = source === 'history' || (!!storedFlip && source !== 'results');

  // ── Local state (history mode only) ───────────────────────────────────────
  const [thriftStr,    setThriftStr]    = useState(
    isHistory && baseFlip ? String(baseFlip.thriftPrice) : '',
  );
  const [thriftEditing, setThriftEditing] = useState(false);
  const [listingsOpen,  setListingsOpen]  = useState(false);

  const haptic = (s: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(s).catch(() => {});
  };

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!baseFlip) {
    return (
      <ScreenContainer>
        <View style={d.emptyWrap}>
          <Text style={d.emptyTitle}>Analysis not found</Text>
          <Text style={d.emptySub}>Something went wrong loading this analysis.</Text>
          <Pressable onPress={() => router.back()} style={d.backBtn}>
            <Text style={d.backBtnText}>← Go Back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  // ── Live recalc (history mode uses edited thrift price) ───────────────────
  const editedThrift = parseFloat(thriftStr) || baseFlip.thriftPrice;

  // computeFlipCalc is the ONLY calculation call — no inline formulas
  const calc = useMemo(
    () => computeFlipCalc(
      baseFlip.resaleValue,
      editedThrift,
      baseFlip.matchConfidence,
      baseFlip.competitionLevel,
      baseFlip.styleLabels,
      baseFlip.era,
    ),
    [baseFlip.resaleValue, editedThrift, baseFlip.matchConfidence,
     baseFlip.competitionLevel, baseFlip.styleLabels, baseFlip.era],
  );

  const starReasons  = getStarRationale(calc.profit, baseFlip.matchConfidence, baseFlip.competitionLevel);
  const platformWhy  = getPlatformRationale(calc.bestPlatform, baseFlip.resaleValue);
  const profitColor  = calc.profit >= 15 ? V.green : calc.profit >= 0 ? V.greenMuted : V.error;

  // Listing data — prefer live stored flip, fall back to baseFlip
  const currentListings: ListingData | null = storedFlip?.listingData ?? baseFlip.listingData ?? null;
  const listingsGenerated = storedFlip?.listingsGenerated ?? baseFlip.listingsGenerated ?? false;

  // ── Handlers (history mode) ───────────────────────────────────────────────

  const handleThriftChange = (text: string) => {
    if (/^\d*\.?\d*$/.test(text)) setThriftStr(text);
  };

  const handleSaveThrift = () => {
    if (!storedFlip || !isHistory) return;
    const newThrift = parseFloat(thriftStr);
    if (!newThrift || newThrift === storedFlip.thriftPrice) {
      setThriftEditing(false);
      return;
    }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    // Persist updated thrift price + recalculated fields back to the store
    updateFlip(storedFlip.id, {
      thriftPrice: newThrift,
      fees:        calc.fees,
      profit:      calc.profit,
      roi:         calc.roi,
      buyScore:    calc.buyScore,
      buyLabel:    calc.buyLabel,
      stars:       calc.stars,
    });
    setThriftEditing(false);
    Alert.alert('Updated', 'Thrift price and calculations saved.');
  };

  const handleGenerateListings = async () => {
    if (listingsGenerated && currentListings) {
      setListingsOpen(true);
      return;
    }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await generateListingsMutation.mutateAsync({
        item_name:                baseFlip.itemName,
        brand:                    baseFlip.brand,
        category:                 baseFlip.category,
        estimated_era:            baseFlip.era,
        material_guess:           baseFlip.material,
        style_labels:             baseFlip.styleLabels,
        adjusted_estimated_value: baseFlip.resaleValue,
        demand:                   baseFlip.demand,
      });

      const listingData: ListingData = {
        ebay:  { title: result.ebay.title,  description: result.ebay.description  },
        depop: { title: result.depop.title, description: result.depop.description },
      };

      if (storedFlip) {
        // Persist to the store so future visits show listings as already generated
        updateFlip(storedFlip.id, {
          listingsGenerated: true,
          generatedAt:       Date.now(),
          listingData,
        });
      }

      setListingsOpen(true);
      haptic(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      Alert.alert('Error', 'Could not generate listings. Please try again.');
    }
  };

  // Listings to render — freshly generated take priority over stored
  const listingsToShow: ListingData | null =
    storedFlip?.listingData ?? currentListings;

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={d.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Header ── */}
          <View style={d.header}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <MaterialIcons name="arrow-back" size={22} color={V.green} />
            </Pressable>
            <Text style={d.headerTitle}>Deep Analysis</Text>
            <View style={{ width: 22 }} />
          </View>

          {/* ── Summary strip ── */}
          <View style={d.strip}>
            {baseFlip.imageUri ? (
              <Image source={{ uri: baseFlip.imageUri }} style={d.stripThumb} contentFit="cover" />
            ) : (
              <View style={[d.stripThumb, d.stripThumbFallback]}>
                <MaterialIcons name="checkroom" size={22} color={V.textMuted} />
              </View>
            )}
            <View style={d.stripInfo}>
              <Text style={d.stripName} numberOfLines={1}>{baseFlip.itemName}</Text>
              <Text style={d.stripBrand}>{baseFlip.brand} · {baseFlip.category}</Text>
              <StarRow stars={calc.stars} />
            </View>
            <View style={d.stripRight}>
              <Text style={[d.stripProfit, { color: profitColor }]}>
                {calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`}
              </Text>
              <Text style={d.stripLabel}>{calc.buyLabel}</Text>
            </View>
          </View>

          {/* ══════════════════════════════════════════════════════════════
              HISTORY MODE — thrift price editor + generate listings
              Only shown when source = 'history' (confirmed flip)
          ══════════════════════════════════════════════════════════════ */}
          {isHistory && (
            <>
              <Section title="✏️ Update Thrift Price">
                <View style={d.thriftRow}>
                  <Text style={d.thriftDesc}>
                    Edit what you paid — all calculations update live.
                  </Text>
                  {thriftEditing ? (
                    <View style={d.thriftInputRow}>
                      <View style={d.thriftInputWrap}>
                        <Text style={d.thriftDollar}>$</Text>
                        <TextInput
                          style={d.thriftInput}
                          value={thriftStr}
                          onChangeText={handleThriftChange}
                          keyboardType="decimal-pad"
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={handleSaveThrift}
                          onBlur={handleSaveThrift}
                        />
                      </View>
                      <Pressable onPress={handleSaveThrift} style={d.saveBtn}>
                        <Text style={d.saveBtnText}>Save</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setThriftEditing(true);
                        haptic(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={d.thriftDisplay}
                    >
                      <Text style={d.thriftDisplayVal}>${editedThrift}</Text>
                      <MaterialIcons name="edit" size={14} color={V.green} />
                    </Pressable>
                  )}
                </View>

                {/* Live recalculated metrics */}
                <View style={d.calcPreview}>
                  <View style={d.calcItem}>
                    <Text style={d.calcItemLabel}>Profit</Text>
                    <Text style={[d.calcItemValue, { color: profitColor }]}>
                      {calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`}
                    </Text>
                  </View>
                  <View style={d.calcDivider} />
                  <View style={d.calcItem}>
                    <Text style={d.calcItemLabel}>ROI</Text>
                    <Text style={d.calcItemValue}>{calc.roi > 0 ? `${calc.roi}%` : '—'}</Text>
                  </View>
                  <View style={d.calcDivider} />
                  <View style={d.calcItem}>
                    <Text style={d.calcItemLabel}>Rating</Text>
                    <Text style={d.calcItemValue} numberOfLines={1}>{calc.buyLabel}</Text>
                  </View>
                </View>
              </Section>

              {/* Generate / view listings */}
              <Section title="📋 Listings">
                {listingsGenerated ? (
                  <View style={d.listingStatusRow}>
                    <View style={d.listingGeneratedBadge}>
                      <MaterialIcons name="check-circle" size={14} color={V.green} />
                      <Text style={d.listingGeneratedText}>Listings already generated</Text>
                    </View>
                    <Pressable
                      onPress={() => setListingsOpen(v => !v)}
                      style={d.listingToggleBtn}
                    >
                      <Text style={d.listingToggleText}>
                        {listingsOpen ? 'Hide' : 'View listings'}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={handleGenerateListings}
                    disabled={generateListingsMutation.isPending}
                    style={({ pressed }) => [d.generateBtn, pressed && { opacity: 0.82 }]}
                  >
                    <MaterialIcons name="edit-note" size={18} color={V.white} />
                    <Text style={d.generateBtnText}>
                      {generateListingsMutation.isPending ? 'Generating...' : 'Generate Listings'}
                    </Text>
                  </Pressable>
                )}

                {(listingsOpen || (!listingsGenerated && generateListingsMutation.isSuccess)) &&
                  listingsToShow && (
                    <>
                      {([calc.bestPlatform === 'Depop' ? 'depop' : 'ebay',
                         calc.bestPlatform === 'Depop' ? 'ebay' : 'depop'] as const).map(platform => {
                        const listing = listingsToShow[platform as 'ebay' | 'depop'];
                        if (!listing) return null;
                        return (
                          <View key={platform} style={d.listingBlock}>
                            <Text style={d.listingPlatform}>
                              {platform === 'ebay' ? 'eBay' : 'Depop'}
                              {platform === calc.bestPlatform.toLowerCase() ? '  ⭐' : ''}
                            </Text>
                            <View style={d.listingContent}>
                              <Text style={d.listingTitle}>{listing.title}</Text>
                              <Text style={d.listingDesc}>{listing.description}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}
              </Section>
            </>
          )}

          {/* ══ 1. STAR RATING BREAKDOWN ═══════════════════════════════════ */}
          <Section title="⭐ Star Rating Breakdown">
            <View style={d.starsRow}>
              <StarRow stars={calc.stars} />
              <Text style={d.starsCount}>{calc.stars} / 5 stars</Text>
            </View>
            <Text style={d.rationaleIntro}>This item received {calc.stars} stars because:</Text>
            {starReasons.map((r, i) => <Bullet key={i} text={r} />)}
          </Section>

          {/* ══ 2. MATCH CONFIDENCE ════════════════════════════════════════ */}
          <Section title="📊 Match Confidence">
            <ConfidenceBar value={baseFlip.matchConfidence} />
            <Text style={d.explanationText}>
              {baseFlip.matchConfidence >= 80
                ? 'High confidence — the AI identified this item with strong certainty. Pricing should be accurate.'
                : baseFlip.matchConfidence >= 55
                ? 'Moderate confidence — reasonable identification, but the price estimate may have some margin of error.'
                : 'Low confidence — the AI struggled to identify this item precisely. Treat the pricing as a rough estimate.'}
            </Text>
            {baseFlip.riskFlags.length > 0 && (
              <>
                <Text style={d.riskHeader}>Risk flags:</Text>
                {baseFlip.riskFlags.map((f, i) => <Bullet key={i} text={f} />)}
              </>
            )}
          </Section>

          {/* ══ 3. PRICE BREAKDOWN ═════════════════════════════════════════ */}
          <Section title="💰 Price Breakdown">
            <DataRow label="Est. Resale Value"    value={`$${baseFlip.resaleValue}`} />
            <View style={d.innerDiv} />
            <DataRow label="Platform Fees (~12%)" value={`-$${calc.fees}`} valueColor={V.error} />
            <View style={d.innerDiv} />
            <DataRow
              label={isHistory ? 'Your Thrift Price' : 'Max Buy Price'}
              value={`$${editedThrift}`}
            />
            <View style={d.innerDiv} />
            <DataRow
              label="Net Profit"
              value={calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`}
              valueColor={profitColor}
            />
            <View style={d.innerDiv} />
            <DataRow
              label="ROI"
              value={calc.roi > 0 ? `${calc.roi}%` : '—'}
              valueColor={calc.roi >= 50 ? V.green : V.textMuted}
            />
            <View style={d.rangeRow}>
              <Text style={d.rangeLabel}>Market range:</Text>
              <Text style={d.rangeValue}>${baseFlip.resaleRangeLow} – ${baseFlip.resaleRangeHigh}</Text>
            </View>
            {baseFlip.avgSoldPrice > 0 && (
              <View style={d.rangeRow}>
                <Text style={d.rangeLabel}>Avg sold:</Text>
                <Text style={d.rangeValue}>${baseFlip.avgSoldPrice}</Text>
              </View>
            )}
          </Section>

          {/* ══ 4. MARKET SIGNALS ══════════════════════════════════════════ */}
          <Section title="📈 Market Signals">
            <View style={d.signalGrid}>
              {[
                { label: 'Demand',       value: baseFlip.demand,
                  color: baseFlip.demand === 'High' ? V.green : baseFlip.demand === 'Medium' ? V.warning : V.error },
                { label: 'Competition',  value: baseFlip.competitionLevel,
                  color: baseFlip.competitionLevel.toLowerCase() === 'low' ? V.green
                       : baseFlip.competitionLevel.toLowerCase() === 'high' ? V.error : V.warning },
                { label: 'Sell Speed',   value: baseFlip.sellSpeed,
                  color: baseFlip.sellSpeed === 'Fast' ? V.green : baseFlip.sellSpeed === 'Moderate' ? V.warning : V.error },
                { label: 'Score',        value: `${calc.buyScore}/100`, color: V.textDark },
              ].map(sig => (
                <View key={sig.label} style={d.signalBox}>
                  <Text style={[d.signalValue, { color: sig.color }]}>{sig.value}</Text>
                  <Text style={d.signalLabel}>{sig.label}</Text>
                </View>
              ))}
            </View>
          </Section>

          {/* ══ 5. PLATFORM RECOMMENDATION ════════════════════════════════ */}
          <Section title="🛒 Platform Recommendation">
            <View style={d.platformBadge}>
              <MaterialIcons name="store" size={15} color={V.green} />
              <Text style={d.platformBadgeText}>{calc.bestPlatform}</Text>
            </View>
            <Text style={d.explanationText}>{platformWhy}</Text>
          </Section>

          {/* ══ 6. ITEM DETAILS ════════════════════════════════════════════ */}
          <Section title="📦 Item Details">
            <DataRow label="Brand"    value={baseFlip.brand    || '—'} />
            <View style={d.innerDiv} />
            <DataRow label="Category" value={baseFlip.category || '—'} />
            <View style={d.innerDiv} />
            <DataRow label="Era"      value={baseFlip.era      || '—'} />
            <View style={d.innerDiv} />
            <DataRow label="Material" value={baseFlip.material || '—'} />
            {baseFlip.styleLabels.length > 0 && (
              <View style={d.tagRow}>
                {baseFlip.styleLabels.map((lbl, i) => (
                  <View key={i} style={d.tag}><Text style={d.tagText}>{lbl}</Text></View>
                ))}
              </View>
            )}
          </Section>

          {/* ══ 7. AVG SOLD DATA ═══════════════════════════════════════════ */}
          <Section title="💵 Average Sold Data">
            <DataRow label="Avg Sold Price (eBay)"  value={baseFlip.avgSoldPrice > 0 ? `$${baseFlip.avgSoldPrice}` : 'N/A'} />
            <View style={d.innerDiv} />
            <DataRow label="Est. Range" value={`$${baseFlip.resaleRangeLow} – $${baseFlip.resaleRangeHigh}`} />
            <Text style={d.soldNote}>
              Based on recent eBay sold listings. Depop prices typically vary by 10–15%.
            </Text>
          </Section>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const d = StyleSheet.create({
  scroll: { paddingHorizontal: V.screenPad, paddingBottom: 20 },

  emptyWrap:  { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: V.textDark, textAlign: 'center' },
  emptySub:   { fontSize: 14, color: V.textMuted, textAlign: 'center', lineHeight: 20 },
  backBtn:    { marginTop: 8, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 50, backgroundColor: V.green },
  backBtnText:{ color: V.white, fontWeight: '700', fontSize: 14 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '700', color: V.green },

  // Summary strip
  strip: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: V.cardBg, borderRadius: 14, borderWidth: 1, borderColor: V.border, padding: 12, marginBottom: 14 },
  stripThumb:        { width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderColor: V.border },
  stripThumbFallback:{ backgroundColor: V.tan, justifyContent: 'center', alignItems: 'center' },
  stripInfo:         { flex: 1, gap: 3 },
  stripName:         { fontSize: 14, fontWeight: '800', color: V.textDark },
  stripBrand:        { fontSize: 11, color: V.textMuted },
  stripRight:        { alignItems: 'flex-end', gap: 2 },
  stripProfit:       { fontSize: 18, fontWeight: '900' },
  stripLabel:        { fontSize: 9, color: V.textMuted, fontWeight: '600', maxWidth: 70 },

  // Sections
  section: { backgroundColor: V.cardBg, borderRadius: 14, borderWidth: 1, borderColor: V.border, padding: 16, marginBottom: 12, shadowColor: V.textDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: V.textDark, marginBottom: 14 },

  // Thrift price editor (history mode)
  thriftRow:       { gap: 10 },
  thriftDesc:      { fontSize: 13, color: V.textMuted, marginBottom: 8 },
  thriftInputRow:  { flexDirection: 'row', gap: 10, alignItems: 'center' },
  thriftInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.pageBg, borderRadius: 10, borderWidth: 1.5, borderColor: V.green, paddingHorizontal: 10, paddingVertical: 6, flex: 1 },
  thriftDollar:    { fontSize: 16, fontWeight: '700', color: V.green },
  thriftInput:     { fontSize: 18, fontWeight: '800', color: V.textDark, flex: 1, padding: 0 },
  thriftDisplay:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: V.pageBg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: V.border, alignSelf: 'flex-start' },
  thriftDisplayVal:{ fontSize: 16, fontWeight: '800', color: V.textDark },
  saveBtn:         { backgroundColor: V.green, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  saveBtnText:     { color: V.white, fontWeight: '700', fontSize: 14 },

  // Live calc preview (history mode)
  calcPreview:   { flexDirection: 'row', marginTop: 14, backgroundColor: V.pageBg, borderRadius: 10, borderWidth: 1, borderColor: V.border, overflow: 'hidden' },
  calcItem:      { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  calcItemLabel: { fontSize: 9, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  calcItemValue: { fontSize: 13, fontWeight: '700', color: V.textDark },
  calcDivider:   { width: 1, backgroundColor: V.border },

  // Listings (history mode)
  listingStatusRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  listingGeneratedBadge:{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: V.greenLight, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: V.green + '30' },
  listingGeneratedText: { fontSize: 12, fontWeight: '600', color: V.green },
  listingToggleBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5, borderColor: V.green },
  listingToggleText:    { fontSize: 12, fontWeight: '700', color: V.green },
  generateBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: V.green, paddingVertical: 13, borderRadius: 12 },
  generateBtnText:      { fontSize: 14, fontWeight: '700', color: V.white },
  listingBlock:         { marginTop: 14 },
  listingPlatform:      { fontSize: 14, fontWeight: '700', color: V.textDark, marginBottom: 8 },
  listingContent:       { borderRadius: 10, borderWidth: 1, borderColor: V.border, padding: 12, backgroundColor: V.pageBg },
  listingTitle:         { fontSize: 13, fontWeight: '700', color: V.textDark, marginBottom: 6, lineHeight: 19 },
  listingDesc:          { fontSize: 12, color: V.textMuted, lineHeight: 18 },

  // Stars
  starsRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  starsCount:      { fontSize: 15, fontWeight: '700', color: V.textDark },
  rationaleIntro:  { fontSize: 13, color: V.textMuted, marginBottom: 8 },
  explanationText: { fontSize: 13, color: V.textMuted, lineHeight: 19 },

  // Bullets
  bullet:    { flexDirection: 'row', gap: 6, marginBottom: 5, alignItems: 'flex-start' },
  bulletDot: { fontSize: 16, color: V.gold, lineHeight: 20 },
  bulletText:{ flex: 1, fontSize: 13, color: V.textDark, lineHeight: 19 },

  // Confidence bar
  barRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  barBg:    { flex: 1, height: 9, borderRadius: 5, overflow: 'hidden', backgroundColor: V.tan },
  barFill:  { height: '100%', borderRadius: 5 },
  barLabel: { fontSize: 14, fontWeight: '800', minWidth: 44 },
  riskHeader:{ fontSize: 12, fontWeight: '700', color: V.error, marginBottom: 6, marginTop: 8 },

  // Data rows
  dataRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  dataLabel:{ fontSize: 14, color: V.textMuted, fontWeight: '500' },
  dataValue:{ fontSize: 14, fontWeight: '700', color: V.textDark },
  innerDiv: { height: StyleSheet.hairlineWidth, backgroundColor: V.border },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingVertical: 4 },
  rangeLabel:{ fontSize: 12, color: V.textMuted },
  rangeValue:{ fontSize: 12, fontWeight: '600', color: V.textDark },

  // Market signals
  signalGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  signalBox:  { width: '50%', padding: 3 },
  signalValue:{ fontSize: 16, fontWeight: '800', marginBottom: 2 },
  signalLabel:{ fontSize: 10, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Platform
  platformBadge:    { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: V.greenLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: V.green + '40', marginBottom: 10 },
  platformBadgeText:{ fontSize: 14, fontWeight: '800', color: V.green },

  // Tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tag:    { backgroundColor: V.tan, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  tagText:{ fontSize: 11, fontWeight: '600', color: V.textMuted },

  soldNote: { fontSize: 11, color: V.textMuted, marginTop: 10, fontStyle: 'italic', lineHeight: 16 },
});