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
  View, Text, Pressable, StyleSheet, Alert, Platform, Image, Animated, PanResponder, Modal,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useEffect, useRef } from 'react';

// Hunt scan icon — the marksman/crosshair image
const HUNT_SCAN_ICON = require('@/assets/images/hunt-scan-icon.png');

import {
  getActiveHunt, endHunt, getHuntStats, subscribeToHunt,
  toggleHuntItemKept, moveHuntItemToRemoved, type HuntItem, type HuntRating,
  consumeReturningFromHuntItemDetail,
} from '@/lib/hunt-context';
import { logHuntScanStarted, logHuntEnded } from '@/lib/analytics';
import { applyHuntXp, setLastCompletionResult } from '@/lib/huntXp';
import { useFlipStore } from '@/lib/useFlipStore';
import { isHuntBundle, type HuntBundle, type HuntBundleItem } from '@/types/flip';
import { FONTS } from '@/constants/typography';

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

const SCAN_BTN = 96;

function HuntBottomZone({ onPress }: { onPress: () => void }) {
  const insets     = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 0);

  // Three sonar rings — staggered 0ms / 460ms / 920ms offsets
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeRing = (a: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(a, { toValue: 1, duration: 1380, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 0,    useNativeDriver: true }),
        ])
      );
    makeRing(ring1, 0).start();
    makeRing(ring2, 460).start();
    makeRing(ring3, 920).start();
  }, []);

  const ringStyle = (a: Animated.Value) => ({
    position:        'absolute' as const,
    width:           SCAN_BTN,
    height:          SCAN_BTN,
    borderRadius:    SCAN_BTN / 2,
    borderWidth:     1.5,
    borderColor:     GOLD,
    transform:       [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1.0, 2.8] }) }],
    opacity:         a.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.55, 0.20, 0] }),
  });

  return (
    <View style={{
      width:           '100%',
      paddingBottom:   safeBottom + 14,
      paddingTop:      12,
      backgroundColor: BG,
      alignItems:      'center',
    }}>

      {/* ── Scan button: sonar rings + permanent ring + pressable ── */}
      <View style={{ width: SCAN_BTN, height: SCAN_BTN, alignItems: 'center', justifyContent: 'center' }}>

        {/* Three staggered sonar expansion rings */}
        <Animated.View pointerEvents="none" style={ringStyle(ring1)} />
        <Animated.View pointerEvents="none" style={ringStyle(ring2)} />
        <Animated.View pointerEvents="none" style={ringStyle(ring3)} />

        {/* Permanent gold border */}
        <View pointerEvents="none" style={{
          position:     'absolute',
          top: -3, left: -3, right: -3, bottom: -3,
          borderRadius: (SCAN_BTN + 6) / 2,
          borderWidth:  2,
          borderColor:  GOLD + '70',
        }} />

        <Pressable
          onPress={onPress}
          style={({ pressed }) => ({
            width:        SCAN_BTN,
            height:       SCAN_BTN,
            borderRadius: SCAN_BTN / 2,
            overflow:     'hidden' as const,
            opacity:      pressed ? 0.88 : 1,
            transform:    pressed ? [{ scale: 0.93 }] : [],
          })}
        >
          <Image
            source={HUNT_SCAN_ICON}
            style={{ width: SCAN_BTN, height: SCAN_BTN }}
            resizeMode="contain"
          />
        </Pressable>
      </View>

    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HuntActiveScreen() {
  const router     = useRouter();
  const navigation = useNavigation();
  const insets     = useSafeAreaInsets();

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
  const [endConfirmVisible, setEndConfirmVisible] = useState(false);
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
      if (allowNavRef.current) return; // confirmed end — let through

      // Intentional return from Hunt Item Detail (Save or Remove confirmed).
      // consumeReturningFromHuntItemDetail() reads AND resets the flag atomically
      // so it can never accidentally stay true across multiple navigations.
      if (consumeReturningFromHuntItemDetail()) return;

      e.preventDefault();
      setEndConfirmVisible(true);
    });
    return unsub;
  }, [navigation]);

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
  const recentItems = session.items.slice(0, 4);
  const profitColor = stats.estimatedProfit >= 0 ? '#3A7A3A' : '#8A2A1A';

  // H/I: split into kept and removed lists
  const keptItems    = session.items.filter(i => i.kept);
  const removedItems = session.items.filter(i => !i.kept);
  const recentKept   = keptItems.slice(0, 4);

  const handleScan = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    logHuntScanStarted(stats.scanned);
    router.push('/camera' as any);
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
          onPress={() => {
            if (keptItems.length === 0) {
              // No kept items — show subtle feedback, block save
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
              }
              Alert.alert('', 'Save at least 1 item to finish your hunt.');
              return;
            }
            setSaveConfirmVisible(true);
          }}
          hitSlop={10}
          style={[s.headerBtn, keptItems.length === 0 && { opacity: 0.4 }]}
        >
          <MaterialIcons name="check-circle-outline" size={24} color={FOREST} />
        </Pressable>
      </View>

      {/* ── Location card — timer sits inline to the right of location text ── */}
      <View style={s.locationCard}>
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
      <View style={s.statsCard}>
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
        <Text style={s.sectionTitle}>KEPT ITEMS</Text>
        {keptItems.length > 0 && (
          <View style={s.sectionLink}>
            <Text style={s.sectionCount}>{keptItems.length}</Text>
            <MaterialIcons name="chevron-right" size={18} color={GOLD} />
          </View>
        )}
      </View>

      {/* ── Kept item list or empty state ── */}
      <View style={s.itemList}>
        {recentKept.length === 0 ? (
          <View style={s.emptyState}>
            <PawPrints />
            <Text style={s.emptyTitle}>No treasures found yet.</Text>
            <Text style={s.emptySub}>Tap scan to start the hunt.</Text>
          </View>
        ) : (
          recentKept.map(item => <ItemCard key={item.huntItemId} item={item} />)
        )}
      </View>

      {/* I: Removed items row — subtle but tappable */}
      {removedItems.length > 0 && (
        <Pressable
          onPress={() => router.push('/hunt-removed' as any)}
          style={({ pressed }) => [s.removedRow, pressed && { opacity: 0.75 }]}
        >
          <MaterialIcons name="remove-circle-outline" size={16} color={MUTED} />
          <Text style={s.removedRowText}>Removed Items</Text>
          <Text style={s.removedRowCount}>{removedItems.length} skipped</Text>
          <MaterialIcons name="chevron-right" size={16} color={MUTED} />
        </Pressable>
      )}

      {/* ── Hunt bottom zone: sonar glow + safari details + scan button ── */}
      <HuntBottomZone onPress={handleScan} />

      {/* ── Save Hunt confirmation modal (checkmark button) ── */}
      <Modal
        visible={saveConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveConfirmVisible(false)}
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
                const now      = Date.now();
                const hunt     = getActiveHunt();
                if (!hunt) return;
                const keptItems: HuntBundleItem[]    = hunt.items.filter(i => i.kept).map(i => ({
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
                }));
                const removedItems: HuntBundleItem[] = hunt.items.filter(i => !i.kept).map(i => ({
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
                }));
                const totalCost    = keptItems.reduce((s, i) => s + i.thriftPrice, 0);
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

                // Calculate and apply XP — updates AsyncStorage profile atomically
                // Must happen BEFORE addHuntBundle so bundle stores xpEarned/xpBreakdown
                let xpResult: import('@/lib/huntXp').HuntXpResult | null = null;
                try {
                  xpResult = await applyHuntXp(baseBundle);
                } catch { /* never block save on XP failure */ }

                // Attach XP to bundle before persisting to history
                const bundle: HuntBundle = xpResult
                  ? { ...baseBundle, xpEarned: xpResult.totalXpEarned, xpBreakdown: xpResult.breakdown }
                  : baseBundle;

                addHuntBundle(bundle);
                logHuntEnded({
                  durationMs,
                  scannedCount:    hunt.items.length,
                  keptCount:       keptItems.length,
                  estimatedProfit: Math.round(totalProfit),
                });
                // Store XP result for hunt-complete to consume on mount
                if (xpResult) setLastCompletionResult(xpResult);
                endHunt();
                allowNavRef.current = true;
                // Navigate to XP reveal screen first — then user continues to hunt-complete
                router.replace(`/hunt-xp-reveal?bundleId=${bundle.id}` as any);
              }}
              style={({ pressed }) => [s.modalSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.modalSaveText}>Save Hunt</Text>
            </Pressable>
            <Pressable
              onPress={() => setSaveConfirmVisible(false)}
              style={({ pressed }) => [s.modalCancel, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── End Hunt confirmation modal (back arrow) ── */}
      <Modal
        visible={endConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEndConfirmVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>End this hunt?</Text>
            <Text style={s.modalSub}>
              Are you sure you want to leave? Your current hunt progress may be lost.
            </Text>
            <Pressable
              onPress={() => {
                setEndConfirmVisible(false);
                allowNavRef.current = true;
                logHuntEnded({
                  durationMs:      Date.now() - (getActiveHunt()?.startedAt ?? Date.now()),
                  scannedCount:    stats.scanned,
                  keptCount:       stats.kept,
                  estimatedProfit: stats.estimatedProfit,
                });
                endHunt();
                router.replace('/(tabs)' as any);
              }}
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
  removedRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: CARD_BG, borderRadius: 10, borderWidth: 1, borderColor: CARD_B + '80' },
  removedRowText:  { flex: 1, fontSize: 13, color: MUTED, fontWeight: '600' },
  removedRowCount: { fontSize: 12, color: MUTED + 'AA' },
  sectionCount:    { fontSize: 11, fontWeight: '700', color: GOLD },

  itemList:        { flex: 1, paddingHorizontal: 16, paddingBottom: 8, gap: 8 },

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