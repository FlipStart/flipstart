/**
 * app/hunt-item-detail.tsx
 *
 * Hunt Mode Discovery Analysis.
 *
 * Four contexts, decided from the route and the live hunt:
 *
 *   new      — a scan that just finished (no mode param). Save to Hunt / Remove.
 *              A thrift price is REQUIRED to save: tapping Save without one
 *              focuses the price field with guidance, never a popup.
 *   kept     — mode=readonly&huntItemId=…, item is in the live hunt and kept.
 *              Price is editable; Done recalculates profit, ROI and rating.
 *   removed  — same, item is in the live hunt and removed. Price editable;
 *              Restore to Kept returns the identical item (needs a price).
 *   history  — the item is in a SAVED hunt bundle. Read-only; shows the price
 *              and rating exactly as they were saved.
 *
 * Price entry never keeps or removes anything. Money and rating always come
 * from lib/huntEconomics — the same engine and risk signals as normal Analysis.
 *
 * Navigation:
 *   new: Save / Remove → router.replace('/hunt-active') (loading.tsx put this
 *        screen inside a fullScreenModal stack, so back() would land on Home).
 *   kept / removed / history: router.back().
 */

import {
  View, Text, Pressable, StyleSheet, Alert,
  Platform, Modal, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useNavigation, useLocalSearchParams, type ErrorBoundaryProps } from 'expo-router';
import { ScreenCrashFallback } from '@/components/scan/ScreenCrashFallback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useEffect, useRef, useMemo } from 'react';

import { useScanContext }       from '@/lib/scan-context';
import {
  isHuntActive, getHuntItemById, keepScanInHunt, removeScanFromHunt,
  setHuntItemPrice, restoreHuntItem, markReturningFromHuntItemDetail,
  subscribeToHunt, addPendingScanToHunt, itemStatus, type HuntItem, type HuntRating,
} from '@/lib/hunt-context';
import {
  huntEconomics, provisionalEconomics, parseThriftPrice, formatThriftPrice,
} from '@/lib/huntEconomics';
import { backUpHuntItemPhotos } from '@/lib/huntPhotos';
import { viewerPhotosFor }      from '@/lib/viewerPhotos';
import { useAuth }              from '@/lib/auth-context';
import { useFlipStore }         from '@/lib/useFlipStore';
import { isHuntBundle }         from '@/types/flip';
import { FONTS }                from '@/constants/typography';
import { getConfidenceDisplay } from '@/utils/confidenceDisplay';
import { logHuntItemSaved, logHuntItemRemoved, logEvent } from '@/lib/analytics';
import { HuntPriceField, type HuntPriceFieldHandle } from '@/components/hunt/HuntPriceField';

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

// ─── Hunt badge config (by Hunt rating) ───────────────────────────────────────

const HUNT_BADGE: Record<HuntRating, {
  label: string; emoji: string;
  bg: string; border: string; text: string; glow?: string;
}> = {
  legendary: { label: 'Legendary Loot', emoji: '👑', bg: '#2A1E04', border: '#D4A72C', text: '#D4A72C', glow: '#D4A72C44' },
  treasure:  { label: 'Treasure',       emoji: '💰', bg: '#1A2A06', border: '#BE9C2C', text: '#BE9C2C' },
  risky:     { label: 'Risky Buy',      emoji: '⚠️', bg: '#2A1A04', border: '#C89020', text: '#C89020' },
  trash:     { label: 'Skip',           emoji: '✕',  bg: '#6B1414', border: '#E05555', text: '#FFDADA', glow: '#E0555522' },
};

const SAVE_HELPER    = 'Enter the thrift price to calculate your profit and save this find.';
const RESTORE_HELPER = 'Enter the thrift price to restore this find.';
const KEPT_HELPER    = 'A kept find needs a thrift price of at least $0.01.';
const MIN_HELPER     = 'Enter a price of at least $0.01.';

type Context = 'new' | 'kept' | 'removed' | 'history';

// ─── Early-return error styles (defined before component — s is after) ────────

