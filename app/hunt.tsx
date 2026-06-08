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
  ImageBackground, Animated, Platform, Keyboard,
  Modal, TouchableWithoutFeedback, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRef, useState, useEffect } from 'react';

import { startHunt } from '@/lib/hunt-context';
import { useAuth } from '@/lib/auth-context';
import { logHuntModeOpened, logHuntStarted } from '@/lib/analytics';
import { FONTS } from '@/constants/typography';

// ─── Assets ───────────────────────────────────────────────────────────────────

const BG_IMAGE   = require('@/assets/images/hunt-mode-bg.png');
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function HuntScreen() {
  const router  = useRouter();
  const { user, loading: authLoading } = useAuth();
  const insets  = useSafeAreaInsets();
  const player  = useAudioPlayer(ROAR_SOUND);

  // Confirmed hunt name shown on the card
  const [huntName, setHuntName] = useState('');
  // Draft inside the modal (discarded on Cancel, committed on Confirm)
  const [draft, setDraft]         = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [starting, setStarting]   = useState(false);

  const inputRef = useRef<TextInput>(null);

  // Track Hunt Mode screen open — fires once on mount
  useEffect(() => {
    logHuntModeOpened();
  }, []);

  // ── Screen entrance animation ──────────────────────────────────────────────
  const screenFade = useRef(new Animated.Value(0)).current;
  const cardSlide  = useRef(new Animated.Value(32)).current;

  const handleImageLoad = () => {
    Animated.parallel([
      Animated.timing(screenFade, {
        toValue: 1, duration: 200, useNativeDriver: true,
      }),
      Animated.spring(cardSlide, {
        toValue: 0, tension: 72, friction: 12, useNativeDriver: true,
      }),
    ]).start();
  };

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

    const session = startHunt(huntName);
    logHuntStarted(huntName || 'Unnamed Hunt');
    if (__DEV__) console.log(`[hunt] session started — id:${session.id} name:"${session.name}"`);

    router.replace('/hunt-active' as any);
    setStarting(false);
  };

  const handleBack = () => router.back();

  if (!authLoading && !user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F0E8D4', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <Text style={{ fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 10 }}>Hunt Mode</Text>
        <Text style={{ fontSize: 14, color: '#8A7050', textAlign: 'center', lineHeight: 21, marginBottom: 28 }}>Create an account to save hunts, XP, and streaks.</Text>
        <Pressable onPress={() => router.push({ pathname: '/auth', params: { mode: 'signup' } } as any)}
          style={{ backgroundColor: FOREST, borderRadius: 50, paddingVertical: 14, paddingHorizontal: 36, marginBottom: 12 }}>
          <Text style={{ color: CREAM, fontSize: 15, fontWeight: '700', fontFamily: FONTS.serif }}>Create Account</Text>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } } as any)}>
          <Text style={{ color: '#8A7050', fontSize: 14, textDecorationLine: 'underline' }}>Log In</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: '#8A7050', fontSize: 13 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }


  return (
    <Animated.View style={[s.screenWrap, { opacity: screenFade }]}>
      <ImageBackground
        source={BG_IMAGE}
        style={s.bg}
        resizeMode="cover"
        onLoad={handleImageLoad}
      >
        {/* Back button */}
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={[s.backBtn, { top: insets.top + 12 }]}
        >
          <Text style={s.backBtnText}>✕</Text>
        </Pressable>

        <View style={s.spacer} />

        {/* ── Card ── */}
        <Animated.View
          style={[
            s.card,
            { marginBottom: insets.bottom + 40 },
            { transform: [{ translateY: cardSlide }] },
          ]}
        >
          <Text style={s.inputLabel}>HUNT NAME (OPTIONAL)</Text>

          {/* Tap target — opens popup instead of inline keyboard */}
          <Pressable
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

          <Text style={s.hint}>Scan items during your hunt to track your haul</Text>
        </Animated.View>
      </ImageBackground>

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
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
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

  spacer: { flex: 1 },

  // ── Entry card ─────────────────────────────────────────────────────────────
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
    marginTop:       2,
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