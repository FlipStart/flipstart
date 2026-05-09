import { useState, useEffect, useCallback } from 'react';
import { Text, View, StyleSheet, Alert, ScrollView, FlatList, Platform, ImageBackground, Pressable, Image, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  withRepeat,
  Easing,
} from 'react-native-reanimated';

import { ScreenContainer } from '@/components/screen-container';
import { HomeHeader } from '@/components/home/HomeHeader';
import { ScanCTA } from '@/components/home/ScanCTA';
import { FeatureCard } from '@/components/home/FeatureCard';
import { SectionHeader } from '@/components/home/SectionHeader';
import { FlipCard, type FlipCardData } from '@/components/home/FlipCard';
import { ArticleCard, type ArticleCardData } from '@/components/home/ArticleCard';
import { PhotoReview } from '@/components/home/PhotoReview';
import { V } from '@/constants/vintage';
import { captureFromCamera, captureMultipleFromGallery, type CapturedPhoto, type CapturedPhotoSet } from '@/lib/capture';
import { consumePendingCaptureSet } from '@/lib/pending-capture-set';
import { setPendingScan } from '@/lib/pending-scan';
import { logEvent } from '@/lib/analytics';
import { registerCaptureListener, unregisterCaptureListener } from '@/lib/capture-event';
import { trpc } from '@/lib/trpc';
import { isOnboardingComplete, completeOnboarding, getUserMode, setUserMode, type UserMode } from '@/lib/onboarding-storage';
import { ModeToggle } from '@/components/home/ModeToggle';

// ─── Background image (hanger / clothing lifestyle photo) ────────────────────
const BG_IMAGE_URL =
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663494407970/gaMDCnzoMJG8V9dwmhqrAK/flipstart-bg-Qs6A8FzK7XtL97Ca6AEdJU.webp';

// ─── Mock data ─────────────────────────────────────────────────────────────────

const TOP_FLIPS: FlipCardData[] = [
  { rank: 61, countryCode: 'US', userName: 'William', itemName: 'Akira Vintage Jeans',       thriftPrice: 3,  soldPrice: 200 },
  { rank: 58, countryCode: 'GB', userName: 'Sophie',  itemName: 'Ralph Lauren Polo Vintage', thriftPrice: 4,  soldPrice: 85  },
  { rank: 44, countryCode: 'CA', userName: 'Marcus',  itemName: "Levi's 501 Deadstock",      thriftPrice: 8,  soldPrice: 140 },
];

const ARTICLES: ArticleCardData[] = [
  { id: 'a1', title: 'Thrift Stores Selling Hot Brands',    priceBadge: '$75',  badgeVariant: 'green', sourcePrice: '$75',  sourceName: 'ALFWACIEN \xb7 TCIY'   },
  { id: 'a2', title: 'Spotting Fake Designer Items',         priceBadge: 'FAKE', badgeVariant: 'red',   sourcePrice: '$120', sourceName: 'ALKIRA LARILERNESS' },
  { id: 'a3', title: 'Best Platforms for Flipping in 2025', priceBadge: 'NEW',  badgeVariant: 'gold',  sourcePrice: '$0',   sourceName: 'FLIPSTART GUIDES'   },
];

// ─── Hunt Mode Bar ────────────────────────────────────────────────────────────
// Compact secondary bar that sits flush under the Scan Item card, forming a
// single visual module. Structured to accept real navigation later.

// ─── Hunt Mode ────────────────────────────────────────────────────────────────
//
// #162D1A — deep eerie predator green. Darker and more sinister than ScanCTA.
// Same green family but pushed toward shadow/forest, not brand/clean.

const HUNT_BG        = '#162D1A';  // deep eerie green — predator dark
const HUNT_PARCHMENT = '#D6C8A3';  // aged cream — lion artwork interior
const HUNT_GOLD      = '#BE9C2C';  // gold — lion artwork frame accent

const LION_IMAGE = require('@/assets/images/hunt-lion.png');