const es = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#F0E8D4', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingTop: 60 },
  text:    { fontFamily: 'serif', fontSize: 17, color: '#5A3A1A', marginTop: 12, marginBottom: 20 },
  btn:     { backgroundColor: '#5A3A1A', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  btnText: { fontSize: 14, fontWeight: '700', color: '#F4EED8' },
});

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * If this screen crashes, show what broke instead of a blank or frozen screen
 * (Phase 7). Finds the same scan the screen was showing: the current scan, or
 * — for a saved item opened from a finished hunt — its stored snapshot.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; huntItemId?: string }>();
  const { currentScan } = useScanContext();
  const { flips } = useFlipStore();
  const readOnly = params.mode === 'readonly';
  let scan: unknown = currentScan;
  if (readOnly) {
    scan = null;
    try {
      const id = params.huntItemId ?? '';
      const fromActive = id ? getHuntItemById(id) : null;
      if (fromActive) scan = (fromActive as any).scanSnapshot ?? null;
      else {
        for (const entry of flips) {
          if (!isHuntBundle(entry)) continue;
          const found = [...entry.keptItems, ...entry.removedItems].find((i: any) => i.huntItemId === id);
          if (found) { scan = (found as any).scanSnapshot ?? null; break; }
        }
      }
    } catch { scan = null; }
  }
  const inHunt = isHuntActive();
  return (
    <ScreenCrashFallback
      screen="hunt_item"
      error={error}
      scan={scan}
      onRetry={retry}
      onBack={() => {
        if (readOnly && router.canGoBack()) router.back();
        else router.replace((inHunt ? '/hunt-active' : '/(tabs)') as any);
      }}
      backLabel={inHunt ? 'Back to Hunt' : 'Back to Home'}
      justScanned={!readOnly}
    />
  );
}

