/**
 * scan-detail.tsx — "Flip Record"
 *
 * The screen a user lands on when tapping an old scan in Scan History.
 * Purpose-built for revisiting a find: what it was, what FlipStart predicted,
 * what actually happened (bought → listed → sold + real profit), plus listings
 * and a doorway into Deep Analysis for the full reasoning.
 *
 * Data source: useFlipStore ONLY (history items). All edits persist via
 * updateFlip. Deep Analysis remains reachable with source:'history' so its
 * existing history-mode behavior is unchanged.
 */

import { navGuard } from '@/lib/navGuard';
import {
  Text, View, ScrollView, Pressable, Platform, Modal,
  StyleSheet, TextInput, Alert, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useMemo, useEffect, useRef } from 'react';
import { Clipboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useFlipStore } from '@/lib/useFlipStore';
import { FlipResult, ListingData, isHuntBundle } from '@/types/flip';
import { FONTS } from '@/constants/typography';
import { normalizeBuyRating, type CanonicalRating } from '@/utils/recommendation';
import { computeFlipCalc, calculateFees } from '@/utils/flipCalculations';
import { trpc } from '@/lib/trpc';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import {
  getScanDeletionImpact, computeValidSets, type ImpactContext,
} from '@/lib/scanDeletionImpact';

// ─── Palette (matches results.tsx / analysis-details.tsx) ────────────────────
const BG     = '#FFFFFF';
const CARD   = '#FFFEFA';
const CARD_B = '#DDD2AC';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';
const MAROON = '#6E211B';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasGeneratedListings(ld: { ebay?: { title?: string } | null; depop?: { title?: string } | null } | null | undefined): boolean {
  return !!(ld && ((ld.ebay?.title ?? '').trim().length > 0 || (ld.depop?.title ?? '').trim().length > 0));
}

/** "Jun 12, 2026 · 3 weeks ago" */
function formatWhen(ts: number): string {
  const d = new Date(ts);
  const abs = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const mins = Math.floor((Date.now() - ts) / 60000);
  let rel: string;
  if (mins < 1)            rel = 'just now';
  else if (mins < 60)      rel = `${mins}m ago`;
  else if (mins < 1440)    rel = `${Math.floor(mins / 60)}h ago`;
  else if (mins < 10080)   rel = `${Math.floor(mins / 1440)}d ago`;
  else if (mins < 43200)   rel = `${Math.floor(mins / 10080)} week${Math.floor(mins / 10080) === 1 ? '' : 's'} ago`;
  else                     rel = `${Math.floor(mins / 43200)} month${Math.floor(mins / 43200) === 1 ? '' : 's'} ago`;
  return `${abs} · ${rel}`;
}

const RATING_THEME: Record<CanonicalRating, { fg: string; bg: string; border: string }> = {
  'STRONG BUY': { fg: FOREST,    bg: '#F5EFDB', border: GOLD },
  'BUY':        { fg: '#2A5A2A', bg: '#EFF6EC', border: '#7CA87C' },
  'RISKY BUY':  { fg: '#7A5C1E', bg: '#F7EFD9', border: '#C9A94E' },
  'SKIP':       { fg: MAROON,    bg: '#F5E9E7', border: '#C08A80' },
};

type Status = NonNullable<FlipResult['status']>;
const JOURNEY: { key: Status; label: string; icon: string }[] = [
  { key: 'scanned', label: 'Scanned', icon: 'qr-code-scanner' },
  { key: 'bought',  label: 'Bought',  icon: 'shopping-bag' },
  { key: 'listed',  label: 'Listed',  icon: 'sell' },
  { key: 'sold',    label: 'Sold',    icon: 'paid' },
];

