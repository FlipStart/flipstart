/**
 * PhotoReview — Vintage parchment confirmation screen
 *
 * Matches the reference design: parchment bg, serif fonts, green accents,
 * swipeable photo carousel with arrows + counter, slot thumbnails with
 * X-remove, tips grid, premium analyze button.
 *
 * ALL photo logic, slot state, and analyze flow unchanged.
 */

import {
  View, Text, Pressable, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';

import { ScreenContainer } from '@/components/screen-container';
import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';
import { captureFromCamera, captureFromGallery } from '@/lib/capture';
import type { CapturedPhoto, CapturedPhotoSet, PhotoSlot } from '@/lib/capture';
import { SLOT_LABELS, SLOT_ORDER } from '@/lib/capture';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhotoReviewProps {
  photoSet:           CapturedPhotoSet;
  onAnalyze:          () => void;
  onRetake:           () => void;
  isAnalyzing:        boolean;
  onPhotoSetUpdate?:  (set: CapturedPhotoSet) => void;
}

// ─── Palette (vintage parchment) ─────────────────────────────────────────────

const PARCHMENT    = '#EDE0C4';   // warm parchment page background
const PARCHMENT_D  = '#D9C9A3';   // slightly darker — card/section bg
const PARCHMENT_DD = '#C8B488';   // border / divider tone
const FOREST       = '#1F3D1F';   // deep forest green — headers, labels
const FOREST_BTN   = '#2B5430';   // analyze button fill
const FOREST_LIGHT = '#3A6B3A';   // lighter green accents
const CREAM_TEXT   = '#F4EED8';   // light text on dark green
const WARM_BROWN   = '#5A3A1A';   // secondary text
const GOLD         = '#BE9C2C';   // gold accents
const CARD_BG      = 'rgba(255,245,220,0.85)';  // translucent warm card

// ─── Tips ─────────────────────────────────────────────────────────────────────

const TIPS: { icon: keyof typeof MaterialIcons.glyphMap; label: string }[] = [
  { icon: 'wb-sunny',            label: 'Good\nlighting'   },
  { icon: 'filter-center-focus', label: 'Centered\nsubject' },
  { icon: 'layers',              label: 'Single\nitem'      },
  { icon: 'crop-free',           label: 'Flat, clear\nbg'   },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PhotoReview({
  photoSet, onAnalyze, onRetake, isAnalyzing, onPhotoSetUpdate,
}: PhotoReviewProps) {
  const { width: screenW } = useWindowDimensions();

  // Which slot is shown in the carousel
  const [viewingSlot, setViewingSlot] = useState<PhotoSlot>('front');

  const getSlotPhoto = (slot: PhotoSlot): CapturedPhoto | undefined =>
    slot === 'front' ? photoSet.front : slot === 'back' ? photoSet.back : photoSet.tag;

  const filledSlots = SLOT_ORDER.filter(sl => !!getSlotPhoto(sl));
  const viewingPhoto = getSlotPhoto(viewingSlot) ?? photoSet.front ?? photoSet.primary;
  const viewingIndex = filledSlots.indexOf(viewingSlot);
  const totalFilled  = filledSlots.length;

  // Navigate carousel
  const goNext = () => {
    const idx = filledSlots.indexOf(viewingSlot);
    if (idx < filledSlots.length - 1) setViewingSlot(filledSlots[idx + 1]);
  };
  const goPrev = () => {
    const idx = filledSlots.indexOf(viewingSlot);
    if (idx > 0) setViewingSlot(filledSlots[idx - 1]);
  };

  // Remove a photo from a slot
  const handleRemove = (slot: PhotoSlot) => {
    if (slot === 'front') {
      Alert.alert('Remove Front Photo?', 'This is the primary photo. Removing it will clear the review.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: () => {
            const next: CapturedPhotoSet = { back: photoSet.back, tag: photoSet.tag };
            onPhotoSetUpdate?.(next);
            onRetake();
          },
        },
      ]);
      return;
    }
    const next: CapturedPhotoSet = { ...photoSet, [slot]: undefined };
    delete (next as any)[slot];
    onPhotoSetUpdate?.(next);
    // If we were viewing that slot, move to front
    if (viewingSlot === slot) setViewingSlot('front');
  };

  // Add / replace a slot
  const handleAddOrReplace = (slot: PhotoSlot) => {
    Alert.alert(
      `${SLOT_LABELS[slot]} Photo`,
      getSlotPhoto(slot) ? 'Replace this photo?' : 'Add a photo for this slot.',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            const p = await captureFromCamera();
            if (!p) return;
            onPhotoSetUpdate?.({ ...photoSet, [slot]: p });
            setViewingSlot(slot);
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => {
            const p = await captureFromGallery();
            if (!p) return;
            onPhotoSetUpdate?.({ ...photoSet, [slot]: p });
            setViewingSlot(slot);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleRetakeTap = () => {
    Alert.alert('Photos', 'What would you like to do?', [
      {
        text: 'Take Photo',
        onPress: async () => {
          const p = await captureFromCamera();
          if (p) onPhotoSetUpdate?.({ ...photoSet, front: p }) ?? onRetake();
        },
      },
      {
        text: 'Choose from Library',
        onPress: async () => {
          const p = await captureFromGallery();
          if (p) onPhotoSetUpdate?.({ ...photoSet, front: p }) ?? onRetake();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Carousel image width
  const carouselW = screenW - 40;

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <Pressable
            onPress={onRetake}
            hitSlop={10}
            style={({ pressed }) => [s.headerCircleBtn, pressed && { opacity: 0.65 }]}
          >
            <MaterialIcons name="arrow-back" size={20} color={WARM_BROWN} />
          </Pressable>

          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>FlipStart</Text>
            <Text style={s.headerSubtitle}>CONFIRM ITEM</Text>
          </View>

          <Pressable hitSlop={10} style={s.headerCircleBtn}>
            <MaterialIcons name="settings" size={20} color={WARM_BROWN} />
          </Pressable>
        </View>

        {/* ── "Is this the item?" title ───────────────────────────────────── */}
        <View style={s.titleRow}>
          <Text style={s.titleDecorator}>✦</Text>
          <Text style={s.titleText}>Is this the item?</Text>
          <Text style={s.titleDecorator}>✦</Text>
        </View>
        <Text style={s.titleSub}>Review your photos and make sure they're clear.</Text>

        {/* ── Photo carousel ─────────────────────────────────────────────── */}
        <View style={[s.carouselWrap, { width: carouselW }]}>
          {/* Photo frame */}
          <View style={s.carouselFrame}>
            {/* Active slot badge top-left */}
            <View style={s.slotActiveBadge}>
              <Text style={s.slotActiveBadgeText}>
                {SLOT_LABELS[viewingSlot].toUpperCase()}
              </Text>
            </View>

            {viewingPhoto ? (
              <Image
                source={{ uri: viewingPhoto.uri }}
                style={s.carouselImage}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={s.carouselPlaceholder}>
                <MaterialIcons name="photo-camera" size={48} color={PARCHMENT_DD} />
              </View>
            )}

            {/* Left arrow */}
            {viewingIndex > 0 && (
              <Pressable
                onPress={goPrev}
                style={({ pressed }) => [s.arrowBtn, s.arrowLeft, pressed && { opacity: 0.7 }]}
              >
                <MaterialIcons name="chevron-left" size={26} color={WARM_BROWN} />
              </Pressable>
            )}

            {/* Right arrow */}
            {viewingIndex < totalFilled - 1 && (
              <Pressable
                onPress={goNext}
                style={({ pressed }) => [s.arrowBtn, s.arrowRight, pressed && { opacity: 0.7 }]}
              >
                <MaterialIcons name="chevron-right" size={26} color={WARM_BROWN} />
              </Pressable>
            )}

            {/* Counter badge */}
            {totalFilled > 1 && (
              <View style={s.counterBadge}>
                <Text style={s.counterText}>
                  {viewingIndex + 1} / {totalFilled}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Slot thumbnails ─────────────────────────────────────────────── */}
        <View style={s.thumbRow}>
          {SLOT_ORDER.map((slot) => {
            const photo   = getSlotPhoto(slot);
            const active  = slot === viewingSlot;
            const isFront = slot === 'front';
            return (
              <View key={slot} style={s.thumbItem}>
                <Pressable
                  onPress={() => photo ? setViewingSlot(slot) : handleAddOrReplace(slot)}
                  style={[s.thumbFrame, active && s.thumbFrameActive, !photo && s.thumbFrameEmpty]}
                >
                  {photo ? (
                    <Image source={{ uri: photo.uri }} style={s.thumbImg} contentFit="cover" />
                  ) : (
                    <View style={s.thumbPlaceholderInner}>
                      <MaterialIcons name="add-a-photo" size={20} color={isFront ? FOREST : PARCHMENT_DD} />
                    </View>
                  )}

                  {/* ✕ remove button on filled slots */}
                  {photo && (
                    <Pressable
                      onPress={() => handleRemove(slot)}
                      style={s.removeBtn}
                      hitSlop={6}
                    >
                      <View style={s.removeBtnInner}>
                        <MaterialIcons name="close" size={10} color="#FFF" />
                      </View>
                    </Pressable>
                  )}
                </Pressable>

                <Text style={[s.thumbLabel, active && s.thumbLabelActive]}>
                  {photo ? SLOT_LABELS[slot] : `${SLOT_LABELS[slot]}${isFront ? '' : ' (optional)'}`}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Quality hint if only one photo ─────────────────────────────── */}
        {totalFilled === 1 && (
          <View style={s.hintBanner}>
            <MaterialIcons name="info-outline" size={13} color={FOREST_LIGHT} />
            <Text style={s.hintBannerText}>
              Add back + tag photos for a more accurate result.
            </Text>
          </View>
        )}

        {/* ── Tips card ───────────────────────────────────────────────────── */}
        <View style={s.tipsCard}>
          {/* Corner ornaments */}
          <View style={[s.cardOrnament, s.ornTL]} />
          <View style={[s.cardOrnament, s.ornTR]} />
          <View style={[s.cardOrnament, s.ornBL]} />
          <View style={[s.cardOrnament, s.ornBR]} />

          <Text style={s.tipsHeader}>✦  TIPS FOR THE BEST RESULTS  ✦</Text>
          <View style={s.tipsGrid}>
            {TIPS.map((tip) => (
              <View key={tip.label} style={s.tipItem}>
                <MaterialIcons name={tip.icon} size={28} color={FOREST} />
                <Text style={s.tipLabel}>{tip.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Analyze button ──────────────────────────────────────────────── */}
        <Pressable
          onPress={onAnalyze}
          disabled={isAnalyzing}
          style={({ pressed }) => [
            s.analyzeBtn,
            pressed && !isAnalyzing && { transform: [{ scale: 0.97 }], opacity: 0.92 },
            isAnalyzing && { opacity: 0.72 },
          ]}
        >
          {isAnalyzing
            ? <ActivityIndicator size="small" color={CREAM_TEXT} />
            : <MaterialIcons name="auto-awesome" size={20} color={CREAM_TEXT} />}
          <Text style={s.analyzeBtnText}>
            {isAnalyzing ? 'Preparing...' : 'Analyze Item'}
          </Text>
        </Pressable>

        {/* ── Retake / add button ─────────────────────────────────────────── */}
        <Pressable
          onPress={handleRetakeTap}
          disabled={isAnalyzing}
          style={({ pressed }) => [s.retakeBtn, pressed && { opacity: 0.65 }, isAnalyzing && { opacity: 0.4 }]}
        >
          <MaterialIcons name="replay" size={15} color={WARM_BROWN} />
          <Text style={s.retakeBtnText}>Retake Photos</Text>
        </Pressable>

        {/* ── Privacy note ────────────────────────────────────────────────── */}
        <View style={s.privacyRow}>
          <MaterialIcons name="lock-outline" size={11} color={PARCHMENT_DD} />
          <Text style={s.privacyText}>
            Your photos are only used for analysis and are never stored.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: PARCHMENT },
  scroll: {
    alignItems:        'center',
    paddingHorizontal: 20,
    paddingBottom:     40,
    paddingTop:        0,
    backgroundColor:   PARCHMENT,
  },

  // ── Header
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    width:          '100%',
    paddingTop:     14,
    paddingBottom:  6,
  },
  headerCircleBtn: {
    width:           42,
    height:          36,
    borderRadius:    20,
    backgroundColor: PARCHMENT_D,
    justifyContent:  'center',
    alignItems:      'center',
    shadowColor:     WARM_BROWN,
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.12,
    shadowRadius:    3,
    elevation:       2,
  },
  headerCenter:   { alignItems: 'center' },
  headerTitle:    { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '700', color: FOREST, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: FONTS.serif, fontSize: 12, fontWeight: '700', color: FOREST_LIGHT, letterSpacing: 2, marginTop: -1 },

  // ── Title
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  titleDecorator: { fontSize: 16, color: GOLD },
  titleText: {
    fontFamily: FONTS.serif, fontSize: 22, fontWeight: '700',
    color: FOREST, letterSpacing: 0.1,
  },
  titleSub: {
    fontSize: 13, color: WARM_BROWN, marginTop: 3, marginBottom: 12,
    textAlign: 'center',
  },

  // ── Carousel
  carouselWrap: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  carouselFrame: {
    width:           '100%',
    aspectRatio:     4 / 3,
    borderRadius:    16,
    overflow:        'hidden',
    backgroundColor: PARCHMENT_D,
    borderWidth:     2,
    borderColor:     PARCHMENT_DD,
    shadowColor:     WARM_BROWN,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.22,
    shadowRadius:    10,
    elevation:       6,
    position:        'relative',
  },
  carouselImage:       { width: '100%', height: '100%' },
  carouselPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Slot badge top-left
  slotActiveBadge: {
    position:          'absolute',
    top:               10,
    left:              10,
    zIndex:            10,
    backgroundColor:   FOREST_BTN,
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      6,
  },
  slotActiveBadgeText: {
    fontFamily:    FONTS.serif,
    fontSize:      11,
    fontWeight:    '700',
    color:         CREAM_TEXT,
    letterSpacing: 1.5,
  },

  // Arrow buttons
  arrowBtn: {
    position:        'absolute',
    top:             '50%',
    marginTop:       -22,
    width:           44,
    height:          44,
    borderRadius:    22,
    backgroundColor: 'rgba(217,201,163,0.88)',
    justifyContent:  'center',
    alignItems:      'center',
    shadowColor:     WARM_BROWN,
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.15,
    shadowRadius:    4,
    elevation:       3,
  },
  arrowLeft:  { left: 8 },
  arrowRight: { right: 8 },

  // Counter badge
  counterBadge: {
    position:          'absolute',
    bottom:            10,
    alignSelf:         'center',
    left:              '50%',
    marginLeft:        -30,
    width:             60,
    backgroundColor:   'rgba(217,201,163,0.88)',
    borderRadius:      20,
    paddingVertical:   3,
    alignItems:        'center',
  },
  counterText: {
    fontFamily: FONTS.serif,
    fontSize:   14,
    fontWeight: '700',
    color:      FOREST,
  },

  // ── Slot thumbnails
  thumbRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:            14,
    width:          '100%',
    marginBottom:   10,
  },
  thumbItem:       { alignItems: 'center', gap: 5, position: 'relative' },
  thumbFrame:      { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: PARCHMENT_DD },
  thumbFrameActive:{ borderColor: FOREST, borderWidth: 2.5 },
  thumbFrameEmpty: { borderStyle: 'dashed', borderColor: PARCHMENT_DD, backgroundColor: PARCHMENT_D },
  thumbImg:        { width: '100%', height: '100%' },
  thumbPlaceholderInner: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: PARCHMENT_D },
  thumbLabel:      { fontFamily: FONTS.serif, fontSize: 11, fontWeight: '700', color: WARM_BROWN, textAlign: 'center' },
  thumbLabelActive:{ color: FOREST },

  removeBtn:      { position: 'absolute', top: -8, right: -8, zIndex: 10 },
  removeBtnInner: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(100,30,20,0.85)',
    borderWidth: 1.5, borderColor: '#E8897A',
    justifyContent: 'center', alignItems: 'center',
  },

  // ── Hint banner
  hintBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    backgroundColor:   'rgba(190,156,44,0.12)',
    borderRadius:      8,
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderWidth:       1,
    borderColor:       GOLD + '50',
    width:             '100%',
    marginBottom:      8,
  },
  hintBannerText: { fontSize: 11, color: WARM_BROWN, flex: 1 },

  // ── Tips card
  tipsCard: {
    width:             '100%',
    backgroundColor:   CARD_BG,
    borderRadius:      14,
    borderWidth:       1.5,
    borderColor:       PARCHMENT_DD,
    padding:           16,
    marginBottom:      16,
    position:          'relative',
    shadowColor:       WARM_BROWN,
    shadowOffset:      { width: 0, height: 2 },
    shadowOpacity:     0.10,
    shadowRadius:      6,
    elevation:         3,
  },
  // Corner ornaments — thin L-shaped brackets
  cardOrnament: {
    position:  'absolute',
    width:     14,
    height:    14,
    borderColor: PARCHMENT_DD,
  },
  ornTL: { top: 4,  left: 4,  borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  ornTR: { top: 4,  right: 4, borderTopWidth: 1.5, borderRightWidth: 1.5 },
  ornBL: { bottom: 4, left: 4,  borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  ornBR: { bottom: 4, right: 4, borderBottomWidth: 1.5, borderRightWidth: 1.5 },

  tipsHeader: {
    fontFamily:    FONTS.serif,
    fontSize:      12,
    fontWeight:    '700',
    color:         FOREST,
    textAlign:     'center',
    letterSpacing: 1,
    marginBottom:  14,
  },
  tipsGrid:  { flexDirection: 'row', justifyContent: 'space-around' },
  tipItem:   { alignItems: 'center', gap: 6, flex: 1 },
  tipLabel:  {
    fontFamily:  FONTS.serif,
    fontSize:    10,
    fontWeight:  '600',
    color:       FOREST,
    textAlign:   'center',
    lineHeight:  14,
  },

  // ── Buttons
  analyzeBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             10,
    width:           '100%',
    paddingVertical: 17,
    borderRadius:    50,
    backgroundColor: FOREST_BTN,
    borderWidth:     1,
    borderColor:     '#1A3D1A',
    marginBottom:    10,
    shadowColor:     FOREST,
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.28,
    shadowRadius:    7,
    elevation:       5,
  },
  analyzeBtnText: {
    fontFamily:    FONTS.serif,
    fontSize:      18,
    fontWeight:    '700',
    color:         CREAM_TEXT,
    letterSpacing: 0.2,
  },

  retakeBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    width:           '100%',
    paddingVertical: 13,
    borderRadius:    50,
    borderWidth:     1.5,
    borderColor:     PARCHMENT_DD,
    backgroundColor: 'rgba(217,201,163,0.40)',
    marginBottom:    12,
  },
  retakeBtnText: {
    fontFamily: FONTS.serif,
    fontSize:   15,
    fontWeight: '600',
    color:      WARM_BROWN,
  },

  // ── Privacy note
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  privacyText: { fontSize: 10, color: PARCHMENT_DD, textAlign: 'center' },
});