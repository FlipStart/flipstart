/**
 * app/hunt-active.tsx
 *
 * V1 Live Hunt Mode tracking screen.
 * Appears after pressing "Start Hunt" on hunt.tsx.
 *
 * Layout (single screen, no scroll):
 *   Header: ← [Hunt Title] [map icon]
 *   Location row
 *   Stats row: Scanned | Kept | Est. Profit
 *   Scanned Items section (max 4 recent)
 *   Search for Treasure button
 *   Custom Hunt Mode bottom nav
 */

import {
  View, Text, Pressable, StyleSheet, Alert, Platform, Image, Animated, PanResponder, Modal, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useEffect, useRef } from 'react';
import { useAfterModalClose } from '@/lib/useAfterModalClose';

// Hunt scan icon — the marksman/crosshair image

import {
  getActiveHunt, finishHunt, discardHunt, getHuntStats, subscribeToHunt,
  moveHuntItemToRemoved, type HuntItem, type HuntRating,
  keptItemsOf, removedItemsOf, pendingItemOf, setScanDestination,
  consumeReturningFromHuntItemDetail, addPendingScanToHunt,
} from '@/lib/hunt-context';
import { logHuntScanStarted, logHuntEnded, logHuntXpAwarded } from '@/lib/analytics';
import { applyHuntXp, setLastCompletionResult } from '@/lib/huntXp';
import { useFlipStore } from '@/lib/useFlipStore';
import { isHuntBundle, type HuntBundle, type HuntBundleItem } from '@/types/flip';
import { FONTS } from '@/constants/typography';
import { V } from '@/constants/vintage';
import { useScanGate } from '@/lib/useScanGate';
import { isHuntDemoActive, isDemoExiting, beginDemoExit, endDemoExit } from '@/lib/huntDemoMode';
import { advanceCoach, returnCoachTo, type CoachStepId } from '@/lib/huntDemoCoach';
import { finishDemoHunt, endDemoHunt, demoScanFor } from '@/lib/huntDemoSession';
import { demoPhotoUri } from '@/components/hunt/onboarding/demoAssets';
import { CoachOverlay } from '@/components/hunt/onboarding/coach/CoachOverlay';
import { useCoachRef } from '@/components/hunt/onboarding/coach/coachTargets';
import { useHuntOnboarding } from '@/lib/useHuntOnboarding';

// ─── Palette ──────────────────────────────────────────────────────────────────

const FOREST   = '#2A4A2A';
const FOREST_D = '#1A3020';
const GOLD     = '#BE9C2C';
const GOLD_L   = '#D4A72C';
const CREAM    = '#F2E8D0';
const CREAM_D  = '#E0D0A8';
const BG       = '#F0E8D4';
const CARD_BG  = '#FFF9EE';
const CARD_B   = '#DDD0B0';
const BROWN    = '#5A3A1A';
const MUTED    = '#8A7050';

/**
 * Fields added with hunt persistence, copied into the saved bundle so history
 * keeps the photos, fees and ids. Undefined values are left out entirely.
 */
function huntItemExtras(i: HuntItem): Partial<HuntBundleItem> {
  const out: Partial<HuntBundleItem> = {};
  if (i.analysisId)              out.analysisId     = i.analysisId;
  if (i.allImageUris?.length)    out.allImageUris   = i.allImageUris;
  if (i.extraPhotos?.length)     out.extraPhotos    = i.extraPhotos;
  if (typeof i.fees === 'number') out.fees          = i.fees;
  if (typeof i.roi === 'number')  out.roi           = i.roi;
  if (i.priceUpdatedAt)          out.priceUpdatedAt = i.priceUpdatedAt;
  if (i.compsSnapshot)           out.compsSnapshot  = i.compsSnapshot;
  return out;
}

// ─── Rating config ────────────────────────────────────────────────────────────

const RATING_CFG: Record<HuntRating, {
  label: string; emoji: string;
  color: string; bg: string; border: string; glow?: string;
}> = {
  legendary: {
    label: 'Legendary Loot', emoji: '👑',
    color: GOLD_L, bg: '#2A1E04', border: GOLD_L, glow: GOLD_L + '55',
  },
  treasure: {
    label: 'Treasure', emoji: '💰',
    color: GOLD, bg: '#221904', border: GOLD + 'AA',
  },
  risky: {
    label: 'Risky', emoji: '⚠️',
    color: '#C89020', bg: '#221604', border: '#C8902088',
  },
  trash: {
    label: 'Skip', emoji: '✕',
    color: '#FFDADA', bg: '#6B1414', border: '#E05555',
  },
};

// ─── Item card ────────────────────────────────────────────────────────────────

// ─── Item card with swipe-to-remove ──────────────────────────────────────────

const SWIPE_WIDTH = 80;