// ─── Image viewer ─────────────────────────────────────────────────────────────
function ImageViewerModal({ uri, visible, onClose }: { uri: string; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={iv.backdrop} onPress={onClose}>
        <Image source={{ uri }} style={iv.img} contentFit="contain" />
        <View style={iv.closeHint}><MaterialIcons name="close" size={16} color={CREAM} /><Text style={iv.closeText}>Tap anywhere to close</Text></View>
      </Pressable>
    </Modal>
  );
}
const iv = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(20,14,6,0.94)', justifyContent: 'center', alignItems: 'center' },
  img:       { width: '94%', height: '78%' },
  closeHint: { position: 'absolute', bottom: 48, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: 0.85 },
  closeText: { color: CREAM, fontSize: 12, fontWeight: '600' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ScanDetailScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const params  = useLocalSearchParams<{ scanId?: string }>();
  const { user } = useAuth();
  const { flips, removeFlip, updateFlip } = useFlipStore();
  const { pruneUnseen } = useAchievementNotifications();

  const flip = useMemo(
    () => flips.find(f => !isHuntBundle(f) && f.id === params.scanId) as FlipResult | undefined,
    [flips, params.scanId],
  );

  // ── Local UI state (hooks before any early return) ──────────────────────────
  const [thriftEditing, setThriftEditing] = useState(false);
  const [thriftStr,     setThriftStr]     = useState('');
  const [soldStr, setSoldStr] = useState('');
  const soldInputRef = useRef<TextInput>(null);
  const [listLoading,   setListLoading]   = useState(false);
  const [localListings, setLocalListings] = useState<ListingData | null>(null);
  const [listingsOpen,  setListingsOpen]  = useState(false);
  const [copiedKey,     setCopiedKey]     = useState<string | null>(null);
  const [imageOpen,     setImageOpen]     = useState(false);

  // Impact context for safe deletion (mirrors the history tab).
  const [impactCtx, setImpactCtx] = useState<ImpactContext>({ completedHunts: 0, huntStreak: 0, huntBrands: [] });
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

  useEffect(() => { if (flip) setThriftStr(String(flip.thriftPrice)); }, [flip?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (flip) setSoldStr(flip.soldPrice ? String(flip.soldPrice) : ''); }, [flip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateListingsMutation = trpc.scan.generateListings.useMutation();

  const editedThrift = flip ? (parseFloat(thriftStr) || flip.thriftPrice) : 0;
  const calc = useMemo(
    () => flip ? computeFlipCalc(
      flip.resaleValue, editedThrift,
      flip.matchConfidence, flip.competitionLevel,
      flip.styleLabels, flip.era,
      flip.demand ?? '', flip.sellSpeed ?? '',
    ) : null,
    [flip, editedThrift],
  );

  const haptic = (style: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(style).catch(() => {});
  };

  // ── Not found (deleted mid-view / bad param) ────────────────────────────────
  if (!flip || !calc) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={20} color={CREAM} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerBrand}>FlipStart</Text>
            <Text style={s.headerSub}>✦ FLIP RECORD ✦</Text>
          </View>
          <View style={s.headerBtnGhost} />
        </View>
        <View style={s.notFound}>
          <MaterialIcons name="search-off" size={40} color={MUTED} />
          <Text style={s.notFoundTitle}>Scan not found</Text>
          <Text style={s.notFoundSub}>This scan may have been removed from your history.</Text>
          <Pressable onPress={() => router.back()} style={s.notFoundBtn}>
            <Text style={s.notFoundBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const rating  = normalizeBuyRating(flip.recommendation?.label ?? flip.buyLabel ?? 'SKIP');
  const rTheme  = RATING_THEME[rating];
  // No explicit status = 'scanned'. We never infer a purchase the user didn't
  // declare — legacy thriftPrice may be the AI "Est." default, not a real buy.
  const status: Status = flip.status ?? 'scanned';
  const isPassed = status === 'passed';
  const hasBought = status === 'bought' || status === 'listed' || status === 'sold';
  const journeyIdx = JOURNEY.findIndex(j => j.key === status); // −1 when passed

  const isSold      = status === 'sold' && (flip.soldPrice ?? 0) > 0;
  const soldPrice   = flip.soldPrice ?? 0;
  const actualFees  = isSold ? Math.round(calculateFees(soldPrice)) : 0;
  const actualProfit = isSold ? Math.round(soldPrice - calculateFees(soldPrice) - flip.thriftPrice) : 0;
  const delta       = isSold ? actualProfit - calc.profit : 0;
  const verdict     = !isSold ? '' :
    delta > 0 ? `Beat the estimate by $${delta}` :
    delta < 0 ? `$${Math.abs(delta)} under the estimate` :
    'Right on the estimate';

  const predColor   = calc.profit >= 15 ? '#2A5A2A' : calc.profit >= 0 ? '#7A5C1E' : '#8A3A2A';
  const actualColor = actualProfit >= 0 ? '#7FD98A' : '#E89A8A';

  const currentListings: ListingData | null = localListings ?? flip.listingData ?? null;
  const hasListings = hasGeneratedListings(
    currentListings ? { ebay: { title: currentListings.ebay.title }, depop: { title: currentListings.depop.title } } : null,
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  const setStatus = (next: Status) => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    const clearingSold = status === 'sold' && next !== 'sold';
    updateFlip(flip.id, {
      status: next,
      ...(clearingSold ? { soldPrice: undefined, soldAt: undefined } : {}),
    });
    trackAnalyticsEvent('flip_status_changed', { scan_id: flip.id, status: next });
  };

  const handleJourneyTap = (stage: Status) => {
    if (stage === 'sold') {
      // The sold-price field is always visible below — just focus it, rather
      // than gating discovery behind a tap-to-reveal panel.
      soldInputRef.current?.focus();
      haptic(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (stage === status) return;
    setStatus(stage);
  };

  const handleConfirmSold = () => {
    const v = parseFloat(soldStr);
    if (!v || v <= 0) {
      // Clearing the field un-sells the item (falls back to wherever it was).
      if (status === 'sold') {
        setStatus(flip.thriftPrice > 0 ? 'bought' : 'scanned');
      }
      return;
    }
    if (v === flip.soldPrice && status === 'sold') return; // no change
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Entering a valid sold price is what completes the journey — the stepper
    // jumps straight to 100% (Sold) since that's the real-world outcome.
    updateFlip(flip.id, { status: 'sold', soldPrice: v, soldAt: Date.now() });
    trackAnalyticsEvent('flip_status_changed', { scan_id: flip.id, status: 'sold', sold_price: v });
  };

  const handleTogglePassed = () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    if (isPassed) {
      setStatus('scanned');
    } else {
      setStatus('passed');
    }
  };

  const handleSaveThrift = () => {
    const v = parseFloat(thriftStr);
    if (!v || v === flip.thriftPrice) { setThriftEditing(false); setThriftStr(String(flip.thriftPrice)); return; }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    updateFlip(flip.id, {
      thriftPrice: v, fees: calc.fees, profit: calc.profit, roi: calc.roi,
      buyScore: calc.buyScore, buyLabel: calc.buyLabel, stars: calc.stars,
    });
    setThriftEditing(false);
  };

  const handleGenerateListings = async () => {
    if (hasListings && currentListings) { setListingsOpen(true); return; }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setListLoading(true);
    try {
      const result = await generateListingsMutation.mutateAsync({
        item_name: flip.itemName, brand: flip.brand, category: flip.category,
        estimated_era: flip.era ?? 'Unknown', material_guess: flip.material ?? 'Unknown',
        style_labels: flip.styleLabels ?? [],
        adjusted_estimated_value: flip.resaleValue, demand: flip.demand ?? 'Medium',
      });
      const listingData: ListingData = {
        ebay:  { title: result.ebay.title,  description: result.ebay.description  },
        depop: { title: result.depop.title, description: result.depop.description },
      };
      updateFlip(flip.id, { listingsGenerated: true, generatedAt: Date.now(), listingData });
      setLocalListings(listingData);
      setListingsOpen(true);
      trackAnalyticsEvent('listing_generated', {
        scan_id: flip.id, item_title: flip.itemName, brand: flip.brand, category: flip.category,
        platform: 'both',
        title_generated: !!(listingData.ebay?.title || listingData.depop?.title),
        description_generated: !!(listingData.ebay?.description || listingData.depop?.description),
        estimated_resale_value: flip.resaleValue,
        generation_source: 'scan_detail',
      });
    } catch {
      Alert.alert('Generation failed', 'Could not generate listings right now. Please try again.');
    } finally {
      setListLoading(false);
    }
  };

  const copy = (text: string, key: string) => {
    Clipboard.setString(text);
    haptic(Haptics.ImpactFeedbackStyle.Light);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1600);
  };

  // Deletion with the SAME reconciliation the history tab performs — badges are
  // pruned and cloud rows reconciled so nothing resurrects on the next sync.
  const performDelete = () => {
    const lost = getScanDeletionImpact(flips, flip.id, impactCtx);
    trackAnalyticsEvent('scan_deleted', {
      scan_id: flip.id,
      lost_achievements: lost.affectedAchievements.length,
      lost_brands:       lost.affectedBrands.length,
      lost_diamonds:     lost.affectedDiamonds.length,
    });
    removeFlip(flip.id);
    const after = flips.filter(f => f.id !== flip.id);
    const valid = computeValidSets(after, impactCtx);
    pruneUnseen(valid);
    const uid = user?.id;
    if (uid) {
      import('@/lib/achievementSync').then(({ reconcileAchievementsToLocalTruth }) => reconcileAchievementsToLocalTruth(uid, valid.achievements)).catch(() => {});
      import('@/lib/brandSync').then(({ reconcileBrandsToLocalTruth }) => reconcileBrandsToLocalTruth(uid, valid.brands)).catch(() => {});
      import('@/lib/diamondSync').then(({ reconcileDiamondsToLocalTruth }) => reconcileDiamondsToLocalTruth(uid, valid.diamonds)).catch(() => {});
    }
    router.back();
  };

  const handleDeletePress = () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const impact = getScanDeletionImpact(flips, flip.id, impactCtx);
    const warning = impact.hasProgressImpact
      ? `Deleting this scan removes progress: ${impact.affectedAchievements.length} achievement${impact.affectedAchievements.length === 1 ? '' : 's'}, ${impact.affectedBrands.length} brand${impact.affectedBrands.length === 1 ? '' : 's'}, ${impact.affectedDiamonds.length} diamond${impact.affectedDiamonds.length === 1 ? '' : 's'} may be lost.`
      : 'This removes the scan from your history.';
    Alert.alert('Delete this scan?', warning, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: performDelete },
    ]);
  };

  // ── Deep Analysis coach-mark (tooltip) — IDENTICAL system to results.tsx,
  // and deliberately keyed by the SAME account-scoped storage key so the
  // "haven't opened Deep Analysis in N scans" streak is shared across both
  // Flip Record (this screen) and normal Scan Analysis (results.tsx). Opening
  // Deep Analysis from either screen resets the shared streak.
  //  • Shows on first visit to either screen until the user taps in once.
  //  • The X hides it for the current scan only.
  //  • After first use, stays hidden — UNLESS the user then views 5+ scans in
  //    a row (across both screens) WITHOUT opening Deep Analysis.
  const DEEP_STREAK_THRESHOLD = 5;
  const deepTipKey = `@flipstart/deep_analysis_state:${user?.id ?? 'guest'}`;
  const [showDeepTip, setShowDeepTip] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(deepTipKey);
        const st = raw ? JSON.parse(raw) as { seen?: boolean; streak?: number; lastScanId?: string } : {};
        let streak = st.streak ?? 0;
        // Count this scan once (dedupe by scan id so re-renders don't inflate it).
        if (flip?.id && flip.id !== st.lastScanId) {
          streak += 1;
          await AsyncStorage.setItem(deepTipKey, JSON.stringify({ ...st, streak, lastScanId: flip.id }));
        }
        const shouldShow = !st.seen || streak >= DEEP_STREAK_THRESHOLD;
        if (alive) setShowDeepTip(shouldShow);
      } catch { /* if storage fails, just don't show the tip */ }
    })();
    return () => { alive = false; };
  }, [deepTipKey, flip?.id]);

  // ── Deep Analysis arrow glow — same subtle pulsing gold aura as results.tsx ─
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

  const navigateToDeepAnalysis = () => {
    if (!navGuard()) return;
    haptic(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/analysis-details' as any, params: { scanId: flip.id, source: 'history' } });
  };

  // Tapping the title/arrow (or the existing Deep Analysis card) opens Deep
  // Analysis AND permanently dismisses the coach-mark, resetting the streak.
  const handleOpenDeepAnalysis = () => {
    if (showDeepTip) setShowDeepTip(false);
    AsyncStorage.setItem(
      deepTipKey,
      JSON.stringify({ seen: true, streak: 0, lastScanId: flip?.id ?? '' }),
    ).catch(() => { /* non-fatal */ });
    navigateToDeepAnalysis();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={CREAM} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerBrand}>FlipStart</Text>
          <Text style={s.headerSub}>✦ FLIP RECORD ✦</Text>
        </View>
        <Pressable onPress={handleDeletePress} style={s.headerBtn} hitSlop={8}>
          <MaterialIcons name="delete-outline" size={20} color={CREAM} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: BG }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 44 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Hero ── */}
        <View style={s.heroCard}>
          <Pressable onPress={() => flip.imageUri && setImageOpen(true)} style={s.heroImgWrap}>
            {flip.imageUri ? (
              <Image source={{ uri: flip.imageUri }} style={s.heroImg} contentFit="cover" />
            ) : (
              <View style={[s.heroImg, s.heroFallback]}>
                <MaterialIcons name="checkroom" size={44} color={MUTED} />
              </View>
            )}
            {/* Rating badge over image */}
            <View style={[s.heroRating, { backgroundColor: rTheme.bg, borderColor: rTheme.border }]}>
              <Text style={[s.heroRatingText, { color: rTheme.fg }]}>{rating}</Text>
            </View>
            {isSold && (
              <View style={s.heroSold}>
                <MaterialIcons name="paid" size={12} color={CREAM} />
                <Text style={s.heroSoldText}>SOLD</Text>
              </View>
            )}
            {flip.imageUri && (
              <View style={s.heroZoom}><MaterialIcons name="zoom-in" size={13} color={CREAM} /></View>
            )}
          </Pressable>

          <View style={s.heroBody}>
            <View style={s.idTitleWrap}>
              <Pressable onPress={handleOpenDeepAnalysis} hitSlop={4} style={({ pressed }) => [s.idTitlePress, pressed && { opacity: 0.6 }]}>
                <Text style={s.heroTitle}>
                  {flip.itemName || 'Unknown Item'}
                  <Animated.Text
                    style={[
                      s.idTitleArrow,
                      { textShadowColor: GOLD, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: arrowShadowRadius },
                    ]}
                  > ›</Animated.Text>
                </Text>
              </Pressable>

              {/* First-visit coach mark for Deep Analysis — shared streak with Scan Analysis */}
              {showDeepTip && (
                <View style={s.deepTip}>
                  <View style={s.deepTipArrow} />
                  <View style={s.deepTipRow}>
                    <MaterialIcons name="lightbulb" size={15} color={GOLD} style={{ marginTop: 1 }} />
                    <Text style={s.deepTipText}>
                      Tap the item name to open <Text style={s.deepTipBold}>Deep Analysis</Text> — full price reasoning, risks, and platform strategy.
                    </Text>
                    <Pressable onPress={() => setShowDeepTip(false)} hitSlop={8} style={s.deepTipClose}>
                      <MaterialIcons name="close" size={15} color={MUTED} />
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
            <View style={s.chipWrap}>
              {!!flip.brand && <View style={s.chip}><Text style={s.chipText} numberOfLines={1}>{flip.brand}</Text></View>}
              {!!flip.category && <View style={s.chip}><Text style={s.chipText} numberOfLines={1}>{flip.category}</Text></View>}
              {!!flip.era && flip.era.toLowerCase() !== 'unknown' && <View style={s.chip}><Text style={s.chipText} numberOfLines={1}>{flip.era}</Text></View>}
              {flip.matchConfidence > 0 && (
                <View style={[s.chip, s.chipConf]}>
                  <MaterialIcons name="verified" size={11} color={FOREST} />
                  <Text style={[s.chipText, { color: FOREST, fontWeight: '700' }]} numberOfLines={1}>{flip.matchConfidence}%</Text>
                </View>
              )}
            </View>
            <View style={s.dateRow}>
              <MaterialIcons name="history" size={13} color={MUTED} />
              <Text style={s.dateText}>Scanned {formatWhen(flip.timestamp)}</Text>
            </View>
          </View>
        </View>

        {/* ── 2. Flip Journey ── */}
        <View style={s.card}>
          <View style={s.cardHead}>
            <View style={s.cardHeadIcon}><MaterialIcons name="route" size={15} color={GOLD} /></View>
            <Text style={s.cardHeadTitle}>Flip Journey</Text>
            {isPassed && (
              <View style={s.passedPill}><Text style={s.passedPillText}>PASSED</Text></View>
            )}
          </View>

          <View style={[s.journeyRow, isPassed && { opacity: 0.35 }]}>
            {JOURNEY.map((stage, i) => {
              const reached = !isPassed && journeyIdx >= i;
              const isCurrent = !isPassed && journeyIdx === i;
              return (
                <View key={stage.key} style={s.journeyStage}>
                  {i > 0 && <View style={[s.journeyLine, reached && s.journeyLineFilled]} />}
                  <Pressable
                    onPress={() => handleJourneyTap(stage.key)}
                    hitSlop={6}
                    style={({ pressed }) => [
                      s.journeyNode,
                      reached && s.journeyNodeFilled,
                      isCurrent && s.journeyNodeCurrent,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <MaterialIcons name={stage.icon as any} size={17} color={reached ? CREAM : MUTED} />
                  </Pressable>
                  <Text style={[s.journeyLabel, reached && s.journeyLabelActive]}>{stage.label}</Text>
                </View>
              );
            })}
          </View>

          {/* Sold-price field — ALWAYS visible so it's discoverable, not hidden
              behind a tap. Entering a price marks the item sold and completes
              the journey; clearing it un-sells. Once sold, this row is REPLACED
              by the Outcome panel below (predicted vs actual), connected right
              here in the Journey card — with an X to come back and edit the price. */}
          {!isPassed && !isSold && (
            <View style={s.soldPanel}>
              <MaterialIcons name="paid" size={15} color={MUTED} />
              <Text style={s.soldPanelLabel}>Sold for</Text>
              <View style={s.soldInputWrap}>
                <Text style={s.soldDollar}>$</Text>
                <TextInput
                  ref={soldInputRef}
                  style={s.soldInput}
                  value={soldStr}
                  onChangeText={t => { if (/^\d*\.?\d*$/.test(t)) setSoldStr(t); }}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={handleConfirmSold}
                  onBlur={handleConfirmSold}
                  placeholder="0"
                  placeholderTextColor={MUTED}
                />
              </View>
            </View>
          )}

          {/* Outcome — replaces the sold-price row once a price is entered.
              Connected directly to the journey it completes. X re-opens editing. */}
          {!isPassed && isSold && (
            <View style={s.outcomePanel}>
              <Pressable
                onPress={() => {
                  // Revert to editable — soldStr still holds the price, so the
                  // input row reappears pre-filled for a quick correction.
                  setStatus(flip.thriftPrice > 0 ? 'bought' : 'scanned');
                }}
                style={s.outcomeClose}
                hitSlop={8}
              >
                <MaterialIcons name="close" size={15} color="rgba(244,238,216,0.65)" />
              </Pressable>

              <View style={s.cardHeadPremRow}>
                <View style={s.cardHeadIconPrem}><MaterialIcons name="emoji-events" size={15} color={GOLD} /></View>
                <Text style={s.cardHeadTitlePrem}>The Outcome</Text>
              </View>
              <View style={s.outcomeRow}>
                <View style={s.outcomeCol}>
                  <Text style={s.outcomeColLabel}>PREDICTED</Text>
                  <Text style={s.outcomePred}>{calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`}</Text>
                </View>
                <MaterialIcons name="arrow-forward" size={18} color={'rgba(244,238,216,0.5)'} />
                <View style={s.outcomeCol}>
                  <Text style={s.outcomeColLabel}>ACTUAL</Text>
                  <Text style={[s.outcomeActual, { color: actualColor }]}>{actualProfit >= 0 ? `+$${actualProfit}` : `-$${Math.abs(actualProfit)}`}</Text>
                </View>
              </View>
              <View style={s.verdictRow}>
                <Text style={s.verdictStar}>✦</Text>
                <Text style={s.verdictText}>{verdict}</Text>
                <Text style={s.verdictStar}>✦</Text>
              </View>
              <Text style={s.outcomeBreakdown}>
                Sold ${soldPrice} · Fees ~${actualFees} · Paid ${flip.thriftPrice}
              </Text>
            </View>
          )}

          <Pressable onPress={handleTogglePassed} style={s.passedToggle} hitSlop={4}>
            <MaterialIcons name={isPassed ? 'undo' : 'block'} size={13} color={MUTED} />
            <Text style={s.passedToggleText}>{isPassed ? 'Un-mark as passed' : 'Passed on this one?'}</Text>
          </Pressable>
        </View>

        {/* ── 3. Your Numbers ── */}
        <View style={s.card}>
          <View style={s.cardHead}>
            <View style={s.cardHeadIcon}><MaterialIcons name="payments" size={15} color={GOLD} /></View>
            <Text style={s.cardHeadTitle}>Your Numbers</Text>
          </View>
          <View style={s.numGrid}>
            {/* You Paid — editable */}
            <View style={s.numBox}>
              {thriftEditing ? (
                <View style={s.numEditWrap}>
                  <Text style={s.numEditDollar}>$</Text>
                  <TextInput
                    style={s.numEditInput}
                    value={thriftStr}
                    onChangeText={t => { if (/^\d*\.?\d*$/.test(t)) setThriftStr(t); }}
                    keyboardType="decimal-pad" autoFocus returnKeyType="done"
                    onSubmitEditing={handleSaveThrift} onBlur={handleSaveThrift}
                  />
                </View>
              ) : (
                <Pressable onPress={() => { setThriftEditing(true); haptic(Haptics.ImpactFeedbackStyle.Light); }} style={s.numPressable}>
                  <Text style={s.numVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>${flip.thriftPrice}</Text>
                  <MaterialIcons name="edit" size={11} color={MUTED} style={s.numEditIcon} />
                </Pressable>
              )}
              <Text style={s.numLabel}>{hasBought ? 'YOU PAID' : 'BUY PRICE'}</Text>
            </View>

            <View style={s.numBox}>
              <Text style={s.numVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>${flip.resaleValue}</Text>
              <Text style={s.numLabel}>EST. RESALE</Text>
            </View>

            {isSold ? (
              <View style={s.numBox}>
                <Text style={[s.numVal, { color: '#2A5A2A' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>${soldPrice}</Text>
                <Text style={s.numLabel}>SOLD FOR</Text>
              </View>
            ) : (
              <View style={s.numBox}>
                <Text style={[s.numVal, { color: predColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {calc.profit >= 0 ? `+$${calc.profit}` : `-$${Math.abs(calc.profit)}`}
                </Text>
                <Text style={s.numLabel}>EST. PROFIT</Text>
              </View>
            )}

            <View style={s.numBox}>
              <Text style={s.numVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {isSold ? `~$${actualFees}` : (calc.roi > 0 ? `${calc.roi}%` : '—')}
              </Text>
              <Text style={s.numLabel}>{isSold ? 'FEES' : 'ROI'}</Text>
            </View>
          </View>
          <Text style={s.numNote}>
            Market range ${flip.resaleRangeLow}–${flip.resaleRangeHigh}
            {flip.avgSoldPrice > 0 ? ` · avg sold $${flip.avgSoldPrice}` : ''}
          </Text>
        </View>

        {/* ── 5. Listings ── */}
        <View style={s.card}>
          <View style={s.cardHead}>
            <View style={s.cardHeadIcon}><MaterialIcons name="description" size={15} color={GOLD} /></View>
            <Text style={s.cardHeadTitle}>Listings</Text>
          </View>
          {hasListings && currentListings ? (
            <>
              <View style={s.listingStatusRow}>
                <View style={s.listingBadge}>
                  <MaterialIcons name="check-circle" size={13} color={FOREST} />
                  <Text style={s.listingBadgeText}>Listings ready</Text>
                </View>
                <Pressable onPress={() => setListingsOpen(v => !v)} style={s.listingToggle} hitSlop={4}>
                  <Text style={s.listingToggleText}>{listingsOpen ? 'Hide' : 'View'}</Text>
                </Pressable>
              </View>
              {listingsOpen && (['ebay', 'depop'] as const).map(p => currentListings[p] && (
                <View key={p} style={s.listingBlock}>
                  <View style={s.listingBlockHeader}>
                    <Text style={s.listingPlatform}>{p === 'ebay' ? 'eBay' : 'Depop'}</Text>
                    <Pressable onPress={() => copy(currentListings[p]!.title + '\n\n' + currentListings[p]!.description, p)} style={s.listingCopyBtn} hitSlop={4}>
                      <MaterialIcons name={copiedKey === p ? 'check' : 'content-copy'} size={12} color={FOREST} />
                      <Text style={s.listingCopyText}>{copiedKey === p ? 'Copied' : 'Copy all'}</Text>
                    </Pressable>
                  </View>
                  <Text style={s.listingTitle}>{currentListings[p]!.title}</Text>
                  <Text style={s.listingDesc}>{currentListings[p]!.description}</Text>
                </View>
              ))}
            </>
          ) : (
            <Pressable onPress={handleGenerateListings} disabled={listLoading} style={({ pressed }) => [s.generateBtn, pressed && { opacity: 0.85 }]}>
              <MaterialIcons name={listLoading ? 'hourglass-empty' : 'edit-note'} size={17} color={CREAM} />
              <Text style={s.generateBtnText}>{listLoading ? 'Generating…' : 'Generate Listings'}</Text>
            </Pressable>
          )}
        </View>

        {/* ── 6. Deep Analysis doorway ── */}
        <Pressable onPress={handleOpenDeepAnalysis} style={({ pressed }) => [s.deepCard, pressed && { opacity: 0.88 }]}>
          <View style={s.deepIconWrap}><MaterialIcons name="psychology" size={20} color={GOLD} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.deepTitle}>Deep Analysis</Text>
            <Text style={s.deepSub}>Why this rating, risks, where to sell & listing strategy</Text>
          </View>
          <MaterialIcons name="chevron-right" size={22} color={GOLD} />
        </Pressable>
      </ScrollView>

      <ImageViewerModal uri={flip.imageUri} visible={imageOpen} onClose={() => setImageOpen(false)} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Header (matches results / deep analysis)
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FOREST, paddingHorizontal: 14, paddingBottom: 12 },
  headerBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(244,238,216,0.14)', alignItems: 'center', justifyContent: 'center' },
  headerBtnGhost:{ width: 36, height: 36 },
  headerCenter: { alignItems: 'center', gap: 1 },
  headerBrand:  { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '800', color: CREAM },
  headerSub:    { fontSize: 10, fontWeight: '800', color: GOLD, letterSpacing: 2.4 },

  // Not found
  notFound:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 30 },
  notFoundTitle: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', color: FOREST },
  notFoundSub:   { fontSize: 13, color: MUTED, textAlign: 'center' },
  notFoundBtn:   { marginTop: 12, backgroundColor: FOREST, paddingHorizontal: 26, paddingVertical: 12, borderRadius: 50 },
  notFoundBtnText:{ fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: CREAM },

  // Hero
  heroCard:    { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: CARD_B, marginHorizontal: 14, marginTop: 14, overflow: 'hidden', shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.10, shadowRadius: 8, elevation: 3 },
  heroImgWrap: { width: '100%', height: 228, position: 'relative' },
  heroImg:     { width: '100%', height: '100%', backgroundColor: '#FFFEFA' },
  heroFallback:{ alignItems: 'center', justifyContent: 'center' },
  heroRating:  { position: 'absolute', top: 10, right: 10, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  heroRatingText:{ fontFamily: FONTS.serif, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  heroSold:    { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: FOREST, borderWidth: 1, borderColor: GOLD, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  heroSoldText:{ fontSize: 10, fontWeight: '800', color: CREAM, letterSpacing: 1 },
  heroZoom:    { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(42,74,42,0.85)', borderRadius: 10, padding: 4 },
  heroBody:    { padding: 15, gap: 9 },
  heroTitle:   { fontFamily: FONTS.serif, fontSize: 21, fontWeight: '800', color: FOREST, lineHeight: 26 },
  idTitleWrap: { position: 'relative', zIndex: 40 },
  idTitlePress:{ alignSelf: 'flex-start' },
  idTitleArrow:{ fontFamily: FONTS.serif, fontSize: 21, fontWeight: '800', color: GOLD },
  deepTip: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, zIndex: 20,
    backgroundColor: '#FFFDF6', borderRadius: 12, borderWidth: 1, borderColor: GOLD,
    paddingVertical: 10, paddingHorizontal: 12,
    shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6,
  },
  deepTipArrow: {
    position: 'absolute', top: -7, left: 22, width: 12, height: 12,
    backgroundColor: '#FFFDF6', borderLeftWidth: 1, borderTopWidth: 1, borderColor: GOLD,
    transform: [{ rotate: '45deg' }],
  },
  deepTipRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  deepTipText: { flex: 1, fontSize: 12, lineHeight: 17, color: BROWN },
  deepTipBold: { fontWeight: '800', color: FOREST },
  deepTipClose:{ padding: 2, marginTop: -1 },
  chipWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%', backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 50, paddingHorizontal: 8, paddingVertical: 4 },
  chipConf:    { borderColor: '#7CA87C', backgroundColor: '#EFF6EC' },
  chipText:    { fontSize: 10.5, fontWeight: '600', color: BROWN, flexShrink: 1 },
  dateRow:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dateText:    { fontSize: 12, color: MUTED, fontWeight: '600' },

  // Generic card + head
  card:            { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: CARD_B, marginHorizontal: 14, marginTop: 12, padding: 15, shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  cardHead:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardHeadIcon:    { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(190,156,44,0.14)', borderWidth: 1, borderColor: 'rgba(190,156,44,0.4)', alignItems: 'center', justifyContent: 'center' },
  cardHeadTitle:   { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: '800', color: FOREST, flex: 1 },
  cardHeadIconPrem:{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  cardHeadTitlePrem:{ fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: '800', color: CREAM, flex: 1 },

  // Journey
  journeyRow:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 2 },
  journeyStage:     { flex: 1, alignItems: 'center', gap: 5, position: 'relative' },
  journeyLine:      { position: 'absolute', top: 19, right: '50%', width: '100%', height: 2, backgroundColor: CARD_B, zIndex: 0 },
  journeyLineFilled:{ backgroundColor: GOLD },
  journeyNode:      { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F8F7F0', borderWidth: 1.5, borderColor: CARD_B, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  journeyNodeFilled:{ backgroundColor: FOREST, borderColor: FOREST },
  journeyNodeCurrent:{ borderColor: GOLD, borderWidth: 2.5, shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 6, elevation: 4 },
  journeyLabel:     { fontSize: 10, fontWeight: '700', color: MUTED },
  journeyLabelActive:{ color: FOREST },

  passedPill:      { backgroundColor: '#F5E9E7', borderWidth: 1, borderColor: '#C08A80', borderRadius: 50, paddingHorizontal: 9, paddingVertical: 3 },
  passedPillText:  { fontSize: 10, fontWeight: '800', color: MAROON, letterSpacing: 0.6 },
  passedToggle:    { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center', marginTop: 12, paddingVertical: 2 },
  passedToggleText:{ fontSize: 11.5, fontWeight: '600', color: MUTED },

  soldPanel:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  soldPanelLabel:{ fontSize: 12.5, fontWeight: '700', color: BROWN },
  soldInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  soldDollar:    { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: FOREST },
  soldInput:     { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: FOREST, padding: 0, minWidth: 18, textAlign: 'left' },

  // Outcome — replaces the sold-price row inside the Journey card once sold
  outcomePanel:  { marginTop: 14, backgroundColor: '#1E3A20', borderRadius: 14, paddingTop: 14, paddingBottom: 14, paddingHorizontal: 15, position: 'relative', shadowColor: '#0A1A0A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  outcomeClose:  { position: 'absolute', top: 9, right: 9, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  cardHeadPremRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingRight: 20 },
  outcomeRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', marginTop: 2 },
  outcomeCol:    { alignItems: 'center', gap: 3 },
  outcomeColLabel:{ fontSize: 9.5, fontWeight: '800', color: 'rgba(244,238,216,0.55)', letterSpacing: 1.4 },
  outcomePred:   { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '800', color: 'rgba(244,238,216,0.75)' },
  outcomeActual: { fontFamily: FONTS.serif, fontSize: 30, fontWeight: '800' },
  verdictRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  verdictStar:   { fontSize: 10, color: GOLD },
  verdictText:   { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: '700', color: CREAM },
  outcomeBreakdown:{ fontSize: 11, color: 'rgba(244,238,216,0.6)', textAlign: 'center', marginTop: 7 },

  // Numbers grid
  numGrid:     { flexDirection: 'row', gap: 8 },
  numBox:      { flex: 1, backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  numPressable:{ flexDirection: 'row', alignItems: 'center', gap: 3 },
  numVal:      { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: FOREST },
  numLabel:    { fontSize: 8.5, fontWeight: '800', color: MUTED, letterSpacing: 0.5, marginTop: 3 },
  numEditIcon: { marginTop: 1 },
  numEditWrap: { flexDirection: 'row', alignItems: 'center' },
  numEditDollar:{ fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: FOREST },
  numEditInput:{ fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: FOREST, padding: 0, minWidth: 42 },
  numNote:     { fontSize: 11, color: MUTED, marginTop: 10, textAlign: 'center' },

  // Listings
  listingStatusRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listingBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  listingBadgeText:{ fontSize: 12.5, fontWeight: '700', color: FOREST },
  listingToggle:   { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 50, borderWidth: 1, borderColor: FOREST + '55', backgroundColor: '#EFF6EC' },
  listingToggleText:{ fontSize: 12, fontWeight: '700', color: FOREST },
  listingBlock:    { marginTop: 12, backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 12, padding: 12 },
  listingBlockHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  listingPlatform: { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: '800', color: FOREST },
  listingCopyBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 50, borderWidth: 1, borderColor: FOREST + '44', backgroundColor: '#EFF6EC' },
  listingCopyText: { fontSize: 10.5, fontWeight: '700', color: FOREST },
  listingTitle:    { fontSize: 13, fontWeight: '800', color: BROWN, marginBottom: 5 },
  listingDesc:     { fontSize: 12, lineHeight: 17.5, color: BROWN },
  generateBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: FOREST, borderRadius: 50, paddingVertical: 14 },
  generateBtnText: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: CREAM },

  // Deep Analysis doorway
  deepCard:    { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: CARD, borderRadius: 16, borderWidth: 1.5, borderColor: GOLD + '77', marginHorizontal: 14, marginTop: 12, padding: 14, shadowColor: GOLD, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 7, elevation: 2 },
  deepIconWrap:{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(190,156,44,0.14)', borderWidth: 1, borderColor: 'rgba(190,156,44,0.45)', alignItems: 'center', justifyContent: 'center' },
  deepTitle:   { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: '800', color: FOREST },
  deepSub:     { fontSize: 11, color: MUTED, marginTop: 1 },
});