export default function HuntItemDetailScreen() {
  const router     = useRouter();
  const navigation = useNavigation();
  const insets     = useSafeAreaInsets();
  const params     = useLocalSearchParams<{ mode?: string; huntItemId?: string; focusPrice?: string }>();
  const { user }   = useAuth();

  const isReadOnlyRoute = params.mode === 'readonly';
  // mode=pending: an analysed-but-undecided find restored after an app close.
  const isPendingRoute  = params.mode === 'pending';
  const huntItemId      = params.huntItemId ?? null;

  const { currentScan, setCurrentScan } = useScanContext();
  const { pendingThriftPrices, setPendingThriftPrice, flips } = useFlipStore();

  // ── ALL hooks before any conditional return ──────────────────────────────
  const [imgIndex,       setImgIndex]       = useState(0);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [helper,         setHelper]         = useState<string | null>(null);
  const [emphasize,      setEmphasize]      = useState(false);
  const [, setTick]                         = useState(0);
  const allowNavRef = useRef(false);
  const priceRef    = useRef<HuntPriceFieldHandle>(null);

  // Re-render when the live hunt changes (price edits, restore, photo uploads).
  useEffect(() => subscribeToHunt(() => setTick(n => n + 1)), []);

  // Item from the LIVE hunt (editable) or from a SAVED bundle (read-only).
  const liveItem: HuntItem | null = (isReadOnlyRoute || isPendingRoute) && huntItemId
    ? getHuntItemById(huntItemId)
    : (currentScan ? getHuntItemById(`hi_${currentScan.id}`) : null);
  const savedItem = useMemo(() => {
    if (!isReadOnlyRoute || !huntItemId || liveItem) return null;
    for (const entry of flips) {
      if (!isHuntBundle(entry)) continue;
      const found = [...entry.keptItems, ...entry.removedItems].find(i => i.huntItemId === huntItemId);
      if (found) return found as unknown as HuntItem;
    }
    return null;
  }, [isReadOnlyRoute, huntItemId, flips, liveItem]);

  const item = liveItem ?? savedItem;
  const liveStatus = liveItem ? itemStatus(liveItem) : null;
  // A fresh scan and a restored pending find are both "new": Save / Remove.
  const context: Context =
      (!isReadOnlyRoute && !isPendingRoute) ? (liveStatus && liveStatus !== 'pending' ? liveStatus : 'new')
    : isPendingRoute ? (liveStatus === 'pending' ? 'new' : liveStatus ?? 'new')
    : liveItem ? (liveStatus === 'kept' ? 'kept' : liveStatus === 'removed' ? 'removed' : 'new')
    : 'history';

  const scan   = context === 'new'
    ? (currentScan ?? liveItem?.scanSnapshot ?? null)
    : item?.scanSnapshot ?? null;
  const scanId = scan?.id ?? '';

  // ── Thrift price text ─────────────────────────────────────────────────────
  // New scans keep the draft in the flip store (survives a remount); existing
  // items edit a local draft that is committed with Done.
  const storedPriceText = item && item.thriftPrice > 0 ? formatThriftPrice(item.thriftPrice) : '';
  const [itemDraft, setItemDraft] = useState<string | null>(null);
  const priceText = context === 'new'
    ? (pendingThriftPrices[scanId] ?? storedPriceText)
    : (itemDraft ?? storedPriceText);
  const setPriceText = (t: string) => {
    if (context === 'new') setPendingThriftPrice(scanId, t);
    else setItemDraft(t);
    if (helper && parseThriftPrice(t) !== null) { setHelper(null); setEmphasize(false); }
  };
  const typedPrice = parseThriftPrice(priceText);

  // ── Money + rating ────────────────────────────────────────────────────────
  // history: exactly as saved. Otherwise live from the shared engine: at the
  // user's price when there is one, else provisional at the suggested price.
  const econ = useMemo(() => {
    if (!scan) return null;
    if (typedPrice !== null) return { ...huntEconomics(scan, typedPrice), provisional: false as const, basis: typedPrice };
    if (context === 'history' && item && item.thriftPrice > 0) {
      return { ...huntEconomics(scan, item.thriftPrice), provisional: false as const, basis: item.thriftPrice };
    }
    return provisionalEconomics(scan);
  }, [scan, typedPrice, context, item]);

  // A saved hunt keeps the rating it was saved with (historical snapshot).
  const shownRating: HuntRating = context === 'history' && item
    ? item.huntRating
    : (econ?.huntRating ?? 'trash');
  const shownProfit: number | null = context === 'history' && item
    ? (item.thriftPrice > 0 ? item.profit : null)
    : (econ && !econ.provisional ? econ.profit : null);

  // Photos: this session's front / tag / detail, else the saved set.
  const images: string[] = useMemo(() => {
    const main = item?.imageUri ?? scan?.imageUri ?? '';
    const extras = (item?.extraPhotos ?? []) as Array<{ uri: string; label: 'Tag' | 'Detail' }>;
    const list = viewerPhotosFor(scanId, main, extras).map(p => p.uri);
    return list.length ? list : [main].filter(Boolean);
  }, [scanId, item?.imageUri, item?.extraPhotos, scan?.imageUri]);

  // Record the finished scan in the hunt as PENDING straight away, so closing
  // the app before Keep / Remove can't lose a scan that was already charged.
  // Idempotent per scan. Photos are backed up now too (this session holds the
  // tag / detail files only in memory).
  const pendingRecordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (context !== 'new' || !scan || !isHuntActive()) return;
    if (pendingRecordedRef.current === scan.id) return;
    pendingRecordedRef.current = scan.id;
    const before = getHuntItemById(`hi_${scan.id}`);
    addPendingScanToHunt(scan);
    if (!before) void backUpHuntItemPhotos(scan.id, scan.imageUri, user?.id);
  }, [context, scan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back-gesture guard — new scans only (a decision is pending).
  useEffect(() => {
    if (context !== 'new') return;
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (allowNavRef.current) return;
      e.preventDefault();
      setConfirmVisible(true);
    });
    return unsub;
  }, [navigation, context]);

  // Scan vanished (hot reload etc.) and no pending record to fall back on.
  useEffect(() => {
    if (context !== 'new') return;
    if (!scan) {
      allowNavRef.current = true;
      router.back();
    }
  }, [scan, context]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrived from Removed Items to price an item before restoring it.
  useEffect(() => {
    if (params.focusPrice !== '1' || context !== 'removed') return;
    setEmphasize(true);
    setHelper(RESTORE_HELPER);
    const id = requestAnimationFrame(() => priceRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [params.focusPrice, context]);

  // ── Guard — after all hooks ────────────────────────────────────────────────
  if (context !== 'new' && (!item || !scan)) {
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
  if (!scan || !econ) return null;

  const md  = scan.market_data;
  const id  = scan.identification;
  const ra  = scan.risk_analysis;
  const badge = HUNT_BADGE[shownRating] ?? HUNT_BADGE.trash;
  const resaleValue = md?.adjusted_estimated_value ?? 0;
  const editable = context !== 'history';

  const profit$ = shownProfit !== null
    ? `${shownProfit >= 0 ? '+' : '-'}$${Math.abs(Math.round(shownProfit))}`
    : '—';
  const profitColor = shownProfit !== null
    ? (shownProfit >= 0 ? '#2A6A2A' : '#8A2A2A')
    : MUTED;

  const haptic = (kind: 'success' | 'medium' | 'light') => {
    if (Platform.OS === 'web') return;
    if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  /** Point the user at the price field — guidance, not an error. */
  const askForPrice = (message: string) => {
    setEmphasize(true);
    setHelper(message);
    haptic('light');
    priceRef.current?.focus();
  };

  // ── Price commit (Done / keyboard closed) ─────────────────────────────────
  const commitPrice = (text: string) => {
    const p = parseThriftPrice(text);
    if (context === 'new') {
      if (p !== null) {
        setPendingThriftPrice(scanId, formatThriftPrice(p));
        // Saved on the pending item too, so an app close keeps the typed price.
        if (getHuntItemById(`hi_${scanId}`)) setHuntItemPrice(`hi_${scanId}`, p);
      } else if (text.trim() !== '') setHelper(MIN_HELPER);
      return;
    }
    if (!item || context === 'history') return;
    if (p === null) {
      if (text.trim() === '' && context === 'removed' && item.thriftPrice <= 0) { setItemDraft(null); return; }
      // A kept find always keeps a price: put the stored one back.
      setItemDraft(null);
      setHelper(context === 'kept' ? KEPT_HELPER : MIN_HELPER);
      return;
    }
    setItemDraft(null);
    if (p !== item.thriftPrice) {
      setHuntItemPrice(item.huntItemId, p);
      logEvent('hunt_item_price_edited', { context, rating: HUNT_BADGE[huntEconomics(scan, p).huntRating]?.label ?? null });
    }
  };

  const leaveToHunt = () => {
    setCurrentScan(null);
    markReturningFromHuntItemDetail();
    allowNavRef.current = true;
    router.replace('/hunt-active' as any);
  };

  // ── New scan: Save / Remove ───────────────────────────────────────────────
  const handleSave = () => {
    if (!scan) return;
    if (!isHuntActive()) { leaveToHunt(); return; }
    Keyboard.dismiss();
    const result = keepScanInHunt(scan, priceText);
    if (result === 'needs_price') { askForPrice(SAVE_HELPER); return; }
    haptic('success');
    const e = huntEconomics(scan, typedPrice ?? 0);
    try {
      logHuntItemSaved({
        profit:         e.profit,
        recommendation: e.calc.recommendation?.label ?? 'UNKNOWN',
        category:       id.category ?? '',
      });
    } catch {}
    leaveToHunt();
  };

  const handleRemove = () => {
    if (!scan) return;
    haptic('medium');
    if (isHuntActive()) {
      removeScanFromHunt(scan, priceText);
      try {
        logHuntItemRemoved({
          recommendation: econ.calc.recommendation?.label ?? 'UNKNOWN',
          category:       id.category ?? '',
        });
      } catch {}
    }
    leaveToHunt();
  };

  // ── Removed item: Restore ─────────────────────────────────────────────────
  const handleRestore = () => {
    if (!item) return;
    Keyboard.dismiss();
    // Apply a price typed but not yet committed, then restore.
    if (typedPrice !== null && typedPrice !== item.thriftPrice) setHuntItemPrice(item.huntItemId, typedPrice);
    const r = restoreHuntItem(item.huntItemId);
    if (r === 'needs_price') { askForPrice(RESTORE_HELPER); return; }
    haptic('success');
    logEvent('hunt_item_restored', { huntItemId: item.huntItemId, category: item.category, from: 'analysis' });
    router.back();
  };

  const goBack = () => {
    Keyboard.dismiss();
    allowNavRef.current = true;
    router.back();
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
    { label: 'Best Platform', value: String(econ.calc.bestPlatform ?? '—') },
    ...(md.competition_level ? [{ label: 'Competition', value: md.competition_level }] : []),
  ];

  const historyPrice = context === 'history' && item ? item.thriftPrice : 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable
          onPress={() => context === 'new' ? setConfirmVisible(true) : goBack()}
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

      {/* Tapping anywhere outside the price field closes the keyboard (which commits). */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={{ flex: 1 }}>

      {/* ── Image — multi-photo carousel ── */}
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
        <Text style={s.itemName} numberOfLines={2}>{id.item_name}</Text>
        <Text style={s.itemMeta} numberOfLines={1}>
          {[id.brand, id.category, id.estimated_era].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {/* ── Decision row ── */}
      <View style={s.decisionRow}>
        <View style={[
          s.badge,
          { backgroundColor: badge.bg, borderColor: badge.border },
          econ.provisional && context !== 'history' && s.badgeProvisional,
          badge.glow && { shadowColor: badge.glow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
        ]}>
          {econ.provisional && context !== 'history' && (
            <Text style={[s.badgeEst, { color: badge.text }]}>ESTIMATED</Text>
          )}
          <Text style={s.badgeEmoji}>{badge.emoji}</Text>
          <Text style={[s.badgeLabel, { color: badge.text }]}>{badge.label.toUpperCase()}</Text>
        </View>

        <View style={[s.priceBox, emphasize && { borderColor: GOLD, borderWidth: 2 }]}>
          <Text style={s.boxLabel}>Thrift Price</Text>
          {editable ? (
            <HuntPriceField
              ref={priceRef}
              value={priceText}
              onChange={setPriceText}
              onCommit={commitPrice}
              emphasize={emphasize}
              accessoryId="hunt-price-accessory"
              color={RED}
              placeholderColor={RED + '88'}
              accentColor={GOLD}
              barColor={CARD}
            />
          ) : (
            <Text style={s.priceReadOnly}>
              {historyPrice > 0 ? `-$${historyPrice.toFixed(2)}` : '—'}
            </Text>
          )}
          {editable && !priceText && (
            <Text style={s.priceHint}>Tap to enter</Text>
          )}
        </View>

        <View style={s.profitBox}>
          <Text style={s.boxLabel}>Est. Profit</Text>
          <Text style={[s.profitValue, { color: profitColor }]}>{profit$}</Text>
          {shownProfit !== null && <Text style={s.profitSub}>after fees</Text>}
        </View>
      </View>

      {/* Guidance (Save / Restore without a price) or the provisional note. */}
      {helper ? (
        <Text style={s.helper}>{helper}</Text>
      ) : econ.provisional && context !== 'history' ? (
        <Text style={s.provisionalNote}>
          {econ.basis
            ? `Estimated at FlipStart's suggested buy price ($${econ.basis.toFixed(2)}). Enter your price for the final rating.`
            : 'Estimated rating. Enter your thrift price for the final rating.'}
        </Text>
      ) : null}

      {/* ── Market data card ── */}
      <View style={s.marketCard}>
        {marketRows.map(({ label, value }, i) => (
          <View key={label} style={[s.marketRow, i === marketRows.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={s.marketLabel}>{label}</Text>
            <Text style={s.marketValue}>{value}</Text>
          </View>
        ))}
        {(() => {
          // Words, not a percentage: match_confidence is ordinal, not a
          // probability. The tier is the server's when the scan has one.
          const conf = getConfidenceDisplay((id as any)?.v1, ra.match_confidence);
          if (!conf) return null;
          return (
            <View style={{ alignItems: 'center', paddingVertical: 8, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <MaterialIcons name="verified-user" size={12} color={conf.color} />
                <Text style={[s.confidence, { color: conf.color, fontWeight: '700' }]}>{conf.short}</Text>
              </View>
              {!!conf.reason && <Text style={s.confidence} numberOfLines={2}>{conf.reason}</Text>}
              {!!conf.authenticity && (
                <Text style={[s.confidence, { color: '#8A3A2A', fontWeight: '600' }]} numberOfLines={2}>
                  Authenticity not verified — {conf.authenticity}
                </Text>
              )}
            </View>
          );
        })()}
      </View>

      <View style={{ flex: 1 }} />
        </View>
      </TouchableWithoutFeedback>

      {/* ── Actions ── */}
      {context === 'new' && (
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
              'It moves to Removed Items, where you can restore it later.',
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

      {context === 'removed' && (
        <View style={[s.actions, { paddingBottom: Math.max(insets.bottom + 24, 40) }]}>
          <Pressable
            onPress={handleRestore}
            style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="restore" size={18} color={CREAM} />
            <Text style={s.saveBtnText}>RESTORE TO KEPT</Text>
          </Pressable>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [s.saveBtn, { backgroundColor: BROWN }, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="arrow-back" size={18} color={CREAM} />
            <Text style={s.saveBtnText}>Back</Text>
          </Pressable>
        </View>
      )}

      {(context === 'kept' || context === 'history') && (
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

      {/* ── Back confirm modal (new scans only) ── */}
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
  // Provisional rating (no price yet): dashed edge + ESTIMATED tag, never mistaken for final.
  badgeProvisional: { borderStyle: 'dashed', opacity: 0.9 },
  badgeEst:    { fontSize: 7, fontWeight: '800', letterSpacing: 1 },

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

  helper:          { marginHorizontal: 16, marginTop: 8, fontSize: 12, fontWeight: '600', color: '#7A5C1E', textAlign: 'center' },
  provisionalNote: { marginHorizontal: 16, marginTop: 8, fontSize: 11, color: MUTED, textAlign: 'center' },

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