// Place lion roar at: assets/images/lion-roar.m4a
const ROAR_SOUND = require('@/assets/images/lion-roar.m4a');

function HuntModeBar({ onPress }: { onPress: () => void }) {
  const player = useAudioPlayer(ROAR_SOUND);

  const handlePress = () => {
    // Play roar then call original onPress
    player.seekTo(0);
    player.play();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        hm.strip,
        pressed && { opacity: 0.75 },
      ]}
    >
      {/* ── Claw marks — three diagonal scratches across the strip ──────── */}
      {/* Claw 1 — leftmost, slightly steeper */}
      <View style={hm.claw1} />
      {/* Claw 2 — middle */}
      <View style={hm.claw2} />
      {/* Claw 3 — rightmost, slightly shallower */}
      <View style={hm.claw3} />

      {/* Lion icon */}
      <View style={hm.iconFrame}>
        <View style={hm.iconInner}>
          <Image source={LION_IMAGE} style={hm.lionImage} resizeMode="cover" />
        </View>
      </View>

      {/* Separator */}
      <View style={hm.divider} />

      {/* Text */}
      <View style={hm.textBlock}>
        <Text style={hm.title}>Enter Hunt Mode</Text>
        <Text style={hm.subtitle}>Track your full store haul</Text>
      </View>

      {/* NEW + chevron */}
      <View style={hm.rightGroup}>
        <View style={hm.newPill}>
          <Text style={hm.newPillText}>NEW</Text>
        </View>
        <Text style={hm.chevron}>›</Text>
      </View>

      {/* ── Safari grass — tall reeds growing from the bottom edge ────────── */}
      {/* Left cluster */}
      <View style={[hm.blade, { left: 18,  height: 18, transform: [{ rotate: '-8deg'  }] }]} />
      <View style={[hm.blade, { left: 24,  height: 22, transform: [{ rotate: '4deg'   }] }]} />
      <View style={[hm.blade, { left: 30,  height: 16, transform: [{ rotate: '-3deg'  }] }]} />
      {/* Mid-left cluster */}
      <View style={[hm.blade, { left: 72,  height: 14, transform: [{ rotate: '6deg'   }] }]} />
      <View style={[hm.blade, { left: 78,  height: 19, transform: [{ rotate: '-5deg'  }] }]} />
      {/* Right cluster */}
      <View style={[hm.blade, { right: 60, height: 17, transform: [{ rotate: '7deg'   }] }]} />
      <View style={[hm.blade, { right: 66, height: 21, transform: [{ rotate: '-4deg'  }] }]} />
      <View style={[hm.blade, { right: 72, height: 13, transform: [{ rotate: '3deg'   }] }]} />
    </Pressable>
  );
}

