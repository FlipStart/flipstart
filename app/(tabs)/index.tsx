/**
 * index.tsx — Home (V3 rebuild, from the hand-drawn sketch)
 *
 * Structure (top → bottom):
 *   1. Compact header: profile menu btn | ✦ FlipStart ✦ + subtitle | scans pill
 *   2. Divider, then "Welcome back, {name}"
 *   3. Scan Item hero (dark green, camera art on top, title under) — tappable
 *   4. Scan / Analyze / Collect strip fused to the hero's bottom edge
 *   5. Hunt Mode XP teaser card → The Hunt Leaderboard
 *   6. Articles & Guides horizontal rail
 *
 * Clean-white palette: #FFFFFF page, #FFFEFA cards, #F8F7F0 inner surfaces,
 * #DDD2AC borders, #214D2D green, #C4A334 gold. The hero card alone stays
 * #122E1B because the camera PNG's feathered edge was sampled against it.
 *
 * ALL original plumbing preserved verbatim:
 *  • onboarding version-gate + guest redirect + username-setup routing
 *  • capture listener → pending-scan → /loading pipeline
 *  • XP/avatar focus loading (account-scoped, clears on sign-out)
 *  • honest scans-remaining hook (null until real data; never a fake 7)
 */

import { navGuard } from '@/lib/navGuard';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
  Platform, Modal, Dimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { FONTS } from '@/constants/typography';
import { type CapturedPhotoSet } from '@/lib/capture';
import { consumePendingCaptureSet } from '@/lib/pending-capture-set';
import { setPendingScan } from '@/lib/pending-scan';
import { logEvent } from '@/lib/analytics';
import { registerCaptureListener, unregisterCaptureListener } from '@/lib/capture-event';
import { needsOnboarding } from '@/lib/onboarding-storage';
import { useAuth } from '@/lib/auth-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadXpProfile, getCurrentRank, getNextRank,
  getRankProgress, RANK_LADDER, type HuntXpProfile,
} from '@/lib/huntXp';

// ─── Palette (clean-white spec) ────────────────────────────────────────────────
const WHITE     = '#FFFFFF';
const CARD      = '#FFFEFA';
const INNER     = '#F8F7F0';
const BORDER    = '#DDD2AC';
const GREEN     = '#214D2D';
const HERO_DARK = '#122E1B';   // sampled from the camera artwork — do not change
const GOLD      = '#C4A334';
const BROWN     = '#6F5A3E';
const DARK      = '#2B2118';
const MUTED     = '#8A7658';
const CREAM     = '#F4EED8';   // light text/icons on dark green
const WARN      = '#6E211B';   // low/zero scans pill state
const GREEN_TINT = '#E7EFE4';
const GOLD_TINT  = '#F5EBCB';

const { height: SH } = Dimensions.get('window');
const IS_SMALL = SH < 700;

