/**
 * app/hunt-item-detail.tsx
 *
 * Hunt Mode Discovery Analysis screen.
 *
 * Modes:
 *   - Active scan (default): mode undefined / mode=active
 *     Shows Save to Hunt + Remove buttons.
 *     Requires thrift price before saving.
 *
 *   - Read-only: mode=readonly&huntItemId=<id>
 *     Looks up HuntItem from active hunt by huntItemId.
 *     Hides Save/Remove buttons.
 *     Shows all photos captured during the hunt scan.
 *
 * Navigation:
 *   - Save to Hunt → router.replace('/hunt-active') — explicit, never goBack()
 *   - Remove       → router.replace('/hunt-active') — explicit, never goBack()
 *   - Back arrow   → shows "Keep this find?" confirmation modal (active mode)
 *                  → router.back() (read-only mode — safe, no modal stack issue)
 *
 * Why router.replace not router.back():
 *   loading.tsx uses router.replace("/hunt-item-detail") which puts hunt-item-detail
 *   inside loading's fullScreenModal stack. router.back() from inside a modal stack
 *   dismisses the whole modal group → lands on Home. router.replace('/hunt-active')
 *   exits the modal stack and lands on the correct screen unconditionally.
 */

import {
  View, Text, Pressable, StyleSheet, Alert,
  TextInput, Platform, Modal, TouchableWithoutFeedback,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useNavigation, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useEffect, useRef, useMemo } from 'react';

import { useScanContext }       from '@/lib/scan-context';
import {
  isHuntActive, addItemToHunt, recLabelToHuntRating,
  markReturningFromHuntItemDetail, getHuntItemById,
  type HuntItem,
} from '@/lib/hunt-context';
import { useFlipStore }         from '@/lib/useFlipStore';
import { isHuntBundle }         from '@/types/flip';
import { FONTS }                from '@/constants/typography';
import { computeFlipCalc }      from '@/utils/flipCalculations';
import { logHuntItemSaved, logHuntItemRemoved } from '@/lib/analytics';

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

// ─── Hunt badge config ────────────────────────────────────────────────────────
// C: SKIP replaces TRASH (label + emoji + color)
// D: LEGENDARY LOOT replaces LEGENDARY

const HUNT_BADGE: Record<string, {
  label: string; emoji: string;
  bg: string; border: string; text: string; glow?: string;
}> = {
  STRONG_BUY: { label: 'Legendary Loot', emoji: '👑', bg: '#2A1E04', border: '#D4A72C', text: '#D4A72C', glow: '#D4A72C44' },
  BUY:        { label: 'Treasure',       emoji: '💰', bg: '#1A2A06', border: '#BE9C2C', text: '#BE9C2C' },
  RISKY_BUY:  { label: 'Risky',          emoji: '⚠️', bg: '#2A1A04', border: '#C89020', text: '#C89020' },
  SKIP:       { label: 'Skip',           emoji: '✕',  bg: '#6B1414', border: '#E05555', text: '#FFDADA', glow: '#E0555522' },
};

// ─── Early-return error styles (defined before component — s is after) ────────