const hm = StyleSheet.create({
  strip: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   HUNT_BG,
    paddingVertical:   10,
    paddingHorizontal: 14,
    gap:               12,
    overflow:          'hidden',
  },

  // ── Claw marks — three long diagonal scratches in the top-right area ──────
  // Each is a thin rotated View, slightly offset so they fan like real claws.
  // rgba white at low opacity so they read as surface scratches, not paint.
  claw1: {
    position:        'absolute',
    top:             -4,
    right:           52,
    width:           40,
    height:          1.2,
    borderRadius:    1,
    backgroundColor: 'rgba(255,255,255,0.22)',
    transform:       [{ rotate: '70deg' }],
  },
  claw2: {
    position:        'absolute',
    top:             -4,
    right:           40,
    width:           40,
    height:          1.2,
    borderRadius:    1,
    backgroundColor: 'rgba(255,255,255,0.16)',
    transform:       [{ rotate: '70deg' }],
  },
  claw3: {
    position:        'absolute',
    top:             -4,
    right:           28,
    width:           40,
    height:          1.2,
    borderRadius:    1,
    backgroundColor: 'rgba(255,255,255,0.11)',
    transform:       [{ rotate: '70deg' }],
  },

  iconFrame: {
    width:           36,
    height:          36,
    borderRadius:    8,
    backgroundColor: HUNT_GOLD,
    padding:         2,
  },
  iconInner: {
    width:           32,
    height:          32,
    borderRadius:    5,
    backgroundColor: HUNT_PARCHMENT,
    overflow:        'hidden',
  },
  lionImage: {
    width:  32,
    height: 32,
  },
  divider: {
    width:           1,
    height:          22,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  textBlock: {
    flex: 1,
    gap:  1,
  },
  title: {
    fontSize:      14,
    fontWeight:    '700',
    color:         '#ECE7D3',
    letterSpacing: 0.1,
  },
  subtitle: {
    fontSize:   12,
    color:      'rgba(255,255,255,0.55)',
    lineHeight: 16,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  newPill: {
    backgroundColor:   HUNT_GOLD,
    paddingHorizontal: 7,
    paddingVertical:   3,
    borderRadius:      5,
  },
  newPillText: {
    fontSize:      9,
    fontWeight:    '800',
    color:         '#3D2A12',
    letterSpacing: 0.6,
  },
  chevron: {
    fontSize:    16,
    color:       'rgba(255,255,255,0.40)',
    lineHeight:  18,
    marginRight: 1,
  },

  // Safari grass blades — thin reeds anchored to bottom edge
  blade: {
    position:        'absolute',
    bottom:          0,
    width:           2.5,
    borderRadius:    2,
    backgroundColor: '#2A5A1A',
    opacity:         0.55,
  },
});

// ─── Component ─────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();

  // Onboarding overlay — null = checking, true = show onboarding, false = skip
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  // User mode — loaded from storage, defaults to onboarding choice or 'resell'
  const [userMode,   setUserModeState] = useState<UserMode>('resell');
  const [modeOpen,   setModeOpen]       = useState(false);

  useEffect(() => {
    // Load onboarding status and saved mode in parallel
    Promise.all([isOnboardingComplete(), getUserMode()]).then(([done, savedMode]) => {
      if (savedMode) setUserModeState(savedMode);
      setShowOnboarding(!done);
    });
  }, []);

  // ScanBalancePill fetches its own scan stats — no query needed here

  const handleModeChange = (mode: UserMode) => {
    setUserModeState(mode);
    setUserMode(mode);  // persist immediately
  };

  const [photoSet, setPhotoSet] = useState<CapturedPhotoSet | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // ── Register direct capture listener ────────────────────────────────────────
  // The tab bar center button calls dispatchCapturedPhoto(photo) which hits
  // this listener immediately — no focus change required.
  useEffect(() => {
    registerCaptureListener((photo) => {
      // Fallback path only — fires if dispatchCapturedPhoto() is called
      // from legacy code. The new camera/gallery flow uses setPendingCaptureSet
      // + useFocusEffect instead, so this should rarely trigger.
      // Only set if no photoSet is already pending (don't override multi-photo set).
      setPhotoSet((current) => current ?? { front: photo });
      setIsAnalyzing(false);
    });
    return () => {
      unregisterCaptureListener();
    };
  }, []);

  // ── Consume pending photo set when returning from /camera screen ──────────
  // This is the critical bridge: camera.tsx calls setPendingCaptureSet(),
  // then router.back(). useFocusEffect fires when home regains focus and
  // reads the stored set.
  useFocusEffect(
    useCallback(() => {
      const set = consumePendingCaptureSet();
      if (set?.front) {
        console.log('[home] consumed pending photo set — front✓ detail:', !!set.detail, 'tag:', !!set.tag);
        setPhotoSet(set);
        setIsAnalyzing(false);
      }
    }, [])
  );

  // ── Dollar tag wiggle: wiggle → wait 2s → wiggle → loop ─────────────────
  const tagRotate = useSharedValue(0);
  useEffect(() => {
    // One wiggle = quick left-right-left shake (3 steps, 80ms each)
    const wiggle = () =>
      withSequence(
        withTiming(-14, { duration: 80,  easing: Easing.out(Easing.quad) }),
        withTiming( 14, { duration: 80,  easing: Easing.inOut(Easing.quad) }),
        withTiming(-10, { duration: 70,  easing: Easing.inOut(Easing.quad) }),
        withTiming( 10, { duration: 70,  easing: Easing.inOut(Easing.quad) }),
        withTiming(  0, { duration: 60,  easing: Easing.out(Easing.quad) })
      );

    // wiggle immediately, then every (wiggleDuration + 2s) ms repeat
    tagRotate.value = withRepeat(
      withSequence(
        wiggle(),
        withDelay(2000, withTiming(0, { duration: 0 })) // 2s pause then reset
      ),
      -1, // infinite
      false
    );
  }, []);

  const tagAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${12 + tagRotate.value}deg` }, // base tilt (12deg) + wiggle offset
    ],
  }));

  // ── Scan CTA handler ──────────────────────────────────────────────────────
  const handleScanItem = () => {
    console.log('[home] Scan Item pressed -> opening custom camera');
    router.push('/camera' as any);
  };

  // ── Review actions ────────────────────────────────────────────────────────
  const handleRetake = () => {
    setPhotoSet(null);
    setIsAnalyzing(false);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleAnalyze = () => {
    if (!photoSet?.front || isAnalyzing) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    const primary = photoSet.front!;  // non-null: guarded by the check above
    setIsAnalyzing(true);

    // Analytics: scan started — fire-and-forget, never blocks
    try {
      logEvent("scan_started", {
        tagPresent:    !!photoSet.tag?.base64,
        detailPresent: !!photoSet.detail?.base64,
      });
    } catch { /* never block scan */ }

    setPendingScan({
      front: { base64: primary.base64, mimeType: primary.mimeType },
      ...(photoSet.detail?.base64 ? { detail: { base64: photoSet.detail.base64, mimeType: photoSet.detail.mimeType } } : {}),
      ...(photoSet.tag?.base64    ? { tag:    { base64: photoSet.tag.base64,    mimeType: photoSet.tag.mimeType    } } : {}),
    });

    const imageUri = primary.uri;
    const mimeType = primary.mimeType;
    setPhotoSet(null);

    router.push({
      pathname: '/loading' as any,
      params: { imageUri, mimeType },
    });
  };

  // ─── Photo review ──────────────────────────────────────────────────────────
  if (photoSet?.front) {
    return (
      <PhotoReview
        photoSet={photoSet}
        onAnalyze={handleAnalyze}
        onRetake={handleRetake}
        isAnalyzing={isAnalyzing}
        onPhotoSetUpdate={(updated) => setPhotoSet(updated)}
      />
    );
  }

  // ─── Home feed ─────────────────────────────────────────────────────────────
  return (
    <ScreenContainer>
      <HomeHeader
        onSettingsPress={() => router.push('/(tabs)/settings' as any)}
        onModeToggle={() => setModeOpen(v => !v)}
        modeOpen={modeOpen}
      />
      {/* Collapsible mode toggle — slides in under header when modeOpen */}
      {modeOpen && <ModeToggle value={userMode} onChange={handleModeChange} />}

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome hero — hanger image behind header + welcome text only */}
        <ImageBackground
          source={{ uri: BG_IMAGE_URL }}
          style={s.heroBg}
          imageStyle={s.heroBgImage}
          blurRadius={3}
          resizeMode="cover"
        >
          {/* Semi-transparent cream wash keeps text crisp */}
          <View style={s.heroOverlay}>
            <View style={s.welcomeBlock}>
              {/* Text takes flex:1 so the tag doesn't wrap it */}
              <View style={s.welcomeTextWrap}>
                <Text style={s.welcomeText}>{"Welcome! Ready to\nflip thrifted finds?"}</Text>
              </View>
              {/* Decorative $ tag — gold, slightly rotated, brand detail */}
              <View style={s.dollarTagWrap}>
                <Animated.View style={[s.dollarTag, tagAnimStyle]}>
                  <Text style={s.dollarTagText}>$</Text>
                </Animated.View>
              </View>
            </View>
          </View>
        </ImageBackground>


        {/* ── Scan module — one unified rounded container ─────────────────── */}
        {/* Single outer View owns borderRadius + shadow + marginHorizontal.   */}
        {/* ScanCTA attached=true removes its own margin/bottom-radius.        */}
        {/* HuntModeBar has no radius at all — container clips it.             */}
        <View style={s.scanModule}>
          <ScanCTA onPress={handleScanItem} attached />
          {/* Thin warm gold separator — visually links but distinguishes the two */}
          <View style={s.scanHuntDivider} />
          <HuntModeBar onPress={() => Alert.alert('Hunt Mode', 'Coming soon — track your full store haul!')} />
        </View>

        <View style={s.gap} />

        {/* 3 — Flip Feed */}
        <FeatureCard
          title="Flip Feed"
          subtitle="See what other flippers are scoring right now."
          iconName="dynamic-feed"
          accentColor={V.gold}
          onPress={() => Alert.alert('Flip Feed', 'Coming soon!')}
        />

        <View style={s.gap} />

        {/* 4 — Top Flips This Week */}
        <SectionHeader title="Top Flips This Week" pillLabel="USA" />
        <View style={s.flipList}>
          {TOP_FLIPS.map((flip) => (
            <FlipCard key={flip.rank} data={flip} />
          ))}
        </View>

        <View style={s.gap} />

        {/* 5 — Articles & Guides */}
        <SectionHeader title="Articles & Guides" pillLabel="Global" />
        <FlatList
          data={ARTICLES}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.articlesRow}
          renderItem={({ item }) => <ArticleCard data={item} onPress={() => {}} />}
        />

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Onboarding modal — Modal renders at native root so tab bar stays visible */}
      <Modal
        visible={showOnboarding === true}
        animationType="fade"
        statusBarTranslucent
      >
        <OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
      </Modal>
    </ScreenContainer>
  );
}

// ─── Inline onboarding overlay ────────────────────────────────────────────────

function OnboardingOverlay({ onComplete }: { onComplete: () => void }) {
  const [step,   setStep]   = useState<1 | 2>(1);
  const [mode,   setMode]   = useState<'resell' | 'personal' | null>(null);
  const [saving, setSaving] = useState(false);

  const BG     = '#F0E8D4';
  const CARD   = '#FFF9EE';
  const CARD_B = '#DDD0B0';
  const FOREST = '#2A4A2A';
  const GOLD   = '#BE9C2C';
  const MUTED  = '#8A7050';
  const CREAM  = '#F4EED8';
  const BROWN  = '#5A3A1A';

  const handleFinish = async () => {
    if (saving) return;
    setSaving(true);
    await completeOnboarding(mode ?? 'resell');
    onComplete();
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG, justifyContent: 'center', paddingHorizontal: 24 }}>

      <View style={{ alignItems: 'center', gap: 4, marginBottom: 32 }}>
        <Text style={{ fontSize: 32, fontWeight: '800', color: FOREST }}>FlipStart</Text>
        <Text style={{ fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2 }}>✦ THRIFT INTELLIGENCE ✦</Text>
      </View>

      {step === 1 ? (
        <>
          <View style={{ alignItems: 'center', gap: 8, marginBottom: 28 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: FOREST, textAlign: 'center', lineHeight: 30 }}>
              {'What are you using\nFlipStart for?'}
            </Text>
            <Text style={{ fontSize: 14, color: MUTED, textAlign: 'center' }}>Choose how you want the app to help you.</Text>
          </View>
          {([
            { m: 'resell'   as const, icon: '📈', label: 'Flip for Profit',  desc: 'Check resale value, profit, comps, and sell speed' },
            { m: 'personal' as const, icon: '🛍️', label: 'Buy for Myself',   desc: 'See if an item is worth the price' },
          ]).map(item => (
            <Pressable
              key={item.m}
              onPress={() => { setMode(item.m); setStep(2); }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 14,
                backgroundColor: pressed ? '#F5EDDA' : CARD,
                borderRadius: 16, borderWidth: 1.5, borderColor: pressed ? GOLD : CARD_B,
                padding: 18, marginBottom: 12,
              })}
            >
              <Text style={{ fontSize: 28 }}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: FOREST, marginBottom: 3 }}>{item.label}</Text>
                <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>{item.desc}</Text>
              </View>
              <Text style={{ fontSize: 18, color: GOLD }}>{'›'}</Text>
            </Pressable>
          ))}
          <Text style={{ fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 8 }}>You can change this later in Settings.</Text>
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', marginBottom: 28 }}>
            <View style={{ width: 96, height: 96, borderRadius: 24, backgroundColor: GOLD + '18', borderWidth: 1.5, borderColor: GOLD + '40', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
              <Text style={{ fontSize: 44 }}>📷</Text>
            </View>
            <Text style={{ fontSize: 28, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 12 }}>Scan. Decide. Profit.</Text>
            <Text style={{ fontSize: 15, color: BROWN, textAlign: 'center', lineHeight: 22 }}>Scan any item to instantly see value, profit, and whether it's worth buying.</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 36 }}>
            {[
              { icon: '⚡', label: 'Instant\nAnalysis' },
              { icon: '💰', label: 'Resale\nValue'    },
              { icon: '👍', label: 'Buy /\nSkip'       },
            ].map(f => (
              <View key={f.label} style={{ alignItems: 'center', gap: 8 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: FOREST + '10', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 20 }}>{f.icon}</Text>
                </View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: FOREST, textAlign: 'center' }}>{f.label.replace('\\n', '\n')}</Text>
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
        </>
      )}
    </View>
  );
}


// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:        { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  // ── Hero background (header + welcome only) ──────────────────────────────
  heroBg: {
    width: '100%',
  },
  heroBgImage: {
    opacity: 0.13,       // subtle — visible but never fights text
  },
  heroOverlay: {
    backgroundColor: 'rgba(246, 241, 232, 0.74)',  // cream wash for readability
  },

  // ── Welcome block ──────────────────────────────────────────────────────────
  welcomeBlock: {
    paddingHorizontal: V.screenPad,
    paddingTop: 14,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  welcomeTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  welcomeText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#3D2A12',
    lineHeight: 34,
    letterSpacing: -0.4,
  },

  // ── Dollar tag decoration ──────────────────────────────────────────────────
  dollarTagWrap: {
    paddingTop: 4,  // align with first line of welcome text
  },
  dollarTag: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: V.gold,       // Vintage Gold swatch
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '12deg' }],
    // Depth so it sits above the background
    shadowColor: '#8A7050',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.30,
    shadowRadius: 6,
    elevation: 4,
  },
  dollarTagText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ECE7D3',
    letterSpacing: -0.5,
  },
  gap:         { height: 20 },
  flipList:    { gap: 10 },
  articlesRow: { paddingHorizontal: V.screenPad, gap: 12 },

  // Single container owns all geometry for the scan+hunt module.
  // ScanCTA renders with attached=true (no own margin/bottom-radius).
  // HuntModeBar renders with no radius — this container clips everything.
  scanModule: {
    marginHorizontal: V.screenPad,
    borderRadius:     16,
    overflow:         'hidden',
    shadowColor:      '#3D2A12',
    shadowOffset:     { width: 0, height: 5 },
    shadowOpacity:    0.28,
    shadowRadius:     14,
    elevation:        7,
  },
  // Warm gold separator line between Scan Item and Hunt Mode
  // Matches the gold accent in the lion artwork and the $ tag
  scanHuntDivider: {
    height:          1,
    backgroundColor: '#C49332',
    opacity:         0.55,
  },
});