// ─── Scan balance hook — honest (null until real data, never a fake 7) ───────
function useScansRemaining(): { remaining: number | null; failed: boolean } {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [failed,    setFailed]    = useState(false);
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

  const load = useCallback(async () => {
    try {
      const { getScannerId } = await import('@/lib/analytics');
      const scannerId = await getScannerId().catch(() => undefined);
      const qs   = scannerId ? `?scannerId=${encodeURIComponent(scannerId)}` : '';
      const res  = await fetch(`${apiBase}/api/scan-stats${qs}`);
      const data = await res.json();
      if (typeof data?.remainingToday === 'number') {
        setRemaining(data.remainingToday); setFailed(false);
      } else if (typeof data?.globalScansRemainingToday === 'number') {
        setRemaining(data.globalScansRemainingToday); setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
  }, [apiBase]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { remaining, failed };
}

// ─── Articles & Guides (all route to real, fully-written articles) ───────────
const CONTENT_CARDS = [
  {
    id: 'brands-worth-money', title: 'Brands Worth Real Money',
    subtitle: 'Denim, sportswear, workwear & more — broken down by category.',
    icon: 'sell' as const, tint: GREEN_TINT, iconColor: GREEN,
    route: { pathname: '/article', params: { id: 'brands-worth-money' } },
  },
  {
    id: 'thrifting-locations', title: 'Where to Thrift',
    subtitle: 'Goodwill bins, Salvation Army, Savers & more — ranked and explained.',
    icon: 'storefront' as const, tint: GOLD_TINT, iconColor: GOLD,
    route: { pathname: '/article', params: { id: 'thrifting-locations' } },
  },
  {
    id: 'fake-vs-real', title: 'Fake vs. Real',
    subtitle: 'Spot counterfeits before you buy them.',
    icon: 'verified' as const, tint: GREEN_TINT, iconColor: GREEN,
    route: { pathname: '/article', params: { id: 'fake-vs-real' } },
  },
  {
    id: 'resale-platforms', title: 'Where to Sell',
    subtitle: 'eBay, Depop, Poshmark & more — matched to your item.',
    icon: 'swap-horiz' as const, tint: GOLD_TINT, iconColor: GOLD,
    route: { pathname: '/article', params: { id: 'resale-platforms' } },
  },
];

// ─── Scan → Analyze → Collect steps ───────────────────────────────────────────
const STEPS = [
  { icon: 'photo-camera' as const, title: 'Scan',    desc: 'Take photos of a thrift find.' },
  { icon: 'query-stats' as const,  title: 'Analyze', desc: 'See value, buy rating, and risk flags.' },
  { icon: 'emoji-events' as const, title: 'Collect', desc: 'Unlock brands, achievements, and Diamonds.' },
];

// ─── Home Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Onboarding ──────────────────────────────────────────────────────────────
  const { user, profile, loading: authLoading, profileChecked } = useAuth();
  const [showScanModal,   setShowScanModal]   = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  useEffect(() => {
    // Version-gated: anyone whose device hasn't completed the CURRENT onboarding
    // version is sent through it once — including returning testers who finished
    // the old onboarding (migrated to v1) and signed-in users. Any successful
    // auth or onboarding completion writes the current version, so this never
    // loops. Scans, Hunt, achievements, brands, diamonds, and profile are untouched.
    needsOnboarding().then(needed => {
      if (needed) router.replace('/onboarding' as any);
    });
  }, []);

  // routedForUser prevents re-routing when profile state updates after
  // username setup completes — without this guard a stale profile causes a loop.
  const routedForUser = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading || !profileChecked) return;
    if (!user) {
      // No account (signed out, or never logged in). Guests are not allowed —
      // send them to the start of onboarding to create/log into an account.
      routedForUser.current = null;
      router.replace('/onboarding' as any);
      return;
    }
    if (routedForUser.current === user.id) return;       // already routed this session

    if (profile?.onboarding_complete) {
      routedForUser.current = user.id;
    } else {
      routedForUser.current = user.id;
      router.replace('/username-setup' as any);
    }
  }, [authLoading, profileChecked, user, profile]);

  // ── Scan balance (honest) ───────────────────────────────────────────────────
  const { remaining, failed: scanFailed } = useScansRemaining();
  const hasScanData = remaining !== null;
  const isZero = hasScanData && remaining! <= 0;
  const isLow  = hasScanData && remaining! > 0 && remaining! <= 2;
  const scanCountText = hasScanData ? String(remaining) : (scanFailed ? '—' : '…');

  // ── XP / avatar ─────────────────────────────────────────────────────────────
  const [xpProfile, setXpProfile] = useState<HuntXpProfile | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    // Use user?.id (not user) as dep so token-refresh events that update the
    // user object reference without changing the ID don't trigger a spurious
    // reload. Pass uid explicitly to loadXpProfile to bypass _activeUserId and
    // eliminate the async-import timing race that caused the stale-data flash.
    const uid = user?.id ?? null;
    if (uid) {
      loadXpProfile(uid).then(setXpProfile).catch(() => {});
      // Prefer the Supabase-backed avatar; local cache is the fallback.
      if (profile?.avatar_url) {
        setAvatarUri(profile.avatar_url);
      } else {
        AsyncStorage.getItem(`@flipstart/avatar:${uid}`).then(uri => {
          setAvatarUri(uri ?? null);
        }).catch(() => {});
      }
    } else {
      setXpProfile(null); // sign-out: clear immediately, never show previous account XP
      setAvatarUri(null);
    }
  }, [user?.id, profile?.avatar_url]));

  const totalXp     = xpProfile?.totalXp ?? 0;
  const currentRank = getCurrentRank(totalXp);
  const nextRank    = getNextRank(totalXp);
  const xpProgress  = getRankProgress(totalXp);
  const levelNum    = RANK_LADDER.findIndex(r => r.rank === currentRank.rank) + 1;
  const xpText      = nextRank
    ? `${totalXp.toLocaleString()} / ${nextRank.xp.toLocaleString()} XP`
    : `${totalXp.toLocaleString()} XP · MAX`;

  // ── Welcome name — display name → @username → plain fallback ───────────────
  const welcomeText = profile?.display_name
    ? `Welcome back, ${profile.display_name}`
    : profile?.username
      ? `Welcome back, @${profile.username}`
      : 'Welcome back';

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

  const handleScanItem = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push('/camera' as any);
  };

  const go = (route: any) => {
    if (!navGuard()) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(route);
  };

  const openFromMenu = (route: any) => {
    setShowProfileMenu(false);
    go(route);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>

      {/* ── 1. HEADER ── */}
      <Animated.View entering={FadeInDown.duration(380)} style={[s.headerBand, { paddingTop: insets.top + 2 }]}>
        <View style={s.headerRow}>
          {/* Centered brand — absolute full-width so it's centered on the SCREEN */}
          <View style={s.headerTitleWrap} pointerEvents="none">
            <Text style={s.headerTitle}>FlipStart</Text>
            <Text style={s.headerSub}>✦ THRIFT & RESALE AI ✦</Text>
          </View>

          {/* Profile → small menu (Profile / Settings) */}
          <Pressable
            onPress={() => setShowProfileMenu(true)}
            style={({ pressed }) => [s.profileBtn, pressed && { opacity: 0.7 }]}
            hitSlop={6}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={{ width: 42, height: 42, borderRadius: 21 }} />
            ) : (
              <MaterialIcons name="person" size={22} color={GREEN} />
            )}
          </Pressable>

          {/* Scans remaining button — dark green rounded rect, bolt, stacked
              number/label, chevron on the right (matches reference exactly) */}
          <Pressable
            onPress={() => setShowScanModal(true)}
            style={({ pressed }) => [
              s.scanPill,
              (isZero || isLow) && s.scanPillLow,
              pressed && { opacity: 0.85 },
            ]}
            hitSlop={8}
          >
            <MaterialIcons name="bolt" size={14} color={(isZero || isLow) ? CREAM : GOLD} />
            <View style={s.scanPillTextWrap}>
              <Text style={s.scanPillNum} numberOfLines={1}>
                {hasScanData ? remaining : (scanFailed ? '—' : '…')}
              </Text>
              <Text style={s.scanPillLabel} numberOfLines={1}>scans left</Text>
            </View>
            <MaterialIcons name="chevron-right" size={13} color={CREAM} />
          </Pressable>
        </View>
      </Animated.View>
      <View style={s.headerDivider} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── 2. WELCOME ── */}
        <Animated.View entering={FadeInUp.delay(60).duration(380)}>
          <Text style={s.welcome} numberOfLines={1} ellipsizeMode="tail">
            {welcomeText}
          </Text>
        </Animated.View>

        {/* ── 3. SCAN ITEM HERO + 4. fused Scan/Analyze/Collect strip ── */}
        <Animated.View entering={FadeInUp.delay(120).duration(400)}>
          <Pressable
            onPress={handleScanItem}
            style={({ pressed }) => [s.hero, pressed && { transform: [{ scale: 0.985 }] }]}
          >
            {/* Vintage dashed gold inset frame */}
            <View style={s.heroDashed} pointerEvents="none" />

            {/* Camera artwork — the existing extracted PNG, centered on its
                native green so the feathered edge blends invisibly. */}
            <Image
              source={require('@/assets/images/hero-camera.png')}
              style={s.heroArt}
              contentFit="contain"
            />

            <Text style={s.heroTitle}>Scan Item</Text>
            <Text style={s.heroSub} numberOfLines={2}>
              Analyze thrift finds and see their resale value.
            </Text>

            <View style={s.heroCta}>
              <Text style={s.heroCtaText}>Start Scan</Text>
              <MaterialIcons name="arrow-forward" size={13} color={GREEN} />
            </View>
          </Pressable>

          {/* Steps strip — fused to the hero (shared edges, no overlap) */}
          <View style={s.stepsStrip}>
            {STEPS.map((step, i) => (
              <View key={step.title} style={s.stepItem}>
                {i > 0 && <View style={s.stepDivider} />}
                <View style={s.stepBadge}>
                  <MaterialIcons name={step.icon} size={15} color={GREEN} />
                </View>
                <Text style={s.stepTitle} numberOfLines={1}>{step.title}</Text>
                <Text style={s.stepDesc} numberOfLines={2} ellipsizeMode="tail">{step.desc}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── 5. HUNT MODE — explains itself, sells the mode, THEN shows rank ── */}
        <Animated.View entering={FadeInUp.delay(180).duration(400)}>
          <View style={s.huntCard}>

            {/* Explainer header — compass mark, tagline, bullets */}
            <View style={s.huntHeadRow}>
              <MaterialIcons name="pets" size={18} color="#1A1A1A" />
              <Text style={s.huntHeadTitle}>Hunt Mode</Text>
            </View>
            <Text style={s.huntTagline}>Turn every thrift trip into a challenge.</Text>

            <View style={s.huntBullets}>
              <View style={s.huntBulletRow}>
                <View style={s.huntBulletDot} />
                <Text style={s.huntBulletText}>Earn XP</Text>
              </View>
              <View style={s.huntBulletRow}>
                <View style={s.huntBulletDot} />
                <Text style={s.huntBulletText}>Unlock new ranks</Text>
              </View>
              <View style={s.huntBulletRow}>
                <View style={s.huntBulletDot} />
                <Text style={s.huntBulletText}>Climb the Hunt Leaderboard</Text>
              </View>
            </View>

            <View style={s.huntRule} />

            {/* Rank reward — comes AFTER the pitch, framed as the payoff */}
            <View style={s.huntTop}>
              {/* Circular level icon — placeholder, prepared for future rank art */}
              <View style={s.huntIcon}>
                <MaterialIcons name="emoji-events" size={22} color={GOLD} />
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.huntRankRow}>
                  <Text style={s.huntRank} numberOfLines={1} ellipsizeMode="tail">
                    {currentRank.rank}
                  </Text>
                  <View style={s.huntRankDivider} />
                  <Text style={s.huntLevel}>Level {levelNum}</Text>
                </View>

                <View style={s.xpTrack}>
                  <View style={[s.xpFill, { width: `${xpProgress}%` }]} />
                </View>
                <Text style={s.xpText}>{xpText}</Text>
              </View>
            </View>

            <Pressable
              onPress={() => go('/hunt')}
              style={({ pressed }) => [s.huntBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.huntBtnText}>Start Hunting</Text>
              <MaterialIcons name="arrow-forward" size={15} color={CREAM} />
            </Pressable>
          </View>
        </Animated.View>

        {/* ── 6. ARTICLES & GUIDES ── */}
        <Animated.View entering={FadeInUp.delay(320).duration(400)}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Articles & Guides</Text>
            <View style={s.sectionRule} />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.articlesScroll}
          >
            {CONTENT_CARDS.map(c => (
              <Pressable
                key={c.id}
                onPress={() => go(c.route)}
                style={({ pressed }) => [s.articleCard, pressed && { opacity: 0.85 }]}
              >
                <View style={[s.articleBadge, { backgroundColor: c.tint }]}>
                  <MaterialIcons name={c.icon} size={17} color={c.iconColor} />
                </View>
                <Text style={s.articleTitle} numberOfLines={2} ellipsizeMode="tail">{c.title}</Text>
                <Text style={s.articleSub} numberOfLines={2} ellipsizeMode="tail">{c.subtitle}</Text>
                <View style={s.articleReadRow}>
                  <Text style={s.articleRead}>Read</Text>
                  <MaterialIcons name="arrow-forward" size={12} color={GOLD} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>

      </ScrollView>

      {/* ── Profile menu (Profile / Settings) ── */}
      <Modal
        visible={showProfileMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfileMenu(false)}
      >
        <Pressable style={s.menuBackdrop} onPress={() => setShowProfileMenu(false)}>
          <View style={[s.menuCard, { top: insets.top + 58 }]}>
            <Pressable
              onPress={() => openFromMenu('/(tabs)/profile')}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: INNER }]}
            >
              <MaterialIcons name="person" size={18} color={GREEN} />
              <Text style={s.menuText}>Profile</Text>
            </Pressable>
            <View style={s.menuDivider} />
            <Pressable
              onPress={() => openFromMenu('/(tabs)/settings')}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: INNER }]}
            >
              <MaterialIcons name="settings" size={18} color={GREEN} />
              <Text style={s.menuText}>Settings</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── Scans remaining modal (existing behavior, unchanged) ── */}
      <Modal
        visible={showScanModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowScanModal(false)}
      >
        <Pressable style={sm.backdrop} onPress={() => setShowScanModal(false)}>
          <Pressable style={sm.card} onPress={e => e.stopPropagation()}>
            <View style={sm.header}>
              <MaterialIcons name="bolt" size={22} color={GOLD} />
              <Text style={sm.title}>Scans Remaining</Text>
            </View>

            <Text style={sm.count}>{scanCountText}</Text>
            <Text style={sm.subtitle}>Daily Scans{'\n'}Remaining Today</Text>

            <View style={sm.divider} />

            <Text style={sm.body}>
              You get 7 scans per day. Each item you scan uses one. Your scans reset every day at midnight.
            </Text>

            {(isLow || isZero) && (
              <View style={sm.warningRow}>
                <MaterialIcons name="info-outline" size={14} color="#B85450" />
                <Text style={sm.warningText}>
                  {isZero
                    ? "You've used all 7 free scans for today. Your scans reset tomorrow."
                    : 'Running low on your free scans for today.'}
                </Text>
              </View>
            )}

            <Pressable
              onPress={() => setShowScanModal(false)}
              style={({ pressed }) => [sm.dismissBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={sm.dismissText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },

  // Header
  headerBand: {
    backgroundColor: WHITE,
    paddingHorizontal: 16, paddingBottom: 6,
    zIndex: 10,
  },
  headerDivider: { height: 1, backgroundColor: BORDER },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 68,
  },
  headerTitleWrap: { position: 'absolute', left: -14, right: 14, alignItems: 'center' },
  headerTitle:     { fontFamily: FONTS.serif, fontSize: 28, fontWeight: '800', color: GREEN },
  headerSub:       { fontSize: 10, fontWeight: '800', color: GOLD, letterSpacing: 2.4, marginTop: 3 },
  profileBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', zIndex: 2,
    marginLeft: 14,
  },
  scanPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: HERO_DARK, borderRadius: 11,
    paddingLeft: 8, paddingRight: 6, paddingVertical: 5, zIndex: 2,
    shadowColor: DARK, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3, elevation: 2,
  },
  scanPillLow:     { backgroundColor: WARN },
  scanPillTextWrap:{ alignItems: 'flex-start' },
  scanPillNum:     { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: CREAM, lineHeight: 15 },
  scanPillLabel:   { fontSize: 7, fontWeight: '700', color: 'rgba(244,238,216,0.85)', marginTop: -1 },

  // Welcome
  welcome: {
    fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', fontStyle: 'italic', color: DARK,
    marginHorizontal: 18, marginTop: 4, marginBottom: 16,
  },

  // Hero — dark green (art-sampled), fused to the steps strip beneath
  hero: {
    backgroundColor: HERO_DARK,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    marginHorizontal: 16,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 13,
    overflow: 'hidden', alignItems: 'center',
    shadowColor: '#0A1A0A', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  heroDashed: {
    position: 'absolute', top: 8, left: 8, right: 8, bottom: 0,
    borderTopWidth: 1.2, borderLeftWidth: 1.2, borderRightWidth: 1.2,
    borderColor: 'rgba(196,163,52,0.5)', borderStyle: 'dashed',
    borderTopLeftRadius: 15, borderTopRightRadius: 15,
    zIndex: 3,
  },
  heroArt:   { width: '54%', height: IS_SMALL ? 88 : 104, marginBottom: 3 },
  heroTitle: { fontFamily: FONTS.serif, fontSize: IS_SMALL ? 23 : 26, fontWeight: '800', color: CREAM, marginBottom: 3 },
  heroSub:   { fontSize: 11, lineHeight: 15, color: 'rgba(244,238,216,0.85)', textAlign: 'center', marginBottom: 10, maxWidth: '86%' },
  heroCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: CREAM, borderRadius: 50, paddingVertical: 8, paddingHorizontal: 20,
    borderWidth: 1, borderColor: 'rgba(196,163,52,0.4)',
  },
  heroCtaText: { fontFamily: FONTS.serif, fontSize: 12.5, fontWeight: '800', color: GREEN },

  // Steps strip — attached to the hero's bottom edge
  stepsStrip: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: CARD,
    borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
    borderWidth: 1, borderColor: BORDER, borderTopWidth: 0,
    paddingVertical: 12, paddingHorizontal: 4,
    shadowColor: DARK, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  stepItem:    { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 6, position: 'relative' },
  stepDivider: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 1, backgroundColor: BORDER },
  stepBadge: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: INNER,
    borderWidth: 1, borderColor: 'rgba(196,163,52,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepTitle: { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: GREEN },
  stepDesc:  { fontSize: 8.5, lineHeight: 11.5, color: MUTED, fontWeight: '600', textAlign: 'center' },

  // Hunt Mode teaser card — explains + sells the mode, THEN shows rank reward
  huntCard: {
    backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER,
    marginHorizontal: 16, marginTop: IS_SMALL ? 14 : 18, padding: 16, gap: 10,
    shadowColor: DARK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
    overflow: 'hidden',
  },
  huntHeadRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  huntHeadTitle: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: DARK },
  huntTagline:   { fontSize: 12, fontWeight: '600', fontStyle: 'italic', color: BROWN, marginTop: -4 },
  huntBullets:   { gap: 6 },
  huntBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  huntBulletDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: GOLD },
  huntBulletText:{ fontSize: 12.5, fontWeight: '700', color: DARK },
  huntRule:      { height: 1, backgroundColor: BORDER, marginVertical: 1 },
  huntTop: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  huntIcon: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: INNER,
    borderWidth: 1.5, borderColor: 'rgba(196,163,52,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  huntRankRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  huntRank:    { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: '800', color: DARK, flexShrink: 1 },
  huntRankDivider: { width: 1, height: 14, backgroundColor: BORDER },
  huntLevel:   { fontSize: 12, fontWeight: '700', color: MUTED },
  xpTrack: {
    height: 7, backgroundColor: INNER, borderRadius: 4, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER,
  },
  xpFill: { height: '100%', backgroundColor: GREEN, borderRadius: 4 },
  xpText: { fontSize: 10.5, fontWeight: '700', color: MUTED, marginTop: 5 },
  huntBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: GREEN, borderRadius: 12, paddingVertical: 13,
  },
  huntBtnText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: CREAM },

  // Articles & Guides
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 18, marginTop: IS_SMALL ? 18 : 22, marginBottom: 11,
  },
  sectionTitle: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: DARK },
  sectionRule:  { flex: 1, height: 1, backgroundColor: BORDER },
  articlesScroll: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  articleCard: {
    width: 158, backgroundColor: CARD, borderRadius: 15, borderWidth: 1, borderColor: BORDER,
    padding: 12, gap: 6,
    shadowColor: DARK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2,
  },
  articleBadge: {
    width: 32, height: 32, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  articleTitle: { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: '800', color: DARK, lineHeight: 17 },
  articleSub:   { fontSize: 10, lineHeight: 13.5, color: MUTED, fontWeight: '600' },
  articleReadRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  articleRead:    { fontSize: 11, fontWeight: '800', color: GOLD },

  // Profile menu
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(20,14,8,0.25)' },
  menuCard: {
    position: 'absolute', left: 16, width: 168,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
    shadowColor: DARK, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.16, shadowRadius: 14, elevation: 8,
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 15, paddingVertical: 13,
  },
  menuText:    { fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: '700', color: DARK },
  menuDivider: { height: 1, backgroundColor: BORDER, marginHorizontal: 12 },
});