const es = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#F0E8D4', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingTop: 60 },
  text:    { fontFamily: 'serif', fontSize: 17, color: '#5A3A1A', marginTop: 12, marginBottom: 20 },
  btn:     { backgroundColor: '#5A3A1A', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  btnText: { fontSize: 14, fontWeight: '700', color: '#F4EED8' },
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function HuntItemDetailScreen() {
  const router     = useRouter();
  const navigation = useNavigation();
  const insets     = useSafeAreaInsets();
  const params     = useLocalSearchParams<{ mode?: string; huntItemId?: string }>();

  const isReadOnly  = params.mode === 'readonly';
  const huntItemId  = params.huntItemId ?? null;

  const { currentScan, setCurrentScan } = useScanContext();
  const { pendingThriftPrices, setPendingThriftPrice, flips } = useFlipStore();

  // ── ALL hooks before any conditional return ──────────────────────────────
  const [imgIndex,          setImgIndex]          = useState(0);
  const [confirmVisible,    setConfirmVisible]    = useState(false);
  const [previewVisible,    setPreviewVisible]    = useState(false);
  const [priceModalVisible, setPriceModalVisible] = useState(false);
  const allowNavRef = useRef(false);

  // Read-only: look up hunt item by stable ID.
  // Checks active hunt first, then falls back to saved bundles in flip history
  // so diamonds found in completed hunts can still be viewed.
  const readOnlyItem: HuntItem | null = useMemo(() => {
    if (!isReadOnly || !huntItemId) return null;
    const fromActive = getHuntItemById(huntItemId);
    if (fromActive) return fromActive;
    // Search completed hunt bundles in saved history.
    for (const entry of flips) {
      if (isHuntBundle(entry)) {
        const found = [...entry.keptItems, ...entry.removedItems]
          .find(i => i.huntItemId === huntItemId);
        if (found) return found as unknown as HuntItem;
      }
    }
    return null;
  }, [isReadOnly, huntItemId, flips]);

  // Derive the scan data source: read-only uses stored snapshot, active uses currentScan
  const scan = isReadOnly ? readOnlyItem?.scanSnapshot ?? null : currentScan;

  const scanId         = scan?.id ?? '';
  const thriftPriceStr = pendingThriftPrices[scanId] ?? '';
  const thriftPrice    = parseFloat(thriftPriceStr) || 0;
  const resaleValue    = scan?.market_data?.adjusted_estimated_value ?? 0;

  // D: Price formatting — always 2 decimals, no more
  const handlePriceChange = (t: string) => {
    // Strip anything that's not a digit or single decimal point
    const cleaned = t.replace(/[^0-9.]/g, '');
    // Only allow one decimal point
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    // Max 2 digits after decimal
    if (parts[1] !== undefined && parts[1].length > 2) return;
    setPendingThriftPrice(scanId, cleaned);
  };

  const handlePriceBlur = () => {
    if (!thriftPriceStr) return;
    const n = parseFloat(thriftPriceStr);
    if (!isNaN(n) && n > 0) {
      setPendingThriftPrice(scanId, n.toFixed(2));
    }
  };

  // B: price display uses thriftPrice.toFixed(2) directly in JSX

  const calc = useMemo(() => computeFlipCalc(
    resaleValue,
    thriftPrice || (isReadOnly ? (readOnlyItem?.thriftPrice ?? 0) : (scan?.market_data?.suggested_buy_price ?? 0)),
    scan?.risk_analysis?.match_confidence ?? 0,
    scan?.market_data?.competition_level ?? '',
    scan?.identification?.style_labels ?? [],
    scan?.identification?.estimated_era ?? '',
    scan?.market_data?.demand ?? '',
    scan?.market_data?.sell_speed ?? '',
  ), [thriftPrice, resaleValue, scanId, isReadOnly]);

  const profit = thriftPrice > 0
    ? calc.profit
    : (isReadOnly && readOnlyItem && readOnlyItem.thriftPrice > 0)
      ? readOnlyItem.profit
      : null;

  // E: Multi-photo — use allImageUris if present, fall back to single imageUri
  const images: string[] = useMemo(() => {
    if (isReadOnly && readOnlyItem) {
      return readOnlyItem.allImageUris?.length
        ? readOnlyItem.allImageUris
        : [readOnlyItem.imageUri].filter(Boolean);
    }
    return (scan?.allImageUris?.length
      ? scan.allImageUris
      : [scan?.imageUri].filter(Boolean)) as string[];
  }, [isReadOnly, readOnlyItem, scan]);

  // Navigation guard — only in active mode
  useEffect(() => {
    if (isReadOnly) return; // read-only: no guard needed
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (allowNavRef.current) return;
      e.preventDefault();
      setConfirmVisible(true);
    });
    return unsub;
  }, [navigation, isReadOnly]);

  // Redirect if scan gone (hot reload etc) — only in active mode
  useEffect(() => {
    if (isReadOnly) return;
    if (!currentScan) {
      allowNavRef.current = true;
      router.back();
    }
  }, [currentScan, isReadOnly]);

  // ── Guard — after all hooks ────────────────────────────────────────────────
  if (isReadOnly) {
    if (!readOnlyItem || !scan) {
      return (
        <View style={es.wrap}>
          <MaterialIcons name="search-off" size={40} color={MUTED} />
          <Text style={es.text}>Item not found</Text>
          <Pressable onPress={() => router.back()} style={es.btn}>
            <Text style={es.btnText}>Back to Hunt</Text>
          </Pressable>
        </View>
      );
    }
  } else {
    if (!currentScan) return null;
  }

  const md  = scan!.market_data;
  const id  = scan!.identification;
  const ra  = scan!.risk_analysis;
  const rec = calc.recommendation;
  const badge = HUNT_BADGE[rec?.label ?? 'SKIP'] ?? HUNT_BADGE.SKIP;

  // B: Thrift price — show as negative red cost
  const displayThriftPrice = isReadOnly && readOnlyItem
    ? readOnlyItem.thriftPrice
    : thriftPrice;
  const profit$ = profit !== null
    ? `${profit >= 0 ? '+' : ''}$${Math.abs(profit)}`
    : '—';
  const profitColor = profit !== null
    ? (profit >= 0 ? '#2A6A2A' : '#8A2A2A')
    : MUTED;

  const goBack = () => {
    allowNavRef.current = true;
    router.back();
  };

  // A: Require thrift price before saving
  const handleSave = () => {
    if (!thriftPriceStr || parseFloat(thriftPriceStr) <= 0) {
      setPriceModalVisible(true);
      return;
    }
    _doSave();
  };

  const _doSave = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

    const finalThriftPrice = parseFloat(thriftPriceStr) || 0;
    const finalProfit      = computeFlipCalc(
      resaleValue, finalThriftPrice,
      ra.match_confidence, md.competition_level ?? '',
      id.style_labels ?? [], id.estimated_era ?? '',
      md.demand ?? '', md.sell_speed ?? '',
    ).profit;

    // F: Do NOT add to normal scan history (addFlip) during hunt mode
    if (isHuntActive()) {
      try {
        addItemToHunt({
          huntItemId:     `hi_${currentScan!.id}`,   // stable — scanId is unique per scan
          scanId:         currentScan!.id,
          itemName:       id.item_name,
          brand:          id.brand,
          category:       id.category,
          imageUri:       currentScan!.imageUri,
          allImageUris:   currentScan!.allImageUris ?? [currentScan!.imageUri],
          estimatedValue: resaleValue,
          thriftPrice:    finalThriftPrice,
          profit:         finalProfit,
          kept:           true,
          huntRating:     recLabelToHuntRating(rec?.label),
          addedAt:        Date.now(),
          scanSnapshot:   currentScan!,
        });
        logHuntItemSaved({
          profit:         finalProfit,
          recommendation: rec?.label ?? 'UNKNOWN',
          category:       id.category ?? '',
        });
      } catch {}
    }
    setCurrentScan(null);
    markReturningFromHuntItemDetail();
    console.log('[HUNT SAVE] navigating to hunt-active');
    router.replace('/hunt-active' as any);
  };

  // G: Remove — add to hunt removed list, go back to hunt-active
  const handleRemove = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    if (isHuntActive() && currentScan) {
      try {
        addItemToHunt({
          huntItemId:     `hi_${currentScan.id}`,   // stable — same scanId = same hunt item
          scanId:         currentScan.id,
          itemName:       id.item_name,
          brand:          id.brand,
          category:       id.category,
          imageUri:       currentScan.imageUri,
          allImageUris:   currentScan.allImageUris ?? [currentScan.imageUri],
          estimatedValue: resaleValue,
          thriftPrice:    0,
          profit:         0,
          kept:           false,
          huntRating:     recLabelToHuntRating(rec?.label),
          addedAt:        Date.now(),
          scanSnapshot:   currentScan,
        });
        logHuntItemRemoved({
          recommendation: rec?.label ?? 'UNKNOWN',
          category:       id.category ?? '',
        });
      } catch {}
    }
    setCurrentScan(null);
    markReturningFromHuntItemDetail();
    console.log('[HUNT SAVE] navigating to hunt-active (remove)');
    router.replace('/hunt-active' as any);
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
        <Pressable
          onPress={() => isReadOnly ? goBack() : setConfirmVisible(true)}
          hitSlop={12} style={s.headerBtn}
        >
          <MaterialIcons name="arrow-back" size={22} color={BROWN} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerMode}>♦  HUNT MODE  ♦</Text>
          <Text style={s.headerTitle}>Discovery Analysis</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* ── Image — E: multi-photo carousel ── */}
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
        {/* C: SKIP badge — red bg */}
        <View style={[
          s.badge,
          { backgroundColor: badge.bg, borderColor: badge.border },
          badge.glow && { shadowColor: badge.glow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
        ]}>
          <Text style={s.badgeEmoji}>{badge.emoji}</Text>
          <Text style={[s.badgeLabel, { color: badge.text }]}>{badge.label.toUpperCase()}</Text>
        </View>

        {/* B: Thrift price — negative, red, centered */}
        <View style={s.priceBox}>
          <Text style={s.boxLabel}>Thrift Price</Text>
          {isReadOnly ? (
            <Text style={s.priceReadOnly}>
              {displayThriftPrice > 0 ? `-$${displayThriftPrice.toFixed(2)}` : '-$0.00'}
            </Text>
          ) : (
            <View style={s.priceInputRow}>
              <Text style={s.priceMinus}>-$</Text>
              <TextInput
                style={s.priceInput}
                value={thriftPriceStr}
                onChangeText={handlePriceChange}
                onBlur={handlePriceBlur}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={RED + '88'}
                returnKeyType="done"
              />
            </View>
          )}
          {!thriftPriceStr && !isReadOnly && (
            <Text style={s.priceHint}>Enter price</Text>
          )}
        </View>

        {/* Est. Profit */}
        <View style={s.profitBox}>
          <Text style={s.boxLabel}>Est. Profit</Text>
          <Text style={[s.profitValue, { color: profitColor }]}>{profit$}</Text>
          {profit !== null && <Text style={s.profitSub}>after fees</Text>}
        </View>
      </View>

      {/* ── Market data card ── */}
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

      <View style={{ flex: 1 }} />

      {/* K: Actions — hidden in read-only mode */}
      {!isReadOnly && (
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
      )}

      {/* Read-only: back button */}
      {isReadOnly && (
        <View style={[s.actions, { paddingBottom: Math.max(insets.bottom + 24, 40) }]}>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [s.saveBtn, { backgroundColor: BROWN }, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="arrow-back" size={18} color={CREAM} />
            <Text style={s.saveBtnText}>Back to Hunt</Text>
          </Pressable>
        </View>
      )}

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

      {/* ── A: Require thrift price modal ── */}
      <Modal visible={priceModalVisible} transparent animationType="fade" onRequestClose={() => setPriceModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Enter your thrift price first</Text>
            <Text style={s.modalSub}>Add what this item costs so FlipStart can calculate hunt profit.</Text>
            <View style={s.modalPriceRow}>
              <Text style={s.modalPriceMinus}>-$</Text>
              <TextInput
                style={s.modalPriceInput}
                value={thriftPriceStr}
                onChangeText={handlePriceChange}
                onBlur={handlePriceBlur}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={RED + '88'}
                returnKeyType="done"
                autoFocus
              />
            </View>
            <Pressable
              onPress={() => {
                if (!thriftPriceStr || parseFloat(thriftPriceStr) <= 0) return;
                setPriceModalVisible(false);
                _doSave();
              }}
              style={[s.modalSave, (!thriftPriceStr || parseFloat(thriftPriceStr) <= 0) && { opacity: 0.45 }]}
            >
              <Text style={s.modalSaveText}>Save to Hunt</Text>
            </Pressable>
            <Pressable onPress={() => setPriceModalVisible(false)} style={s.modalCancel}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Back confirm modal (active mode only) ── */}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CARD_B },
  headerBtn:    { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: CARD_B + '50' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 1 },
  headerMode:   { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: BROWN },

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

  // B: Price box — centered, negative red display
  priceBox:      { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_B, borderRadius: 12, padding: 12, alignItems: 'center' },
  boxLabel:      { fontSize: 9, fontWeight: '700', color: MUTED, letterSpacing: 0.8, marginBottom: 6, textAlign: 'center' },
  priceInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  priceMinus:    { fontSize: 17, fontWeight: '800', color: RED },
  priceInput:    { fontSize: 20, fontWeight: '800', color: RED, padding: 0, minWidth: 60, textAlign: 'center' },
  priceReadOnly: { fontSize: 20, fontWeight: '800', color: RED, textAlign: 'center' },
  priceHint:     { fontSize: 9, color: MUTED, marginTop: 3 },

  profitBox:   { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_B, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
  profitValue: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800' },
  profitSub:   { fontSize: 9, color: MUTED, marginTop: 3 },

  marketCard:  { marginHorizontal: 16, marginTop: 10, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_B, borderRadius: 12 },
  marketRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: CARD_B + '70' },
  marketLabel: { fontSize: 13, color: MUTED },
  marketValue: { fontSize: 13, fontWeight: '700', color: BROWN },
  confidence:  { fontSize: 10, color: MUTED },

  actions:      { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10, backgroundColor: BG },
  saveBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: FOREST, borderRadius: 12, paddingVertical: 15, shadowColor: '#0A1A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  saveBtnText:  { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: CREAM, letterSpacing: 0.8 },
  removeBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7A1F1F', borderRadius: 12, paddingVertical: 15, shadowColor: '#3A0808', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  removeBtnText:{ fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: CREAM, letterSpacing: 0.8 },

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.93)', justifyContent: 'center', alignItems: 'center' },
  previewImage:   { width: '100%', height: '80%' },
  previewClose:   { position: 'absolute', top: 52, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(60,40,20,0.80)', justifyContent: 'center', alignItems: 'center' },

  modalOverlay:    { flex: 1, backgroundColor: 'rgba(10,6,2,0.65)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  modalCard:       { width: '100%', backgroundColor: CARD, borderRadius: 20, padding: 24, gap: 12, borderWidth: 1, borderColor: CARD_B },
  modalTitle:      { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: BROWN, textAlign: 'center' },
  modalSub:        { fontSize: 13, color: MUTED, textAlign: 'center', marginBottom: 4 },
  modalPriceRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: BG, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: CARD_B },
  modalPriceMinus: { fontSize: 22, fontWeight: '800', color: RED },
  modalPriceInput: { flex: 1, fontSize: 26, fontWeight: '800', color: RED, padding: 0, textAlign: 'center' },
  modalSave:       { backgroundColor: FOREST, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalSaveText:   { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: CREAM, letterSpacing: 1 },
  modalRemove:     { borderWidth: 1.5, borderColor: RED + '55', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalRemoveText: { fontSize: 14, fontWeight: '700', color: RED },
  modalCancel:     { alignItems: 'center', paddingVertical: 8 },
  modalCancelText: { fontSize: 14, color: MUTED },
});