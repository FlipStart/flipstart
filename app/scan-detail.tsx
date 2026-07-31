/**
 * analysis-details.tsx — Deep Analysis screen (proof + supporting data)
 */

import {
  View, Text, Pressable, StyleSheet, ScrollView, Platform,
  Alert, TextInput, KeyboardAvoidingView, Modal, Clipboard, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useMemo } from 'react';

import { ScreenContainer } from '@/components/screen-container';
import { useFlipStore } from '@/lib/useFlipStore';
import { useScanContext } from '@/lib/scan-context';
import { trpc } from '@/lib/trpc';
import { FlipResult, ListingData } from '@/types/flip';
import { FONTS } from '@/constants/typography';
import { computeFlipCalc } from '@/utils/flipCalculations';
import { REC_THEMES, normalizeBuyRating } from '@/utils/recommendation';
import {
  buildDeepInputs, whyThisRating, ratingQuestion, priceLogicText,
  riskAssessment, confidenceBreakdown, platformStrategy, listingStrategy,
  itemEvidence, whatCouldChange,
} from '@/utils/deepAnalysis';
import { trackAnalyticsEvent } from '@/lib/analytics';

// ─── Listings helper ─────────────────────────────────────────────────────────

function hasGeneratedListings(ld: { ebay?: { title?: string } | null; depop?: { title?: string } | null } | null | undefined): boolean {
  if (!ld) return false;
  return !!(ld.ebay?.title?.trim() || ld.depop?.title?.trim());
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const BG     = '#FFFFFF';
const CARD   = '#FFFEFA';
const CARD_B = '#DDD2AC';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** A clean label-value row with guaranteed spacing */
/**
 * DataRow — used in Price Breakdown / Market Signals (single-column, independent rows).
 * Unchanged from original — no overflow, no chevron.
 */
function DataRow({ label, value, valueColor, bold }: {
  label: string; value: string; valueColor?: string; bold?: boolean;
}) {
  return (
    <View style={d.dataRow}>
      <Text style={d.dataLabel}>{label}:</Text>
      <Text
        style={[d.dataValue, d.dataValueInline,
          valueColor ? { color: valueColor } : {},
          bold ? { fontWeight: '800' as const } : {}]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * ItemDetailsGrid — renders all four Item Detail fields in two synchronized rows.
 *
 * Divider position is computed ONCE from all four values so both rows share
 * the same column widths. The left flex is a content-weighted ratio clamped
 * between 40 % and 60 % so neither side dominates.
 *
 * Sony example:
 *   left  longest: "Category: Video Game Accessory" → 30 chars
 *   right longest: "Material: Plastic"              → 17 chars
 *   rawFlex = 30/47 ≈ 0.638 → clamped to 0.60 → left gets 60%, right 40%
 *   Category can now show "Video Game Accessory" fully before chevron kicks in.
 */
const SCROLL_THRESHOLD = 18;
const MIN_LEFT_FLEX    = 0.40;
const MAX_LEFT_FLEX    = 0.60;

function ItemDetailsGrid({ brand, category, eraValue, material }: {
  brand: string; category: string; eraValue: string; material: string;
}) {
  // Weight left column on longest full label+value string in each column
  const leftLongest  = Math.max(
    ('Brand: '    + brand).length,
    ('Category: ' + category).length,
  );
  const rightLongest = Math.max(
    ('Era: '      + eraValue).length,
    ('Material: ' + material).length,
  );
  const total       = leftLongest + rightLongest || 1;
  const rawFlex     = leftLongest / total;
  const leftFlex    = Math.min(MAX_LEFT_FLEX, Math.max(MIN_LEFT_FLEX, rawFlex));
  const rightFlex   = 1 - leftFlex;

  return (
    <View>
      <ItemDetailRow
        leftLabel="Brand"    leftValue={brand}
        rightLabel="Era"     rightValue={eraValue}
        leftFlex={leftFlex}  rightFlex={rightFlex}
      />
      <ItemDetailRow
        leftLabel="Category" leftValue={category}
        rightLabel="Material" rightValue={material}
        leftFlex={leftFlex}  rightFlex={rightFlex}
      />
    </View>
  );
}

function ItemDetailRow({
  leftLabel, leftValue, rightLabel, rightValue, leftFlex, rightFlex,
}: {
  leftLabel: string;  leftValue: string;
  rightLabel: string; rightValue: string;
  leftFlex: number;   rightFlex: number;
}) {
  return (
    <View style={d.itemDetailRow}>
      <DetailCell label={leftLabel}  value={leftValue}  cellFlex={leftFlex} />
      <View style={d.itemDetailDivider} />
      <DetailCell label={rightLabel} value={rightValue} cellFlex={rightFlex} />
    </View>
  );
}

function DetailCell({ label, value, cellFlex }: {
  label: string; value: string; cellFlex: number;
}) {
  const isScrollable = value.length > SCROLL_THRESHOLD;
  return (
    <View style={[d.dataCell, { flex: cellFlex, minWidth: 0 }]}>
      <View style={d.dataCellInner}>
        <Text style={d.dataLabel} numberOfLines={1}>{label}:</Text>
        {isScrollable ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={d.dataCellScroll}
              contentContainerStyle={{ paddingRight: 2 }}
            >
              <Text style={d.dataValue} numberOfLines={1}>{value}</Text>
            </ScrollView>
            <Text style={d.chevron} numberOfLines={1}>›</Text>
          </>
        ) : (
          <Text style={[d.dataValue, d.dataValueInline]} numberOfLines={1}>{value}</Text>
        )}
      </View>
    </View>
  );
}

/**
 * PriceRow — used in Price Breakdown only.
 * Full-width row: label left, value right-aligned with reserved width.
 * Values NEVER clip because the value container has minWidth.
 */
function PriceRow({ label, value, valueColor, bold }: {
  label: string; value: string; valueColor?: string; bold?: boolean;
}) {
  return (
    <View style={d.priceRow2}>
      <Text style={d.priceLabel2} numberOfLines={1}>{label}</Text>
      <Text
        style={[
          d.priceValue2,
          valueColor ? { color: valueColor } : {},
          bold ? { fontWeight: '800' as const } : {},
        ]}
        numberOfLines={1}
      >
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

const isUnknownStr = (v?: string) =>
  !v || ['unknown', 'other', 'n/a', 'insufficient evidence', ''].includes(v.trim().toLowerCase());

/** Deep Analysis section head — MaterialIcon in a gold circle + serif title (cream card). */
function DeepHead({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={d.deepHead}>
      <View style={d.deepHeadIcon}><MaterialIcons name={icon as any} size={15} color={GOLD} /></View>
      <Text style={d.deepHeadTitle}>{title}</Text>
    </View>
  );
}

/** Deep Analysis section head for the dark-green premium card (cream text/icon). */
function DeepHeadPremium({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={d.deepHead}>
      <View style={d.deepHeadIconPrem}><MaterialIcons name={icon as any} size={15} color={GOLD} /></View>
      <Text style={d.deepHeadTitlePrem}>{title}</Text>
    </View>
  );
}

/** Small compact stat used in Price Logic / Listing Strategy recaps. */
function PriceStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={d.priceStat}>
      <Text style={[d.priceStatVal, color ? { color } : {}]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
      <Text style={d.priceStatLabel}>{label}</Text>
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
  const { updateScan } = useScanContext();

  const storedFlip = scanId ? getFlipById(scanId) : undefined;
  const baseFlip: FlipResult | undefined = storedFlip ?? (snapshot ? (() => {
    try { return JSON.parse(snapshot) as FlipResult; } catch { return undefined; }
  })() : undefined);

  const isHistory     = source === 'history' || source === 'hunt_history' || (!!storedFlip && source !== 'results');
  const isHuntHistory = source === 'hunt_history';

  const [thriftStr,     setThriftStr]     = useState(isHistory && baseFlip ? String(baseFlip.thriftPrice) : '');
  const [thriftEditing, setThriftEditing] = useState(false);
  const [listingsOpen,  setListingsOpen]  = useState(false);
  const [listLoading,   setListLoading]   = useState(false);
  const [localListings, setLocalListings] = useState<ListingData | null>(null);
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
      <ScreenContainer edges={['left', 'right']}>
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
  const currentListings: ListingData | null = localListings ?? storedFlip?.listingData ?? baseFlip.listingData ?? null;
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
    updateFlip(storedFlip.id, { thriftPrice: v, fees: calc.fees, profit: calc.profit, roi: calc.roi, buyScore: calc.buyScore, buyLabel: calc.buyLabel, stars: calc.stars, recommendation: calc.recommendation });
    setThriftEditing(false);
  };

  const handleGenerateListings = async () => {
    if (hasListings && listingsToShow) { setListingsOpen(true); return; }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setListLoading(true);
    try {
      const result = await generateListingsMutation.mutateAsync({
        item_name: baseFlip.itemName, brand: baseFlip.brand, category: baseFlip.category,
        estimated_era: baseFlip.era ?? 'Unknown', material_guess: baseFlip.material ?? 'Unknown',
        style_labels: baseFlip.styleLabels ?? [],
        adjusted_estimated_value: baseFlip.resaleValue, demand: baseFlip.demand ?? 'Medium',
      });
      const listingData: ListingData = {
        ebay:  { title: result.ebay.title,  description: result.ebay.description  },
        depop: { title: result.depop.title, description: result.depop.description },
      };
      // Save to flip store if item is in history
      if (storedFlip) {
        updateFlip(storedFlip.id, { listingsGenerated: true, generatedAt: Date.now(), listingData });
      }
      // Also save to scan context so results screen picks it up (when source='results')
      if (baseFlip?.id) {
        updateScan(baseFlip.id, {
          listings: { ebay: listingData.ebay, depop: listingData.depop },
        });
      }
      setLocalListings(listingData);
      setListingsOpen(true);
      trackAnalyticsEvent('listing_generated', {
        scan_id:           baseFlip?.id ?? null,
        item_title:        baseFlip.itemName,
        brand:             baseFlip.brand,
        category:          baseFlip.category,
        platform:          'both',
        title_generated:   !!(listingData.ebay?.title || listingData.depop?.title),
        description_generated: !!(listingData.ebay?.description || listingData.depop?.description),
        estimated_resale_value: baseFlip.resaleValue,
        generation_source: 'history',
      });
    } catch (err: any) {
      console.error('[analysis-details] generateListings failed:', err?.message ?? err);
      trackAnalyticsEvent('listing_generation_failed', {
        scan_id:    baseFlip?.id ?? null,
        item_title: baseFlip.itemName,
        platform:   'both',
        error_code: err?.code ?? null,
        failure_stage: 'ai_generation',
      });
      Alert.alert('Error', 'Could not generate listings. Please try again.');
    } finally {
      setListLoading(false);
    }
  };

  const plat = platformName(calc.bestPlatform);
  const platNote = platformNote(calc.bestPlatform);

  // ── Deep Analysis derived reasoning (all from real scan data) ──────────────
  // LIVE rating from the current thrift price. `rec` is calc.recommendation,
  // which already reflects the edited price; the stored value on baseFlip is
  // only a fallback for a flip that somehow has no calc.
  const canonicalRating = normalizeBuyRating(
    rec?.label ?? baseFlip.recommendation?.label ?? (baseFlip as any).buyLabel ?? 'SKIP',
  );
  const maxBuyShown = isHistory && editedThrift > 0 ? editedThrift : baseFlip.thriftPrice;
  // Pass the LIVE rating so the explanation matches the badge above it.
  const di = buildDeepInputs(
    baseFlip,
    { profit: calc.profit, roi: calc.roi, fees: calc.fees },
    maxBuyShown,
    normalizeBuyRating(calc.recommendation?.label ?? 'SKIP'),
  );
  // buildDeepInputs already received the live rating; no override needed.
  // The previous assignment here silently replaced it with the stored value,
  // which is why the explanation never followed the badge.
  const whyBullets   = whyThisRating(di);
  const priceText    = priceLogicText(di);
  const risk         = riskAssessment(di);
  const confB        = confidenceBreakdown(di);
  const platStrat    = platformStrategy(di);
  const listStrat    = listingStrategy(di);
  const evidence     = itemEvidence(di);
  const changeItems  = whatCouldChange(di);

  return (
    <ScreenContainer edges={['left', 'right']}>
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

          {/* ── 2. Compact item recap ── */}
          <View style={d.recapCard}>
            <Pressable
              onPress={() => baseFlip.imageUri && setImageOpen(true)}
              style={({ pressed }) => [d.recapThumbWrap, pressed && { opacity: 0.85 }]}
            >
              {baseFlip.imageUri
                ? <Image source={{ uri: baseFlip.imageUri }} style={d.recapThumb} contentFit="cover" />
                : <View style={[d.recapThumb, d.thumbFallback]}><MaterialIcons name="checkroom" size={22} color={MUTED} /></View>
              }
            </Pressable>
            <View style={d.recapInfo}>
              <Text style={d.recapName} numberOfLines={2} ellipsizeMode="tail">{baseFlip.itemName || 'Unknown Item'}</Text>
              <View style={d.recapChips}>
                {!isUnknownStr(baseFlip.brand) && <View style={d.recapChip}><Text style={d.recapChipText} numberOfLines={1}>{baseFlip.brand}</Text></View>}
                {!isUnknownStr(baseFlip.category) && <View style={d.recapChip}><Text style={d.recapChipText} numberOfLines={1}>{baseFlip.category}</Text></View>}
                {!isUnknownStr(baseFlip.era) && <View style={d.recapChip}><Text style={d.recapChipText} numberOfLines={1}>{baseFlip.era}</Text></View>}
                {baseFlip.matchConfidence > 0 && (
                  <View style={[d.recapChip, d.recapChipConf]}><Text style={[d.recapChipText, { color: FOREST }]} numberOfLines={1}>{baseFlip.matchConfidence}% Conf</Text></View>
                )}
              </View>
              <View style={d.recapRatingRow}>
                <View style={[d.recapRatingBadge, { borderColor: theme.border, backgroundColor: theme.bg + '22' }]}>
                  <Text style={[d.recapRatingText, { color: theme.iconColor }]}>{canonicalRating}</Text>
                </View>
                {baseFlip.resaleValue > 0 && (
                  <Text style={d.recapResale}>Est. Resale <Text style={d.recapResaleVal}>${baseFlip.resaleValue}</Text></Text>
                )}
              </View>
            </View>
          </View>

          {/* History: editable thrift price — not shown for hunt_history */}
          {isHistory && !isHuntHistory && (
            <View style={d.card}>
              <DeepHead icon="edit" title="Update Thrift Price" />
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
            </View>
          )}

          {/* ── 3. Why this rating? (premium dark-green card) ── */}
          <View style={d.premiumCard}>
            <View style={d.premiumAccent} />
            <DeepHeadPremium icon="verified" title={ratingQuestion(canonicalRating)} />
            {whyBullets.map((b, i) => (
              <View key={i} style={d.premiumBulletRow}>
                <MaterialIcons name="chevron-right" size={16} color={GOLD} style={{ marginTop: 1 }} />
                <Text style={d.premiumBulletText}>{b}</Text>
              </View>
            ))}
          </View>

          {/* ── 4. Price logic ── */}
          <View style={d.card}>
            <DeepHead icon="payments" title="Price Logic" />
            <View style={d.priceLogicStats}>
              <PriceStat label="Est. Resale" value={baseFlip.resaleValue > 0 ? `$${baseFlip.resaleValue}` : '—'} />
              <PriceStat label="Max Buy"     value={`$${maxBuyShown}`} />
              <PriceStat label="Profit"      value={calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`} color={profitColor} />
              <PriceStat label="ROI"         value={calc.roi > 0 ? `${calc.roi}%` : '—'} />
            </View>
            <Text style={d.paragraph}>{priceText}</Text>
          </View>

          {/* ── 5. Risk flags ── */}
          <View style={d.card}>
            <View style={d.riskHeadRow}>
              <View style={d.riskHeadLeft}><DeepHead icon="shield" title="Risk Flags" /></View>
              <View style={[d.riskLevelPill, { backgroundColor: risk.color + '18', borderColor: risk.color + '55' }]}>
                <Text style={[d.riskLevelText, { color: risk.color }]} numberOfLines={1}>{risk.level}</Text>
              </View>
            </View>
            {risk.bullets.map((b, i) => (
              <View key={i} style={d.bulletRow}>
                <MaterialIcons name="fiber-manual-record" size={7} color={risk.color} style={{ marginTop: 6 }} />
                <Text style={d.bulletText}>{b}</Text>
              </View>
            ))}
          </View>

          {/* ── 6. Confidence breakdown ── */}
          <View style={d.card}>
            <View style={d.riskHeadRow}>
              <View style={d.riskHeadLeft}><DeepHead icon="insights" title="Confidence Breakdown" /></View>
              <Text style={d.confBig} numberOfLines={1}>{confB.pct > 0 ? `${confB.pct}%` : '—'}</Text>
            </View>
            <Text style={d.confSubHead}>Confident because</Text>
            {confB.confident.map((c, i) => (
              <View key={`c${i}`} style={d.bulletRow}>
                <MaterialIcons name="check-circle" size={13} color="#2A5A2A" style={{ marginTop: 2 }} />
                <Text style={d.bulletText}>{c}</Text>
              </View>
            ))}
            <Text style={[d.confSubHead, { marginTop: 10 }]}>Lower confidence because</Text>
            {confB.uncertain.map((c, i) => (
              <View key={`u${i}`} style={d.bulletRow}>
                <MaterialIcons name="help-outline" size={13} color={MUTED} style={{ marginTop: 2 }} />
                <Text style={d.bulletText}>{c}</Text>
              </View>
            ))}
          </View>

          {/* ── 7. Where to sell (platform strategy) ── */}
          <View style={d.card}>
            <DeepHead icon="storefront" title="Where to Sell" />
            <Text style={d.confSubHead}>Best Bets</Text>
            {platStrat.best.map((p, i) => (
              <View key={`b${i}`} style={d.platRow}>
                <View style={d.platNameBadge}><Text style={d.platNameText}>{p.name}</Text></View>
                <Text style={d.platNote}>{p.note}</Text>
              </View>
            ))}
            {platStrat.backup.length > 0 && (
              <>
                <Text style={[d.confSubHead, { marginTop: 10 }]}>Backup Platforms</Text>
                {platStrat.backup.map((p, i) => (
                  <View key={`bk${i}`} style={d.platRow}>
                    <View style={[d.platNameBadge, d.platNameBadgeMuted]}><Text style={[d.platNameText, { color: MUTED }]}>{p.name}</Text></View>
                    <Text style={d.platNote}>{p.note}</Text>
                  </View>
                ))}
              </>
            )}
          </View>

          {/* ── 8. Listing strategy ── */}
          <View style={d.card}>
            <DeepHead icon="sell" title="Listing Strategy" />
            <View style={d.priceLogicStats}>
              <PriceStat label="List Price" value={listStrat.listPriceRange} />
              <PriceStat label="Accept Above" value={listStrat.acceptAbove} />
            </View>
            <Text style={d.confSubHead}>Keywords</Text>
            <View style={d.kwWrap}>
              {listStrat.keywords.map((k, i) => (
                <View key={i} style={d.kwChip}><Text style={d.kwChipText}>{k}</Text></View>
              ))}
            </View>
            <Text style={[d.confSubHead, { marginTop: 10 }]}>Photos to take</Text>
            <Text style={d.inlineList}>{listStrat.photos.join(' · ')}</Text>
            <Text style={[d.confSubHead, { marginTop: 10 }]}>Details to mention</Text>
            <Text style={d.inlineList}>{listStrat.mention.join(' · ')}</Text>
          </View>

          {/* ── 9. Item evidence ── */}
          <View style={d.card}>
            <DeepHead icon="fact-check" title="Item Evidence" />
            {evidence.present.map((f, i) => (
              <View key={i} style={d.evidenceRow}>
                <Text style={d.evidenceLabel}>{f.label}</Text>
                <Text style={d.evidenceValue} numberOfLines={2}>{f.value}</Text>
              </View>
            ))}
            {evidence.missing.length > 0 && (
              <>
                <Text style={[d.confSubHead, { marginTop: 10 }]}>Missing / not visible</Text>
                <Text style={d.inlineList}>{evidence.missing.join(' · ')}</Text>
              </>
            )}
          </View>

          {/* ── 10. What could change this rating? ── */}
          <View style={d.card}>
            <DeepHead icon="tips-and-updates" title="What Could Change This Rating?" />
            {changeItems.map((c, i) => (
              <View key={i} style={d.bulletRow}>
                <MaterialIcons name="chevron-right" size={15} color={GOLD} style={{ marginTop: 2 }} />
                <Text style={d.bulletText}>{c}</Text>
              </View>
            ))}
          </View>

          {/* Listings (generate / view) */}
          <View style={d.card}>
            <DeepHead icon="description" title="Listings" />
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

          {/* ── 11. Back to Analysis ── */}
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [d.backToSummaryBtn, { marginTop: 4 }, pressed && { opacity: 0.88 }]}
          >
            <MaterialIcons name="arrow-back" size={18} color={CREAM} />
            <Text style={d.backToSummaryText}>Back to Analysis</Text>
          </Pressable>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const d = StyleSheet.create({
  scroll:    { backgroundColor: BG, paddingBottom: 40 },
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
  thumbFallback:  { backgroundColor: '#FFFEFA', justifyContent: 'center', alignItems: 'center' },
  thumbZoomBadge: { position: 'absolute', bottom: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 6, padding: 2 },
  summaryInfo:    { flex: 1, gap: 4 },
  summaryName:    { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '700', color: FOREST, lineHeight: 22, flexShrink: 1 },
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

  // Data rows — label intrinsic width, value immediately after, gap: 8
  dataRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  dataLabel:        { fontSize: 13, color: BROWN },   // no fixed width — sizes to text
  dataValue:        { fontSize: 13, fontWeight: '600', color: FOREST },
  dataValueInline:  { flexShrink: 1 },               // non-overflow: shrinks if needed, no scroll
  // Overflow rows: fill remaining space, clip at edge, scroll to reveal
  dataOverflowWrap: { flex: 1, overflow: 'hidden' },
  // Fade — thin cream sliver at the far right of the overflow container only
  chevron: { fontSize: 13, color: '#BE9C2C', marginLeft: 2, lineHeight: 18, alignSelf: 'center' },
  smallNote: { fontSize: 10, color: MUTED, marginTop: 8, fontStyle: 'italic', lineHeight: 14 },

  // Two-column layout with divider
  twoCol:      { flexDirection: 'row', gap: 0 },
  colLeft:     { flex: 1, paddingRight: 8 },
  colRight:    { flex: 1, paddingLeft: 8 },
  colDivider:  { width: 1, backgroundColor: CARD_B, marginVertical: 2 },
  // Item Details columns — left sizes to content, right fills remainder
  // PriceRow — used in Price Breakdown, full-width, value never clips
  priceRow2:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  priceLabel2:   { fontSize: 13, color: BROWN, flex: 1, marginRight: 8 },
  priceValue2:   { fontSize: 13, fontWeight: '600', color: FOREST, minWidth: 70, textAlign: 'right' },
  priceRowDivider:{ height: 1, backgroundColor: CARD_B, marginVertical: 6 },

  // ItemDetailRow — each pair is ONE flex row, so both sides share height automatically
  itemDetailRow: {
    flexDirection: 'row',
    alignItems:    'stretch',    // both cells stretch to the taller side's height
    paddingVertical: 2,
  },
  itemDetailDivider: {
    width: 1,
    backgroundColor: CARD_B,
    marginHorizontal: 10,
    alignSelf: 'stretch',
  },
  // Cell styles — flex is set dynamically via ItemDetailsGrid, not static
  dataCell:      { justifyContent: 'center', paddingVertical: 4 },
  dataCellInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dataCellScroll:{ flex: 1, minWidth: 0 },

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
  warningBanner:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FFFEFA', borderRadius: 10, borderWidth: 1, borderColor: '#C07030' + '50', marginHorizontal: 14, marginTop: 10, padding: 12 },
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

  // ════════ DEEP ANALYSIS REDESIGN STYLES ════════
  deepHead:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  deepHeadIcon:    { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(190,156,44,0.14)', borderWidth: 1, borderColor: 'rgba(190,156,44,0.4)', alignItems: 'center', justifyContent: 'center' },
  deepHeadTitle:   { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: '800', color: FOREST, flex: 1 },
  deepHeadIconPrem:{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  deepHeadTitlePrem:{ fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: '800', color: CREAM, flex: 1 },

  recapCard: {
    flexDirection: 'row', gap: 12, backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: CARD_B,
    marginHorizontal: 14, marginTop: 12, padding: 12, alignItems: 'center',
    shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  recapThumbWrap: { width: 76, height: 76, borderRadius: 12, overflow: 'hidden' },
  recapThumb:     { width: '100%', height: '100%', backgroundColor: '#FFFEFA' },
  recapInfo:      { flex: 1, minWidth: 0, gap: 6 },
  recapName:      { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: FOREST, lineHeight: 20 },
  recapChips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  recapChip:      { backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 50, paddingHorizontal: 7, paddingVertical: 2 },
  recapChipConf:  { borderColor: '#7CA87C', backgroundColor: '#EFF6EC' },
  recapChipText:  { fontSize: 9.5, fontWeight: '700', color: BROWN },
  recapRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 1 },
  recapRatingBadge:{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  recapRatingText:{ fontSize: 10, fontWeight: '800', letterSpacing: 0.4, fontFamily: FONTS.serif },
  recapResale:    { fontSize: 11, color: MUTED, fontWeight: '600' },
  recapResaleVal: { color: GOLD, fontWeight: '800', fontFamily: FONTS.serif },

  premiumCard: {
    backgroundColor: '#1E3A20', borderRadius: 16, marginHorizontal: 14, marginTop: 12,
    paddingTop: 0, paddingBottom: 14, paddingHorizontal: 15, overflow: 'hidden',
    shadowColor: '#0A1A0A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  premiumAccent:  { height: 3, backgroundColor: GOLD, marginHorizontal: -15, marginBottom: 14 },
  premiumBulletRow:{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 8 },
  premiumBulletText:{ flex: 1, fontSize: 13, lineHeight: 19, color: '#EDE6D2' },

  bulletRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 7 },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 19, color: BROWN },
  paragraph:  { fontSize: 13, lineHeight: 20, color: BROWN, marginTop: 4 },

  priceLogicStats: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  priceStat:       { flex: 1, backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center' },
  priceStatVal:    { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: FOREST },
  priceStatLabel:  { fontSize: 9, fontWeight: '700', color: MUTED, marginTop: 2, letterSpacing: 0.3, textTransform: 'uppercase' },

  riskHeadRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  riskHeadLeft:  { flex: 1, minWidth: 0 },
  riskLevelPill: { flexShrink: 0, borderWidth: 1, borderRadius: 50, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 4 },
  riskLevelText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  confBig:     { flexShrink: 0, fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: GOLD, marginBottom: 4 },
  confSubHead: { fontSize: 11, fontWeight: '800', color: FOREST, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 },

  platRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  platNameBadge:    { backgroundColor: FOREST, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4, minWidth: 68, alignItems: 'center' },
  platNameBadgeMuted:{ backgroundColor: 'transparent', borderWidth: 1, borderColor: CARD_B },
  platNameText:     { fontSize: 11.5, fontWeight: '800', color: CREAM, fontFamily: FONTS.serif },
  platNote:         { flex: 1, fontSize: 12, lineHeight: 17, color: BROWN },

  kwWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  kwChip:     { backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 50, paddingHorizontal: 9, paddingVertical: 4 },
  kwChipText: { fontSize: 11, fontWeight: '600', color: BROWN },
  inlineList: { fontSize: 12.5, lineHeight: 19, color: BROWN },

  evidenceRow:   { flexDirection: 'row', gap: 10, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F4F1E8' },
  evidenceLabel: { width: 90, fontSize: 12, fontWeight: '800', color: FOREST },
  evidenceValue: { flex: 1, fontSize: 12.5, color: BROWN, lineHeight: 17 },
});