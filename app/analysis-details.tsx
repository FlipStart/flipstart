/**
 * analysis-details.tsx — Deep Analysis screen (proof + supporting data)
 */

import {
  View, Text, Pressable, StyleSheet, ScrollView, Platform,
  Alert, TextInput, KeyboardAvoidingView, Modal, Clipboard,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useMemo } from 'react';

import { ScreenContainer } from '@/components/screen-container';
import { useFlipStore } from '@/lib/useFlipStore';
import { trpc } from '@/lib/trpc';
import { FlipResult, ListingData } from '@/types/flip';
import { FONTS } from '@/constants/typography';
import { computeFlipCalc } from '@/utils/flipCalculations';
import { REC_THEMES } from '@/utils/recommendation';

// ─── Listings helper ─────────────────────────────────────────────────────────

function hasGeneratedListings(ld: { ebay?: { title?: string } | null; depop?: { title?: string } | null } | null | undefined): boolean {
  if (!ld) return false;
  return !!(ld.ebay?.title?.trim() || ld.depop?.title?.trim());
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const BG     = '#F0E8D4';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** A clean label-value row with guaranteed spacing */
function DataRow({ label, value, valueColor, bold }: {
  label: string; value: string; valueColor?: string; bold?: boolean;
}) {
  return (
    <View style={d.dataRow}>
      <Text style={d.dataLabel}>{label}</Text>
      <Text style={[d.dataValue, valueColor ? { color: valueColor } : {}, bold ? { fontWeight: '800' } : {}]}>
        {value}
      </Text>
    </View>
  );
}

function SectionHead({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={d.sectionHead}>
      <Text style={d.sectionIcon}>{icon}</Text>
      <Text style={d.sectionTitle}>{title}</Text>
    </View>
  );
}

function confidenceLabel(conf: number) {
  if (conf >= 85) return { text: 'Strong Match',   color: '#2A5A2A' };
  if (conf >= 60) return { text: 'Good Match',     color: '#7A5C1E' };
  if (conf >= 35) return { text: 'Low Confidence', color: '#8A4A1A' };
  return           { text: 'Uncertain',            color: '#6A2A2A' };
}

function platformName(p: string): string {
  const pl = (p || '').toLowerCase();
  if (pl === 'ebay')  return 'eBay';
  if (pl === 'depop') return 'Depop';
  return 'eBay + Depop';
}

function platformNote(p: string): string {
  const pl = (p || '').toLowerCase();
  if (pl === 'ebay')  return 'Largest buyer pool. Buyer protection increases buyer confidence.';
  if (pl === 'depop') return 'Younger audience, lower fees (~10%). Great for vintage and streetwear.';
  return 'This item performs similarly on both platforms. List on both eBay and Depop for maximum exposure.';
}

// ─── Image Viewer Modal ───────────────────────────────────────────────────────

function ImageViewerModal({ uri, visible, onClose }: { uri: string; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={im.backdrop} onPress={onClose}>
        <Pressable style={im.closeBtn} onPress={onClose}>
          <MaterialIcons name="close" size={22} color={CREAM} />
        </Pressable>
        <Image source={{ uri }} style={im.image} contentFit="contain" transition={200} />
      </Pressable>
    </Modal>
  );
}
const im = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  closeBtn: { position: 'absolute', top: 52, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  image:    { width: '90%', height: '75%' },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AnalysisDetailsScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { scanId, snapshot, source } = useLocalSearchParams<{ scanId: string; snapshot?: string; source?: string }>();
  const { getFlipById, updateFlip } = useFlipStore();

  const storedFlip = scanId ? getFlipById(scanId) : undefined;
  const baseFlip: FlipResult | undefined = storedFlip ?? (snapshot ? (() => {
    try { return JSON.parse(snapshot) as FlipResult; } catch { return undefined; }
  })() : undefined);

  const isHistory = source === 'history' || (!!storedFlip && source !== 'results');

  const [thriftStr,     setThriftStr]     = useState(isHistory && baseFlip ? String(baseFlip.thriftPrice) : '');
  const [thriftEditing, setThriftEditing] = useState(false);
  const [listingsOpen,  setListingsOpen]  = useState(false);
  const [listLoading,   setListLoading]   = useState(false);
  const [imageOpen,     setImageOpen]     = useState(false);
  const [copiedKey,     setCopiedKey]     = useState<string | null>(null);

  const generateListingsMutation = trpc.scan.generateListings.useMutation();

  const copy = (text: string, key: string) => {
    Clipboard.setString(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  if (!baseFlip) {
    return (
      <ScreenContainer edges={['left', 'right', 'bottom']}>
        <View style={d.emptyWrap}>
          <Text style={d.emptyTitle}>Analysis not found</Text>
          <Pressable onPress={() => router.back()} style={d.backBtn}>
            <Text style={d.backBtnText}>← Go Back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const editedThrift = parseFloat(thriftStr) || baseFlip.thriftPrice;
  const calc = useMemo(
    () => computeFlipCalc(
      baseFlip.resaleValue, editedThrift,
      baseFlip.matchConfidence, baseFlip.competitionLevel,
      baseFlip.styleLabels, baseFlip.era,
      baseFlip.demand ?? '',
      baseFlip.sellSpeed ?? '',
    ),
    [baseFlip.resaleValue, editedThrift, baseFlip.matchConfidence,
     baseFlip.competitionLevel, baseFlip.styleLabels, baseFlip.era,
     baseFlip.demand, baseFlip.sellSpeed],
  );

  const confBadge   = confidenceLabel(baseFlip.matchConfidence);
  const profitColor = calc.profit >= 15 ? '#2A5A2A' : calc.profit >= 0 ? '#7A5C1E' : '#8A3A2A';
  const rec   = calc.recommendation;
  const theme = REC_THEMES[rec.colorKey];
  const currentListings: ListingData | null = storedFlip?.listingData ?? baseFlip.listingData ?? null;
  const listingsToShow = currentListings;
  // hasListings is true ONLY if real non-empty content exists
  const hasListings = hasGeneratedListings(
    listingsToShow
      ? { ebay: { title: listingsToShow.ebay.title }, depop: { title: listingsToShow.depop.title } }
      : null
  );
  const showVerify = baseFlip.matchConfidence > 0 && baseFlip.matchConfidence < 70;

  const haptic = (style: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(style).catch(() => {});
  };

  const handleSaveThrift = () => {
    if (!storedFlip || !isHistory) { setThriftEditing(false); return; }
    const v = parseFloat(thriftStr);
    if (!v || v === storedFlip.thriftPrice) { setThriftEditing(false); return; }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    updateFlip(storedFlip.id, { thriftPrice: v, fees: calc.fees, profit: calc.profit, roi: calc.roi, buyScore: calc.buyScore, buyLabel: calc.buyLabel, stars: calc.stars });
    setThriftEditing(false);
  };

  const handleGenerateListings = async () => {
    if (hasListings && listingsToShow) { setListingsOpen(true); return; }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setListLoading(true);
    try {
      const result = await generateListingsMutation.mutateAsync({
        item_name: baseFlip.itemName, brand: baseFlip.brand, category: baseFlip.category,
        estimated_era: baseFlip.era, material_guess: baseFlip.material,
        style_labels: baseFlip.styleLabels,
        adjusted_estimated_value: baseFlip.resaleValue, demand: baseFlip.demand,
      });
      const listingData: ListingData = {
        ebay:  { title: result.ebay.title,  description: result.ebay.description  },
        depop: { title: result.depop.title, description: result.depop.description },
      };
      if (storedFlip) updateFlip(storedFlip.id, { listingsGenerated: true, generatedAt: Date.now(), listingData });
      setListingsOpen(true);
    } catch {
      Alert.alert('Error', 'Could not generate listings. Please try again.');
    } finally {
      setListLoading(false);
    }
  };

  const plat = platformName(calc.bestPlatform);
  const platNote = platformNote(calc.bestPlatform);

  return (
    <ScreenContainer edges={['left', 'right', 'bottom']}>
      {baseFlip.imageUri && (
        <ImageViewerModal uri={baseFlip.imageUri} visible={imageOpen} onClose={() => setImageOpen(false)} />
      )}

      {/* Header outside ScrollView — prevents double safe-area stacking */}
      <View style={[d.header, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <MaterialIcons name="arrow-back" size={22} color={CREAM} />
        </Pressable>

        <View style={d.headerCenter}>
          <Text style={d.headerBrand}>FlipStart</Text>
          <View style={d.headerSubRow}>
            <Text style={d.headerStar}>✦</Text>
            <Text style={d.headerSub}>DEEP ANALYSIS</Text>
            <Text style={d.headerStar}>✦</Text>
          </View>
        </View>

        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={d.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* Compact item summary */}
          <View style={d.card}>
            <View style={d.summaryRow}>
              <Pressable
                onPress={() => baseFlip.imageUri && setImageOpen(true)}
                style={({ pressed }) => [d.thumbWrap, pressed && { opacity: 0.85 }]}
              >
                {baseFlip.imageUri
                  ? <Image source={{ uri: baseFlip.imageUri }} style={d.summaryThumb} contentFit="cover" />
                  : <View style={[d.summaryThumb, d.thumbFallback]}><MaterialIcons name="checkroom" size={20} color={MUTED} /></View>
                }
                {baseFlip.imageUri && (
                  <View style={d.thumbZoomBadge}>
                    <MaterialIcons name="zoom-in" size={10} color={CREAM} />
                  </View>
                )}
              </Pressable>

              <View style={d.summaryInfo}>
                <Text style={d.summaryName} numberOfLines={1}>{baseFlip.itemName}</Text>
                <Text style={d.summaryMeta}>{baseFlip.brand} · {baseFlip.category}</Text>

                <View style={d.summaryBadgeRow}>
                  {/* Confidence */}
                  {baseFlip.matchConfidence > 0 && (
                    <View style={[d.confPill, { backgroundColor: confBadge.color + '18', borderColor: confBadge.color + '40' }]}>
                      <Text style={[d.confPillPct, { color: confBadge.color }]}>{baseFlip.matchConfidence}%</Text>
                      <Text style={[d.confPillLabel, { color: confBadge.color }]}>CONFIDENCE</Text>
                    </View>
                  )}
                  {/* Stars */}
                  <View style={d.starsRow}>
                    {[1,2,3,4,5].map(n => (
                      <MaterialIcons
                        key={n}
                        name={n <= (calc.stars ?? 0) ? 'star' : 'star-border'}
                        size={13}
                        color={n <= (calc.stars ?? 0) ? GOLD : CARD_B}
                      />
                    ))}
                  </View>
                </View>

                {/* Buy label badge */}
                <View style={[d.buyLabelBadge, { borderColor: theme.border, backgroundColor: theme.bg + '22' }]}>
                  <Text style={[d.buyLabelText, { color: theme.iconColor }]}>
                    {rec.displayLabel.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* History: editable thrift price */}
          {isHistory && (
            <View style={d.card}>
              <SectionHead icon="✏️" title="UPDATE THRIFT PRICE" />
              <View style={d.priceRow}>
                <Text style={d.dataLabel}>What you paid</Text>
                {thriftEditing ? (
                  <View style={d.priceInputWrap}>
                    <Text style={d.priceDollar}>$</Text>
                    <TextInput
                      style={d.priceInput} value={thriftStr}
                      onChangeText={t => { if (/^\d*\.?\d*$/.test(t)) setThriftStr(t); }}
                      keyboardType="decimal-pad" autoFocus returnKeyType="done"
                      onSubmitEditing={handleSaveThrift} onBlur={handleSaveThrift}
                    />
                  </View>
                ) : (
                  <Pressable onPress={() => { setThriftEditing(true); haptic(Haptics.ImpactFeedbackStyle.Light); }} style={d.priceDisplay}>
                    <Text style={d.priceDisplayText}>${editedThrift}</Text>
                    <MaterialIcons name="edit" size={13} color={FOREST} />
                  </Pressable>
                )}
              </View>
              <View style={d.calcPreview}>
                {[
                  { label: 'Profit', value: calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`, color: profitColor },
                  { label: 'ROI',    value: calc.roi > 0 ? `${calc.roi}%` : '—',  color: FOREST },
                  { label: 'Rating', value: calc.buyLabel.replace(/^[^\s]+\s/, ''), color: BROWN },
                ].map(m => (
                  <View key={m.label} style={d.calcBox}>
                    <Text style={[d.calcValue, { color: m.color }]} numberOfLines={1}>{m.value}</Text>
                    <Text style={d.calcLabel}>{m.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Recommendation warning — shown when rec has a caution note */}
          {rec.warning && (
            <View style={d.warningBanner}>
              <MaterialIcons name="info-outline" size={14} color="#C07030" />
              <Text style={d.warningBannerText}>{rec.warning}</Text>
            </View>
          )}

          {/* Price Breakdown */}
          <View style={d.card}>
            <SectionHead icon="💰" title="PRICE BREAKDOWN" />
            <View style={d.twoCol}>
              <View style={d.colLeft}>
                <DataRow label="Estimated Resale Value" value={`$${baseFlip.resaleValue}`} />
                <DataRow label="Platform Fees (~12%)"   value={`-$${calc.fees}`} valueColor="#8A3A2A" />
                <DataRow label="Max Buy Price"          value={`$${baseFlip.thriftPrice}`} />
                <DataRow label="Net Profit"             value={calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`} valueColor={profitColor} bold />
                <DataRow label="ROI"                    value={calc.roi > 0 ? `${calc.roi}%` : '—'} />
              </View>
              <View style={d.colDivider} />
              <View style={d.colRight}>
                <DataRow label="Market Range" value={`$${baseFlip.resaleRangeLow} – $${baseFlip.resaleRangeHigh}`} />
                <DataRow label="Average Sold" value={baseFlip.avgSoldPrice > 0 ? `$${baseFlip.avgSoldPrice}` : 'N/A'} />
                <Text style={d.smallNote}>Based on recent eBay sold listings. Depop prices typically vary by 10–15%.</Text>
              </View>
            </View>
          </View>

          {/* Market Signals + Platform — side by side */}
          <View style={d.halfRow}>
            <View style={[d.card, d.halfCard]}>
              <SectionHead icon="📊" title="MARKET SIGNALS" />
              {[
                { label: 'Demand',      value: baseFlip.demand,           color: baseFlip.demand?.toLowerCase() === 'high' ? '#2A5A2A' : baseFlip.demand?.toLowerCase() === 'low' ? '#8A3A2A' : BROWN },
                { label: 'Competition', value: baseFlip.competitionLevel, color: (baseFlip.competitionLevel||'').toLowerCase() === 'high' ? '#8A3A2A' : '#2A5A2A' },
                { label: 'Sell Speed',  value: baseFlip.sellSpeed,        color: baseFlip.sellSpeed?.toLowerCase() === 'fast' ? '#2A5A2A' : '#8A3A2A' },
                { label: 'Score',       value: `${baseFlip.buyScore}/100`, color: FOREST },
              ].map(m => <DataRow key={m.label} label={m.label} value={m.value || '—'} valueColor={m.color} bold />)}
            </View>

            <View style={[d.card, d.halfCard]}>
              <SectionHead icon="🛒" title="PLATFORM" />
              <View style={[d.platformPill, { backgroundColor: FOREST + '15', borderColor: FOREST + '30' }]}>
                <MaterialIcons name="store" size={13} color={FOREST} />
                <Text style={d.platformPillText}>{plat}</Text>
              </View>
              <Text style={d.platformNote}>{platNote}</Text>
            </View>
          </View>

          {/* Item Details */}
          <View style={d.card}>
            <SectionHead icon="📦" title="ITEM DETAILS" />
            <View style={d.twoCol}>
              <View style={d.colLeft}>
                <DataRow label="Brand"    value={baseFlip.brand    || '—'} />
                <DataRow label="Category" value={baseFlip.category || '—'} />
              </View>
              <View style={d.colDivider} />
              <View style={d.colRight}>
                <DataRow label="Era"      value={baseFlip.era      || '—'} />
                <DataRow label="Material" value={baseFlip.material || '—'} />
              </View>
            </View>
            {baseFlip.styleLabels?.length > 0 && (
              <View style={d.tagRow}>
                {baseFlip.styleLabels.map((l, i) => (
                  <View key={i} style={d.tag}><Text style={d.tagText}>{l}</Text></View>
                ))}
              </View>
            )}
          </View>

          {/* Listings (shown for all modes) */}
          <View style={d.card}>
            <SectionHead icon="📋" title="LISTINGS" />
            {hasListings ? (
              <>
                <View style={d.listingStatusRow}>
                  <View style={d.listingBadge}>
                    <MaterialIcons name="check-circle" size={13} color={FOREST} />
                    <Text style={d.listingBadgeText}>Listings generated</Text>
                  </View>
                  <Pressable onPress={() => setListingsOpen(v => !v)} style={d.listingToggle}>
                    <Text style={d.listingToggleText}>{listingsOpen ? 'Hide' : 'View'}</Text>
                  </Pressable>
                </View>
                {listingsOpen && listingsToShow && (
                  <>
                    {(['ebay', 'depop'] as const).map(p => listingsToShow[p] && (
                      <View key={p} style={d.listingBlock}>
                        <View style={d.listingBlockHeader}>
                          <Text style={d.listingPlatform}>{p === 'ebay' ? 'eBay' : 'Depop'}</Text>
                          <Pressable onPress={() => copy(listingsToShow[p]!.title + '\n\n' + listingsToShow[p]!.description, p)} style={d.listingCopyBtn}>
                            <MaterialIcons name={copiedKey === p ? 'check' : 'content-copy'} size={12} color={FOREST} />
                            <Text style={d.listingCopyText}>{copiedKey === p ? 'Copied' : 'Copy all'}</Text>
                          </Pressable>
                        </View>
                        <View style={d.listingContent}>
                          <Text style={d.listingTitle}>{listingsToShow[p]!.title}</Text>
                          <Text style={d.listingDesc}>{listingsToShow[p]!.description}</Text>
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </>
            ) : (
              <Pressable onPress={handleGenerateListings} disabled={listLoading} style={({ pressed }) => [d.generateBtn, pressed && { opacity: 0.82 }]}>
                <MaterialIcons name={listLoading ? 'hourglass-empty' : 'edit-note'} size={17} color={CREAM} />
                <Text style={d.generateBtnText}>{listLoading ? 'Generating…' : 'Generate Listings'}</Text>
              </Pressable>
            )}
          </View>

          {/* Average Sold Data */}
          <View style={d.card}>
            <SectionHead icon="💵" title="AVERAGE SOLD DATA" />
            <DataRow label="Avg Sold Price (eBay)" value={baseFlip.avgSoldPrice > 0 ? `$${baseFlip.avgSoldPrice}` : 'N/A'} />
            <DataRow label="Estimated Range"        value={`$${baseFlip.resaleRangeLow} – $${baseFlip.resaleRangeHigh}`} />
            <Text style={d.smallNote}>Based on recent completed listings</Text>
          </View>

          {/* Verify Before Buying — shown when confidence < 70 */}
          {showVerify && (
            <View style={[d.card, d.verifyCard]}>
              <SectionHead icon="🔍" title="VERIFY BEFORE BUYING" />
              <Text style={d.verifyIntro}>
                Confidence is {baseFlip.matchConfidence}%. Double-check before purchasing:
              </Text>
              {[
                'Check tags and brand markings carefully',
                'Compare condition to sold comps online',
                'Confirm size, flaws, and any damage',
                'Search manually if price seems unusually high',
              ].map((tip, i) => (
                <View key={i} style={d.verifyRow}>
                  <MaterialIcons name="check-circle-outline" size={14} color={GOLD} />
                  <Text style={d.verifyText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Risk flags if present */}
          {(baseFlip.riskFlags?.length ?? 0) > 0 && (
            <View style={d.card}>
              <SectionHead icon="⚠️" title="RISK FLAGS" />
              {baseFlip.riskFlags!.map((flag, i) => (
                <View key={i} style={d.verifyRow}>
                  <MaterialIcons name="warning-amber" size={14} color="#C07030" />
                  <Text style={d.verifyText}>{flag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Back to Summary */}
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [d.backToSummaryBtn, { marginTop: 16 }, pressed && { opacity: 0.88 }]}
          >
            <MaterialIcons name="arrow-back" size={18} color={CREAM} />
            <Text style={d.backToSummaryText}>Back to Summary</Text>
          </Pressable>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const d = StyleSheet.create({
  scroll:    { backgroundColor: BG, paddingBottom: 20 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  emptyTitle:{ fontSize: 18, fontWeight: '700', color: FOREST, fontFamily: FONTS.serif },
  backBtn:   { backgroundColor: FOREST, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 50, marginTop: 8 },
  backBtnText:{ color: CREAM, fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, backgroundColor: FOREST,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },
  headerCenter:  { alignItems: 'center', gap: 2 },
  headerBrand:   { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: CREAM, letterSpacing: 0.3 },
  headerSubRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerSub:     { fontSize: 14, fontWeight: '700', color: GOLD, letterSpacing: 2.0, textTransform: 'uppercase' },
  headerStar:    { fontSize: 14, color: GOLD },

  card: {
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: CARD_B,
    marginHorizontal: 14, marginTop: 12, padding: 16,
    shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },

  // Compact summary
  summaryRow:     { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  thumbWrap:      { position: 'relative', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B },
  summaryThumb:   { width: 78, height: 78, borderRadius: 9 },
  thumbFallback:  { backgroundColor: '#EDE0C4', justifyContent: 'center', alignItems: 'center' },
  thumbZoomBadge: { position: 'absolute', bottom: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 6, padding: 2 },
  summaryInfo:    { flex: 1, gap: 4 },
  summaryName:    { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '700', color: FOREST },
  summaryMeta:    { fontSize: 11, color: MUTED },
  summaryBadgeRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  confPill:       { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  confPillPct:    { fontSize: 11, fontWeight: '800' },
  confPillLabel:  { fontSize: 8, fontWeight: '600', letterSpacing: 0.3 },
  starsRow:       { flexDirection: 'row', gap: 1 },
  buyLabelBadge:  { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 2 },
  buyLabelText:   { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, fontFamily: FONTS.serif },

  // Section header
  sectionHead:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  sectionIcon:  { fontSize: 13 },
  sectionTitle: { fontSize: 10, fontWeight: '700', color: MUTED, letterSpacing: 1.4, textTransform: 'uppercase' },

  // Data rows — label left, value right, guaranteed gap
  dataRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 8 },
  dataLabel: { fontSize: 13, color: BROWN, flex: 1 },
  dataValue: { fontSize: 13, fontWeight: '600', color: FOREST, textAlign: 'right' },
  smallNote: { fontSize: 10, color: MUTED, marginTop: 8, fontStyle: 'italic', lineHeight: 14 },

  // Two-column layout with divider
  twoCol:    { flexDirection: 'row', gap: 0 },
  colLeft:   { flex: 1, paddingRight: 8 },
  colRight:  { flex: 1, paddingLeft: 8 },
  colDivider:{ width: 1, backgroundColor: CARD_B, marginVertical: 2 },

  // Half cards
  halfRow:  { flexDirection: 'row', marginHorizontal: 14, gap: 10, marginTop: 12 },
  halfCard: { flex: 1, marginHorizontal: 0, marginTop: 0 },

  // Platform
  platformPill:     { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, marginBottom: 8 },
  platformPillText: { fontSize: 13, fontWeight: '700', color: FOREST, fontFamily: FONTS.serif },
  platformNote:     { fontSize: 11, color: BROWN, lineHeight: 16 },

  // Tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  tag:    { backgroundColor: CARD_B + '60', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText:{ fontSize: 11, color: MUTED, fontWeight: '500' },

  // History price edit
  priceRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: FOREST, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  priceDollar:    { fontSize: 15, fontWeight: '700', color: FOREST },
  priceInput:     { fontSize: 17, fontWeight: '800', color: FOREST, minWidth: 60, padding: 0 },
  priceDisplay:   { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: CARD_B, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  priceDisplayText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: FOREST },
  calcPreview: { flexDirection: 'row' },
  calcBox:     { flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: BG, borderRadius: 8, margin: 2 },
  calcValue:   { fontSize: 13, fontWeight: '700' },
  calcLabel:   { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },

  // Listings
  listingStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  listingBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  listingBadgeText: { fontSize: 12, fontWeight: '600', color: FOREST },
  listingToggle:    { borderWidth: 1, borderColor: FOREST, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  listingToggleText:{ fontSize: 12, fontWeight: '700', color: FOREST },
  generateBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: FOREST, paddingVertical: 12, borderRadius: 10 },
  generateBtnText:  { fontSize: 14, fontWeight: '700', color: CREAM, fontFamily: FONTS.serif },
  listingBlock:     { marginTop: 12 },
  listingBlockHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  listingPlatform:  { fontSize: 13, fontWeight: '700', color: FOREST },
  listingCopyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: CARD_B },
  listingCopyText:  { fontSize: 10, fontWeight: '600', color: FOREST },
  listingContent:   { backgroundColor: BG, borderRadius: 8, borderWidth: 1, borderColor: CARD_B, padding: 10 },
  listingTitle:     { fontSize: 12, fontWeight: '700', color: FOREST, marginBottom: 5, lineHeight: 17 },
  listingDesc:      { fontSize: 11, color: BROWN, lineHeight: 16 },

  // Verify Before Buying
  verifyCard: { borderColor: GOLD + '50', backgroundColor: '#FFFBEE' },
  warningBanner:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FFF8EC', borderRadius: 10, borderWidth: 1, borderColor: '#C07030' + '50', marginHorizontal: 14, marginTop: 10, padding: 12 },
  warningBannerText: { flex: 1, fontSize: 12, color: '#7A4010', lineHeight: 18 },
  verifyIntro:{ fontSize: 12, color: BROWN, marginBottom: 10, lineHeight: 18 },
  verifyRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 7 },
  verifyText: { flex: 1, fontSize: 12, color: BROWN, lineHeight: 18 },

  // Back button
  backToSummaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: FOREST, marginHorizontal: 14, paddingVertical: 16, borderRadius: 50,
  },
  backToSummaryText: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '700', color: CREAM },
});