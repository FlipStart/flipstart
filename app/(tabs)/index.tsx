/**
 * app/(tabs)/index.tsx  — FlipStart Home Screen
 *
 * NO ScrollView — entire screen fits on one iPhone.
 * Layout (top → bottom):
 *   Header: profile | settings | FlipStart title | scan pill
 *   Slogan
 *   Scan Item card (lion bg, large CTA)
 *   Progress preview card (XP rank + streak)
 *   Articles & Guides (3 cards)
 *   Bottom tab bar (separate component)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, Image,
  Dimensions, Modal, Animated, ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image as ExpoImage } from 'expo-image';

import { FONTS } from '@/constants/typography';
import { ArticleCard, type ArticleCardData } from '@/components/home/ArticleCard';
import { captureFromCamera, type CapturedPhotoSet } from '@/lib/capture';
import { consumePendingCaptureSet } from '@/lib/pending-capture-set';
import { setPendingScan } from '@/lib/pending-scan';
import { logEvent } from '@/lib/analytics';
import { registerCaptureListener, unregisterCaptureListener } from '@/lib/capture-event';
import { isOnboardingComplete, completeOnboarding } from '@/lib/onboarding-storage';
import {
  loadXpProfile, getCurrentRank, getNextRank,
  getRankProgress, RANK_LADDER, type HuntXpProfile,
} from '@/lib/huntXp';

// ─── Assets ───────────────────────────────────────────────────────────────────
const LION_CARD_BG = require('@/assets/images/ScanItem-Lion.png');

// ─── Palette — matched to reference image exactly ────────────────────────────
const FOREST    = '#2A4A2A';   // wordmark, section headers, text
const SCAN_DARK = '#162D1A';   // scan card + scan pill bg — deep predator green
const CREAM     = '#F4EED8';   // text on dark cards
const PARCHMENT = '#F0E8D4';   // page background — warm tan
const CARD_B    = '#DDD0B0';   // card borders
const BROWN     = '#5A3A1A';   // secondary text
const MUTED     = '#8A7050';   // muted text
const GOLD      = '#BE9C2C';   // gold accents
const GOLD_L    = '#D4A72C';   // lighter gold

const { width: SW, height: SH } = Dimensions.get('window');
const IS_SMALL = SH < 700;

// ─── Article data ─────────────────────────────────────────────────────────────
const ARTICLES: ArticleCardData[] = [
  { id: 'a1', title: 'Thrift Brands Worth Real Money',   badgeVariant: 'green', priceBadge: 'HOT',  imageUri: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=400&q=80' },
  { id: 'a2', title: 'Spotting Fake Designer Items',     badgeVariant: 'red',   priceBadge: 'FAKE', imageUri: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80' },
  { id: 'a3', title: 'Best Apps for Flippers',           badgeVariant: 'gold',  priceBadge: 'NEW',  imageUri: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=400&q=80' },
];

// ─── Scan balance hook (wraps ScanBalancePill logic for inline use) ───────────
// Falls back to a simple fetch if useScanBalance hook doesn't exist yet
function useScansRemaining(): { remaining: number; loading: boolean } {
  const [remaining, setRemaining] = useState(200);
  const [loading,   setLoading]   = useState(true);
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`${apiBase}/api/scan-stats`);
      const data = await res.json();
      if (typeof data?.globalScansRemainingToday === 'number') {
        setRemaining(data.globalScansRemainingToday);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { remaining, loading };
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Onboarding ──────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    isOnboardingComplete().then(done => setShowOnboarding(!done));
  }, []);

  // ── Scan balance ────────────────────────────────────────────────────────────
  const { remaining, loading: scanLoading } = useScansRemaining();

  // ── XP profile ──────────────────────────────────────────────────────────────
  const [xpProfile, setXpProfile] = useState<HuntXpProfile | null>(null);
  useFocusEffect(useCallback(() => {
    loadXpProfile().then(setXpProfile).catch(() => {});
  }, []));

  const totalXp     = xpProfile?.totalXp      ?? 0;
  const streak      = xpProfile?.huntStreak   ?? 0;
  const currentRank = getCurrentRank(totalXp);
  const nextRank    = getNextRank(totalXp);
  const xpProgress  = getRankProgress(totalXp);
  const levelNum    = RANK_LADDER.findIndex(r => r.rank === currentRank.rank) + 1;

  // ── Camera / scan flow ──────────────────────────────────────────────────────
  const [photoSet,    setPhotoSet]    = useState<CapturedPhotoSet | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    registerCaptureListener((photo) => {
      setPhotoSet(curr => curr ?? { front: photo });
      setIsAnalyzing(false);
    });
    return () => unregisterCaptureListener();
  }, []);

  useFocusEffect(useCallback(() => {
    const set = consumePendingCaptureSet();
    if (set?.front) {
      setPhotoSet(set);
      setIsAnalyzing(false);
    }
  }, []));

  // After photo arrives, auto-navigate to loading/analysis
  useEffect(() => {
    if (!photoSet?.front || isAnalyzing) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try { logEvent('scan_started', { tagPresent: !!photoSet.tag?.base64 }); } catch {}
    setPendingScan({
      front: { base64: photoSet.front.base64, mimeType: photoSet.front.mimeType },
      ...(photoSet.detail?.base64 ? { detail: { base64: photoSet.detail.base64, mimeType: photoSet.detail.mimeType } } : {}),
      ...(photoSet.tag?.base64    ? { tag:    { base64: photoSet.tag.base64,    mimeType: photoSet.tag.mimeType    } } : {}),
    });
    const imageUri = photoSet.front.uri;
    const mimeType = photoSet.front.mimeType;
    setPhotoSet(null);
    setIsAnalyzing(true);
    router.push({ pathname: '/loading' as any, params: { imageUri, mimeType } });
  }, [photoSet]);

  const handleScanItem = () => router.push('/camera' as any);

  // ── Scan pill accent ────────────────────────────────────────────────────────
  const isLow  = remaining > 0 && remaining <= 30;
  const isZero = remaining <= 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        {/* Left: profile (larger circle) + settings (icon only, no bg) */}
        <View style={s.headerLeft}>
          <Pressable
            onPress={() => router.push('/(tabs)/profile' as any)}
            style={({ pressed }) => [s.avatarCircle, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <MaterialIcons name="person" size={22} color={FOREST} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/settings' as any)}
            style={({ pressed }) => [s.settingsBtn, pressed && { opacity: 0.6 }]}
            hitSlop={12}
          >
            <MaterialIcons name="settings" size={22} color={BROWN} />
          </Pressable>
        </View>

        {/* Center: FlipStart title with decorative stars */}
        <View style={s.headerCenter}>
          <View style={s.wordmarkRow}>
            <Text style={s.wordmarkStar}>✦</Text>
            <Text style={s.wordmark}>FlipStart</Text>
            <Text style={s.wordmarkStar}>✦</Text>
          </View>
        </View>

        {/* Right: scans pill — premium, taller, larger text */}
        <Pressable
          style={[s.scanPill, { borderColor: (isZero || isLow ? '#B85450' : GOLD) + '60', marginLeft: 10 }]}
          hitSlop={6}
        >
          <MaterialIcons name="bolt" size={26} color={GOLD} />
          <View style={s.scanPillTextBlock}>
            <Text style={s.scanPillNum}>{scanLoading ? '…' : remaining}</Text>
            <Text style={s.scanPillLabel}>scans left</Text>
          </View>
          <MaterialIcons name="chevron-right" size={15} color={CREAM} style={{ opacity: 0.7 }} />
        </Pressable>
      </View>

      {/* Header separator */}
      <View style={s.headerSep} />

      {/* ── SLOGAN ─────────────────────────────────────────────────────────── */}
      <View style={s.sloganRow}>
        <Text style={s.slogan}>
          Find it. Flip it. <Text style={s.sloganGold}>Fund your life.</Text>
        </Text>
      </View>
      <View style={s.sloganDivider}>
        <View style={s.divLine} />
        <Text style={s.divStar}>✦</Text>
        <View style={s.divLine} />
      </View>

      {/* ── SCAN ITEM CARD ─────────────────────────────────────────────────── */}
      <Pressable
        onPress={handleScanItem}
        style={({ pressed }) => [s.scanCard, pressed && { opacity: 0.92 }]}
      >
        {/* Lion artwork — right side, bg matches SCAN_DARK so blends seamlessly at full opacity */}
        <Image
          source={LION_CARD_BG}
          style={s.lionBg}
          resizeMode="cover"
        />
        {/* Horizontal fade removed — lion renders sharp with no blending overlay */}

        {/* Left content */}
        <View style={s.scanCardContent}>
          {/* Camera icon with radial rays */}
          <View style={s.cameraIconWrap}>
            {/* Radial ray lines */}
            {[0,45,90,135,180,225,270,315].map(deg => (
              <View
                key={deg}
                style={[s.ray, {
                  transform: [{ rotate: `${deg}deg` }],
                }]}
              />
            ))}
            <View style={s.cameraIconBox}>
              <MaterialIcons name="photo-camera" size={38} color={CREAM} />
            </View>
          </View>
          <Text style={s.scanCardTitle}>Scan Item</Text>
          <Text style={s.scanCardSub}>
            Scan an item with your camera{'\n'}to find out its resale value{'\n'}in seconds!
          </Text>
        </View>

        {/* Right chevron */}
        <View style={s.scanCardChevron}>
          <MaterialIcons name="chevron-right" size={30} color={CREAM} style={{ opacity: 0.7 }} />
        </View>
      </Pressable>

      {/* ── PROGRESS CARD ──────────────────────────────────────────────────── */}
      <View style={s.progressCard}>
        {/* Left: rank icon + name + XP */}
        <View style={s.progressLeft}>
          <View style={s.rankIconWrap}>
            <MaterialIcons name="emoji-events" size={26} color={GOLD} />
          </View>
          <View style={s.rankInfo}>
            <Text style={s.rankName} numberOfLines={1} adjustsFontSizeToFit>{currentRank.rank}</Text>
            <Text style={s.rankLevel}>Level {levelNum}</Text>
            <View style={s.xpBarTrack}>
              <View style={[s.xpBarFill, { width: `${xpProgress}%` }]} />
            </View>
            <Text style={s.xpText}>
              {totalXp.toLocaleString()} / {(nextRank?.xp ?? totalXp).toLocaleString()} XP
            </Text>
          </View>
        </View>

        {/* Center: streak */}
        <View style={s.streakBlock}>
          <View style={s.streakTopRow}>
            <Text style={s.streakFire}>🔥</Text>
            <Text style={s.streakNum}>{streak}</Text>
          </View>
          <Text style={s.streakLabel}>Hunt streak</Text>
        </View>

        {/* Right: compact green button */}
        <Pressable
          onPress={() => router.push('/(tabs)/progress' as any)}
          style={({ pressed }) => [s.viewProgressBtn, pressed && { opacity: 0.75 }]}
        >
          <Text style={s.viewProgressText}>View{'\n'}Progress</Text>
          <MaterialIcons name="chevron-right" size={12} color={BROWN} />
        </Pressable>
      </View>

      {/* ── ARTICLES & GUIDES ──────────────────────────────────────────────── */}
      <View style={s.articlesSection}>
        <View style={s.articlesHeader}>
          <Text style={s.articlesTitle}>Articles &amp; Guides</Text>
          <Pressable
            style={({ pressed }) => [s.viewAllBtn, pressed && { opacity: 0.65 }]}
          >
            <Text style={s.viewAllText}>View All</Text>
            <MaterialIcons name="chevron-right" size={14} color={BROWN} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.articlesScroll}
          decelerationRate="fast"
          snapToInterval={ARTICLE_W + 8}
          snapToAlignment="start"
        >
          {ARTICLES.map(item => (
            <View key={item.id} style={s.articleCardWrap}>
              <ArticleCard
                data={item}
                onPress={() => router.push({ pathname: '/article', params: { id: item.id } } as any)}
              />
              {/* Invisible expander — pushes card to match tallest sibling */}
              <View style={{ flex: 1 }} />
            </View>
          ))}
        </ScrollView>
      </View>

      {/* ── Onboarding overlay ─────────────────────────────────────────────── */}
      <Modal visible={showOnboarding === true} animationType="fade" statusBarTranslucent>
        <OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
      </Modal>
    </View>
  );
}

