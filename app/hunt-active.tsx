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
  View, Text, Pressable, StyleSheet, Alert, Platform, Image, Animated,
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
  toggleHuntItemKept, type HuntItem, type HuntRating,
  consumeReturningFromHuntItemDetail,
} from '@/lib/hunt-context';
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
    label: 'Legendary', emoji: '👑',
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
    label: 'Trash', emoji: '🤮',
    color: '#888', bg: '#1A1A1A', border: '#444',
  },
};

// ─── Item card ────────────────────────────────────────────────────────────────

function ItemCard({ item }: { item: HuntItem }) {
  const cfg        = RATING_CFG[item.huntRating];
  const profitStr  = item.profit >= 0 ? `+$${item.profit}` : `-$${Math.abs(item.profit)}`;
  const profitColor = item.profit > 0 ? '#3A7A3A' : '#8A2A1A';

  const glowStyle = cfg.glow
    ? { shadowColor: cfg.glow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, elevation: 6 }
    : {};

  return (
    <View style={[ic.card, { borderColor: cfg.border }, glowStyle]}>
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
          <Text style={ic.price}>${item.thriftPrice.toFixed(2)}</Text>
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
        <Pressable
          onPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
            toggleHuntItemKept(item.scanId);
          }}
          style={({ pressed }) => [
            ic.keepBtn,
            item.kept ? ic.keepActive : ic.keepInactive,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={[ic.keepText, item.kept ? ic.keepTextActive : ic.keepTextInactive]}>
            {item.kept ? 'KEEP' : 'PASS'}
          </Text>
        </Pressable>
      </View>
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
  keepBtn:     { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, borderWidth: 1.5 },
  keepActive:  { backgroundColor: FOREST, borderColor: FOREST },
  keepInactive:{ backgroundColor: 'transparent', borderColor: CARD_B },
  keepText:    { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  keepTextActive:  { color: CREAM },
  keepTextInactive:{ color: MUTED },
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
  const [, forceUpdate] = useState(0);
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
        // Check existing permission first — avoid re-prompting if already granted
        const existing = await Location.getForegroundPermissionsAsync();

        if (existing.status !== 'granted') {
          // Show explanation before the system prompt
          await new Promise<void>(resolve => {
            Alert.alert(
              '📍 Hunt Location',
              'FlipStart uses your approximate location to label your thrift hunt — like "Goodwill" or "House Hunt". We never show your exact home address.',
              [
                { text: 'Skip', style: 'cancel', onPress: () => { if (!cancelled) setLocationLabel('Thrift Hunt'); resolve(); } },
                { text: 'Allow', onPress: () => resolve() },
              ]
            );
          });

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
      Alert.alert(
        'End Hunt?',
        'Do you want to end this hunt or keep hunting?',
        [
          { text: 'Stay',     style: 'cancel' },
          {
            text: 'End Hunt', style: 'destructive',
            onPress: () => {
              allowNavRef.current = true;
              endHunt();
              router.replace('/(tabs)' as any);
            },
          },
        ]
      );
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

  const handleScan = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    router.push('/camera' as any);
  };

  const handleFullList = () => {
    Alert.alert('📋 Full Item List', 'Full organized item list coming soon!',
      [{ text: 'Got it' }]);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
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
          onPress={() => Alert.alert('🗺️ Map', 'Map system coming soon in the global release!', [{ text: 'Got it' }])}
          hitSlop={10}
          style={s.headerBtn}
        >
          <MaterialIcons name="map" size={22} color={BROWN} />
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

      {/* ── Scanned Items header ── */}
      <View style={s.sectionRow}>
        <Text style={s.sectionTitle}>SCANNED ITEMS</Text>
        <Pressable onPress={handleFullList} style={s.sectionLink} hitSlop={8}>
          {session.items.length > 0 && (
            <Text style={s.sectionCount}>{session.items.length}</Text>
          )}
          <MaterialIcons name="chevron-right" size={18} color={GOLD} />
        </Pressable>
      </View>

      {/* ── Item list or empty state ── */}
      <View style={s.itemList}>
        {recentItems.length === 0 ? (
          <View style={s.emptyState}>
            <PawPrints />
            <Text style={s.emptyTitle}>No treasures found yet.</Text>
            <Text style={s.emptySub}>Tap scan to start the hunt.</Text>
          </View>
        ) : (
          recentItems.map(item => <ItemCard key={item.scanId} item={item} />)
        )}
      </View>

      {/* ── Hunt bottom zone: sonar glow + safari details + scan button ── */}
      <HuntBottomZone onPress={handleScan} />

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
  sectionCount:    { fontSize: 11, fontWeight: '700', color: GOLD },

  itemList:        { flex: 1, paddingHorizontal: 16, paddingBottom: 8, gap: 8 },

  emptyState:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle:  { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: BROWN, textAlign: 'center' },
  emptySub:    { fontSize: 13, color: MUTED, textAlign: 'center' },

  safetyWrap:      { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  safetyTitle:     { fontFamily: FONTS.serif, fontSize: 20, color: BROWN },
  safetyBtn:       { backgroundColor: FOREST, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  safetyBtnText:   { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: CREAM },
});