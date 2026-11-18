/**
 * app/hunt.tsx
 *
 * Hunt Mode entry screen — accessed ONLY from the Home screen "Enter Hunt Mode" button.
 * Stack screen (fullScreenModal), NOT a tab.
 *
 * Hunt Name input uses a popup modal so the keyboard never covers the card.
 * Start Hunt is the ONLY way to enter Live Hunt.
 */

import {
  View, Text, TextInput, Pressable, StyleSheet,
  Animated, Platform, Keyboard,
  Modal, TouchableWithoutFeedback, Dimensions, Alert, AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRef, useState, useEffect } from 'react';

import { startHunt, isHuntActive, subscribeToHunt } from '@/lib/hunt-context';
import { useAuth } from '@/lib/auth-context';
import { logHuntModeOpened, logHuntStarted } from '@/lib/analytics';
import { useHuntOnboarding } from '@/lib/useHuntOnboarding';
import { HuntGlowRing } from '@/components/hunt/HuntGlowRing';
import { HuntWelcome } from '@/components/hunt/onboarding/HuntWelcome';
import { launchHuntDemoResult, DEMO_HUNT_NAME } from '@/lib/huntDemoLaunch';
import {
  logHuntOnboardingOffered, logHuntOnboardingSkipped, logHuntOnboardingReplayed,
} from '@/lib/huntOnboardingAnalytics';
import { devResetHuntOnboarding } from '@/lib/huntOnboarding';
import { isHuntDemoActive } from '@/lib/huntDemoMode';
import { advanceCoach, getCoachState, LEADERBOARD_LIVE } from '@/lib/huntDemoCoach';
import { beginDemoHuntSession, endDemoHunt } from '@/lib/huntDemoSession';
import { CoachOverlay } from '@/components/hunt/onboarding/coach/CoachOverlay';
import { useCoachRef } from '@/components/hunt/onboarding/coach/coachTargets';
import { FONTS } from '@/constants/typography';
import { HUNT_BG, HUNT_TITLE, isHuntArtReady } from '@/lib/huntArt';

// ─── Assets ───────────────────────────────────────────────────────────────────

// Both images live in lib/huntArt so the tab bar can load them before this screen opens.
const BG_IMAGE    = HUNT_BG;
// "HUNT MODE" + paw divider, drawn as its own layer on top of the background
// (the background no longer contains them). Rendered at 3x for crisp edges.
const TITLE_IMAGE = HUNT_TITLE;

// Background image size, and where the title layer sits on it (in background
// image pixels). The background uses resizeMode="cover", so the title is placed
// with the same cover math to stay locked to the artwork on every iPhone size.
// If either image is ever re-exported at a different size, update these.
const BG_W = 853;
const BG_H = 1844;
const TITLE_RECT = { x: 215, y: 640, w: 430, h: 425 };
const ROAR_SOUND = require('@/assets/images/lion-roar.m4a');

// ─── Palette ──────────────────────────────────────────────────────────────────

const FOREST      = '#1E3A1E';
const FOREST_DARK = '#142814';
const GOLD        = '#C4972A';
const CREAM       = '#F2E8D0';
const CREAM_DARK  = '#E0D0A8';
const CARD_BG     = 'rgba(242, 232, 208, 0.96)';
const TEXT_DARK   = '#2A1A0A';
const TEXT_MUTED  = '#6A5030';
const SCREEN_H    = Dimensions.get('window').height;
// Short phones (iPhone SE class). The leaderboard button + card would otherwise
// crowd up into the HUNT MODE title, so spacing tightens a little on these only.
// Normal iPhones are unaffected.
const COMPACT    = SCREEN_H < 700;

/**
 * Painted under the art. The navigator's own background is forest green (#214D2D,
 * app/_layout), which showed through as the screen opened. The art is normally
 * already loaded by now (lib/huntArt), so this is rarely seen; when it is, it is plain
 * white, a clean blank, not a coloured flash.
 */
