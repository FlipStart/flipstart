/**
 * app/diamonds-in-the-rough.tsx — "Diamonds in the Rough" (Pass 1)
 *
 * A museum-style showcase of the user's rarest thrift finds.
 *
 * Architecture
 * ────────────
 * Diamonds are DERIVED from flip history via lib/diamonds.ts
 * (computeUnlockedDiamonds). Nothing is written to the save flow; this screen
 * only reads `flips` from useFlipStore and the unseen-id list from the shared
 * AchievementNotificationContext, then marks the batch seen on open (clearing
 * the Progress-tab badge while keeping a per-card "New" chip for this visit).
 *
 * Pass-1 visual approach (per brief):
 *   • NO background removal. The user's saved item photo is shown as-is inside a
 *     polished, spotlit "display case" frame.
 *   • The closet/exhibit is ILLUSTRATED with react-native-svg (rack of clothes,
 *     spotlight, vintage TV + retro game props) — not a real 3D scene and not an
 *     AI composite. Robust, offline, and crash-safe for beta.
 *
 * No Supabase imports → safe to mount anywhere.
 */

import { navGuard } from '@/lib/navGuard';
import {
  View, Text, StyleSheet, ScrollView, Pressable, FlatList,
  Dimensions, Alert, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Svg, {
  Rect, Path, G, Circle, Line,
} from 'react-native-svg';

import { FONTS } from '@/constants/typography';
import { useFlipStore } from '@/lib/useFlipStore';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { trackAnalyticsEvent, useScreenFocus } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';

import { useDeepAnalysisGate } from '@/lib/useDeepAnalysisGate';
import {
  DIAMONDS, CATEGORY_META, TOTAL_DIAMONDS,
  computeUnlockedDiamonds, markDiamondIdsSeen,
  formatDiscoveredDate, diamondFoundLabel,
  type DiamondDef, type UnlockedDiamond,
} from '@/lib/diamonds';
import {
  getDiamondArtwork, getDiamondArtworkFilename, validateDiamondArtwork,
} from '@/lib/diamondArtwork';

// ─── Palette ─────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const PARCH  = '#FFFFFF';
const CARD   = '#F8F7F0';
const IVORY  = '#FFFEFA';
const BORDER = '#DDD2AC';
const TAN    = '#F4F1E8';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';

// ─── Geometry ────────────────────────────────────────────────────────────────
const SW         = Dimensions.get('window').width;
const SCROLL_PAD = 16;
const CARD_W     = SW - SCROLL_PAD * 2;
const CARD_PAD   = 14;
const EXHIBIT_W  = CARD_W - CARD_PAD * 2;
const EXHIBIT_H  = Math.round(EXHIBIT_W * 1.0);     // square display

// Build a quick lookup of the catalog by id (catalog is the canonical order).
const DIAMOND_BY_ID: Record<string, DiamondDef> = Object.fromEntries(
  DIAMONDS.map(d => [d.id, d]),
);

// "discovered July 21st, 2026" — guards the Hunt-Mode fallback string.
function dateLine(ts: number): string {
  const f = formatDiscoveredDate(ts);
  return f.startsWith('discovered') ? f : `discovered ${f}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Empty-state illustration — vintage line-art display cabinet.
// ═══════════════════════════════════════════════════════════════════════════
function EmptyCabinet({ w = 168 }: { w?: number }) {
  const h = w * 1.02;
  const S = BROWN;
  return (
    <Svg width={w} height={h} viewBox="0 0 168 172">
      {/* cabinet frame */}
      <Rect x={20} y={14} width={128} height={132} rx={10} fill={IVORY} stroke={S} strokeWidth={2} />
      <Rect x={30} y={24} width={108} height={112} rx={6} fill="none" stroke={BORDER} strokeWidth={1.4} />
      {/* shelves */}
      <Line x1={30} y1={60} x2={138} y2={60} stroke={BORDER} strokeWidth={1.4} />
      <Line x1={30} y1={100} x2={138} y2={100} stroke={BORDER} strokeWidth={1.4} />
      {/* rail + empty hangers on the top shelf */}
      <Line x1={42} y1={36} x2={126} y2={36} stroke={S} strokeWidth={1.6} />
      {[58, 84, 110].map((x, i) => (
        <Path key={i} d={`M ${x} 36 q 4 8 -6 12 q -10 -4 -6 -12 M ${x - 8} 50 l 16 0`} stroke={S} strokeWidth={1.4} fill="none" />
      ))}
      {/* legs */}
      <Line x1={36} y1={146} x2={30} y2={160} stroke={S} strokeWidth={2} />
      <Line x1={132} y1={146} x2={138} y2={160} stroke={S} strokeWidth={2} />
      {/* magnifying glass — searching for treasure */}
      <Circle cx={120} cy={120} r={16} fill="none" stroke={GOLD} strokeWidth={3} />
      <Line x1={131} y1={131} x2={146} y2={146} stroke={GOLD} strokeWidth={3.4} strokeLinecap="round" />
      {/* a small sparkle */}
      <Path d="M 56 84 l 3 7 l 7 3 l -7 3 l -3 7 l -3 -7 l -7 -3 l 7 -3 z" fill={GOLD} opacity={0.85} />
    </Svg>
  );
}

// ─── Small diamond glyph (header flourish) ─────────────────────────────────────
function DiamondGlyph({ size = 13, color = FOREST }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 9 L12 3 L19 9 L12 21 Z" fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <Line x1="5" y1="9" x2="19" y2="9" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

// ─── NEW chip with a gentle pulse ──────────────────────────────────────────────
function NewChip() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });
  return (
    <Animated.View style={[s.newChip, { opacity }]}>
      <Text style={s.newChipText}>NEW</Text>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Showcase card — one diamond, museum-exhibit styling.
// ═══════════════════════════════════════════════════════════════════════════
// Showcase card — the featured diamond display.
// ═══════════════════════════════════════════════════════════════════════════
function ShowcaseCard({
  def, unlocked, ordinal, isNew, canPrev, canNext, onPrev, onNext, onViewScan, onViewHuntScan, onShare,
}: {
  def: DiamondDef;
  unlocked: UnlockedDiamond;
  ordinal: number;
  isNew: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onViewScan: () => void;
  onViewHuntScan: () => void;
  onShare: () => void;
}) {
  const [artError, setArtError] = useState(false);
  const meta = CATEGORY_META[def.category];

  // Reset error state when the diamond changes.
  useEffect(() => { setArtError(false); }, [def.id]);

  // Static museum artwork for this Diamond (never the user's scan image).
  const artwork = getDiamondArtwork(def.id);
  const showArtwork = !!artwork && !artError;

  return (
    <View style={s.showcase}>
      {/* item title + date */}
      <Text style={s.itemTitle} numberOfLines={2}>{def.title}</Text>
      <Text style={s.itemDate}>{dateLine(unlocked.discoveredAt)}</Text>

      {/* type badge */}
      <View style={[s.typeBadge, { borderColor: meta.accent + '88', backgroundColor: meta.accent + '14' }]}>
        <View style={[s.typeDot, { backgroundColor: meta.accent }]} />
        <Text style={[s.typeBadgeText, { color: meta.accent }]}>{def.badge}</Text>
      </View>

      {/* ── gallery artwork ── */}
      <View style={s.exhibitWrap}>
        <View style={s.exhibitFrame}>
          {showArtwork ? (
            <Image
              source={artwork}
              style={s.heroImage}
              contentFit="cover"
              transition={180}
              recyclingKey={def.id}
              onError={() => {
                if (__DEV__) {
                  // eslint-disable-next-line no-console
                  console.warn(
                    `[diamonds] artwork failed to load for "${def.id}" → ${getDiamondArtworkFilename(def.id) ?? '(no filename mapped)'}`,
                  );
                }
                setArtError(true);
              }}
            />
          ) : (
            // Clean fallback card — never a broken-image box.
            <View style={s.heroFallback}>
              <DiamondGlyph size={40} color={meta.accent} />
              <Text style={s.heroFallbackText}>{def.title}</Text>
            </View>
          )}

          {/* NEW chip */}
          {isNew && (
            <View style={s.newChipWrap}><NewChip /></View>
          )}

          {/* carousel arrows */}
          {canPrev && (
            <Pressable onPress={onPrev} hitSlop={10} style={[s.arrowBtn, { left: 8 }]}>
              <MaterialIcons name="chevron-left" size={26} color={BROWN} />
            </Pressable>
          )}
          {canNext && (
            <Pressable onPress={onNext} hitSlop={10} style={[s.arrowBtn, { right: 8 }]}>
              <MaterialIcons name="chevron-right" size={26} color={BROWN} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── exhibit plaque: collection position + this Diamond's own flavor ── */}
      <View style={s.plaque}>
        <Text style={s.plaqueTitle}>{diamondFoundLabel(ordinal)}</Text>
        <View style={s.plaqueDivider}>
          <View style={s.plaqueRule} />
          <DiamondGlyph size={9} color={MUTED} />
          <View style={s.plaqueRule} />
        </View>
        <Text style={s.plaqueFlavor}>{def.flavorLine}</Text>
      </View>

      {/* actions */}
      <View style={s.actionRow}>
        {unlocked.sourceScanId && !unlocked.isFromHunt ? (
          <Pressable onPress={onViewScan} style={({ pressed }) => [s.actionBtn, s.actionPrimary, pressed && { opacity: 0.8 }]}>
            <MaterialIcons name="receipt-long" size={16} color={IVORY} />
            <Text style={[s.actionText, { color: IVORY }]}>View Source Scan</Text>
          </Pressable>
        ) : unlocked.sourceScanId && unlocked.isFromHunt ? (
          <Pressable onPress={onViewHuntScan} style={({ pressed }) => [s.actionBtn, s.actionPrimary, pressed && { opacity: 0.8 }]}>
            <MaterialIcons name="travel-explore" size={16} color={IVORY} />
            <Text style={[s.actionText, { color: IVORY }]}>View Hunt Scan</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onShare} style={({ pressed }) => [s.actionBtn, s.actionGhost, pressed && { opacity: 0.8 }]}>
          <MaterialIcons name="ios-share" size={16} color={FOREST} />
          <Text style={[s.actionText, { color: FOREST }]}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mini collection strip — every slot, locked (mysterious) or unlocked.
// ═══════════════════════════════════════════════════════════════════════════
function MiniSlot({
  def, unlocked, isNew, isActive, onPress,
}: {
  def: DiamondDef;
  unlocked: UnlockedDiamond | undefined;
  isNew: boolean;
  isActive: boolean;
  onPress: () => void;
}) {
  const isUnlocked = !!unlocked;
  const meta = CATEGORY_META[def.category];

  return (
    <Pressable
      onPress={isUnlocked ? onPress : undefined}
      style={[
        s.slot,
        isUnlocked ? s.slotUnlocked : s.slotLocked,
        isActive && s.slotActive,
      ]}
    >
      <View style={[s.slotThumb, isUnlocked && { borderColor: meta.accent + '55' }]}>
        {isUnlocked ? (() => {
          const slotArt = getDiamondArtwork(def.id);
          return slotArt ? (
            <Image
              source={slotArt}
              style={s.slotImage}
              contentFit="cover"
              transition={150}
              recyclingKey={def.id}
            />
          ) : (
            <DiamondGlyph size={20} color={meta.accent} />
          );
        })() : (
          <Text style={s.slotQ}>?</Text>
        )}
      </View>
      <Text style={[s.slotLabel, !isUnlocked && { color: MUTED }]} numberOfLines={2}>
        {isUnlocked ? def.title : 'Unknown Diamond'}
      </Text>
      {isNew && <View style={s.slotNewDot} />}
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Screen
// ═══════════════════════════════════════════════════════════════════════════
export default function DiamondsInTheRoughScreen() {
  /**
   * Deep Analysis is Pro. This screen navigated straight to it with no check —
   * one of three history surfaces where the gate did not exist.
   */
  const openDeepAnalysis = useDeepAnalysisGate();
  /**
   * Live identity of the scan behind the active card, read by the gate when the
   * paywall opens and again before the continuation runs.
   */
  const itemContextRef = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { flips, isLoaded } = useFlipStore();
  const { unseenDiamondIds, markDiamondsSeen } = useAchievementNotifications();
  const { user } = useAuth();

  const scrollRef = useRef<ScrollView>(null);

  // Analytics: Diamonds in the Rough opened.
  useScreenFocus('diamonds_opened');

  // Derive unlocked diamonds from history (production source of truth).
  const realMap = useMemo(() => computeUnlockedDiamonds(flips), [flips]);

  // DEV — merge force-unlocked Diamonds from the dev tester. No-op in production.
  const [devMap, setDevMap] = useState<Record<string, UnlockedDiamond>>({});
  useFocusEffect(useCallback(() => {
    if (!__DEV__) return;
    let alive = true;
    import('@/lib/devDiamondOverrides')
      .then(m => m.getDevDiamondRecords())
      .then(r => { if (alive) setDevMap(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, []));

  // Real unlocks win over dev (they carry the actual triggering scan image).
  const unlockedMap = useMemo(() => ({ ...devMap, ...realMap }), [devMap, realMap]);
  const unlockedIds = useMemo(() => Object.keys(unlockedMap), [unlockedMap]);
  const count = unlockedIds.length;

  // Chronological ordinal ("First/Second Diamond Found") by discovery time.
  const ordinalById = useMemo(() => {
    const chrono = [...unlockedIds].sort(
      (a, b) => unlockedMap[a].discoveredAt - unlockedMap[b].discoveredAt,
    );
    const map: Record<string, number> = {};
    chrono.forEach((id, i) => { map[id] = i; });
    return map;
  }, [unlockedIds, unlockedMap]);

  // Snapshot which diamonds were "new" when this screen opened (drives NEW chips
  // for this visit) and clear the persisted + in-memory badge so Progress resets.
  const captured = useRef(false);
  const [newAtOpen, setNewAtOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (captured.current || !isLoaded) return;
    captured.current = true;
    const snapshot = new Set(unseenDiamondIds);
    setNewAtOpen(snapshot);
    if (unseenDiamondIds.length > 0) {
      markDiamondsSeen(unseenDiamondIds);          // in-memory (Progress badge)
      markDiamondIdsSeen(unseenDiamondIds).catch(() => {}); // persisted
      // Mirror to Supabase for signed-in users (background, fail-safe).
      const uid = user?.id;
      if (uid) {
        const ids = [...unseenDiamondIds];
        import('@/lib/diamondSync').then(({ markDiamondDiscoverySeenRemote }) => {
          ids.forEach(id => markDiamondDiscoverySeenRemote(uid, id).catch(() => {}));
        }).catch(() => {});
      }
    }
  }, [isLoaded, unseenDiamondIds, markDiamondsSeen, user?.id]);

  // Display order: newest-first, with this-visit "new" finds leading.
  const displayOrder = useMemo(() => {
    const byNewest = [...unlockedIds].sort(
      (a, b) => unlockedMap[b].discoveredAt - unlockedMap[a].discoveredAt,
    );
    const lead = byNewest.filter(id => newAtOpen.has(id));
    const rest = byNewest.filter(id => !newAtOpen.has(id));
    return [...lead, ...rest];
  }, [unlockedIds, unlockedMap, newAtOpen]);

  const [activeIndex, setActiveIndex] = useState(0);
  // Keep the active index valid if the underlying set changes.
  useEffect(() => {
    if (activeIndex > displayOrder.length - 1) setActiveIndex(0);
  }, [displayOrder.length, activeIndex]);

  // Dev-only: warn if any active Diamond is missing an artwork asset.
  useEffect(() => { validateDiamondArtwork(DIAMONDS.map(d => d.id)); }, []);

  // Preload current + adjacent artwork to avoid blank flicker when swiping.
  const preloadSources = useMemo(() => {
    const ids = [
      displayOrder[activeIndex - 1],
      displayOrder[activeIndex],
      displayOrder[activeIndex + 1],
    ].filter(Boolean) as string[];
    return ids.map(getDiamondArtwork).filter((s): s is number => s != null);
  }, [displayOrder, activeIndex]);

  const activeId  = displayOrder[activeIndex];
  const activeDef = activeId ? DIAMOND_BY_ID[activeId] : undefined;
  const activeUnlocked = activeId ? unlockedMap[activeId] : undefined;

  // ── Actions ──
  const goPrev = useCallback(() => setActiveIndex(i => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setActiveIndex(i => Math.min(displayOrder.length - 1, i + 1)),
    [displayOrder.length],
  );
  const jumpTo = useCallback((id: string) => {
    const idx = displayOrder.indexOf(id);
    if (idx >= 0) {
      setActiveIndex(idx);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      // Analytics: a diamond detail was opened (only meaningful for unlocked).
      if (unlockedMap[id]) {
        trackAnalyticsEvent('diamond_detail_opened', {
          diamond_id:    id,
          diamond_title: DIAMOND_BY_ID[id]?.title ?? null,
        });
      }
    }
  }, [displayOrder, unlockedMap]);

  itemContextRef.current = activeUnlocked?.sourceScanId ?? null;

  const viewScan = useCallback(() => {
    const sid = activeUnlocked?.sourceScanId;
    if (!sid) return;
    if (!navGuard()) return;
    openDeepAnalysis(
      () => router.push({ pathname: '/analysis-details' as any, params: { scanId: sid, source: 'history' } }),
      { contextRef: itemContextRef },
    );
  }, [activeUnlocked, router]);

  const viewHuntScan = useCallback(() => {
    const sid = activeUnlocked?.sourceScanId;
    if (!sid) return;
    if (!navGuard()) return;
    // Hunt items are stored with huntItemId = 'hi_' + scanId.
    router.push({ pathname: '/hunt-item-detail' as any, params: { huntItemId: `hi_${sid}`, mode: 'readonly' } });
  }, [activeUnlocked, router]);

  const shareDiamond = useCallback(() => {
    Alert.alert('Share Diamond', 'Sharing your finds is coming in a future update.');
  }, []);

  // ── Collection strip: found diamonds first (newest → oldest), then locked ──
  const stripData = useMemo(() => {
    const foundNewestFirst = [...unlockedIds].sort(
      (a, b) => unlockedMap[b].discoveredAt - unlockedMap[a].discoveredAt,
    );
    const foundSet = new Set(unlockedIds);
    const locked = DIAMONDS.filter(d => !foundSet.has(d.id));
    const foundDefs = foundNewestFirst.map(id => DIAMOND_BY_ID[id]).filter(Boolean) as DiamondDef[];
    return [...foundDefs, ...locked];
  }, [unlockedIds, unlockedMap]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ═══════ HEADER ═══════ */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color={FOREST} />
        </Pressable>
        <View style={s.headerCenter}>
          <View style={s.headerTitleRow}>
            <DiamondGlyph size={14} color={FOREST} />
            <Text style={s.headerTitle}>Diamonds in the Rough</Text>
            <DiamondGlyph size={14} color={FOREST} />
          </View>
          <Text style={s.headerSub}>Your rarest finds, saved forever.</Text>
        </View>
      </View>
      <View style={s.headerDivider} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 36 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══════ SHOWCASE or EMPTY STATE ═══════ */}
        {count > 0 && activeDef && activeUnlocked ? (
          <ShowcaseCard
            def={activeDef}
            unlocked={activeUnlocked}
            ordinal={ordinalById[activeDef.id] ?? 0}
            isNew={newAtOpen.has(activeDef.id)}
            canPrev={activeIndex > 0}
            canNext={activeIndex < displayOrder.length - 1}
            onPrev={goPrev}
            onNext={goNext}
            onViewScan={viewScan}
            onViewHuntScan={viewHuntScan}
            onShare={shareDiamond}
          />
        ) : (
          <View style={s.emptyCard}>
            <EmptyCabinet w={170} />
            <Text style={s.emptyTitle}>No diamonds found yet.</Text>
            <Text style={s.emptySub}>Save rare thrift finds to begin your collection.</Text>
          </View>
        )}

        {/* Hidden preloader — warms current + adjacent artwork to avoid flicker. */}
        <View style={s.preloader} pointerEvents="none">
          {preloadSources.map((src, i) => (
            <Image key={i} source={src} style={s.preloadImg} contentFit="cover" cachePolicy="disk" />
          ))}
        </View>

        {/* ═══════ THE COLLECTION (mini strip) ═══════ */}
        <View style={s.stripHeader}>
          <View style={s.stripRule} />
          <Text style={s.stripTitle}>The Collection</Text>
          <View style={s.stripRule} />
        </View>

        <FlatList
          data={stripData}
          keyExtractor={d => d.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.stripContent}
          renderItem={({ item }) => (
            <MiniSlot
              def={item}
              unlocked={unlockedMap[item.id]}
              isNew={newAtOpen.has(item.id)}
              isActive={item.id === activeId}
              onPress={() => jumpTo(item.id)}
            />
          )}
        />

        <Text style={s.stripFootnote}>
          {count > 0
            ? `${count} of ${TOTAL_DIAMONDS} discovered — keep hunting to fill the case.`
            : `${TOTAL_DIAMONDS} rare finds waiting to be discovered.`}
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCH },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center', marginRight: 36 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: {
    fontFamily: FONTS.serif, fontSize: 21, fontWeight: '800', color: FOREST,
    fontStyle: 'italic',
  },
  headerSub: { fontSize: 12, color: MUTED, marginTop: 3 },
  headerDivider: { height: 1, backgroundColor: BORDER },

  // Scroll
  scroll: { paddingHorizontal: SCROLL_PAD, paddingTop: 18, gap: 16 },

  // Showcase card
  showcase: {
    backgroundColor: IVORY, borderRadius: 20,
    borderWidth: 1.5, borderColor: GOLD + '66',
    paddingHorizontal: CARD_PAD, paddingTop: 16, paddingBottom: 16,
    alignItems: 'center',
  },
  itemTitle: {
    fontFamily: FONTS.serif, fontSize: 23, fontWeight: '800', color: BROWN,
    textAlign: 'center', lineHeight: 28,
  },
  itemDate: {
    fontFamily: FONTS.serif, fontStyle: 'italic', fontSize: 13.5, color: MUTED,
    marginTop: 2, marginBottom: 10,
  },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5,
    marginBottom: 12,
  },
  typeDot: { width: 7, height: 7, borderRadius: 4 },
  typeBadgeText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3 },

  // Exhibit / hero display
  exhibitWrap: { width: EXHIBIT_W, height: EXHIBIT_H },
  exhibitFrame: {
    width: EXHIBIT_W, height: EXHIBIT_H,
    borderRadius: 14, overflow: 'hidden',
    borderWidth: 2, borderColor: '#5A4226',
  },
  heroImage: { width: EXHIBIT_W, height: EXHIBIT_H },
  preloader: { position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden' },
  preloadImg: { width: 1, height: 1 },
  heroFallback: {
    width: EXHIBIT_W, height: EXHIBIT_H,
    alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: '#241813', paddingHorizontal: 24,
  },
  heroFallbackText: {
    color: PARCH, fontFamily: FONTS.serif, fontSize: 16,
    fontWeight: '700', textAlign: 'center',
  },

  arrowBtn: {
    position: 'absolute', top: EXHIBIT_H / 2 - 21, zIndex: 5,
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#FFFEFAF2', borderWidth: 1.5, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },

  newChipWrap: { position: 'absolute', top: 10, left: 10 },
  newChip: {
    backgroundColor: '#CC2222', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  newChipText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },

  // Plaque
  plaque: {
    width: EXHIBIT_W, marginTop: 14,
    backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center',
  },
  plaqueTitle: { fontFamily: FONTS.serif, fontStyle: 'italic', fontSize: 18, fontWeight: '700', color: FOREST },
  plaqueDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 7, width: '70%' },
  plaqueRule: { flex: 1, height: 1, backgroundColor: BORDER },
  plaqueFlavor: {
    fontFamily: FONTS.serif, fontStyle: 'italic', fontSize: 14, fontWeight: '600',
    color: BROWN, textAlign: 'center', lineHeight: 20, paddingHorizontal: 4,
  },

  // Actions
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14, width: '100%' },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, borderRadius: 12, paddingVertical: 12,
  },
  actionPrimary: { backgroundColor: FOREST },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: FOREST },
  actionDisabled: { backgroundColor: TAN + '70', borderWidth: 1, borderColor: BORDER },
  actionText: { fontSize: 13, fontWeight: '800', fontFamily: FONTS.serif },

  // Empty state
  emptyCard: {
    backgroundColor: IVORY, borderRadius: 20,
    borderWidth: 1.5, borderColor: GOLD + '55',
    paddingVertical: 34, paddingHorizontal: 24, alignItems: 'center', gap: 4,
  },
  emptyTitle: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', color: FOREST, marginTop: 14 },
  emptySub: { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, marginTop: 2 },

  // Collection strip
  stripHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  stripRule: { flex: 1, height: 1, backgroundColor: BORDER },
  stripTitle: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: BROWN, letterSpacing: 0.3 },
  stripContent: { paddingVertical: 6, paddingHorizontal: 2, gap: 10 },

  slot: { width: 78, alignItems: 'center', borderRadius: 12, padding: 7, gap: 6 },
  slotUnlocked: { backgroundColor: IVORY, borderWidth: 1.5, borderColor: BORDER },
  slotLocked: { backgroundColor: '#F4F1E8', borderWidth: 1.5, borderColor: TAN, borderStyle: 'dashed' },
  slotActive: { borderColor: FOREST, borderStyle: 'solid' },
  slotThumb: {
    width: 60, height: 54, borderRadius: 8, overflow: 'hidden',
    backgroundColor: TAN, borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  slotImage: { width: '100%', height: '100%' },
  slotQ: { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '900', color: MUTED, opacity: 0.55 },
  slotLabel: { fontSize: 9.5, fontWeight: '700', color: BROWN, textAlign: 'center', lineHeight: 12, minHeight: 24 },
  slotNewDot: {
    position: 'absolute', top: 4, right: 4,
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#CC2222', borderWidth: 1.5, borderColor: IVORY,
  },

  stripFootnote: { fontSize: 11.5, color: MUTED, textAlign: 'center', fontStyle: 'italic', marginTop: 2 },
});