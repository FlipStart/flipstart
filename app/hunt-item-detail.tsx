/**
 * app/hunt-item-detail.tsx
 */

import {
  View, Text, Pressable, StyleSheet, Alert,
  TextInput, Platform, Modal, TouchableWithoutFeedback,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useEffect, useRef, useMemo } from 'react';

import { useScanContext }                                  from '@/lib/scan-context';
import { isHuntActive, addItemToHunt, computeHuntRating, markReturningFromHuntItemDetail } from '@/lib/hunt-context';
import { logHuntItemSaved, logHuntItemRemoved } from '@/lib/analytics';
import { useFlipStore }                                    from '@/lib/useFlipStore';
import { FONTS }                                           from '@/constants/typography';
import { computeFlipCalc }                                 from '@/utils/flipCalculations';
import { REC_THEMES }                                      from '@/utils/recommendation';

const BG     = '#F0E8D4';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';
const RED    = '#8A2A1A';

const HUNT_BADGE: Record<string, {
  label: string; emoji: string;
  bg: string; border: string; text: string; glow?: string;
}> = {
  STRONG_BUY: { label: 'Legendary', emoji: '👑', bg: '#2A1E04', border: '#D4A72C', text: '#D4A72C', glow: '#D4A72C44' },
  BUY:        { label: 'Treasure',  emoji: '💰', bg: '#1A2A06', border: '#BE9C2C', text: '#BE9C2C' },
  RISKY_BUY:  { label: 'Risky',    emoji: '⚠️', bg: '#2A1A04', border: '#C89020', text: '#C89020' },
  SKIP:       { label: 'Trash',    emoji: '🤮', bg: '#1A1A1A', border: '#444',    text: '#888'    },
};