// ─── Onboarding overlay ───────────────────────────────────────────────────────

function OnboardingOverlay({ onComplete }: { onComplete: () => void }) {
  const [saving, setSaving] = useState(false);

  const handleFinish = async () => {
    if (saving) return;
    setSaving(true);
    await completeOnboarding('resell');
    onComplete();
  };

  return (
    <View style={{ flex: 1, backgroundColor: PARCHMENT, justifyContent: 'center', paddingHorizontal: 24 }}>
      <View style={{ alignItems: 'center', gap: 4, marginBottom: 32 }}>
        <Text style={{ fontFamily: FONTS.serif, fontSize: 32, fontWeight: '800', color: FOREST }}>FlipStart</Text>
        <Text style={{ fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2 }}>✦ THRIFT INTELLIGENCE ✦</Text>
      </View>
      <View style={{ alignItems: 'center', marginBottom: 28 }}>
        <View style={{ width: 96, height: 96, borderRadius: 24, backgroundColor: GOLD + '18', borderWidth: 1.5, borderColor: GOLD + '40', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ fontSize: 44 }}>📷</Text>
        </View>
        <Text style={{ fontFamily: FONTS.serif, fontSize: 28, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 12 }}>Scan. Decide. Profit.</Text>
        <Text style={{ fontSize: 15, color: BROWN, textAlign: 'center', lineHeight: 22 }}>Scan any item to instantly see value, profit, and whether it's worth buying.</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 36 }}>
        {[{ icon: '⚡', label: 'Instant\nAnalysis' }, { icon: '💰', label: 'Resale\nValue' }, { icon: '👍', label: 'Buy /\nSkip' }].map(f => (
          <View key={f.label} style={{ alignItems: 'center', gap: 8 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: FOREST + '10', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontSize: 20 }}>{f.icon}</Text>
            </View>
            <Text style={{ fontSize: 11, fontWeight: '600', color: FOREST, textAlign: 'center' }}>{f.label}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={handleFinish}
        disabled={saving}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: FOREST, borderRadius: 50, paddingVertical: 18, opacity: pressed || saving ? 0.85 : 1 })}
      >
        <Text style={{ fontSize: 17, fontWeight: '700', color: CREAM }}>{saving ? 'Starting…' : 'Start Scanning'}</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ARTICLE_W = (SW - 28 - 8) / 2.15;  // 2 fully visible + peek of 3rd

const s = StyleSheet.create({

  root: { flex: 1, backgroundColor: PARCHMENT },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 14,
    paddingTop:        IS_SMALL ? 6 : 8,
    paddingBottom:     IS_SMALL ? 6 : 8,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8, width: 82 },

  // Profile — vintage circle, slightly smaller than previous pass
  avatarCircle: {
    width:           38,
    height:          38,
    borderRadius:    19,
    backgroundColor: CARD_B + 'BB',
    borderWidth:     1.5,
    borderColor:     GOLD + '80',
    justifyContent:  'center',
    alignItems:      'center',
    shadowColor:     FOREST,
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.1,
    shadowRadius:    3,
    elevation:       2,
  },
  // Settings — gear icon only, no background
  settingsBtn: {
    width:          34,
    height:         34,
    justifyContent: 'center',
    alignItems:     'center',
  },

  headerCenter: { flex: 1, alignItems: 'center' },
  wordmarkRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  wordmark: {
    fontFamily:    FONTS.serif,
    fontSize:      IS_SMALL ? 32 : 36,
    fontWeight:    '900',
    color:         FOREST,
    letterSpacing: -1.2,   // tighter spacing keeps width in check while size grows
  },
  wordmarkStar: {
    fontSize:  12,
    color:     GOLD,
    marginTop: -3,
  },

  // Scan pill — sized relative to larger FlipStart title
  scanPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    backgroundColor:   SCAN_DARK,
    borderRadius:      10,
    paddingHorizontal: 5,
    paddingVertical:   3,
    borderWidth:       1,
    marginRight:       6,
    shadowColor:       '#0A1A0A',
    shadowOffset:      { width: 0, height: 3 },
    shadowOpacity:     0.45,
    shadowRadius:      6,
    elevation:         5,
  },
  scanPillTextBlock: { alignItems: 'flex-start' },
  scanPillNum: {
    fontFamily:    FONTS.serif,
    fontSize:      13,
    fontWeight:    '900',
    color:         CREAM,
    lineHeight:    15,
  },
  scanPillLabel: {
    fontSize:      7,
    fontWeight:    '700',
    color:         CREAM,
    opacity:       0.7,
    lineHeight:    8,
    letterSpacing: 0.2,
  },

  // Header separator
  headerSep: {
    height:          1,
    backgroundColor: GOLD + '30',
    marginHorizontal: 14,
    marginBottom:    IS_SMALL ? 8 : 12,
  },

  // ── Slogan ─────────────────────────────────────────────────────────────────
  sloganRow: {
    alignItems:        'center',
    paddingHorizontal: 16,
    marginBottom:      IS_SMALL ? 4 : 6,
  },
  slogan:     { fontFamily: FONTS.serif, fontSize: IS_SMALL ? 17 : 19, fontWeight: '700', color: FOREST, textAlign: 'center' },
  sloganGold: { color: GOLD },
  sloganDivider: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              10,
    paddingHorizontal: 90,    // wider padding = shorter line, matching reference
    marginBottom:     IS_SMALL ? 8 : 10,
  },
  divLine: { flex: 1, height: 1, backgroundColor: GOLD + '55' },
  divStar: { fontSize: 12, color: GOLD },

  // ── Scan card — gold border frame, overflow visible so border shows ──────────
  scanCard: {
    marginHorizontal: 12,
    borderRadius:     18,
    overflow:         'hidden',
    backgroundColor:  SCAN_DARK,
    height:           IS_SMALL ? 205 : 238,
    flexDirection:    'row',
    alignItems:       'flex-end',
    marginBottom:     IS_SMALL ? 8 : 10,
    borderWidth:      1.5,
    borderColor:      GOLD + '55',   // stronger gold border for vintage frame feel
    shadowColor:      '#0A1A0A',
    shadowOffset:     { width: 0, height: 5 },
    shadowOpacity:    0.5,
    shadowRadius:     14,
    elevation:        10,
  },
  lionBg: {
    position: 'absolute',
    right:    0,       // right edge of image touches right edge of card
    top:      0,
    width:    '68%',
    height:   238,
    opacity:  1,
  },
  // Soft horizontal fade at the left edge of the lion artwork
  // prevents any hard visual boundary between text region and image
  lionFade: {
    position:        'absolute',
    left:            '30%',   // starts where text ends
    top:             0,
    bottom:          0,
    width:           '20%',   // fade zone width
    // React Native can't do linear-gradient natively without a library,
    // so we use a semi-transparent SCAN_DARK overlay that fades the edge
    backgroundColor: SCAN_DARK,
    opacity:         0.55,
  },
  scanCardOverlay: {
    position: 'absolute',
    inset:    0,
    backgroundColor: 'transparent',
  },
  scanCardContent: {
    flex:          1,
    padding:       20,
    paddingBottom: 20,
    zIndex:        2,
  },

  // Camera icon with compass/radar rays OUTSIDE the box
  cameraIconWrap: {
    width:           96,
    height:          96,
    justifyContent:  'center',
    alignItems:      'center',
    marginBottom:    10,
    marginLeft:      28,   // aligns icon left edge with the "a" in Scan Item
    position:        'relative',
  },
  cameraIconBox: {
    width:            68,
    height:           68,
    borderRadius:     18,
    backgroundColor:  'rgba(255,255,255,0.10)',
    justifyContent:   'center',
    alignItems:       'center',
    borderWidth:      1.5,
    borderColor:      'rgba(255,255,255,0.22)',
    zIndex:           2,
  },
  ray: {
    position:        'absolute',
    width:           2,
    height:          12,
    backgroundColor: GOLD,
    opacity:         0.45,
    borderRadius:    1,
    top:             0,
    left:            '50%',
    marginLeft:      -1,
    transformOrigin: '50% 48px',  // radius = half of cameraIconWrap — rays orbit outside box
  },

  scanCardTitle: {
    fontFamily:   FONTS.serif,
    fontSize:     IS_SMALL ? 26 : 30,
    fontWeight:   '800',
    color:        CREAM,
    marginBottom: 6,
  },
  scanCardSub: {
    fontSize:   12,
    color:      CREAM,
    opacity:    0.80,
    lineHeight: 17,
  },
  scanCardChevron: {
    position:  'absolute',
    right:     14,
    bottom:    '50%',
    transform: [{ translateY: 15 }],
    zIndex:    2,
  },

  // ── Progress card — warm darker parchment ──────────────────────────────────
  progressCard: {
    marginHorizontal:  12,
    backgroundColor:   '#E8D8B8',    // darker warm parchment — more premium than page bg
    borderRadius:      14,
    borderWidth:       1,
    borderColor:       CARD_B,
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 14,
    paddingVertical:   IS_SMALL ? 10 : 13,
    marginBottom:      IS_SMALL ? 8 : 10,
    shadowColor:       FOREST,
    shadowOffset:      { width: 0, height: 1 },
    shadowOpacity:     0.08,
    shadowRadius:      4,
    elevation:         2,
  },
  progressLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankIconWrap: {
    width:           44,
    height:          44,
    borderRadius:    22,
    backgroundColor: GOLD + '25',
    borderWidth:     1,
    borderColor:     GOLD + '55',
    justifyContent:  'center',
    alignItems:      'center',
  },
  rankInfo:   { flex: 1 },
  rankName:   { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: SCAN_DARK },
  rankLevel:  { fontSize: 12, color: SCAN_DARK, fontWeight: '700', marginBottom: 5, opacity: 0.8 },
  xpBarTrack: { height: 6, backgroundColor: CARD_B, borderRadius: 3, overflow: 'hidden', marginBottom: 3 },
  xpBarFill:  { height: '100%', backgroundColor: SCAN_DARK, borderRadius: 3 },
  xpText:     { fontSize: 10, color: BROWN, fontWeight: '600', opacity: 0.7 },

  // Separator — bolder, centered between XP bar and streak
  progressSep: {
    width:           1.5,
    alignSelf:       'stretch',
    backgroundColor: BROWN,
    marginVertical:  6,
    marginHorizontal: 4,
    opacity:         0.35,
  },

  streakBlock:  { alignItems: 'center', paddingHorizontal: 10 },
  streakTopRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  streakFire:   { fontSize: 16 },
  streakNum:    { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '900', color: SCAN_DARK },
  streakLabel:  { fontSize: 9, color: BROWN, textAlign: 'center', opacity: 0.75, marginTop: 2 },

  // View Progress — pushed right via marginLeft
  viewProgressBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    backgroundColor:   'rgba(200,184,152,0.55)',
    borderRadius:      10,
    paddingHorizontal: 10,
    paddingVertical:   10,
    borderWidth:       1,
    borderColor:       CARD_B,
    gap:               2,
    minWidth:          68,
    marginLeft:        8,     // pushes button away from streak toward right edge
  },
  viewProgressText: {
    fontFamily:   FONTS.serif,
    fontSize:     11,
    fontWeight:   '700',
    color:        BROWN,
    textAlign:    'center',
    lineHeight:   14,
  },

  // ── Articles — shifted down, equal card heights ────────────────────────────
  articlesSection: {
    paddingHorizontal: 12,
    marginTop:         IS_SMALL ? 8 : 14,   // push down away from progress card
    flex:              1,                   // fill remaining space above tab bar
    justifyContent:    'flex-end',          // anchor to bottom
    marginBottom:      IS_SMALL ? 6 : 10,
  },
  articlesHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   8,
  },
  articlesTitle: {
    fontFamily: FONTS.serif,
    fontSize:   17,
    fontWeight: '800',
    color:      FOREST,
  },
  viewAllBtn:  { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { fontFamily: FONTS.serif, fontSize: 13, color: BROWN, fontWeight: '600' },
  articlesRow:    { flexDirection: 'row', gap: 6 },
  articlesScroll: { gap: 8, paddingRight: 12, alignItems: 'stretch' },
  articleCardWrap: { width: ARTICLE_W, flex: 1 },
});