function ItemCard({ item }: { item: HuntItem }) {
  const router      = useRouter();
  const cfg         = RATING_CFG[item.huntRating] ?? RATING_CFG.trash;
  const profitStr   = item.profit >= 0 ? `+$${item.profit}` : `-$${Math.abs(item.profit)}`;
  const profitColor = item.profit > 0 ? '#3A7A3A' : '#8A2A1A';

  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOpen  = useRef(false);

  const snapOpen = () =>
    Animated.spring(translateX, { toValue: -SWIPE_WIDTH, useNativeDriver: true, bounciness: 4 })
      .start(() => { swipeOpen.current = true; });

  const snapClosed = () =>
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 })
      .start(() => { swipeOpen.current = false; });

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = swipeOpen.current ? -SWIPE_WIDTH : 0;
        translateX.setValue(Math.min(0, Math.max(-SWIPE_WIDTH, base + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const base  = swipeOpen.current ? -SWIPE_WIDTH : 0;
        const total = base + g.dx;
        total < -SWIPE_WIDTH / 2 ? snapOpen() : snapClosed();
      },
      onPanResponderTerminate: () => snapClosed(),
    })
  ).current;

  const glowStyle = cfg.glow
    ? { shadowColor: cfg.glow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, elevation: 6 }
    : {};

  return (
    <View style={[ic.wrapper, glowStyle]}>
      {/* Remove zone — revealed by swipe left */}
      <View style={ic.deleteZone}>
        <Pressable
          style={ic.deleteBtn}
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            snapClosed();
            setTimeout(() => moveHuntItemToRemoved(item.scanId), 180);
          }}
        >
          <MaterialIcons name="delete-outline" size={20} color="#FFF" />
          <Text style={ic.deleteText}>Remove</Text>
        </Pressable>
      </View>

      <Animated.View
        style={[ic.surface, { transform: [{ translateX }] }]}
        {...pan.panHandlers}
      >
        <Pressable
          onPress={() => swipeOpen.current
            ? snapClosed()
            : router.push(`/hunt-item-detail?mode=readonly&huntItemId=${item.huntItemId}` as any)
          }
          style={({ pressed }) => [ic.card, { borderColor: cfg.border }, pressed && !swipeOpen.current && { opacity: 0.80 }]}
        >
          <View style={ic.imgWrap}>
            {item.imageUri ? (
              <Image source={{ uri: item.imageUri }} style={ic.img} resizeMode="cover" />
            ) : (
              <View style={[ic.img, ic.imgFallback]}>
                <MaterialIcons name="checkroom" size={18} color={MUTED} />
              </View>
            )}
          </View>

          <View style={ic.info}>
            <Text style={ic.name} numberOfLines={1}>{item.itemName}</Text>
            {item.thriftPrice > 0 && (
              <Text style={ic.price}>-${item.thriftPrice.toFixed(2)}</Text>
            )}
            <View style={[ic.ratingPill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
              <Text style={ic.ratingEmoji}>{cfg.emoji}</Text>
              <Text style={[ic.ratingLabel, { color: cfg.color }]}>
                {cfg.label.toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={ic.right}>
            <Text style={[ic.profit, { color: profitColor }]}>{profitStr}</Text>
            {/* KEPT: status-only pill, not interactive */}
            <View style={ic.keptPill}>
              <Text style={ic.keptText}>KEPT</Text>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const ic = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD_BG, borderRadius: 12,
    borderWidth: 1.5, padding: 10, gap: 10,
  },
  imgWrap: { borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B },
  img:     { width: 48, height: 48, borderRadius: 7 },
  imgFallback: { backgroundColor: CREAM_D, justifyContent: 'center', alignItems: 'center' },
  info:    { flex: 1, gap: 3 },
  name:    { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700', color: BROWN },
  price:   { fontSize: 11, color: MUTED },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  ratingEmoji: { fontSize: 10 },
  ratingLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  right:       { alignItems: 'flex-end', gap: 5 },
  profit:      { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800' },
  // Swipe-delete layout
  wrapper:    { overflow: 'hidden', borderRadius: 12, marginBottom: 0 },
  deleteZone: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: SWIPE_WIDTH,
    backgroundColor: '#7A1F1F', justifyContent: 'center', alignItems: 'center',
  },
  deleteBtn:  { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', gap: 2 },
  deleteText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  surface:    { backgroundColor: CARD_BG },
  // KEPT status pill — display only
  keptPill:  { backgroundColor: FOREST + '22', borderWidth: 1, borderColor: FOREST + '66', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 },
  keptText:  { fontSize: 9, fontWeight: '800', color: FOREST, letterSpacing: 0.5 },
});

// ─── Animated paw prints ─────────────────────────────────────────────────────

function PawPrints() {
  const anims = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const seq = (a: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(a, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.delay(850),
        Animated.timing(a, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([seq(anims[0], 0), seq(anims[1], 380), seq(anims[2], 760)]),
        Animated.delay(500),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const POS = [{ l: '28%', b: 6 }, { l: '46%', b: 22 }, { l: '61%', b: 5 }];

  return (
    <View style={{ position: 'relative', width: 120, height: 46, marginBottom: 2 }}>
      {anims.map((a, i) => (
        <Animated.Text key={i} style={{
          position:  'absolute',
          bottom:    POS[i].b,
          left:      POS[i].l as any,
          fontSize:  20,
          opacity:   a,
          transform: [{ translateY: a.interpolate({ inputRange: [0,1], outputRange: [5,-3] }) }],
        }}>🐾</Animated.Text>
      ))}
    </View>
  );
}

// ─── Hunt bottom zone (scan button + safari environment) ─────────────────────
// Three-layer sonar glow, permanent compass/trail decoration, paw prints,
// and a warm safari terrain wash behind the scan button.

// Same look as the tab bar's camera button (green disc, page-colour rim,
// white camera glyph), a little larger because it is this screen's main action.
const SCAN_BTN = 76;

function HuntBottomZone({ onPress }: { onPress: () => void }) {
  const insets     = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 0);
  const coachScanRef = useCoachRef('hunt-scan-btn');     // guided demo spotlight; inert otherwise

  return (
    <View style={{
      width:           '100%',
      paddingBottom:   safeBottom + 14,
      paddingTop:      12,
      backgroundColor: BG,
      alignItems:      'center',
    }}>

      {/* ── Scan button ── */}
      <View style={{ width: SCAN_BTN, height: SCAN_BTN, alignItems: 'center', justifyContent: 'center' }}>

        <Pressable
          ref={coachScanRef as any}
          collapsable={false}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel="Scan an item"
          testID="hunt-scan-button"
          style={({ pressed }) => ({
            width:           SCAN_BTN,
            height:          SCAN_BTN,
            borderRadius:    SCAN_BTN / 2,
            backgroundColor: V.green,
            alignItems:      'center' as const,
            justifyContent:  'center' as const,
            borderWidth:     3,
            borderColor:     BG,          // this screen's page colour, like the tab bar's rim
            shadowColor:     '#1A3020',
            shadowOffset:    { width: 0, height: 4 },
            shadowOpacity:   0.35,
            shadowRadius:    10,
            elevation:       8,
            opacity:         pressed ? 0.9 : 1,
            transform:       pressed ? [{ scale: 0.93 }] : [],
          })}
        >
          <MaterialIcons name="photo-camera" size={32} color={V.white} />
        </Pressable>
      </View>

    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HuntActiveScreen() {
  const router     = useRouter();
  const navigation = useNavigation();

  /**
   * Shared scan preflight — see lib/useScanGate.ts.
   *
   * Declared HERE, above the "No Active Hunt" early return further down:
   * useScanGate is a hook, and a hook after a conditional return changes the
   * hook count between renders.
   */
  const startScan = useScanGate();
  const insets     = useSafeAreaInsets();

  // Guided demo (inert outside it): spotlight targets and the exit bookkeeping.
  const demo            = isHuntDemoActive();
  const onboarding      = useHuntOnboarding();
  const coachLocationRef = useCoachRef('hunt-location');
  const coachStatsRef    = useCoachRef('hunt-stats');
  const coachRemovedRef  = useCoachRef('hunt-removed-link');
  const coachFinishRef   = useCoachRef('hunt-finish-btn');

  // Re-render whenever hunt state changes
  const { addHuntBundle, flips } = useFlipStore();

// ─── Auto-hunt name helper ────────────────────────────────────────────────────
// Generates "Thrift Hunt", "Thrift Hunt #2", "Thrift Hunt #3" etc.
// Only counts existing bundles with auto-generated names (not custom ones).
// Custom names are never modified.

function generateAutoHuntName(existingBundles: import('@/types/flip').HistoryEntry[]): string {
  const BASE = 'Thrift Hunt';
  // Collect all numbers already used by auto-generated hunts
  const usedNumbers = new Set<number>();
  for (const entry of existingBundles) {
    if (!isHuntBundle(entry)) continue;
    const title = entry.huntTitle ?? '';
    if (title === BASE) {
      usedNumbers.add(1);
    } else {
      const match = title.match(/^Thrift Hunt #(\d+)$/);
      if (match) usedNumbers.add(parseInt(match[1], 10));
    }
  }
  // Find the next unused number
  if (!usedNumbers.has(1)) return BASE;
  let n = 2;
  while (usedNumbers.has(n)) n++;
  return `${BASE} #${n}`;
}
  const [, forceUpdate] = useState(0);
  const [saveConfirmVisible, setSaveConfirmVisible] = useState(false);
  // True from "Save Hunt" until the next screen opens. The server scores the Hunt
  // in that window (a few seconds at most), so the screen says so instead of
  // looking frozen, and a second tap can't start a second save.
  const [savingHunt, setSavingHunt] = useState(false);
  const savingRef = useRef(false);
  const [endConfirmVisible, setEndConfirmVisible] = useState(false);
  // Leaving waits for the "End this hunt?" sheet to finish closing, or iOS can drop the screen change.
  const endConfirmClose = useAfterModalClose();
  useEffect(() => {
    const unsub = subscribeToHunt(() => forceUpdate(n => n + 1));
    return unsub;
  }, []);

  // ── Live hunt timer ───────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - (getActiveHunt()?.startedAt ?? Date.now())), 1000);
    return () => clearInterval(id);
  }, []);

  const formatElapsed = (ms: number) => {
    const s   = Math.floor(ms / 1000);
    const m   = Math.floor(s / 60);
    const h   = Math.floor(m / 60);
    const ss  = String(s % 60).padStart(2, '0');
    const mm  = String(m % 60).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  // ── Location ──────────────────────────────────────────────────────────────
  // V1: request permission, get approximate city-level label only.
  // Never shows exact street addresses or private home locations.
  const [locationLabel, setLocationLabel] = useState<string>('Finding hunt location…');

  useEffect(() => {
    // Guided demo: never ask for location permission or read the real place.
    if (isHuntDemoActive()) { setLocationLabel('Demo Hunt'); return; }
    let cancelled = false;

    const fetchLocation = async () => {
      try {
        const existing = await Location.getForegroundPermissionsAsync();

        if (existing.status !== 'granted') {
          // If iOS has permanently blocked it, don't re-prompt — just fall back
          if (!existing.canAskAgain) {
            if (!cancelled) setLocationLabel('Thrift Hunt');
            return;
          }
          // First time — request native popup directly (no pre-prompt Alert)
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            if (!cancelled) setLocationLabel('Thrift Hunt');
            return;
          }
        }

        // Get coarse position (low accuracy = faster, less battery)
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
        });

        if (cancelled) return;

        // Reverse geocode — device-native, no external API needed
        const results = await Location.reverseGeocodeAsync({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
        });

        if (cancelled || !results.length) { setLocationLabel('Thrift Hunt'); return; }

        const place = results[0];

        // Build a safe label: city or district only — never street or address number.
        // Check name field first (sometimes contains shop/POI name on device geocoders).
        const poiName = place.name ?? '';
        const STORE_KEYWORDS = /goodwill|savers|salvation army|bins|thrift|value village|arc|plato|clothes mentor|habitat|oxfam/i;

        let label: string;
        if (STORE_KEYWORDS.test(poiName)) {
          // Device geocoder returned a recognizable store name — use it
          const city = place.city ?? place.district ?? '';
          label = city ? `${poiName} · ${city}` : poiName;
        } else {
          // Fall back to city/district — safe, no street-level detail
          const city    = place.city ?? place.district ?? place.subregion ?? '';
          const region  = place.region ?? '';
          label = city
            ? `Thrift Hunt · ${city}${region ? ', ' + region.slice(0, 2).toUpperCase() : ''}`
            : 'Thrift Hunt';
        }

        if (!cancelled) setLocationLabel(label);
      } catch {
        if (!cancelled) setLocationLabel('Thrift Hunt');
      }
    };

    fetchLocation();
    return () => { cancelled = true; };
  }, []);

  // ── Reliable back interception via beforeRemove ───────────────────────────
  // This fires for ALL navigation-away events: back arrow press, swipe gesture,
  // hardware back button. More reliable than Pressable.onPress alone.
  const allowNavRef = useRef(false);
  useEffect(() => {
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (allowNavRef.current || isDemoExiting()) return; // confirmed end — let through

      // Intentional return from Hunt Item Detail (Save or Remove confirmed).
      // consumeReturningFromHuntItemDetail() reads AND resets the flag atomically
      // so it can never accidentally stay true across multiple navigations.
      if (consumeReturningFromHuntItemDetail()) return;

      e.preventDefault();
      setEndConfirmVisible(true);
    });
    return unsub;
  }, [navigation]);

  // An analysed-but-undecided find (e.g. the app closed on Discovery Analysis):
  // take the user straight back to it, once per find. Never re-scanned.
  // Only while THIS screen is on top: during a normal hunt scan the pending
  // find is already open in Discovery Analysis above us.
  const openedPendingRef = useRef<string | null>(null);
  useEffect(() => {
    const open = () => {
      if (!(navigation as any).isFocused?.()) return;
      const p = pendingItemOf(getActiveHunt());
      if (!p || openedPendingRef.current === p.huntItemId) return;
      openedPendingRef.current = p.huntItemId;
      router.push(`/hunt-item-detail?mode=pending&huntItemId=${p.huntItemId}` as any);
    };
    open();
    const unsubFocus = (navigation as any).addListener('focus', open);
    const unsubHunt  = subscribeToHunt(open);
    return () => { unsubFocus?.(); unsubHunt(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // Guided demo: no swipe-back out of the walkthrough (the coach's Exit demo is the way out).
  useEffect(() => {
    if (demo) (navigation as any).setOptions?.({ gestureEnabled: false });
  }, [demo, navigation]);

  const session = getActiveHunt();

  // Safety: no active hunt (e.g. app reload cleared state)
  if (!session) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.safetyWrap}>
          <Text style={s.safetyTitle}>No Active Hunt</Text>
          <Pressable onPress={() => router.replace('/(tabs)' as any)} style={s.safetyBtn}>
            <Text style={s.safetyBtnText}>Go Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const stats       = getHuntStats(session);
  const profitColor = stats.estimatedProfit >= 0 ? '#3A7A3A' : '#8A2A1A';

  // H/I: split into kept and removed lists
  const keptItems    = keptItemsOf(session);
  const removedItems = removedItemsOf(session);
  const pendingItem  = pendingItemOf(session);

  /**
   * Hunt scan.
   *
   * The continuation is the HUNT scan, not a generic one: it keeps the hunt
   * analytics call attached, so resuming after a purchase lands the user back
   * in their session rather than dropping them into a plain Home scan.
   *
   * logHuntScanStarted moved inside `run` deliberately — a scan that never
   * starts because the user is exhausted must not be logged as started.
   */
  const handleScan = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    if (isHuntDemoActive()) {
      // Guided demo: the practice camera. No scan balance, paywall or real camera is involved.
      advanceCoach('scan');
      router.push('/hunt-demo-camera?find=jacket' as any);
      return;
    }
    startScan({
      origin: 'hunt',
      run: () => {
        logHuntScanStarted(stats.scanned, getActiveHunt()?.id);
        // Every scan started from Live Hunt belongs to the hunt.
        setScanDestination('hunt');
        router.push('/camera' as any);
      },
      goToScanStore: () => router.push('/scan-store?from=hunt_active' as any),
    });
  };

  /** Leave the demo and land on Home. Home is a fresh reset, like Hunt Mode's own back. */
  const leaveDemoToHome = () => {
    allowNavRef.current = true;
    beginDemoExit();
    endDemoHunt();
    try { (navigation as any).reset({ index: 0, routes: [{ name: '(tabs)' }] }); }
    catch { router.replace('/(tabs)' as any); }
    setTimeout(endDemoExit, 1000);
  };

  /**
   * Save Hunt, guided demo. Runs the real finish path in the sandbox (bundle, XP rules
   * against a brand-new profile, nothing stored or synced), then plays the real XP reveal
   * and Great Hunt summary from that in-memory Hunt. The demo ends on the summary screen.
   */
  const finishDemoAndLeave = async () => {
    const done = await finishDemoHunt();
    if (!done) { leaveDemoToHome(); return; }
    advanceCoach('confirm');
    allowNavRef.current = true;
    router.replace(`/hunt-xp-reveal?bundleId=${done.bundle.id}` as any);
  };

  /** The coach card's button, for the steps that need something done first. */
  const onCoachNext = (stepId: CoachStepId) => {
    if (stepId === 'another') {
      // The second find arrives on the dashboard; the existing pending-find handoff opens it.
      addPendingScanToHunt(demoScanFor('polo', demoPhotoUri));
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable
          onPress={() => setEndConfirmVisible(true)}
          hitSlop={10}
          style={s.headerBtn}
        >
          <MaterialIcons name="arrow-back" size={22} color={BROWN} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{session.name}</Text>
          <Text style={s.headerSub}>LIVE HUNT</Text>
        </View>
        <Pressable
          ref={coachFinishRef as any}
          collapsable={false}
          onPress={() => {
            if (pendingItem) {
              // A find is still waiting for Keep / Remove: decide it first so
              // the saved hunt never silently drops or includes it.
              Alert.alert('Decide on your last find', 'Keep or remove it before saving the hunt.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open it', onPress: () => router.push(`/hunt-item-detail?mode=pending&huntItemId=${pendingItem.huntItemId}` as any) },
              ]);
              return;
            }
            if (keptItems.length === 0) {
              // No kept items — show subtle feedback, block save
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
              }
              Alert.alert('', 'Save at least 1 item to finish your hunt.');
              return;
            }
            advanceCoach('finish');             // guided demo only; a no-op otherwise
            setSaveConfirmVisible(true);
          }}
          hitSlop={10}
          style={[s.headerBtn, keptItems.length === 0 && { opacity: 0.4 }]}
        >
          <MaterialIcons name="check-circle-outline" size={24} color={FOREST} />
        </Pressable>
      </View>

      {/* ── Location card — timer sits inline to the right of location text ── */}
      <View ref={coachLocationRef as any} collapsable={false} style={s.locationCard}>
        <View style={s.locationInner}>
          <MaterialIcons name="storefront" size={20} color={BROWN} />
          <Text style={s.locationText} numberOfLines={1}>{locationLabel}</Text>
          <View style={s.timerBadge}>
            <MaterialIcons name="timer" size={11} color={GOLD} />
            <Text style={s.timerText}>{formatElapsed(elapsed)}</Text>
          </View>
        </View>
      </View>

      {/* ── Stats card — separate from location, just like reference ── */}
      <View ref={coachStatsRef as any} collapsable={false} style={s.statsCard}>
        <View style={s.statBox}>
          <Text style={s.statNum}>{stats.scanned}</Text>
          <Text style={s.statLabel}>Scanned</Text>
        </View>
        <View style={[s.statBox, s.statMid]}>
          <Text style={s.statNum}>{stats.kept}</Text>
          <Text style={s.statLabel}>Kept</Text>
        </View>
        <View style={s.statBox}>
          <Text style={[s.statNum, { color: profitColor }]}>
            {stats.estimatedProfit >= 0
              ? `+$${stats.estimatedProfit}`
              : `-$${Math.abs(stats.estimatedProfit)}`}
          </Text>
          <Text style={s.statLabel}>Est. Profit</Text>
        </View>
      </View>

      {/* ── Kept Items header ── */}
      <View style={s.sectionRow}>
        <Text style={s.sectionTitle}>{`KEPT ITEMS · ${keptItems.length}`}</Text>
        {/* Always there, even at 0: the way to Removed Items never disappears. */}
        <Pressable
          ref={coachRemovedRef as any}
          collapsable={false}
          onPress={() => { advanceCoach('removed'); router.push('/hunt-removed' as any); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
          style={({ pressed }) => [s.sectionLink, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`Removed items, ${removedItems.length}`}
          testID="hunt-removed-link"
        >
          <Text style={s.removedLinkText}>{`Removed · ${removedItems.length}`}</Text>
          <MaterialIcons name="chevron-right" size={16} color={MUTED} />
        </Pressable>
      </View>

      {/* ── Kept item list or empty state ── */}
      {/* Every kept find is reachable: the list scrolls inside its own area
          (header, stats and the scan button stay put). It used to show only
          the 4 newest and the rest were unreachable during the hunt. */}
      <ScrollView
        style={s.itemScroll}
        contentContainerStyle={[s.itemList, keptItems.length === 0 && { flexGrow: 1 }]}
        showsVerticalScrollIndicator={keptItems.length > 4}
      >
        {keptItems.length === 0 ? (
          <View style={s.emptyState}>
            <PawPrints />
            <Text style={s.emptyTitle}>No treasures found yet.</Text>
            <Text style={s.emptySub}>Tap scan to start the hunt.</Text>
          </View>
        ) : (
          keptItems.map(item => <ItemCard key={item.huntItemId} item={item} />)
        )}
      </ScrollView>

      {/* ── Hunt bottom zone: sonar glow + safari details + scan button ── */}
      <HuntBottomZone onPress={handleScan} />

      {/* ── Save Hunt confirmation modal (checkmark button) ── */}
      <Modal
        visible={saveConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setSaveConfirmVisible(false); returnCoachTo('finish', 'confirm'); }}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>End and save this hunt?</Text>
            <Text style={s.modalSub}>
              {`Save your "${session.name || 'Thrift Hunt'}" hunt to Scan History as one bundle. All kept and removed items will be included.`}
            </Text>
            <Pressable
              onPress={async () => {
                setSaveConfirmVisible(false);
                if (isHuntDemoActive()) { await finishDemoAndLeave(); return; }
                if (savingRef.current) return;
                const now      = Date.now();
                const hunt     = getActiveHunt();
                if (!hunt) return;
                savingRef.current = true;
                setSavingHunt(true);
                try {
                const keptItems: HuntBundleItem[]    = keptItemsOf(hunt).map(i => ({
                  huntItemId:   i.huntItemId,
                  scanId:       i.scanId,
                  itemName:     i.itemName,
                  brand:        i.brand,
                  category:     i.category,
                  imageUri:     i.imageUri,
                  thriftPrice:  i.thriftPrice,
                  profit:       i.profit,
                  huntRating:   i.huntRating,
                  kept:         true,
                  scanSnapshot: i.scanSnapshot,
                  ...huntItemExtras(i),
                }));
                const removedItems: HuntBundleItem[] = removedItemsOf(hunt).map(i => ({
                  huntItemId:   i.huntItemId,
                  scanId:       i.scanId,
                  itemName:     i.itemName,
                  brand:        i.brand,
                  category:     i.category,
                  imageUri:     i.imageUri,
                  thriftPrice:  i.thriftPrice,
                  profit:       i.profit,
                  huntRating:   i.huntRating,
                  kept:         false,
                  scanSnapshot: i.scanSnapshot,
                  ...huntItemExtras(i),
                }));
                // Rounded to cents so float sums never show $12.300000001.
                const totalCost    = Math.round(keptItems.reduce((s, i) => s + i.thriftPrice, 0) * 100) / 100;
                const totalProfit  = keptItems.reduce((s, i) => s + i.profit, 0);
                const estimatedROI = totalCost > 0 ? Math.round((totalProfit / totalCost) * 100) : 0;
                const durationMs   = now - hunt.startedAt;

                // Build base bundle first (without XP)
                const baseBundle: HuntBundle = {
                  type:                'hunt_bundle',
                  id:                  hunt.id,
                  huntTitle:           hunt.name?.trim() || generateAutoHuntName(flips),
                  timestamp:           now,
                  startedAt:           hunt.startedAt,
                  endedAt:             now,
                  durationMs,
                  keptItems,
                  removedItems,
                  keptItemCount:       keptItems.length,
                  removedItemCount:    removedItems.length,
                  totalCost,
                  totalEstimatedProfit: totalProfit,
                  estimatedROI,
                };

                // The SERVER scores the Hunt and awards its XP (lib/huntXp → hunt.complete).
                // Done BEFORE addHuntBundle so the saved Hunt carries the XP it earned.
                // If the server can't be reached in time the Hunt is saved anyway with
                // its XP pending, and the request is sent again later.
                let xpResult: import('@/lib/huntXp').HuntXpResult | null = null;
                try {
                  xpResult = await applyHuntXp(baseBundle);
                } catch { /* never block save on XP failure */ }
                const xpPending = xpResult?.pending === true;
                // Only a real award is logged: not a pending one, not a zero-XP repeat.
                if (xpResult && !xpPending && (xpResult.totalXpEarned > 0 || xpResult.breakdown.length > 0)) {
                  logHuntXpAwarded({
                    hunt_id:         hunt.id,
                    xp_earned:       xpResult.totalXpEarned,
                    total_xp_before: xpResult.previousTotalXp,
                    total_xp_after:  xpResult.newTotalXp,
                    rank_before:     xpResult.previousRank.rank,
                    rank_after:      xpResult.newRank.rank,
                    ranked_up:       xpResult.didRankUp,
                  });
                }

                // Attach XP to bundle before persisting to history
                const bundle: HuntBundle = xpResult
                  ? {
                      ...baseBundle, xpEarned: xpResult.totalXpEarned, xpBreakdown: xpResult.breakdown,
                      ...(xpPending ? { xpPending: true } : {}),
                    }
                  : baseBundle;

                addHuntBundle(bundle);
                logHuntEnded({
                  hunt_id:         hunt.id,
                  outcome:         'saved',
                  durationMs,
                  scannedCount:    hunt.items.length,
                  keptCount:       keptItems.length,
                  estimatedProfit: Math.round(totalProfit),
                });
                // Store XP result for hunt-complete to consume on mount
                if (xpResult) setLastCompletionResult(xpResult);
                // Clears the live hunt, but its saved record is only deleted once
                // the bundle is confirmed in history (lib/hunt-context).
                finishHunt(bundle.id);
                allowNavRef.current = true;
                // XP reveal first, then hunt-complete. With XP still pending there is
                // nothing to reveal yet, so go straight to the summary (which says so).
                router.replace((xpPending
                  ? `/hunt-complete?bundleId=${bundle.id}`
                  : `/hunt-xp-reveal?bundleId=${bundle.id}`) as any);
                } finally {
                  // Whatever happened, never leave the "Saving" card up.
                  savingRef.current = false;
                  setSavingHunt(false);
                }
              }}
              style={({ pressed }) => [s.modalSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.modalSaveText}>Save Hunt</Text>
            </Pressable>
            <Pressable
              onPress={() => { setSaveConfirmVisible(false); returnCoachTo('finish', 'confirm'); }}
              style={({ pressed }) => [s.modalCancel, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Saving: the server is scoring the Hunt ── */}
      <Modal visible={savingHunt} transparent animationType="fade" onRequestClose={() => { /* not dismissible */ }}>
        <View style={s.modalOverlay} accessibilityViewIsModal accessibilityLiveRegion="polite">
          <View style={[s.modalCard, { alignItems: 'center' }]}>
            <ActivityIndicator size="large" color={GOLD} />
            <Text style={s.modalTitle}>Saving your Hunt…</Text>
            <Text style={s.modalSub}>Adding up your XP.</Text>
          </View>
        </View>
      </Modal>

      {/* ── End Hunt confirmation modal (back arrow) ── */}
      <Modal
        visible={endConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEndConfirmVisible(false)}
        onDismiss={endConfirmClose.run}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>End this hunt?</Text>
            <Text style={s.modalSub}>
              Are you sure you want to leave? Your current hunt progress may be lost.
            </Text>
            <Pressable
              onPress={() => endConfirmClose.closeThen(() => setEndConfirmVisible(false), () => {
                if (isHuntDemoActive()) { void onboarding.markSkipped(); leaveDemoToHome(); return; }
                allowNavRef.current = true;
                logHuntEnded({
                  hunt_id:         getActiveHunt()?.id ?? null,
                  outcome:         'discarded',
                  durationMs:      Date.now() - (getActiveHunt()?.startedAt ?? Date.now()),
                  scannedCount:    stats.scanned,
                  keptCount:       stats.kept,
                  estimatedProfit: stats.estimatedProfit,
                });
                discardHunt();
                // A fresh Home, the same way Hunt Mode's own back does it (a plain replace can land on
                // whichever tab was last focused, and leaves this screen sitting underneath).
                try { (navigation as any).reset({ index: 0, routes: [{ name: '(tabs)' }] }); }
                catch { router.replace('/(tabs)' as any); }
              })}
              style={({ pressed }) => [s.modalLeave, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.modalLeaveText}>Leave Hunt</Text>
            </Pressable>
            <Pressable
              onPress={() => setEndConfirmVisible(false)}
              style={({ pressed }) => [s.modalCancel, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Guided demo only (draws nothing otherwise). */}
      <CoachOverlay screen="hunt-active" onNext={onCoachNext} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: BG },

  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: CARD_B },
  headerBtn:       { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: CREAM_D + '80' },
  headerCenter:    { flex: 1, alignItems: 'center', gap: 1 },
  headerTitle:     { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: BROWN, letterSpacing: 0.2 },
  headerSub:       { fontSize: 9, color: GOLD, fontWeight: '700', letterSpacing: 2 },

  // ── Header timer badge ────────────────────────────────────────────────────
  timerBadge: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             3,
    backgroundColor: GOLD + '18',
    borderWidth:     1,
    borderColor:     GOLD + '40',
    borderRadius:    12,
    paddingHorizontal: 8,
    paddingVertical:   5,
    minWidth:        52,
    justifyContent:  'center',
  },
  timerText: {
    fontFamily:    FONTS.serif,
    fontSize:      11,
    fontWeight:    '700',
    color:         BROWN,
    letterSpacing: 0.5,
  },

  // ── Location card — standalone, matches reference ─────────────────────────
  locationCard: {
    marginHorizontal: 16,
    marginTop:        12,
    backgroundColor:  CARD_BG,
    borderRadius:     12,
    borderWidth:      1,
    borderColor:      CARD_B,
    shadowColor:      '#2A1A0A',
    shadowOffset:     { width: 0, height: 1 },
    shadowOpacity:    0.06,
    shadowRadius:     4,
    elevation:        1,
  },
  locationInner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 14,
    paddingVertical:   13,
  },
  locationText: {
    flex:        1,
    fontSize:    16,
    fontWeight:  '700',
    color:       BROWN,
    flexShrink:  1,
  },

  // ── Stats card — separate from location ──────────────────────────────────
  statsCard: {
    flexDirection:    'row',
    marginHorizontal: 16,
    marginTop:        8,
    backgroundColor:  CARD_BG,
    borderRadius:     12,
    borderWidth:      1,
    borderColor:      CARD_B,
    overflow:         'hidden',
    shadowColor:      '#2A1A0A',
    shadowOffset:     { width: 0, height: 1 },
    shadowOpacity:    0.06,
    shadowRadius:     4,
    elevation:        1,
  },
  statBox:  { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 3 },
  statMid:  { borderLeftWidth: 1, borderRightWidth: 1, borderColor: CARD_B },
  statNum:  { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: BROWN },
  statLabel:{ fontSize: 10, fontWeight: '600', color: MUTED, letterSpacing: 0.8 },

  sectionRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 14, marginBottom: 8 },
  sectionTitle:    { flex: 1, fontFamily: FONTS.serif, fontSize: 11, fontWeight: '700', color: MUTED, letterSpacing: 1.2 },
  sectionLink:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  removedLinkText: { fontFamily: FONTS.serif, fontSize: 12, fontWeight: '700', color: MUTED },

  itemScroll:      { flex: 1 },
  itemList:        { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },

  emptyState:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle:  { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: BROWN, textAlign: 'center' },
  emptySub:    { fontSize: 13, color: MUTED, textAlign: 'center' },

  safetyWrap:      { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  safetyTitle:     { fontFamily: FONTS.serif, fontSize: 20, color: BROWN },
  safetyBtn:       { backgroundColor: FOREST, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  safetyBtnText:   { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: CREAM },

  // End Hunt confirmation modal
  modalOverlay:   { flex: 1, backgroundColor: 'rgba(10,6,2,0.70)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  modalCard:      { width: '100%', backgroundColor: CARD_BG, borderRadius: 20, padding: 24, gap: 14, borderWidth: 1, borderColor: CARD_B },
  modalTitle:     { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: BROWN, textAlign: 'center' },
  modalSub:       { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 20 },
  modalLeave:     { backgroundColor: '#7A1F1F', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalLeaveText: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: CREAM, letterSpacing: 0.5 },
  modalSave:      { backgroundColor: FOREST, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalSaveText:  { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: CREAM, letterSpacing: 0.5 },
  modalCancel:    { alignItems: 'center', paddingVertical: 8 },
  modalCancelText:{ fontSize: 14, color: MUTED },
});