const ART_UNDERLAY = '#FFFFFF';

// ─── Component ────────────────────────────────────────────────────────────────

export default function HuntScreen() {
  const router  = useRouter();
  const navigation = useNavigation();
  const { user, loading: authLoading } = useAuth();
  const insets  = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const player  = useAudioPlayer(ROAR_SOUND);
  // Gold glow on START HUNT while Hunt onboarding is unresolved (see lib/huntOnboarding).
  const onboarding = useHuntOnboarding();
  const huntAttention = onboarding.attention;
  // Guided demo spotlight targets (inert outside it).
  const coachNameRef  = useCoachRef('hunt-name');
  const coachStartRef = useCoachRef('hunt-start-btn');

  // ── Welcome (first intentional entry) and replay ──────────────────────────
  // The automatic welcome opens once per visit while onboarding is unresolved
  // (never offered, or skipped for now), and never while a hunt is running (that
  // case already redirects to Live Hunt). The info button replays it any time.
  const [welcome, setWelcome] = useState<null | 'offer' | 'replay'>(null);
  const welcomeOfferedRef = useRef(false);
  useEffect(() => {
    if (!user || !onboarding.autoOffer || welcomeOfferedRef.current || isHuntActive()) return;
    welcomeOfferedRef.current = true;
    setWelcome('offer');
    logHuntOnboardingOffered((onboarding.offerCount ?? 0) + 1);
    void onboarding.recordOffered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, onboarding.autoOffer]);

  // DEVELOPER ONLY (compiled out of release builds by __DEV__): forget this account's onboarding
  // so the welcome and dots come back. Touches nothing but the onboarding record.
  const handleDevReset = async () => {
    if (!user) return;
    const ok = await devResetHuntOnboarding(user.id);
    welcomeOfferedRef.current = false;
    Alert.alert(ok ? 'Onboarding reset' : 'Reset unavailable', ok
      ? 'Leave Hunt Mode and open it again: the welcome and the gold dots are back.'
      : 'Only works in a development build.');
  };

  const handleWelcomeSkip = (doNotShowAgain: boolean) => {
    if (welcome === 'offer') {
      logHuntOnboardingSkipped(doNotShowAgain);
      void onboarding.skipWelcome(doNotShowAgain);
    }
    setWelcome(null);                    // a replay's Close changes nothing
  };
  const handleWelcomeStartDemo = () => {
    // Changes no onboarding state: the welcome just steps aside and the coach takes over.
    const result = launchHuntDemoResult({ replay: welcome === 'replay' });
    if (result === 'real_hunt_active') {
      Alert.alert('Finish your Hunt first', "You have a Hunt in progress. The demo can't run on top of it, so it's waiting until you're done.");
      setWelcome(null);
      return;
    }
    if (result !== 'started') {
      Alert.alert("Demo unavailable", "The guided demo can't start right now. You can skip it and start a real Hunt.");
      return;
    }
    setWelcome(null);
    setHuntName(DEMO_HUNT_NAME);
  };

  // Confirmed hunt name shown on the card
  const [huntName, setHuntName] = useState('');
  // Draft inside the modal (discarded on Cancel, committed on Confirm)
  const [draft, setDraft]         = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [starting, setStarting]   = useState(false);

  const inputRef = useRef<TextInput>(null);
  const startedHereRef = useRef(false);

  // Track Hunt Mode screen open — fires once on mount
  useEffect(() => {
    // A demo left switched on with no coach is stale (it only lives in memory): clear it
    // so it can never stand in the way of a real Hunt.
    if (isHuntDemoActive() && !getCoachState().active) endDemoHunt();
    logHuntModeOpened();
  }, []);

  // A hunt is already running (including one restored after the app was
  // closed): go straight back to it. Starting a new one here would overwrite it.
  useEffect(() => {
    if (isHuntActive()) { router.replace('/hunt-active' as any); return; }
    return subscribeToHunt(() => {
      // startedHereRef: our own START HUNT already navigates — don't do it twice.
      if (isHuntActive() && !startedHereRef.current) router.replace('/hunt-active' as any);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Title layer position (same cover scaling as the background) ──────────
  const coverScale = Math.max(winW / BG_W, winH / BG_H);
  const titleStyle = {
    position: 'absolute' as const,
    left:   (winW - BG_W * coverScale) / 2 + TITLE_RECT.x * coverScale,
    top:    (winH - BG_H * coverScale) / 2 + TITLE_RECT.y * coverScale,
    width:  TITLE_RECT.w * coverScale,
    height: TITLE_RECT.h * coverScale,
  };

  // ── Screen entrance animation ──────────────────────────────────────────────
  // Art already loaded (normal case): the screen is fully there on its first frame and only
  // the card eases in. Otherwise it fades in once the art arrives.
  const artWasReady = useRef(isHuntArtReady()).current;
  const screenFade = useRef(new Animated.Value(artWasReady ? 1 : 0)).current;
  const cardSlide  = useRef(new Animated.Value(32)).current;

  const handleImageLoad = async () => {
    // Reduce Motion: the card is simply there, no slide and no fade.
    let reduceNow = false;
    try { reduceNow = !!(await AccessibilityInfo.isReduceMotionEnabled?.()); } catch { /* animate */ }
    if (reduceNow) { screenFade.setValue(1); cardSlide.setValue(0); return; }
    Animated.parallel([
      Animated.timing(screenFade, {
        toValue: 1, duration: 200, useNativeDriver: true,
      }),
      Animated.spring(cardSlide, {
        toValue: 0, tension: 72, friction: 12, useNativeDriver: true,
      }),
    ]).start();
  };

  useEffect(() => {
    if (artWasReady) { void handleImageLoad(); return; }
    // The art never reporting back must not leave the screen invisible.
    const t = setTimeout(() => { void handleImageLoad(); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Name popup ────────────────────────────────────────────────────────────
  const openModal = () => {
    setDraft(huntName);   // pre-fill with current confirmed value
    setModalVisible(true);
    // Auto-focus after modal animation settles
    setTimeout(() => inputRef.current?.focus(), 120);
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    setModalVisible(false);
    // draft is discarded — huntName unchanged
  };

  const handleConfirm = () => {
    Keyboard.dismiss();
    setHuntName(draft.trim());  // commit draft → card
    setModalVisible(false);
    // Does NOT start hunt. Does NOT navigate anywhere.
  };

  // ── Start Hunt ────────────────────────────────────────────────────────────
  const handleStartHunt = () => {
    if (starting) return;
    Keyboard.dismiss();
    setStarting(true);

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }

    try { player.seekTo(0); player.play(); } catch { /* never crash */ }

    startedHereRef.current = true;
    if (isHuntDemoActive()) {
      // Guided demo: an in-memory Hunt, no analytics, nothing stored.
      beginDemoHuntSession(huntName);
      advanceCoach('start');
      router.replace('/hunt-active' as any);
      setStarting(false);
      return;
    }
    const session = startHunt(huntName);
    logHuntStarted(session.id, huntName);
    if (__DEV__) console.log(`[hunt] session started — id:${session.id} name:"${session.name}"`);

    router.replace('/hunt-active' as any);
    setStarting(false);
  };

  // ── Hunt Leaderboard ──────────────────────────────────────────────────────
  // Opens app/hunt-leaderboard.tsx on top of this screen, so its Start Hunt
  // button and Back both land right back here. LEADERBOARD_LIVE (lib/huntDemoCoach)
  // is the one switch: off, this goes back to a "Coming soon" notice.
  // Never during the guided demo, which touches nothing real.
  const handleLeaderboard = () => {
    if (isHuntDemoActive()) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    if (!LEADERBOARD_LIVE) { Alert.alert('Hunt Leaderboard', 'Coming soon.'); return; }
    router.push({ pathname: '/hunt-leaderboard', params: { source: 'hunt' } } as any);
  };

  // Always return to Home. Hunt Mode is a stack route pushed over the tabs.
  // A plain replace('/(tabs)') lands on whatever tab is currently focused — and
  // after the gate→auth flow that's the hidden 'hunt-tab' route, which redirects
  // straight back into Hunt (the glitch). Resetting the root stack to a fresh
  // (tabs) reinitializes it to its first tab (Home), which is deterministic.
  const leavingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const handleBack = () => {
    if (leavingRef.current) return;          // one leave per tap, even if the button is hit twice
    leavingRef.current = true;
    if (isHuntDemoActive()) endDemoHunt();
    try {
      navigation.reset({ index: 0, routes: [{ name: '(tabs)' as never }] });
    } catch {
      router.replace('/(tabs)' as any); // safety fallback
    }
    // Still here a moment later? The move was dropped (founder report: the X did nothing after
    // coming back from the Leaderboard). Leave a second way - pop straight to Home - and re-arm
    // the button so the next tap always works too.
    setTimeout(() => {
      if (!mountedRef.current) return;
      try { if ((navigation as any).isFocused?.()) router.dismissTo('/' as any); } catch { /* the tap re-arms below */ }
      leavingRef.current = false;
    }, 600);
  };

  if (!authLoading && !user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F0E8D4', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <MaterialIcons name="travel-explore" size={48} color="#2A4A2A" style={{ marginBottom: 16 }} />
        <Text style={{ fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: '#2A4A2A', textAlign: 'center', marginBottom: 10 }}>
          Hunt Mode
        </Text>
        <Text style={{ fontSize: 14, color: '#8A7050', textAlign: 'center', lineHeight: 21, marginBottom: 28 }}>
          Track XP, rank up, and save your hunt progress across every session. Requires a free FlipStart account.
        </Text>
        <Pressable
          onPress={() => router.push('/auth' as any)}
          style={{ backgroundColor: '#152815', borderRadius: 50, paddingVertical: 16, paddingHorizontal: 40, marginBottom: 12 }}
        >
          <Text style={{ color: '#F4EED8', fontSize: 16, fontWeight: '800', fontFamily: FONTS.serif }}>Create Account</Text>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } } as any)}>
          <Text style={{ color: '#8A7050', fontSize: 14, textDecorationLine: 'underline' }}>Already have an account? Log in</Text>
        </Pressable>
        {/* No "continue as guest": Hunt Mode requires an account, and the
            label promised a mode the product no longer has. */}
        {/* A visible way out. Without it the only exit from this screen was a swipe. */}
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ position: 'absolute', left: 18, top: insets.top + 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(42,74,42,0.12)', justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: '#2A4A2A', fontSize: 16, fontWeight: '600' }}>✕</Text>
        </Pressable>
      </View>
    );
  }


  return (
    <View style={s.artUnderlay}>
    <Animated.View style={[s.screenWrap, { opacity: screenFade }]}>
      <View style={s.bg}>
        <Image
          source={BG_IMAGE}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={artWasReady ? 0 : 160}
          cachePolicy="memory-disk"
          priority="high"
          onLoad={handleImageLoad}
          accessible={false}
        />
        {/* HUNT MODE title + paw divider — separate layer, full opacity */}
        <View
          style={titleStyle}
          pointerEvents="none"
          accessible
          accessibilityRole="header"
          accessibilityLabel="Hunt Mode"
        >
          <Image source={TITLE_IMAGE} style={s.titleImg} contentFit="fill" transition={0} cachePolicy="memory-disk" />
        </View>

        {/* Back button */}
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close Hunt Mode"
          style={[s.backBtn, { top: insets.top + 12 }]}
        >
          <Text style={s.backBtnText}>✕</Text>
        </Pressable>

        {/* How Hunt Mode Works — replays the welcome any time, even after it was
            completed or dismissed. Hidden while the onboarding switch is off. */}
        {onboarding.live && (
          <Pressable
            onPress={() => { logHuntOnboardingReplayed(); setWelcome('replay'); }}
            hitSlop={12}
            style={[s.infoBtn, { top: insets.top + 12 }]}
            accessibilityRole="button"
            accessibilityLabel="How Hunt Mode works"
            testID="hunt-replay-welcome"
          >
            <MaterialIcons name="info-outline" size={20} color="#F2E8D0" />
          </Pressable>
        )}

        {__DEV__ && onboarding.live && (
          <Pressable
            onPress={handleDevReset}
            style={[s.devBtn, { top: insets.top + 12 + 44 }]}
            accessibilityRole="button"
            accessibilityLabel="Developer: reset Hunt onboarding"
            testID="hunt-dev-reset-onboarding"
          >
            <Text style={s.devBtnText}>DEV · reset onboarding</Text>
          </Pressable>
        )}

        <View style={s.spacer} />

        {/* ── Hunt Leaderboard button — sits just above the card, where the old
            "Every find is an adventure" tagline used to be. In normal flow (not
            absolutely positioned) so it can never overlap the card on short
            phones. Slides in with the card. ── */}
        <Animated.View
          style={[
            s.lbWrap,
            COMPACT && s.lbWrapCompact,
            { transform: [{ translateY: cardSlide }] },
          ]}
        >
          <Pressable
            onPress={handleLeaderboard}
            accessibilityRole="button"
            accessibilityLabel="Hunt Leaderboard"
            style={({ pressed }) => [
              s.lbBtn,
              COMPACT && s.lbBtnCompact,
              pressed && { transform: [{ scale: 0.97 }], opacity: 0.92 },
            ]}
          >
            <MaterialIcons name="emoji-events" size={22} color={GOLD} />
            <Text
              style={s.lbBtnText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              HUNT LEADERBOARD
            </Text>
            <MaterialIcons name="emoji-events" size={22} color={GOLD} />
          </Pressable>
        </Animated.View>

        {/* ── Card ──
            Invisible while the welcome is up: it shows through the scrim and pulls the eye
            off "Welcome to Hunt Mode". Kept mounted (just transparent) so nothing shifts
            when the welcome closes, and out of touch and VoiceOver while hidden. */}
        <Animated.View
          style={[
            s.card,
            { marginBottom: insets.bottom + (COMPACT ? 16 : 40) },
            COMPACT && s.cardCompact,
            { transform: [{ translateY: cardSlide }] },
            !!welcome && { opacity: 0 },
          ]}
          pointerEvents={welcome ? 'none' : 'auto'}
          importantForAccessibility={welcome ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={!!welcome}
          testID="hunt-start-card"
        >
          <Text style={s.inputLabel}>HUNT NAME (OPTIONAL)</Text>

          {/* Tap target — opens popup instead of inline keyboard */}
          <Pressable
            ref={coachNameRef as any}
            collapsable={false}
            onPress={openModal}
            style={({ pressed }) => [s.inputTap, pressed && { opacity: 0.75 }]}
          >
            <Text
              style={[
                s.inputTapText,
                !huntName && s.inputTapPlaceholder,
              ]}
              numberOfLines={1}
            >
              {huntName || 'e.g. Goodwill Hunt, Bins Run…'}
            </Text>
            <MaterialIcons name="edit" size={14} color={TEXT_MUTED + '99'} />
          </Pressable>

          <View ref={coachStartRef as any} collapsable={false} style={{ position: 'relative', marginTop: 2 }}>
            {huntAttention !== 'off' && <HuntGlowRing mode={huntAttention} radius={14} />}
            <Pressable
              onPress={handleStartHunt}
              disabled={starting}
              style={({ pressed }) => [
                s.startBtn,
                pressed  && { transform: [{ scale: 0.97 }], opacity: 0.92 },
                starting && { opacity: 0.7 },
              ]}
            >
              <MaterialIcons name="pets" size={20} color={GOLD} />
              <Text style={s.startBtnText}>
                {starting ? 'Starting...' : 'START HUNT'}
              </Text>
              <MaterialIcons name="pets" size={20} color={GOLD} />
            </Pressable>
          </View>

          <Text style={s.hint}>Scan items during your hunt to track your haul</Text>
        </Animated.View>
      </View>

      {/* ── Welcome / replay ── */}
      {welcome && (
        <HuntWelcome
          replay={welcome === 'replay'}
          onStartDemo={handleWelcomeStartDemo}
          onSkip={handleWelcomeSkip}
        />
      )}

      {/* ── Guided demo coach marks (draws nothing outside the demo) ── */}
      <CoachOverlay screen="hunt" />

      {/* ── Hunt Name Popup ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleCancel}
      >
        {/* Dim background — tap outside to cancel */}
        <TouchableWithoutFeedback onPress={handleCancel}>
          <View style={s.modalOverlay} />
        </TouchableWithoutFeedback>

        {/* Plain View — popup is above keyboard zone, no KAV shifting needed */}
        <View style={s.kavWrap} pointerEvents="box-none">
          <View style={s.popup}>
            {/* Title */}
            <Text style={s.popupTitle}>Name Your Hunt</Text>

            {/* Input */}
            <TextInput
              ref={inputRef}
              style={s.popupInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="e.g. Goodwill Hunt, Bins Run, Sunday Thrift…"
              placeholderTextColor={TEXT_MUTED + '88'}
              returnKeyType="done"
              onSubmitEditing={handleConfirm}
              maxLength={40}
              autoCorrect={false}
              selectionColor={GOLD}
            />

            {/* Buttons */}
            <View style={s.popupBtns}>
              <Pressable
                onPress={handleCancel}
                style={({ pressed }) => [s.cancelBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleConfirm}
                style={({ pressed }) => [s.confirmBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.confirmBtnText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  artUnderlay: { flex: 1, backgroundColor: ART_UNDERLAY },
  screenWrap: { flex: 1 },
  bg:         { flex: 1, justifyContent: 'flex-end' },

  backBtn: {
    position:        'absolute',
    left:            18,
    width:           36,
    height:          36,
    borderRadius:    18,
    backgroundColor: 'rgba(0,0,0,0.30)',
    justifyContent:  'center',
    alignItems:      'center',
  },
  backBtnText: { color: '#F2E8D0', fontSize: 16, fontWeight: '600' },
  // Replay (info) button: the same disc as ✕, on the opposite side.
  infoBtn: {
    position: 'absolute', right: 18, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.30)', justifyContent: 'center', alignItems: 'center',
  },

  devBtn: {
    position: 'absolute', right: 18, minHeight: 32, paddingHorizontal: 10, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center',
  },
  devBtnText: { color: '#F2E8D0', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  spacer: { flex: 1 },

  // Fills the title layer's box (the box itself is positioned in the component)
  titleImg: { width: '100%', height: '100%' },

  // ── Hunt Leaderboard button (above the card) ───────────────────────────────
  // Matches the card directly beneath it (same cream fill, gold hairline and
  // shadow) with green serif caps and gold trophies, so START HUNT — the one
  // green button — stays the primary action.
  lbWrap: {
    marginHorizontal: 16,
    marginBottom:     14,
  },
  lbBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             10,
    backgroundColor: CARD_BG,
    borderRadius:    14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth:     2,
    borderColor:     GOLD,
    shadowColor:     '#0A1A0A',
    shadowOffset:    { width: 0, height: -2 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       8,
  },
  lbWrapCompact: { marginBottom: 10 },
  lbBtnCompact:  { paddingVertical: 10 },
  cardCompact:   { padding: 16, paddingBottom: 18 },
  lbBtnText: {
    flexShrink:    1,
    fontFamily:    FONTS.serif,
    fontSize:      16,
    fontWeight:    '800',
    color:         FOREST,
    letterSpacing: 1.8,
  },

  // ── Main entry card ────────────────────────────────────────────────────────
  card: {
    marginHorizontal: 16,
    backgroundColor:  CARD_BG,
    borderRadius:     20,
    padding:          20,
    paddingBottom:    22,
    gap:              12,
    borderWidth:      1,
    borderColor:      GOLD + '40',
    shadowColor:      '#0A1A0A',
    shadowOffset:     { width: 0, height: -4 },
    shadowOpacity:    0.22,
    shadowRadius:     16,
    elevation:        12,
  },
  inputLabel: {
    fontSize:      10,
    fontWeight:    '700',
    color:         TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily:    FONTS.serif,
  },

  // Tap target replaces inline TextInput on the card
  inputTap: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   CREAM,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       CREAM_DARK,
    paddingHorizontal: 14,
    paddingVertical:   13,
    gap:               8,
  },
  inputTapText:        { flex: 1, fontSize: 14, color: TEXT_DARK },
  inputTapPlaceholder: { color: TEXT_MUTED + 'AA' },

  startBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             10,
    backgroundColor: FOREST,
    borderRadius:    14,
    paddingVertical: 17,
    borderWidth:     1.5,
    borderColor:     GOLD + '60',
    shadowColor:     FOREST_DARK,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.45,
    shadowRadius:    10,
    elevation:       6,
  },
  startBtnText: {
    fontFamily:    FONTS.serif,
    fontSize:      18,
    fontWeight:    '800',
    color:         CREAM,
    letterSpacing: 2,
  },
  hint: {
    fontSize: 11, color: TEXT_MUTED, textAlign: 'center', lineHeight: 16,
  },

  // ── Modal ──────────────────────────────────────────────────────────────────
  // Full-screen dim layer — tap outside to cancel
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 20, 10, 0.55)',
  },

  // Fixed absolute top — popup sits at lion's snout level (~35% from top).
  // No KeyboardAvoidingView shifting needed: popup is above the keyboard zone.
  kavWrap: {
    position:      'absolute',
    left:          0,
    right:         0,
    top:           SCREEN_H * 0.33,
    pointerEvents: 'box-none',
  },

  popup: {
    marginHorizontal: 20,
    marginTop:        0,
    backgroundColor:  CREAM,
    borderRadius:     20,
    padding:          22,
    gap:              14,
    shadowColor:      '#0A1A0A',
    shadowOffset:     { width: 0, height: -4 },
    shadowOpacity:    0.18,
    shadowRadius:     20,
    elevation:        16,
    borderWidth:      1,
    borderColor:      GOLD + '35',
  },
  popupTitle: {
    fontFamily:  FONTS.serif,
    fontSize:    18,
    fontWeight:  '800',
    color:       TEXT_DARK,
    textAlign:   'center',
    letterSpacing: 0.2,
  },
  popupInput: {
    backgroundColor:   '#FFF8EC',
    borderRadius:      12,
    borderWidth:       1.5,
    borderColor:       GOLD + '55',
    paddingHorizontal: 14,
    paddingVertical:   13,
    fontSize:          15,
    color:             TEXT_DARK,
  },
  popupBtns: {
    flexDirection: 'row',
    gap:           10,
  },
  cancelBtn: {
    flex:            1,
    paddingVertical: 14,
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     TEXT_MUTED + '55',
    alignItems:      'center',
  },
  cancelBtnText: {
    fontSize:   15,
    fontWeight: '600',
    color:      TEXT_MUTED,
  },
  confirmBtn: {
    flex:            1,
    paddingVertical: 14,
    borderRadius:    12,
    backgroundColor: FOREST,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     GOLD + '50',
    shadowColor:     FOREST_DARK,
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.35,
    shadowRadius:    6,
    elevation:       4,
  },
  confirmBtnText: {
    fontFamily:    FONTS.serif,
    fontSize:      15,
    fontWeight:    '800',
    color:         CREAM,
    letterSpacing: 0.5,
  },
});