export default function HuntItemDetailScreen() {
  const router     = useRouter();
  const navigation = useNavigation();
  const insets     = useSafeAreaInsets();

  const { currentScan, setCurrentScan } = useScanContext();
  const { addFlip, pendingThriftPrices, setPendingThriftPrice } = useFlipStore();

  const [imgIndex,       setImgIndex]       = useState(0);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const allowNavRef = useRef(false);

  const scanId         = currentScan?.id ?? '';
  const thriftPriceStr = pendingThriftPrices[scanId] ?? '';
  const thriftPrice    = parseFloat(thriftPriceStr) || 0;
  const resaleValue    = currentScan?.market_data?.adjusted_estimated_value ?? 0;

  const calc = useMemo(() => computeFlipCalc(
    resaleValue,
    thriftPrice || currentScan?.market_data?.suggested_buy_price || 0,
    currentScan?.risk_analysis?.match_confidence ?? 0,
    currentScan?.market_data?.competition_level ?? '',
    currentScan?.identification?.style_labels ?? [],
    currentScan?.identification?.estimated_era ?? '',
    currentScan?.market_data?.demand ?? '',
    currentScan?.market_data?.sell_speed ?? '',
  ), [thriftPrice, resaleValue, scanId]);

  const profit = thriftPrice > 0 ? calc.profit : null;

  useEffect(() => {
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (allowNavRef.current) return;
      e.preventDefault();
      setConfirmVisible(true);
    });
    return unsub;
  }, [navigation]);

  useEffect(() => {
    if (!currentScan) {
      allowNavRef.current = true;
      router.back();
    }
  }, [currentScan]);

  if (!currentScan) return null;

  const md    = currentScan.market_data;
  const id    = currentScan.identification;
  const ra    = currentScan.risk_analysis;
  const rec   = calc.recommendation;
  const badge = HUNT_BADGE[rec?.label ?? 'SKIP'] ?? HUNT_BADGE.SKIP;

  const images: string[] = [currentScan.imageUri].filter(Boolean);

  const profit$     = profit !== null ? `${profit >= 0 ? '+' : ''}$${profit}` : '—';
  const profitColor = profit !== null ? (profit >= 0 ? '#2A6A2A' : '#8A2A2A') : MUTED;
  const profitSub   = profit !== null ? 'after fees' : 'enter price';

  const goBack = () => {
    allowNavRef.current = true;
    router.back();
  };

  const handleSave = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    addFlip({
      id:               currentScan.id,
      imageUri:         currentScan.imageUri,
      timestamp:        Date.now(),
      itemName:         id.item_name,
      brand:            id.brand,
      category:         id.category,
      era:              id.estimated_era ?? '',
      styleLabels:      id.style_labels ?? [],
      material:         id.material_guess ?? '',
      resaleValue,
      resaleRangeLow:   md.estimated_resale_range?.low  ?? resaleValue,
      resaleRangeHigh:  md.estimated_resale_range?.high ?? resaleValue,
      avgSoldPrice:     md.average_sold_price ?? resaleValue,
      demand:           (md.demand as 'High' | 'Medium' | 'Low') ?? 'Medium',
      sellSpeed:        (md.sell_speed as 'Fast' | 'Moderate' | 'Slow') ?? 'Moderate',
      competitionLevel: md.competition_level ?? '',
      matchConfidence:  ra.match_confidence,
      riskFlags:        ra.risk_flags ?? [],
      thriftPrice,
      fees:             calc.fees,
      profit:           calc.profit,
      roi:              calc.roi,
      buyScore:         calc.buyScore,
      buyLabel:         calc.buyLabel,
      stars:            calc.stars,
      bestPlatform:     calc.bestPlatform,
      listingsGenerated: false,
      generatedAt:      null,
      listingData:      null,
    });
    if (isHuntActive()) {
      try {
        addItemToHunt({
          scanId:         currentScan.id,
          itemName:       id.item_name,
          brand:          id.brand,
          category:       id.category,
          imageUri:       currentScan.imageUri,
          estimatedValue: resaleValue,
          thriftPrice,
          profit:         profit ?? calc.profit,
          kept:           true,
          huntRating:     computeHuntRating(profit ?? calc.profit, ra.match_confidence),
          addedAt:        Date.now(),
        });
      } catch {}
    }
    setCurrentScan(null);
    // Mark intent ONLY here — confirmed save path — so hunt-active skips End Hunt modal
    logHuntItemSaved({
      profit:         profit ?? calc.profit,
      recommendation: rec?.label ?? 'UNKNOWN',
      category:       id.category ?? '',
    });
    markReturningFromHuntItemDetail();
    goBack();
  };

  const handleRemove = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setCurrentScan(null);
    // Mark intent ONLY here — confirmed remove path — so hunt-active skips End Hunt modal
    logHuntItemRemoved({
      recommendation: rec?.label ?? 'UNKNOWN',
      category:       id.category ?? '',
    });
    markReturningFromHuntItemDetail();
    goBack();
  };

  const marketRows = [
    {
      label: 'Est. Resale',
      value: md.estimated_resale_range
        ? `$${md.estimated_resale_range.low}–$${md.estimated_resale_range.high}`
        : `$${resaleValue}`,
    },
    { label: 'Sell-Through Rate', value: md.demand ? `${md.demand}${md.sell_speed ? ` (${md.sell_speed})` : ''}` : '—' },
    { label: 'Risk',          value: ra.match_confidence >= 70 ? 'Low' : ra.match_confidence >= 45 ? 'Medium' : 'High' },
    { label: 'Best Platform', value: String(calc.bestPlatform ?? '—') },
    ...(md.competition_level ? [{ label: 'Competition', value: md.competition_level }] : []),
  ];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable onPress={() => setConfirmVisible(true)} hitSlop={12} style={s.headerBtn}>
          <MaterialIcons name="arrow-back" size={22} color={BROWN} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerMode}>♦  HUNT MODE  ♦</Text>
          <Text style={s.headerTitle}>Discovery Analysis</Text>
        </View>
        <Pressable
          onPress={() => Alert.alert('🗺️ Map', 'Map system coming soon!', [{ text: 'Got it' }])}
          hitSlop={12}
          style={s.headerBtn}
        >
          <MaterialIcons name="map" size={22} color={BROWN} />
        </Pressable>
      </View>

      {/* ── Image ── */}
      <Pressable onPress={() => setPreviewVisible(true)} style={s.imageWrap}>
        <Image
          source={{ uri: images[imgIndex] }}
          style={s.image}
          contentFit="cover"
        />
        {images.length > 0 && (
          <View style={s.imageBadge}>
            <Text style={s.imageBadgeText}>{imgIndex + 1} / {images.length}</Text>
          </View>
        )}
        {images.length > 1 && imgIndex > 0 && (
          <Pressable
            onPress={e => { e.stopPropagation(); setImgIndex(i => i - 1); }}
            style={[s.imgArrow, s.imgArrowL]} hitSlop={8}
          >
            <MaterialIcons name="chevron-left" size={24} color={BROWN} />
          </Pressable>
        )}
        {images.length > 1 && imgIndex < images.length - 1 && (
          <Pressable
            onPress={e => { e.stopPropagation(); setImgIndex(i => i + 1); }}
            style={[s.imgArrow, s.imgArrowR]} hitSlop={8}
          >
            <MaterialIcons name="chevron-right" size={24} color={BROWN} />
          </Pressable>
        )}
      </Pressable>

      {/* ── Item identity ── */}
      <View style={s.identity}>
        <Text style={s.itemName} numberOfLines={1}>{id.item_name}</Text>
        <Text style={s.itemMeta} numberOfLines={1}>
          {[id.brand, id.category, id.estimated_era].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {/* ── Decision row ── */}
      <View style={s.decisionRow}>
        <View style={[
          s.badge,
          { backgroundColor: badge.bg, borderColor: badge.border },
          badge.glow && { shadowColor: badge.glow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
        ]}>
          <Text style={s.badgeEmoji}>{badge.emoji}</Text>
          <Text style={[s.badgeLabel, { color: badge.text }]}>{badge.label.toUpperCase()}</Text>
        </View>

        <View style={s.priceBox}>
          <Text style={s.boxLabel}>Thrift Price</Text>
          <View style={s.priceInputRow}>
            <Text style={s.priceDollar}>$</Text>
            <TextInput
              style={s.priceInput}
              value={thriftPriceStr}
              onChangeText={t => { if (/^\d*\.?\d*$/.test(t)) setPendingThriftPrice(scanId, t); }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={BROWN}
              returnKeyType="done"
            />
          </View>
          {!thriftPriceStr && (
            <Text style={s.profitSub}>Enter price</Text>
          )}
        </View>

        <View style={s.profitBox}>
          <Text style={s.boxLabel}>Est. Profit</Text>
          <Text style={[s.profitValue, { color: profitColor }]}>{profit$}</Text>
          {profit !== null && <Text style={s.profitSub}>after fees</Text>}
        </View>
      </View>

      {/* ── Full market data card ── */}
      <View style={s.marketCard}>
        {marketRows.map(({ label, value }, i) => (
          <View key={label} style={[s.marketRow, i === marketRows.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={s.marketLabel}>{label}</Text>
            <Text style={s.marketValue}>{value}</Text>
          </View>
        ))}
        {ra.match_confidence > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8 }}>
            <MaterialIcons name="verified-user" size={12} color={MUTED} />
            <Text style={s.confidence}>{ra.match_confidence}% match confidence</Text>
          </View>
        )}
      </View>

      {/* Flex spacer */}
      <View style={{ flex: 1 }} />

      {/* ── Actions — side by side, lifted off the bottom ── */}
      <View style={[s.actions, { paddingBottom: Math.max(insets.bottom + 24, 40) }]}>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="add-circle-outline" size={18} color={CREAM} />
          <Text style={s.saveBtnText}>SAVE TO HUNT</Text>
        </Pressable>
        <Pressable
          onPress={() => Alert.alert(
            'Remove Item?',
            'This item will not be saved to your hunt.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: handleRemove },
            ]
          )}
          style={({ pressed }) => [s.removeBtn, pressed && { opacity: 0.75 }]}
        >
          <MaterialIcons name="delete-outline" size={16} color={CREAM} />
          <Text style={s.removeBtnText}>Remove</Text>
        </Pressable>
      </View>

      {/* ── Fullscreen image preview ── */}
      <Modal visible={previewVisible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setPreviewVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setPreviewVisible(false)}>
          <View style={s.previewOverlay}>
            <Image
              source={{ uri: images[imgIndex] }}
              style={s.previewImage}
              contentFit="contain"
            />
            <Pressable onPress={() => setPreviewVisible(false)} style={s.previewClose}>
              <MaterialIcons name="close" size={22} color={CREAM} />
            </Pressable>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Keep/discard confirmation modal ── */}
      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Keep this find?</Text>
            <Text style={s.modalSub}>Choose what to do with this item.</Text>
            <Pressable onPress={() => { setConfirmVisible(false); handleSave(); }} style={s.modalSave}>
              <Text style={s.modalSaveText}>Save to Hunt</Text>
            </Pressable>
            <Pressable onPress={() => { setConfirmVisible(false); handleRemove(); }} style={s.modalRemove}>
              <Text style={s.modalRemoveText}>Remove Item</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmVisible(false)} style={s.modalCancel}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CARD_B },
  headerBtn:   { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: CARD_B + '50' },
  headerCenter:{ flex: 1, alignItems: 'center', gap: 1 },
  headerMode:  { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2 },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: BROWN },

  imageWrap:      { marginHorizontal: 8, marginTop: 12, borderRadius: 16, overflow: 'hidden', height: 248, backgroundColor: CARD_B, position: 'relative' },
  image:          { width: '100%', height: '100%' },
  imageBadge:     { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.60)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  imageBadgeText: { fontSize: 11, color: '#FFF', fontWeight: '600' },
  imgArrow:       { position: 'absolute', top: '50%', marginTop: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.85)', justifyContent: 'center', alignItems: 'center' },
  imgArrowL:      { left: 10 },
  imgArrowR:      { right: 10 },

  identity: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, gap: 3 },
  itemName: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: BROWN },
  itemMeta: { fontSize: 13, color: MUTED },

  decisionRow: { flexDirection: 'row', alignItems: 'stretch', marginHorizontal: 16, marginTop: 10, gap: 8 },
  badge:       { width: 90, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, gap: 5 },
  badgeEmoji:  { fontSize: 20 },
  badgeLabel:  { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center' },

  priceBox:      { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_B, borderRadius: 12, padding: 12, alignItems: 'center' },
  boxLabel:      { fontSize: 9, fontWeight: '700', color: MUTED, letterSpacing: 0.8, marginBottom: 6, textAlign: 'center' },
  priceInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1 },
  priceDollar:   { fontSize: 18, fontWeight: '800', color: BROWN },
  priceInput:    { flex: 1, fontSize: 20, fontWeight: '800', color: BROWN, padding: 0 },

  profitBox:   { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_B, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
  profitValue: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800' },
  profitSub:   { fontSize: 9, color: MUTED, marginTop: 3 },

  // Actions — no border line, marginTop: 8 (moved up slightly vs market card's marginTop: 14)
  actions:      { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, gap: 10, backgroundColor: BG, marginTop: 8 },
  saveBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: FOREST, borderRadius: 12, paddingVertical: 15, shadowColor: '#0A1A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  saveBtnText:  { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: CREAM, letterSpacing: 0.8 },
  removeBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7A1F1F', borderRadius: 12, paddingVertical: 15, shadowColor: '#3A0808', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  removeBtnText:{ fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: CREAM, letterSpacing: 0.8 },

  // Market card — marginTop: 14 (moved down slightly vs actions above it)
  marketCard:  { marginHorizontal: 16, marginTop: 10, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_B, borderRadius: 12 },
  marketRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: CARD_B + '70' },
  marketLabel: { fontSize: 13, color: MUTED },
  marketValue: { fontSize: 13, fontWeight: '700', color: BROWN },
  confidence:  { fontSize: 10, color: MUTED },

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.93)', justifyContent: 'center', alignItems: 'center' },
  previewImage:   { width: '100%', height: '80%' },
  previewClose:   { position: 'absolute', top: 52, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(60,40,20,0.80)', justifyContent: 'center', alignItems: 'center' },

  modalOverlay:    { flex: 1, backgroundColor: 'rgba(10,6,2,0.65)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  modalCard:       { width: '100%', backgroundColor: CARD, borderRadius: 20, padding: 24, gap: 12, borderWidth: 1, borderColor: CARD_B },
  modalTitle:      { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: BROWN, textAlign: 'center' },
  modalSub:        { fontSize: 13, color: MUTED, textAlign: 'center', marginBottom: 4 },
  modalSave:       { backgroundColor: FOREST, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalSaveText:   { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: CREAM, letterSpacing: 1 },
  modalRemove:     { borderWidth: 1.5, borderColor: RED + '55', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalRemoveText: { fontSize: 14, fontWeight: '700', color: RED },
  modalCancel:     { alignItems: 'center', paddingVertical: 8 },
  modalCancelText: { fontSize: 14, color: MUTED },
});