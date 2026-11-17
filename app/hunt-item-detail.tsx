/**
 * app/hunt-item-detail.tsx
 *
 * Hunt Mode Discovery Analysis.
 *
 * Four contexts, decided from the route and the live hunt:
 *
 *   new      — a scan that just finished (no mode param). Save to Hunt / Skip.
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
  Platform, Modal, Keyboard, ScrollView, useWindowDimensions, Animated,
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
  subscribeToHunt, addPendingScanToHunt, itemStatus, getActiveHunt, type HuntItem, type HuntRating,
} from '@/lib/hunt-context';
import { useHuntComps } from '@/lib/useHuntComps';
import { useDeepAnalysisGate } from '@/lib/useDeepAnalysisGate';
import { huntItemToFlip } from '@/utils/huntItemToFlip';
import type { HuntBundleItem } from '@/types/flip';
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
import { PhotoViewerModal } from '@/components/results/PhotoViewerModal';
import { H } from '@/components/hunt/discovery/theme';
import { HuntRatingBadge } from '@/components/hunt/discovery/HuntRatingBadge';
import { WhyThisRating } from '@/components/hunt/discovery/WhyThisRating';
import { MarketSnapshot } from '@/components/hunt/discovery/MarketSnapshot';
import { ItemDetails } from '@/components/hunt/discovery/ItemDetails';
import { SectionCard } from '@/components/hunt/discovery/SectionCard';
import { SoldCompsSection } from '@/components/comps/SoldCompsSection';
import { DeepAnalysisButton } from '@/components/results/DeepAnalysisButton';
import {
  huntBuyGuidance, buildWhyRating, buildMarketSnapshot, buildItemDetails, huntMetaParts, HUNT_RATING_LABEL,
} from '@/lib/huntDiscovery';

// ─── Palette (Hunt theme) ─────────────────────────────────────────────────────

const BG     = H.bg;
const CARD   = H.card;
const CARD_B = H.cardB;
const FOREST = H.forest;
const BROWN  = H.brown;
const MUTED  = H.muted;
const GOLD   = H.gold;
const CREAM  = H.cream;
const RED    = H.red;

const SAVE_HELPER    = 'Enter the thrift price to calculate your profit and save this find.';
const RESTORE_HELPER = 'Enter the thrift price to restore this find.';
const KEPT_HELPER    = 'A kept find needs a thrift price of at least $0.01.';
const MIN_HELPER     = 'Enter a price of at least $0.01.';
const DEEP_HELPER    = 'Enter your thrift price to open Deep Analysis at your price.';

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
  const scrollRef   = useRef<ScrollView>(null);
  const { height: winH } = useWindowDimensions();

  // The action bar steps aside while the keyboard is up (the Done bar is the
  // way out), so it can never sit on top of the price field or the content.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

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

  // The saved Hunt this item belongs to (History only) — its id is the Hunt id.
  const savedBundleId = useMemo(() => {
    if (!isReadOnlyRoute || !huntItemId || liveItem) return null;
    for (const entry of flips) {
      if (!isHuntBundle(entry)) continue;
      if ([...entry.keptItems, ...entry.removedItems].some(i => i.huntItemId === huntItemId)) return entry.id;
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

  // Soft pulsing gold glow on the title's "›" (same cue as the Results title).
  // JS driver: textShadowRadius can't use the native one. One tiny element.
  const arrowGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowGlow, { toValue: 1, duration: 1100, useNativeDriver: false }),
        Animated.timing(arrowGlow, { toValue: 0, duration: 1100, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [arrowGlow]);
  const arrowShadowRadius = arrowGlow.interpolate({ inputRange: [0, 1], outputRange: [1, 9] });

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

  // ── Deep Analysis ─────────────────────────────────────────────────────────
  // The production gate (Pro → open, Free → the one-time preview, then the
  // paywall) and the production screen. Never opened automatically.
  const openDeepAnalysis = useDeepAnalysisGate();
  // Which find is on screen right now: the gate re-checks it before it opens, so
  // a paywall answered late can never open Deep Analysis for a different item.
  const itemContextRef = useRef<string | null>(null);
  itemContextRef.current = scan?.id ?? null;

  // ── Sold Comps ────────────────────────────────────────────────────────────
  // The production comps system. A saved snapshot wins and nothing is searched;
  // otherwise one search (the server already started it when the scan finished).
  // History never searches: it shows the snapshot or the honest unavailable
  // state. The search never blocks the rest of the screen.
  const compsItemId = item?.huntItemId ?? (scan ? `hi_${scan.id}` : null);
  const comps = useHuntComps({
    huntItemId: compsItemId,
    scanId:     scan?.id ?? null,
    analysisId: item?.analysisId ?? (scan?.identification as any)?.v1?.analysisId ?? null,
    snapshot:   item?.compsSnapshot,
    allowFetch: context !== 'history',
    huntId:     context === 'history' ? savedBundleId : (getActiveHunt()?.id ?? null),
  });

  // hunt_sold_comps_viewed — once per item per visit, when the section actually
  // scrolls into view (not on every render, not just because it exists).
  const compsY       = useRef<number | null>(null);
  const scrollViewH  = useRef(0);
  const compsViewedFor = useRef<string | null>(null);
  const checkCompsViewed = (offsetY: number) => {
    if (compsY.current === null || !compsItemId || compsViewedFor.current === compsItemId) return;
    if (offsetY + scrollViewH.current < compsY.current + 60) return;
    compsViewedFor.current = compsItemId;
    try {
      logEvent('hunt_sold_comps_viewed', {
        hunt_id: context === 'history' ? savedBundleId : (getActiveHunt()?.id ?? null),
        hunt_item_id: compsItemId, scan_id: scan?.id ?? null, context,
      });
    } catch { /* analytics never breaks the screen */ }
  };

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
  const editable = context !== 'history';
  const provisional = econ.provisional && context !== 'history';
  const conf = getConfidenceDisplay((id as any)?.v1, ra?.match_confidence);
  const guidance = huntBuyGuidance(scan);
  const enteredPrice = context === 'history'
    ? (item && item.thriftPrice > 0 ? item.thriftPrice : null)
    : typedPrice;
  const why = buildWhyRating(econ, shownRating, guidance, enteredPrice);
  const tiles = buildMarketSnapshot(scan, { ...econ, provisional: econ.provisional });
  const details = buildItemDetails(scan, conf?.authenticity ?? null);
  const metaPills = huntMetaParts(scan);
  // Photo a bit shorter than before (248), a touch more on small phones.
  const photoH = winH < 700 ? 176 : 204;

  // No confirmed thrift price: the third box answers "what is it worth?" (the
  // same resale number the Results screen shows). Once a price is confirmed it
  // becomes Est. Profit. History items that were never priced follow the same rule.
  const showResale = shownProfit === null;
  const resaleValue = Number((scan.market_data as any)?.adjusted_estimated_value ?? 0);
  const resale$ = resaleValue > 0 ? `$${Math.round(resaleValue)}` : '—';

  // Same rule as the Deep Analysis button: a History item that was never priced has no entry.
  const canOpenDeep = context !== 'history' || (!!item && item.thriftPrice > 0);

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
    // The price lives in the decision card near the top: bring it into view.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
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
      logEvent('hunt_item_price_edited', { hunt_id: getActiveHunt()?.id ?? null, hunt_item_id: item.huntItemId, context, rating: HUNT_RATING_LABEL[huntEconomics(scan, p).huntRating] ?? null });
    }
  };

  const leaveToHunt = () => {
    setCurrentScan(null);
    markReturningFromHuntItemDetail();
    allowNavRef.current = true;
    router.replace('/hunt-active' as any);
  };

  // ── Deep Analysis ─────────────────────────────────────────────────────────
  // Deep Analysis talks about "your price", so it opens at a real price: the one
  // in the field (or saved with the item). With none, the price field is focused
  // with guidance — BEFORE the gate, so a free user's one-time preview is never
  // spent on a half answer. History is read-only: an item that was never priced
  // has no honest price to analyse at, so it offers no entry.
  const handleDeepAnalysis = () => {
    if (!scan) return;
    const savedPrice = item && item.thriftPrice > 0 ? item.thriftPrice : null;
    const price = context === 'history' ? savedPrice : (typedPrice ?? savedPrice);
    if (price === null) { if (context !== 'history') askForPrice(DEEP_HELPER); return; }
    Keyboard.dismiss();
    const e = huntEconomics(scan, price);
    const money = context === 'history' && item
      ? { thriftPrice: item.thriftPrice, fees: item.fees, profit: item.profit, roi: item.roi }
      : { thriftPrice: e.thriftPrice, fees: e.fees, profit: e.profit, roi: e.roi };
    // The same projection Hunt History and the Flip Record use. A live item's
    // pending / kept / removed status is NOT a Flip Record status, so it is left out.
    const flip = huntItemToFlip({
      ...(item ?? {}),
      huntItemId: compsItemId ?? `hi_${scan.id}`,
      scanId:     scan.id,
      itemName:   id.item_name ?? item?.itemName ?? '',
      brand:      id.brand ?? item?.brand ?? '',
      category:   id.category ?? item?.category ?? '',
      imageUri:   images[0] ?? scan.imageUri,
      extraPhotos: item?.extraPhotos,
      ...money,
      huntRating: shownRating,
      kept:       true,
      status:     undefined,
      scanSnapshot: scan,
    } as unknown as HuntBundleItem, Date.now());
    openDeepAnalysis(
      () => router.push({
        pathname: '/analysis-details' as any,
        params: {
          scanId:   scan.id,
          snapshot: JSON.stringify(flip),
          source:   context === 'history' ? 'hunt_history' : 'hunt',
        },
      }),
      { contextRef: itemContextRef },
    );
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
        hunt_id:        getActiveHunt()?.id ?? null,
        hunt_item_id:   compsItemId,
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
          hunt_id:        getActiveHunt()?.id ?? null,
          hunt_item_id:   compsItemId,
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
    logEvent('hunt_item_restored', { hunt_id: getActiveHunt()?.id ?? null, hunt_item_id: item.huntItemId, huntItemId: item.huntItemId, category: item.category, from: 'analysis' });
    router.back();
  };

  const goBack = () => {
    Keyboard.dismiss();
    allowNavRef.current = true;
    router.back();
  };

  const historyPrice = context === 'history' && item ? item.thriftPrice : 0;
  const showActions = !keyboardUp;
  const barPad = Math.max(insets.bottom + 12, 24);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header (fixed) ── */}
      <View style={s.header}>
        <Pressable
          onPress={() => context === 'new' ? setConfirmVisible(true) : goBack()}
          hitSlop={12} style={s.headerBtn}
          accessibilityLabel="Back"
        >
          <MaterialIcons name="arrow-back" size={22} color={BROWN} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerMode}>♦  HUNT MODE  ♦</Text>
          <Text style={s.headerTitle}>Discovery Analysis</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* ── Scrolling analysis: quick answer first, evidence underneath ──
          Tapping outside the price field or dragging closes the keyboard (which
          commits the price). iOS keeps the focused field above the keyboard. */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 132 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={120}
        onScroll={e => checkCompsViewed(e.nativeEvent.contentOffset.y)}
        onLayout={e => { scrollViewH.current = e.nativeEvent.layout.height; checkCompsViewed(0); }}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        testID="hunt-discovery-scroll"
      >

        {/* 1 · Photo */}
        <Pressable onPress={() => setPreviewVisible(true)} style={[s.imageWrap, { height: photoH }]} accessibilityLabel="View photos">
          <Image source={{ uri: images[imgIndex] }} style={s.image} contentFit="cover" />
          {images.length > 0 && (
            <View style={s.imageBadge}>
              <Text style={s.imageBadgeText}>{imgIndex + 1} / {images.length}</Text>
            </View>
          )}
          {images.length > 1 && imgIndex > 0 && (
            <Pressable onPress={e => { e.stopPropagation(); setImgIndex(i => i - 1); }} style={[s.imgArrow, s.imgArrowL]} hitSlop={8}>
              <MaterialIcons name="chevron-left" size={24} color={BROWN} />
            </Pressable>
          )}
          {images.length > 1 && imgIndex < images.length - 1 && (
            <Pressable onPress={e => { e.stopPropagation(); setImgIndex(i => i + 1); }} style={[s.imgArrow, s.imgArrowR]} hitSlop={8}>
              <MaterialIcons name="chevron-right" size={24} color={BROWN} />
            </Pressable>
          )}
        </Pressable>

        {/* 2 · Identity */}
        <View style={s.identity}>
          {canOpenDeep ? (
            <Pressable
              onPress={handleDeepAnalysis}
              hitSlop={6}
              style={({ pressed }) => [s.titlePress, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={`${id.item_name}. Open Deep Analysis`}
              testID="hunt-title-deep-analysis"
            >
              <Text style={s.itemName} numberOfLines={2}>
                {id.item_name}
                <Animated.Text
                  style={[
                    s.titleArrow,
                    { textShadowColor: GOLD, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: arrowShadowRadius },
                  ]}
                > ›</Animated.Text>
              </Text>
            </Pressable>
          ) : (
            <Text style={s.itemName} numberOfLines={2}>{id.item_name}</Text>
          )}
          {metaPills.length > 0 && (
            <View style={s.pillRow} testID="hunt-meta-pills">
              {metaPills.map(label => (
                <View key={label} style={s.pill}>
                  <Text style={s.pillText} numberOfLines={1} ellipsizeMode="tail">{label}</Text>
                </View>
              ))}
            </View>
          )}
          {!!conf && (
            <View style={s.confRow}>
              <View style={[s.confChip, { borderColor: conf.color + '66', backgroundColor: conf.color + '14' }]}>
                <MaterialIcons name="verified-user" size={11} color={conf.color} />
                <Text style={[s.confChipText, { color: conf.color }]}>{conf.short.toUpperCase()}</Text>
              </View>
            </View>
          )}
        </View>

        {/* 3 · Decision card: rating · thrift price · profit, then buy guidance */}
        <View style={s.decisionCard}>
          <View style={s.decisionRow}>
            <HuntRatingBadge rating={shownRating} provisional={provisional} />

            <View style={[s.priceBox, emphasize && { borderColor: GOLD, borderWidth: 2 }]}>
              <Text style={s.boxLabel}>THRIFT PRICE</Text>
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
              {editable && !priceText && <Text style={s.priceHint}>Tap to enter</Text>}
            </View>

            <View style={s.profitBox} testID={showResale ? 'hunt-est-resale' : 'hunt-est-profit'}>
              <Text style={s.boxLabel}>{showResale ? 'EST. RESALE' : 'EST. PROFIT'}</Text>
              <Text style={[s.profitValue, { color: showResale ? GOLD : profitColor }]}>
                {showResale ? resale$ : profit$}
              </Text>
              {showResale
                ? (resaleValue > 0 && <Text style={s.profitSub}>before fees</Text>)
                : <Text style={s.profitSub}>after fees</Text>}
            </View>
          </View>

          {!!guidance.line && (
            <View style={s.guideRow}>
              <MaterialIcons name="sell" size={13} color={FOREST} />
              <Text style={s.guideText}>{guidance.line}</Text>
            </View>
          )}

          {helper ? (
            <Text style={s.helper}>{helper}</Text>
          ) : provisional ? (
            <Text style={s.provisionalNote}>
              {econ.basis
                ? `Estimated rating at FlipStart's suggested buy price ($${econ.basis.toFixed(2)}). Enter your price for the final rating.`
                : 'Estimated rating. Enter your thrift price for the final rating.'}
            </Text>
          ) : null}
        </View>

        {/* ── Below the fold: evidence ── */}
        <WhyThisRating why={why} />
        <MarketSnapshot tiles={tiles} />
        {/* Real sold listings behind the estimate — the production Sold Comps
            system (same search, tiers and filtering as normal Analysis). */}
        <View onLayout={e => { compsY.current = e.nativeEvent.layout.y; checkCompsViewed(0); }}>
          <SectionCard title="Sold Comps" testID="hunt-sold-comps">
            <SoldCompsSection
              embedded
              subtitle="Real sold listings behind the estimate."
              loading={comps.loading}
              data={comps.data}
            />
          </SectionCard>
        </View>
        <ItemDetails rows={details} />

        {/* Deep Analysis — the production entry, last: decision, evidence, then the
            full reasoning. Always visible (free users must see it exists); the
            gate decides what a tap does. Never opens by itself. */}
        {(context !== 'history' || (item && item.thriftPrice > 0)) && (
          <View style={{ marginHorizontal: 2, marginTop: 10 }} testID="hunt-deep-analysis">
            <DeepAnalysisButton onPress={handleDeepAnalysis} />
          </View>
        )}
      </ScrollView>

      {/* ── Sticky actions (hidden while the keyboard is up) ── */}
      {showActions && context === 'new' && (
        <View style={[s.actions, { paddingBottom: barPad }]}>
          <Pressable onPress={handleSave} style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }]}>
            <MaterialIcons name="add-circle-outline" size={18} color={CREAM} />
            <Text style={s.saveBtnText}>SAVE TO HUNT</Text>
          </Pressable>
          <Pressable
            onPress={() => Alert.alert(
              'Skip this find?',
              'It moves to Removed Items, where you can restore it later.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Skip', style: 'destructive', onPress: handleRemove },
              ]
            )}
            style={({ pressed }) => [s.removeBtn, pressed && { opacity: 0.75 }]}
          >
            <MaterialIcons name="block" size={16} color={CREAM} />
            <Text style={s.removeBtnText}>Skip</Text>
          </Pressable>
        </View>
      )}

      {showActions && context === 'removed' && (
        <View style={[s.actions, { paddingBottom: barPad }]}>
          <Pressable onPress={handleRestore} style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }]}>
            <MaterialIcons name="restore" size={18} color={CREAM} />
            <Text style={s.saveBtnText}>RESTORE TO KEPT</Text>
          </Pressable>
          <Pressable onPress={goBack} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.85 }]}>
            <Text style={s.backBtnText}>Back</Text>
          </Pressable>
        </View>
      )}

      {showActions && (context === 'kept' || context === 'history') && (
        <View style={[s.actions, { paddingBottom: barPad }]}>
          <Pressable onPress={goBack} style={({ pressed }) => [s.saveBtn, { backgroundColor: BROWN }, pressed && { opacity: 0.85 }]}>
            <MaterialIcons name="arrow-back" size={18} color={CREAM} />
            <Text style={s.saveBtnText}>{context === 'history' ? 'BACK' : 'BACK TO HUNT'}</Text>
          </Pressable>
        </View>
      )}

      {/* ── Photos: the shared swipe + Save-to-Photos viewer ── */}
      <PhotoViewerModal
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        photos={images.map(uri => ({ uri }))}
      />

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
              <Text style={s.modalRemoveText}>Skip This Find</Text>
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

  imageWrap:      { marginHorizontal: 12, marginTop: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: CARD_B, position: 'relative', borderWidth: 1, borderColor: GOLD + '40' },
  image:          { width: '100%', height: '100%' },
  imageBadge:     { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.60)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  imageBadgeText: { fontSize: 11, color: '#FFF', fontWeight: '600' },
  imgArrow:       { position: 'absolute', top: '50%', marginTop: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.85)', justifyContent: 'center', alignItems: 'center' },
  imgArrowL:      { left: 10 },
  imgArrowR:      { right: 10 },

  identity:     { paddingHorizontal: 16, paddingTop: 12, gap: 4 },
  titlePress:   { alignSelf: 'flex-start' },
  titleArrow:   { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: GOLD },
  itemName:     { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: BROWN, lineHeight: 25 },
  pillRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  pill:         { maxWidth: '100%', backgroundColor: CARD, borderWidth: 1, borderColor: CARD_B, borderRadius: 50, paddingHorizontal: 10, paddingVertical: 4 },
  pillText:     { fontSize: 12, fontWeight: '600', color: BROWN, flexShrink: 1 },
  confRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  confChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  confChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  decisionCard: { marginHorizontal: 12, marginTop: 12, backgroundColor: CARD, borderRadius: 16, borderWidth: 1.5, borderColor: GOLD + '70', padding: 10, gap: 8,
                  shadowColor: '#3A2A10', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 6, elevation: 2 },
  decisionRow:  { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  priceBox:     { flex: 1, backgroundColor: BG + '80', borderWidth: 1, borderColor: CARD_B, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  boxLabel:     { fontSize: 9, fontWeight: '800', color: MUTED, letterSpacing: 1, marginBottom: 6, textAlign: 'center' },
  priceReadOnly:{ fontSize: 20, fontWeight: '800', color: RED, textAlign: 'center' },
  priceHint:    { fontSize: 9, color: MUTED, marginTop: 3 },
  profitBox:    { flex: 1, backgroundColor: BG + '80', borderWidth: 1, borderColor: CARD_B, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  profitValue:  { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800' },
  profitSub:    { fontSize: 9, color: MUTED, marginTop: 3 },

  guideRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 2 },
  guideText:    { fontSize: 12, fontWeight: '700', color: FOREST, textAlign: 'center', flexShrink: 1 },
  helper:          { fontSize: 12, fontWeight: '700', color: '#7A5C1E', textAlign: 'center' },
  provisionalNote: { fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 15 },

  actions:      { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10,
                  backgroundColor: BG, borderTopWidth: 1, borderTopColor: CARD_B,
                  shadowColor: '#3A2A10', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 8 },
  saveBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: FOREST, borderRadius: 12, paddingVertical: 15, borderWidth: 1, borderColor: GOLD + '55' },
  saveBtnText:  { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: CREAM, letterSpacing: 0.8 },
  removeBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7A1F1F', borderRadius: 12, paddingVertical: 15 },
  removeBtnText:{ fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: CREAM, letterSpacing: 0.8 },
  backBtn:      { paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: BROWN + '55' },
  backBtnText:  { fontSize: 14, fontWeight: '700', color: BROWN },

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