// ─── Scans modal styles ────────────────────────────────────────────────────────

const sm = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(20,14,8,0.5)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36,
  },
  card: {
    backgroundColor: CARD, borderRadius: 22, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 24, paddingVertical: 24, width: '100%', maxWidth: 360,
    alignItems: 'center',
    shadowColor: DARK, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
  },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  title:    { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', color: DARK },
  count:    { fontFamily: FONTS.serif, fontSize: 46, fontWeight: '800', color: GREEN, lineHeight: 52 },
  subtitle: { fontSize: 12, fontWeight: '700', color: MUTED, textAlign: 'center', lineHeight: 16, marginTop: 2 },
  divider:  { height: 1, backgroundColor: BORDER, alignSelf: 'stretch', marginVertical: 15 },
  body:     { fontSize: 13, lineHeight: 19, color: BROWN, textAlign: 'center' },
  warningRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: '#F7E9E4', borderWidth: 1, borderColor: '#E3B8B4', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, marginTop: 13,
  },
  warningText: { flex: 1, fontSize: 11.5, lineHeight: 15.5, color: '#8A3A2A', fontWeight: '600' },
  dismissBtn: {
    marginTop: 17, backgroundColor: GREEN, borderRadius: 50,
    paddingVertical: 12, paddingHorizontal: 44,
  },
  dismissText: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: CREAM },
});